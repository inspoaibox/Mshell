// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildAllowFirewallCommand,
  buildDeleteFirewallCommand,
  buildEnableFirewallCommand,
  buildConfirmFirewallCommand,
  buildFirewallDetectCommand,
  buildInstallFirewallCommand
} from '../firewall-commands'
import { createFirewallRulePlan, shellQuote } from '../firewall-model'
import { firewallOverview, unwrapRoot, zoneLines } from './firewall-fixtures'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
let directory: string
const mocks = String.raw`
flock(){ return 0; }
systemctl(){
  printf 'systemctl %s\n' "$*" >> "$FW_TEST_ROOT/trace"
  case "$1" in
    is-enabled) [ -f "$FW_TEST_ROOT/enabled" ];;
    enable) touch "$FW_TEST_ROOT/enabled";;
    disable) rm -f "$FW_TEST_ROOT/enabled";;
    start) touch "$FW_TEST_ROOT/active"; sed -n 's/^permanent|/runtime|/p' "$FW_TEST_ROOT/firewalld" > "$FW_TEST_ROOT/start-rules";cat "$FW_TEST_ROOT/start-rules" >> "$FW_TEST_ROOT/firewalld";;
    stop) case "$2" in *.timer) :;; *) rm -f "$FW_TEST_ROOT/active";;esac;;
  esac
}
systemd-run(){ printf '%s\n' "$*" >> "$FW_TEST_ROOT/timers"; }
sim_iptables(){
  local f=$1;shift
  case " $* " in
    *' -S INPUT '*) printf '%s\n' '-P INPUT DROP'; if [ -f "$FW_TEST_ROOT/jump$f" ];then printf '%s\n' '-A INPUT -j MSHELL-INPUT';fi;;
    *' -S MSHELL-INPUT '*) [ -f "$FW_TEST_ROOT/kernel$f" ] || return 1;printf '%s\n' '-N MSHELL-INPUT';cat "$FW_TEST_ROOT/kernel$f";;
    *' -C INPUT '*) [ -f "$FW_TEST_ROOT/jump$f" ];;
    *) printf 'UNEXPECTED LIVE EDIT %s\n' "$*" >> "$FW_TEST_ROOT/trace";return 1;;
  esac
}
iptables(){ sim_iptables 4 "$@"; }
ip6tables(){ sim_iptables 6 "$@"; }
sim_restore(){
  local f=$1;shift
  cat > "$FW_TEST_ROOT/tx$f"
  case " $* " in
    *' --test '*) printf 'validate%s\n' "$f" >> "$FW_TEST_ROOT/trace";return 0;;
  esac
  printf 'commit%s\n' "$f" >> "$FW_TEST_ROOT/trace"
  if [ -f "$FW_TEST_ROOT/fail$f" ] && grep -q -- '--dport 443' "$FW_TEST_ROOT/tx$f";then rm -f "$FW_TEST_ROOT/fail$f";echo 'simulated restore failure' >&2;return 1;fi
  grep '^-A MSHELL-INPUT ' "$FW_TEST_ROOT/tx$f" > "$FW_TEST_ROOT/kernel$f.next" || true
  mv "$FW_TEST_ROOT/kernel$f.next" "$FW_TEST_ROOT/kernel$f"
  grep -q '^-I INPUT' "$FW_TEST_ROOT/tx$f" && touch "$FW_TEST_ROOT/jump$f"
  grep -q '^-D INPUT' "$FW_TEST_ROOT/tx$f" && rm -f "$FW_TEST_ROOT/jump$f"
  grep -q '^-X MSHELL-INPUT' "$FW_TEST_ROOT/tx$f" && rm -f "$FW_TEST_ROOT/kernel$f"
  return 0
}
iptables-restore(){ sim_restore 4 "$@"; }
ip6tables-restore(){ sim_restore 6 "$@"; }
firewall-cmd(){
  if [ "$1" = --state ];then [ -f "$FW_TEST_ROOT/active" ] && printf 'running\n';return;fi
  local scope=runtime zone='' operation='' definition=''
  for arg in "$@";do case "$arg" in
    --permanent) scope=permanent;;
    --zone=*) zone="${'$'}{arg#*=}";;
    --query-*=*) operation=query;definition="${'$'}{arg#*=}";;
    --add-*=*) operation=add;definition="${'$'}{arg#*=}";;
    --remove-*=*) operation=remove;definition="${'$'}{arg#*=}";;
    --reload) echo 'unexpected reload' >&2;return 1;;
  esac;done
  local entry="$scope|$zone|$definition"
  printf '%s %s\n' "$operation" "$entry" >> "$FW_TEST_ROOT/trace"
  case "$operation" in
    query) grep -Fqx -- "$entry" "$FW_TEST_ROOT/firewalld";;
    add) if [ "$scope" = permanent ] && [ -f "$FW_TEST_ROOT/fail-firewalld" ];then echo 'simulated permanent failure' >&2;return 1;fi
      printf '%s\n' "$entry" >> "$FW_TEST_ROOT/firewalld";;
    remove) grep -Fxv -- "$entry" "$FW_TEST_ROOT/firewalld" > "$FW_TEST_ROOT/fw.next" || true;mv "$FW_TEST_ROOT/fw.next" "$FW_TEST_ROOT/firewalld";;
  esac
}
firewall-offline-cmd(){ firewall-cmd --permanent "$@"; }
ufw(){ printf 'ufw %s\n' "$*" >> "$FW_TEST_ROOT/trace";case "$*" in *enable*) touch "$FW_TEST_ROOT/active";; *disable*) rm -f "$FW_TEST_ROOT/active";;esac; }
export -f flock systemctl systemd-run sim_iptables iptables ip6tables sim_restore iptables-restore ip6tables-restore firewall-cmd firewall-offline-cmd ufw
`
function relocate(body: string) {
  for (const [from, to] of [
    ['/run/mshell-firewall', 'run'],
    ['/etc/mshell', 'etc'],
    ['/usr/local/sbin', 'sbin'],
    ['/etc/systemd/system', 'units']
  ])
    body = body.split(from).join(directory.replace(/\\/g, '/') + '/' + to)
  return body
}
function execute(command: string) {
  return spawnSync(bash, ['--noprofile', '--norc'], {
    input:
      `export FW_TEST_ROOT=${shellQuote(directory.replace(/\\/g, '/'))}\n` +
      mocks +
      '\n' +
      relocate(unwrapRoot(command)),
    encoding: 'utf8'
  })
}
const file = (path: string) => join(directory, path)
const text = (path: string) => readFileSync(file(path), 'utf8')
const records = ['4|tcp|2222|203.0.113.8', '6|tcp|2222|2001:db8::8']
function overview() {
  return firewallOverview([
    ...text('etc/firewall.rules')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => 'CONFIG|persistent|' + row),
    ...text('run/runtime.rules')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => 'CONFIG|runtime|' + row),
    ...[4, 6].flatMap((f) =>
      text('kernel' + f)
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((row) => `RULE_RAW|iptables|${f}|${row}`)
    )
  ])
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mshell-firewall-test-'))
  for (const path of ['run', 'etc', 'sbin', 'units']) mkdirSync(file(path))
  writeFileSync(file('etc/firewall.rules'), records.join('\n') + '\n')
  writeFileSync(file('run/runtime.rules'), '')
  for (const family of [4, 6]) {
    writeFileSync(
      file('kernel' + family),
      `-A MSHELL-INPUT -p tcp -s ${family === 4 ? '203.0.113.8' : '2001:db8::8'} --dport 2222 -j ACCEPT\n`
    )
    writeFileSync(file('jump' + family), '')
  }
  writeFileSync(file('trace'), '')
  writeFileSync(file('firewalld'), 'runtime|external|8080/tcp\n')
  writeFileSync(file('unrelated'), 'DOCKER and unrelated policies unchanged')
})
afterEach(() => {
  if (resolve(dirname(directory)) === resolve(tmpdir()))
    rmSync(directory, { recursive: true, force: true })
})
describe.skipIf(process.platform === 'win32' && !existsSync(bash))(
  'real shell transaction flow with isolated firewall simulators',
  () => {
    const plan = (persist = true) =>
      createFirewallRulePlan({
        tool: 'iptables',
        ports: '443',
        protocol: 'tcp',
        sourceMode: 'any',
        customSources: '',
        sshClientIp: '203.0.113.8',
        persist
      })
    it('validates both families first, commits atomically and preserves unrelated tables', () => {
      const result = execute(buildAllowFirewallCommand(plan(), overview()))
      expect(result.status, result.stderr).toBe(0)
      const trace = text('trace')
      expect(trace.indexOf('validate6')).toBeLessThan(trace.indexOf('commit4'))
      expect(trace).not.toContain('UNEXPECTED LIVE EDIT')
      expect(text('kernel4')).toContain('--dport 443')
      expect(text('kernel6')).toContain('--dport 443')
      expect(text('etc/firewall.rules')).toContain('4|tcp|443|*')
      expect(text('unrelated')).toBe('DOCKER and unrelated policies unchanged')
    })
    it('rolls IPv4 back if IPv6 fails, retaining original configuration', () => {
      const before4 = text('kernel4'),
        before6 = text('kernel6'),
        beforeConfig = text('etc/firewall.rules')
      writeFileSync(file('fail6'), '')
      const result = execute(buildAllowFirewallCommand(plan(), overview()))
      expect(result.status).not.toBe(0)
      expect(text('trace')).toContain('commit4')
      expect(result.stderr).toContain('simulated restore failure')
      expect(result.stdout).not.toContain('__MSHELL_FIREWALL_COMMITTED__')
      expect(text('kernel4')).toBe(before4)
      expect(text('kernel6')).toBe(before6)
      expect(text('etc/firewall.rules')).toBe(beforeConfig)
    })
    it('can delete temporary rules by registry identity while preserving permanent SSH rules', () => {
      expect(execute(buildAllowFirewallCommand(plan(false), overview())).status).toBe(0)
      const data = overview(),
        rule = data.rules.find((r) => r.port === '443' && r.family === 'IPv4')!
      expect(rule.deletable).toBe(true)
      const result = execute(buildDeleteFirewallCommand(rule, data))
      expect(result.status, result.stderr).toBe(0)
      expect(text('run/runtime.rules')).not.toContain('4|tcp|443|*')
      expect(text('kernel4')).not.toContain('--dport 443')
      expect(text('kernel4')).toContain('--dport 2222')
    })
    it('compensates only newly changed Firewalld objects without removing other runtime rules', () => {
      const data = firewallOverview(
        [...zoneLines('runtime'), ...zoneLines('permanent')],
        'firewalld'
      )
      const fwPlan = createFirewallRulePlan({
        tool: 'firewalld',
        ports: '5432',
        protocol: 'tcp',
        sourceMode: 'current',
        customSources: '',
        sshClientIp: data.sshClientIp,
        zone: 'external'
      })
      writeFileSync(file('fail-firewalld'), '')
      const result = execute(buildAllowFirewallCommand(fwPlan, data))
      expect(result.status).not.toBe(0)
      expect(text('firewalld')).toBe('runtime|external|8080/tcp\n')
      expect(text('trace')).not.toContain('reload')
    })
    it('runs the watchdog rollback and prevents an already-confirmed watchdog from undoing enable', () => {
      const token = '12345678-1234-1234-1234-123456789abc',
        data = firewallOverview(zoneLines('permanent'), 'firewalld')
      let result = execute(buildEnableFirewallCommand('firewalld', data, token))
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(file('active'))).toBe(true)
      expect(execute(buildAllowFirewallCommand(plan(), overview())).stderr).toContain('未确认')
      const rollback = text('run/pending-' + token + '.sh')
      const invokeRollback = () =>
        spawnSync(
          bash,
          [
            '--noprofile',
            '--norc',
            '-c',
            `export FW_TEST_ROOT=${shellQuote(directory.replace(/\\/g, '/'))}\n` +
              mocks +
              '\n' +
              rollback,
            'watchdog',
            'no'
          ],
          { encoding: 'utf8' }
        )
      result = invokeRollback()
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(file('active'))).toBe(false)
      expect(text('run/pending-' + token)).toBe('rolled-back')
      expect(execute(buildEnableFirewallCommand('firewalld', data, token)).status).toBe(0)
      expect(execute(buildConfirmFirewallCommand('firewalld', token)).status).toBe(0)
      expect(invokeRollback().status).toBe(0)
      expect(existsSync(file('active'))).toBe(true)
    })
    it('generates shell syntax accepted by Bash for every command path', () => {
      const data = overview(),
        token = '12345678-1234-1234-1234-123456789abc'
      for (const command of [
        buildFirewallDetectCommand(),
        buildInstallFirewallCommand('ufw'),
        buildAllowFirewallCommand(plan(), data),
        buildEnableFirewallCommand('ufw', data, token),
        buildConfirmFirewallCommand('ufw', token)
      ]) {
        for (const script of [command, unwrapRoot(command)]) {
          const result = spawnSync(bash, ['-n'], { input: script, encoding: 'utf8' })
          expect(result.status, result.stderr).toBe(0)
        }
      }
    })
  }
)
