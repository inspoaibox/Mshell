import { describe, expect, it } from 'vitest'
import {
  createFirewallRulePlan,
  isValidIpOrCidr,
  normalizeSource,
  sourceContains,
  normalizePorts,
  parseFirewallOverview,
  selectPrimaryFirewall,
  sshProtectionReason
} from '../firewall-model'
import {
  buildAllowFirewallCommand,
  buildDeleteFirewallCommand,
  buildEnableFirewallCommand,
  buildInstallFirewallCommand,
  classifyFirewallInstallError
} from '../firewall-commands'
import { firewallOutput, firewallOverview, zoneLines, unwrapRoot } from './firewall-fixtures'
describe('firewall inputs and detection', () => {
  it.each([
    ['203.0.113.8', true],
    ['203.0.113.8/32', true],
    ['256.1.1.1', false],
    ['10.0.0.1/33', false],
    ['2001:db8::1', true],
    ['2001:db8::/64', true],
    ['2001:db8::1/129', false],
    ['example.com', false],
    ['1.2.3.4;touch', false]
  ] as const)('validates %s', (value, valid) => expect(isValidIpOrCidr(value)).toBe(valid))
  it('normalizes CIDRs and ports without losing the original deletion entry', () => {
    expect(normalizeSource('10.0.0.5/24')).toBe('10.0.0.0/24')
    expect(normalizeSource('203.0.113.8/32')).toBe('203.0.113.8')
    expect(normalizeSource('2001:0db8::1234/64')).toBe('2001:db8::/64')
    expect(sourceContains('2001:db8::/64', '2001:db8::9')).toBe(true)
    expect(sourceContains('2001:db8::/64', '203.0.113.8')).toBe(false)
    expect(normalizePorts('022,80,443 1000:2000')).toEqual(['22', '80', '443', '1000-2000'])
    expect(() => normalizePorts('0')).toThrow()
    expect(() => normalizePorts('2000-1000')).toThrow()
  })
  it.each(['0.0.0.0/0', '::/0'])('treats custom %s as public access', (source) => {
    const plan = createFirewallRulePlan({
      tool: 'iptables',
      ports: '2222,5432',
      protocol: 'tcp',
      sourceMode: 'custom',
      customSources: source,
      sshClientIp: '203.0.113.8',
      sshServerPort: 2222
    })
    expect(plan.risk).toBe('danger')
    expect(plan.warnings.join(' ')).toContain('当前 SSH')
  })
  it('rejects incomplete detection and keeps permission failures as unknown', () => {
    expect(() =>
      parseFirewallOverview(firewallOutput().replace('__MSHELL_FIREWALL_END__', ''))
    ).toThrow('不完整')
    const data = parseFirewallOverview(firewallOutput(['ERROR|iptables|permission denied']))
    expect(data.errors).toContain('iptables：permission denied')
  })
  it('selects live native nftables even when its service is inactive', () => {
    const data = firewallOverview([
      'NFT_JSON|' +
        JSON.stringify({
          nftables: [
            {
              chain: {
                family: 'inet',
                table: 'custom',
                name: 'input',
                hook: 'input',
                policy: 'drop'
              }
            }
          ]
        })
    ])
    expect(data.nativeNftInput).toBe(true)
    expect(selectPrimaryFirewall(data)?.id).toBe('nftables')
    const compat = firewallOverview([
      'NFT_JSON|' +
        JSON.stringify({
          nftables: [{ chain: { family: 'ip', table: 'filter', name: 'INPUT', hook: 'input' } }]
        })
    ])
    expect(compat.nativeNftInput).toBe(false)
    expect(selectPrimaryFirewall(compat)?.id).toBe('iptables')
  })
})
describe('rule identity and SSH protection', () => {
  it('splits firewalld ports/services, keeps rich rules and separates persistence', () => {
    const data = firewallOverview(
      [...zoneLines('runtime', '80/tcp 8080/tcp'), ...zoneLines('permanent', '80/tcp 9443/tcp')],
      'firewalld'
    )
    expect(data.sshZone).toBe('external')
    expect(data.rules.find((r) => r.port === '8080')).toMatchObject({
      runtime: true,
      persistent: false
    })
    expect(data.rules.find((r) => r.port === '9443')).toMatchObject({
      runtime: false,
      persistent: true
    })
    expect(data.rules.find((r) => r.kind === 'rich')).toMatchObject({
      port: '8443',
      source: '203.0.113.8',
      runtime: true,
      persistent: true,
      deletable: true
    })
    expect(data.rules.find((r) => r.service === 'ssh')?.deletable).toBe(false)
    expect(data.rules.find((r) => r.service === 'http')?.deletable).toBe(true)
  })
  it('uses source bindings before interface/default zones and refuses ambiguous ipsets', () => {
    const base = [
      ...zoneLines('runtime'),
      'FW_DUMP|runtime|trusted',
      'FW_DUMP|runtime|  sources: 203.0.113.0/24'
    ]
    expect(firewallOverview(base, 'firewalld').sshZone).toBe('trusted')
    expect(
      firewallOverview([...base, 'FW_DUMP|runtime|  sources: ipset:admins'], 'firewalld').zoneError
    ).toContain('ipset')
  })
  it('protects current SSH UFW rules, filters outbound and deletes exact specs instead of numbers', () => {
    const data = firewallOverview(
      [
        'RULE_RAW|ufw|Status: active',
        'RULE_RAW|ufw|[ 1] 443/tcp ALLOW OUT Anywhere',
        'RULE_RAW|ufw|[ 2] 2222/tcp ALLOW IN 203.0.113.8',
        'RULE_RAW|ufw|[ 3] 8080/tcp ALLOW IN 203.0.113.8'
      ],
      'ufw'
    )
    expect(data.rules).toHaveLength(2)
    expect(() => buildDeleteFirewallCommand(data.rules[0], data)).toThrow('SSH')
    const cmd = unwrapRoot(buildDeleteFirewallCommand(data.rules[1], data))
    expect(cmd).toContain("ufw --force delete 'allow' 'from' '203.0.113.8'")
    expect(cmd).not.toContain('ufw --force delete 3')
    expect(cmd).toContain('UFW 规则已变化')
  })
  it('retains /32 and IPv6 originals for deleting persistent and temporary records', () => {
    const entry = '4|tcp|443|203.0.113.8/32'
    const data = firewallOverview([
      'CONFIG|persistent|' + entry,
      'CONFIG|runtime|6|tcp|8443|2001:db8::1/128',
      'RULE_RAW|iptables|4|-A MSHELL-INPUT -s 203.0.113.8/32 -p tcp -m tcp --dport 443 -j ACCEPT',
      'RULE_RAW|iptables|6|-A MSHELL-INPUT -s 2001:db8::1/128 -p tcp -m tcp --dport 8443 -j ACCEPT'
    ])
    expect(data.errors).toEqual([])
    expect(data.rules[0]).toMatchObject({
      source: '203.0.113.8',
      configEntries: [entry],
      runtime: true,
      deletable: true
    })
    expect(data.rules[1]).toMatchObject({ runtime: true, persistent: false, deletable: true })
    const cmd = unwrapRoot(buildDeleteFirewallCommand(data.rules[0], data))
    expect(cmd).not.toContain(entry)
    expect(cmd).toContain('/run/mshell-firewall/runtime.rules')
  })
  it('protects unknown service definitions and negated rich-rule sources conservatively', () => {
    const data = firewallOverview(
      zoneLines(
        'runtime',
        '',
        'rule family="ipv4" source not address="10.0.0.0/8" port port="2222" protocol="tcp" accept'
      ),
      'firewalld'
    )
    const rule = data.rules.find((r) => r.kind === 'rich')!
    expect(sshProtectionReason(rule, data)).toContain('SSH')
  })
})
describe('command boundaries', () => {
  it('changes runtime and permanent firewalld rules separately without reload', () => {
    const overview = firewallOverview(
      [...zoneLines('runtime'), ...zoneLines('permanent')],
      'firewalld'
    )
    const plan = createFirewallRulePlan({
      tool: 'firewalld',
      ports: '5432',
      protocol: 'tcp',
      sourceMode: 'current',
      customSources: '',
      sshClientIp: overview.sshClientIp,
      zone: 'external'
    })
    const body = unwrapRoot(buildAllowFirewallCommand(plan, overview))
    expect(body).toContain("--zone='external'")
    expect(body).toContain('--permanent')
    expect(body).not.toContain('--reload')
    expect(body).toContain('record_undo')
  })
  it('requires watchdog support and uses the detected SSH zone on enable', () => {
    const data = firewallOverview(zoneLines('permanent'), 'firewalld'),
      token = '12345678-1234-1234-1234-123456789abc'
    const body = unwrapRoot(buildEnableFirewallCommand('firewalld', data, token))
    expect(body).toContain("--zone='external'")
    expect(body).toContain('--on-active=90s')
    expect(() =>
      buildEnableFirewallCommand('firewalld', { ...data, sshZone: undefined }, token)
    ).toThrow('zone')
    expect(() => buildEnableFirewallCommand('ufw', { ...data, canWatchdog: false }, token)).toThrow(
      'systemd-run'
    )
  })
  it('keeps repository verification enabled', () => {
    expect(buildInstallFirewallCommand('ufw')).not.toMatch(
      /Check-Valid-Until=false|allow-unauthenticated|AllowInsecureRepositories/i
    )
    expect(classifyFirewallInstallError('Release file expired').errorCode).toBe(
      'REPOSITORY_EXPIRED'
    )
  })
})
