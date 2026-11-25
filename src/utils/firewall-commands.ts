import detectScript from './firewall/detect.sh?raw'
import iptablesEngine from './firewall/iptables-engine.sh?raw'
import {
  shellQuote,
  type FirewallOverview,
  type FirewallRule,
  type FirewallRulePlan
} from './firewall-model'

const rootScript = (body: string, detect = false) => `
sh <<'MSHELL_LAUNCH'
set -eu
export LC_ALL=C
context="\${SSH_CONNECTION:-\${SSH_CLIENT:-}}"
script=${shellQuote(body)}
if [ "$(id -u)" = 0 ]; then
  printf '%s\\n' "$script" | sh -s -- "$context" no no
else
  ${
    detect
      ? `if ! sudo -n sh -c ':' >/dev/null 2>&1; then
    printf '__MSHELL_FIREWALL_V3__\\nMETA|needs_privilege|yes\\nMETA|can_sudo|no\\nERROR|权限|无法读取完整防火墙状态，需要 root 或免密 sudo sh 权限\\n'
    for pair in ufw:ufw firewalld:firewall-cmd iptables:iptables nftables:nft; do
      installed=no;command -v "\${pair#*:}" >/dev/null 2>&1 && installed=yes
      printf 'TOOL|%s|%s|no|unknown|\\n' "\${pair%:*}" "$installed"
    done
    printf '__MSHELL_FIREWALL_END__\\n';exit 0
  fi`
      : ''
  }
  printf '%s\\n' "$script" | sudo -n sh -s -- "$context" yes yes
fi
MSHELL_LAUNCH
`
export const buildFirewallDetectCommand = () => rootScript(detectScript, true)
const transactionPrelude = `
set -eu
export LC_ALL=C
umask 077
command -v flock >/dev/null 2>&1 || { echo '缺少 flock，不能安全串行修改防火墙' >&2;exit 1; }
mkdir -p /run/mshell-firewall
chmod 700 /run/mshell-firewall
exec 9>/run/mshell-firewall/lock
flock -w 10 9 || { echo '其他防火墙操作正在进行，请稍后重试' >&2;exit 1; }
for pending_state in /run/mshell-firewall/pending-*;do
  case "$pending_state" in *.sh) continue;;esac
  [ -f "$pending_state" ] || continue
  if [ "$(cat "$pending_state")" = pending ] && [ "$pending_state" != "/run/mshell-firewall/pending-\${MSHELL_PENDING_ALLOWED:-}" ];then
    echo '当前服务器有未确认的防火墙启用，请先确认或等待回滚' >&2;exit 1
  fi
done
WORK=$(mktemp -d /run/mshell-firewall/transaction.XXXXXXXX)
COMMITTED=no
: > "$WORK/undo"
rollback_extra() { :; }
finish() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$COMMITTED" != yes ]; then
    set +e
    rollback_failed=no
    rollback_extra || rollback_failed=yes
    awk 'BEGIN {print "failed=0"} {lines[NR]=$0} END {for(i=NR;i>0;i--) print "(" lines[i] ") || failed=1"; print "exit $failed"}' "$WORK/undo" > "$WORK/reverse"
    sh "$WORK/reverse" || rollback_failed=yes
    if [ "$rollback_failed" = yes ];then echo "回滚未完成，备份保留在 $WORK，请立即检查" >&2;exit 1;fi
    [ "$status" != 0 ] || status=1
  fi
  rm -f "$WORK"/*
  rmdir "$WORK"
  exit "$status"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
record_undo() { printf '%s\\n' "$1" >> "$WORK/undo"; }
`
const transaction = (body: string, allowedPendingToken = '') =>
  rootScript(
    'MSHELL_PENDING_ALLOWED=' +
      shellQuote(allowedPendingToken) +
      '\n' +
      transactionPrelude +
      '\n' +
      body +
      `\nCOMMITTED=yes\nprintf '__MSHELL_FIREWALL_COMMITTED__\\n'\n`
  )
const quoteArgs = (args: string[]) => args.map(shellQuote).join(' ')
const fwArg = (rule: Pick<FirewallRule, 'kind' | 'definition'>, verb: string) =>
  `--${verb}-${rule.kind === 'rich' ? 'rich-rule' : rule.kind}=${shellQuote(rule.definition!)}`

function firewalldChange(
  rule: Pick<FirewallRule, 'zone' | 'kind' | 'definition'>,
  remove: boolean,
  scopes: Array<'runtime' | 'permanent'>
) {
  if (!rule.zone || !rule.definition || !rule.kind) throw new Error('Firewalld 规则信息不完整')
  const commands: string[] = []
  for (const scope of scopes) {
    const base = `firewall-cmd ${scope === 'permanent' ? '--permanent ' : ''}--zone=${shellQuote(rule.zone)}`
    const query = `${base} ${fwArg(rule, 'query')}`,
      change = `${base} ${fwArg(rule, remove ? 'remove' : 'add')}`,
      undo = `${base} ${fwArg(rule, remove ? 'add' : 'remove')}`
    commands.push(`present=no
if ${query} >/dev/null;then present=yes;else code=$?;[ "$code" = 1 ] || exit "$code";fi
if [ "$present" = ${remove ? 'yes' : 'no'} ];then
  record_undo ${shellQuote(undo)}
  ${change}
fi
${remove ? `if ${query} >/dev/null;then echo '删除后规则仍存在' >&2;exit 1;else code=$?;[ "$code" = 1 ] || exit "$code";fi` : `${query} >/dev/null`}`)
  }
  return commands.join('\n')
}
function registryChange(
  plan: FirewallRulePlan | undefined,
  rule: FirewallRule | undefined,
  overview: FirewallOverview
) {
  const permanent = overview.rules.flatMap((item) =>
    item.tool === 'iptables' ? item.configEntries || [] : []
  )
  const runtime = overview.rules.flatMap((item) =>
    item.tool === 'iptables' ? item.runtimeEntries || [] : []
  )
  let nextPermanent = permanent,
    nextRuntime = runtime
  if (rule) {
    nextPermanent = permanent.filter((entry) => !rule.configEntries?.includes(entry))
    nextRuntime = runtime.filter((entry) => !rule.runtimeEntries?.includes(entry))
  }
  if (plan) {
    const entries = plan.ports.flatMap((port) =>
      plan.protocols.flatMap((proto) =>
        (plan.sources.length ? plan.sources : ['*']).flatMap((source) => {
          const families =
            source === '*'
              ? [
                  '4',
                  ...(overview.rawRules.iptables.some((line) => line.startsWith('6|')) ? ['6'] : [])
                ]
              : [source.includes(':') ? '6' : '4']
          return families.map((family) => `${family}|${proto}|${port}|${source}`)
        })
      )
    )
    if (plan.persistent) nextPermanent = [...new Set([...permanent, ...entries])]
    else nextRuntime = [...new Set([...runtime, ...entries])]
  }
  if ((plan?.persistent || nextPermanent.length > 0) && !overview.canPersist)
    throw new Error('该服务器未运行 systemd，暂不支持永久规则，请使用临时规则')
  const persistent = !!(plan?.persistent || overview.persistenceEnabled || nextPermanent.length)
  const boot = `#!/bin/sh\n${transactionPrelude}\n${iptablesEngine}\nPERMANENT=/etc/mshell/firewall.rules\nRUNTIME=/run/mshell-firewall/runtime.rules\n[ -f "$RUNTIME" ] || : > "$RUNTIME"\nrollback_extra() { rollback_tables; }\nprepare_tables\napply_tables\nCOMMITTED=yes\n`
  const unit =
    '[Unit]\nDescription=Restore MShell firewall rules\nBefore=network-pre.target\nWants=network-pre.target\nAfter=local-fs.target\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/mshell-firewall-restore\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n'
  return transaction(`
${iptablesEngine}
mkdir -p /etc/mshell
for spec in persistent:/etc/mshell/firewall.rules runtime:/run/mshell-firewall/runtime.rules worker:/usr/local/sbin/mshell-firewall-restore unit:/etc/systemd/system/mshell-firewall.service; do
  name=\${spec%%:*};path=\${spec#*:}
  if [ -e "$path" ];then cp -p "$path" "$WORK/backup-$name";fi
done
was_enabled=no
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet mshell-firewall.service 2>/dev/null;then was_enabled=yes;fi
rollback_extra() {
  rollback_tables || rollback_failed=yes
  if [ "$was_enabled" = no ] && [ -f "$WORK/service-touched" ];then systemctl disable mshell-firewall.service >/dev/null 2>&1 || rollback_failed=yes;fi
  for spec in persistent:/etc/mshell/firewall.rules runtime:/run/mshell-firewall/runtime.rules worker:/usr/local/sbin/mshell-firewall-restore unit:/etc/systemd/system/mshell-firewall.service;do
    name=\${spec%%:*};path=\${spec#*:}
    if [ -f "$WORK/backup-$name" ];then cp -p "$WORK/backup-$name" "$path" || rollback_failed=yes;else rm -f "$path" || rollback_failed=yes;fi
  done
  if [ -f "$WORK/service-touched" ];then systemctl daemon-reload || rollback_failed=yes;fi
}
printf '%s\\n' ${shellQuote(nextPermanent.join('\n'))} > "$WORK/permanent"
printf '%s\\n' ${shellQuote(nextRuntime.join('\n'))} > "$WORK/runtime"
PERMANENT="$WORK/permanent"
RUNTIME="$WORK/runtime"
prepare_tables
apply_tables
install -m 600 "$PERMANENT" /etc/mshell/firewall.rules.new
mv -f /etc/mshell/firewall.rules.new /etc/mshell/firewall.rules
install -m 600 "$RUNTIME" /run/mshell-firewall/runtime.rules.new
mv -f /run/mshell-firewall/runtime.rules.new /run/mshell-firewall/runtime.rules
${
  persistent
    ? `printf '%s' ${shellQuote(boot)} > "$WORK/worker"
printf '%s' ${shellQuote(unit)} > "$WORK/unit"
install -m 700 "$WORK/worker" /usr/local/sbin/mshell-firewall-restore
install -m 644 "$WORK/unit" /etc/systemd/system/mshell-firewall.service
touch "$WORK/service-touched"
systemctl daemon-reload
systemctl enable mshell-firewall.service`
    : ''
}
echo 'MShell 规则已提交，其他链保持原样'
`)
}
export function buildAllowFirewallCommand(
  plan: FirewallRulePlan,
  overview: FirewallOverview
): string {
  if (plan.tool === 'iptables') return registryChange(plan, undefined, overview)
  if (plan.tool === 'firewalld')
    return transaction(
      plan.ports
        .flatMap((port) =>
          plan.protocols.flatMap((proto) =>
            (plan.sources.length ? plan.sources : ['']).map((source) => {
              const definition = source
                ? `rule family="${source.includes(':') ? 'ipv6' : 'ipv4'}" source address="${source}" port port="${port}" protocol="${proto}" accept`
                : `${port}/${proto}`
              return firewalldChange(
                { zone: plan.zone, kind: source ? 'rich' : 'port', definition },
                false,
                ['runtime', 'permanent']
              )
            })
          )
        )
        .join('\n')
    )
  // Each command has a matching inverse. Existing semantic rules are skipped.
  const commands = plan.ports.flatMap((port) =>
    plan.protocols.flatMap((proto) =>
      (plan.sources.length ? plan.sources : ['0.0.0.0/0', '::/0']).map((source) => {
        if (
          overview.rules.some(
            (rule) =>
              rule.tool === 'ufw' &&
              rule.action === 'allow' &&
              rule.port?.replace(':', '-') === port &&
              rule.protocol === proto &&
              (rule.source || (rule.family === 'IPv6' ? '::/0' : '0.0.0.0/0')) === source
          )
        )
          return ''
        const args = quoteArgs([
          'allow',
          'from',
          source,
          'to',
          'any',
          'port',
          port.replace('-', ':'),
          'proto',
          proto
        ])
        return `record_undo ${shellQuote('ufw --force delete ' + args)}\nufw ${args}`
      })
    )
  )
  return transaction(
    `current=$(ufw status numbered)\n[ "$current" = ${shellQuote(overview.rawRules.ufw.join('\n'))} ] || { echo 'UFW 规则已变化，请刷新' >&2;exit 1; }\n` +
      commands.join('\n')
  )
}
export function buildDeleteFirewallCommand(rule: FirewallRule, overview: FirewallOverview): string {
  if (!rule.deletable || rule.protectionReason)
    throw new Error(rule.protectionReason || '该规则仅供查看')
  if (rule.tool === 'iptables') return registryChange(undefined, rule, overview)
  if (rule.tool === 'firewalld')
    return transaction(
      firewalldChange(rule, true, [
        ...(rule.runtime ? ['runtime' as const] : []),
        ...(rule.persistent ? ['permanent' as const] : [])
      ])
    )
  if (rule.tool === 'ufw' && rule.deleteArgs && rule.index) {
    const args = quoteArgs(rule.deleteArgs)
    return transaction(`current=$(ufw status numbered)
expected=${shellQuote(overview.rawRules.ufw.join('\n'))}
[ "$current" = "$expected" ] || { echo 'UFW 规则已变化，请刷新后重试' >&2;exit 1; }
record_undo ${shellQuote(`ufw insert ${rule.index} ${args}`)}
ufw --force delete ${args}`)
  }
  throw new Error('不支持该规则的删除')
}
export function buildEnableFirewallCommand(
  tool: 'ufw' | 'firewalld',
  overview: FirewallOverview,
  token: string
): string {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('任务标识无效')
  if (!overview.canWatchdog) throw new Error('需要 systemd-run 才能提供启用后的自动回滚')
  if (!overview.sshClientIp || !overview.sshServerPort)
    throw new Error('无法识别当前 SSH 来源或端口，已阻止启用')
  if (tool === 'firewalld' && !overview.sshZone)
    throw new Error(overview.zoneError || '无法确定 SSH zone')
  const unit = 'mshell-fw-rollback-' + token,
    state = '/run/mshell-firewall/pending-' + token
  const undo =
    tool === 'ufw'
      ? 'ufw --force disable'
      : 'systemctl stop firewalld; if [ "$was_enabled" = no ];then systemctl disable firewalld;fi'
  const rollback = `#!/bin/sh
exec 9>/run/mshell-firewall/lock
flock 9 || exit 1
[ "$(cat ${shellQuote(state)} 2>/dev/null)" = pending ] || exit 0
was_enabled="$1"
${undo}
printf 'rolled-back' > ${shellQuote(state)}
`
  const source = overview.sshClientIp,
    port = String(overview.sshServerPort)
  const guard = `rule family="${source.includes(':') ? 'ipv6' : 'ipv4'}" source address="${source}" port port="${port}" protocol="tcp" accept`
  return transaction(`
was_enabled=no
systemctl is-enabled --quiet ${tool === 'ufw' ? 'ufw' : 'firewalld'}.service 2>/dev/null && was_enabled=yes
printf '%s' ${shellQuote(rollback)} > "$WORK/rollback-script"
install -m 700 "$WORK/rollback-script" ${shellQuote(state + '.sh')}
printf 'pending' > ${shellQuote(state)}
systemd-run --quiet --unit=${shellQuote(unit)} --on-active=90s /bin/sh ${shellQuote(state + '.sh')} "$was_enabled"
record_undo ${shellQuote(`systemctl stop ${unit}.timer && printf 'failed' > ${state}`)}
record_undo ${shellQuote(tool === 'ufw' ? 'ufw --force disable' : 'systemctl stop firewalld')}
${
  tool === 'ufw'
    ? `ufw insert 1 allow from ${shellQuote(source)} to any port ${shellQuote(port)} proto tcp
ufw --force enable`
    : `firewall-offline-cmd --zone=${shellQuote(overview.sshZone!)} --add-rich-rule=${shellQuote(guard)}
systemctl start firewalld
firewall-cmd --zone=${shellQuote(overview.sshZone!)} --query-rich-rule=${shellQuote(guard)}`
}
echo '已启用；90 秒内未确认将自动停用'
`)
}
export function buildConfirmFirewallCommand(tool: 'ufw' | 'firewalld', token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('任务标识无效')
  const state = '/run/mshell-firewall/pending-' + token,
    unit = 'mshell-fw-rollback-' + token
  return transaction(
    `[ "$(cat ${shellQuote(state)})" = pending ] || { echo '确认已过期，已执行自动回滚' >&2;exit 1; }
${tool === 'firewalld' ? 'firewall-cmd --state | grep -qx running' : "ufw status | grep -q 'Status: active'"}
systemctl stop ${shellQuote(unit + '.timer')}
record_undo ${shellQuote(`systemctl start --no-block ${unit}.service`)}
${tool === 'firewalld' ? 'systemctl enable firewalld' : ''}
printf 'confirmed' > "$WORK/confirmed"
mv -f "$WORK/confirmed" ${shellQuote(state)}
echo '已确认保留防火墙启用状态'`,
    token
  )
}
export const buildDisableFirewallCommand = (tool: 'ufw' | 'firewalld') =>
  transaction(tool === 'ufw' ? 'ufw --force disable' : 'systemctl disable --now firewalld')
export function buildInstallFirewallCommand(tool: 'ufw' | 'firewalld') {
  return transaction(`TARGET=${shellQuote(tool)}
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ];then
  mask=$(systemctl is-enabled "$TARGET.service" 2>/dev/null || true)
  case "$mask" in masked*) ;; *) systemctl mask --runtime "$TARGET.service";record_undo "systemctl unmask --runtime $TARGET.service";;esac
fi
if command -v apt-get >/dev/null 2>&1;then apt-get update;DEBIAN_FRONTEND=noninteractive apt-get install -y "$TARGET"
elif command -v dnf >/dev/null 2>&1;then dnf install -y "$TARGET"
elif command -v yum >/dev/null 2>&1;then yum install -y "$TARGET"
elif command -v zypper >/dev/null 2>&1;then zypper --non-interactive install "$TARGET"
elif command -v pacman >/dev/null 2>&1;then pacman -S --needed --noconfirm "$TARGET"
elif command -v apk >/dev/null 2>&1;then apk add "$TARGET"
else echo '不支持的包管理器' >&2;exit 1;fi
if [ -n "\${mask+x}" ];then
  systemctl disable "$TARGET.service"
  case "$mask" in masked*) ;; *) systemctl unmask --runtime "$TARGET.service";;esac
fi`)
}
export function classifyFirewallInstallError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/expired|invalid since|REPOSITORY_EXPIRED/i.test(text))
    return {
      errorCode: 'REPOSITORY_EXPIRED',
      message: '软件源元数据已过期',
      guidance: '请更新可信软件源后重试，不会跳过有效期校验'
    }
  if (/release file|404|REPOSITORY_UNAVAILABLE/i.test(text))
    return {
      errorCode: 'REPOSITORY_UNAVAILABLE',
      message: '软件源不可用',
      guidance: '请检查当前发行版的软件源'
    }
  if (/resolving|resolve|network|NETWORK_UNAVAILABLE/i.test(text))
    return {
      errorCode: 'NETWORK_UNAVAILABLE',
      message: '软件源连接失败',
      guidance: '请检查网络和 DNS'
    }
  return { errorCode: 'PACKAGE_INSTALL_FAILED', message: '防火墙安装失败', guidance: text }
}
