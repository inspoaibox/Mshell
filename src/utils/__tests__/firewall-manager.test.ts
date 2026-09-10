import { describe, expect, it } from 'vitest'
import {
  buildAllowFirewallCommand,
  buildDeleteFirewallCommand,
  buildEnableFirewallCommand,
  buildFirewallDetectCommand,
  buildInstallFirewallCommand,
  classifyFirewallInstallError,
  createFirewallRulePlan,
  displayFirewallLabel,
  isValidIpOrCidr,
  normalizeFirewallRules,
  normalizePorts,
  parseFirewallOverview,
  selectPrimaryFirewall,
  shouldOfferFirewallInstall
} from '../firewall-manager'

const overviewOutput = `
META|os_id|debian
META|os_name|Debian GNU/Linux 11
META|package_manager|apt-get
META|needs_privilege|no
META|can_sudo|no
META|ssh_client_ip|203.0.113.8
META|ssh_server_port|2222
META|iptables_backend|nf_tables
META|iptables_policy_v4|ACCEPT
META|iptables_policy_v6|ACCEPT
META|nft_has_rules|yes
META|mshell_persistence|no
TOOL|ufw|no|no||
TOOL|firewalld|no|no||
TOOL|iptables|yes|no|no-input-rules|iptables v1.8.7 (nf_tables)
TOOL|nftables|yes|no|backend-only|nftables v0.9.8
RULE_RAW|iptables|Chain INPUT (policy ACCEPT)
RULE_RAW|iptables|num target prot opt source destination
RULE_RAW|nftables|table ip filter {
RULE_RAW|nftables|chain DOCKER {
CONTAINER_PORT|web|0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
`

describe('firewall manager', () => {
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
  ])('validates IP or CIDR %s', (value, expected) => {
    expect(isValidIpOrCidr(value)).toBe(expected)
  })

  it('merges iptables nf_tables into one primary management path', () => {
    const overview = parseFirewallOverview(overviewOutput)
    const primary = selectPrimaryFirewall(overview)
    expect(primary?.id).toBe('iptables')
    expect(displayFirewallLabel(primary, overview)).toBe('iptables（nftables 后端）')
    expect(overview.tools.find((tool) => tool.id === 'nftables')).toMatchObject({
      installed: true,
      active: false,
      status: 'backend-only'
    })
    expect(overview.sshClientIp).toBe('203.0.113.8')
    expect(overview.sshServerPort).toBe(2222)
    expect(overview.iptablesPolicies).toEqual({ ipv4: 'ACCEPT', ipv6: 'ACCEPT' })
    expect(overview.containerPorts).toEqual([
      { container: 'web', published: '0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp' }
    ])
    expect(normalizeFirewallRules(overview)).toHaveLength(0)
  })

  it('prefers an active high-level firewall manager', () => {
    const overview = parseFirewallOverview(
      overviewOutput.replace('TOOL|ufw|no|no||', 'TOOL|ufw|yes|yes|Status: active|ufw 0.36')
    )
    expect(selectPrimaryFirewall(overview)?.id).toBe('ufw')
  })

  it('does not prefill ports and validates valid port ranges', () => {
    expect(normalizePorts('22, 80，443 1000:2000')).toEqual(['22', '80', '443', '1000-2000'])
    expect(() => normalizePorts('')).toThrow('请输入至少一个端口')
    expect(() => normalizePorts('0')).toThrow()
    expect(() => normalizePorts('2000-1000')).toThrow()
    expect(() => normalizePorts('65536')).toThrow()
  })

  it('uses the current SSH source by default and warns about transient iptables rules', () => {
    const plan = createFirewallRulePlan({
      tool: 'iptables',
      ports: '443',
      protocol: 'tcp',
      sourceMode: 'current',
      customSources: '',
      sshClientIp: '203.0.113.8',
      persist: false
    })
    expect(plan.sources).toEqual(['203.0.113.8'])
    expect(plan.risk).toBe('safe')
    expect(plan.persistent).toBe(false)
    expect(plan.warnings).toContainEqual(expect.stringContaining('本次开机'))
    const command = buildAllowFirewallCommand(plan)
    expect(command).toContain('"$bin" -w 5 -C INPUT')
    expect(command).toContain("SOURCES='203.0.113.8'")
  })

  it('persists iptables rules in an isolated MShell chain without saving Docker rules', () => {
    const plan = createFirewallRulePlan({
      tool: 'iptables',
      ports: '443',
      protocol: 'tcp',
      sourceMode: 'current',
      customSources: '',
      sshClientIp: '203.0.113.8'
    })
    expect(plan.persistent).toBe(true)
    expect(plan.warnings).not.toContainEqual(expect.stringContaining('本次开机'))
    const command = buildAllowFirewallCommand(plan)
    expect(command).toContain('/etc/mshell/firewall.rules')
    expect(command).toContain('mshell-firewall.service')
    expect(command).toContain('MSHELL-INPUT')
    expect(command).toContain('apply_family 4 iptables')
    expect(command).toContain('apply_family 6 ip6tables')
    expect(command).not.toContain('iptables-save')
    expect(command).not.toContain('netfilter-persistent')
  })

  it('requires a valid custom source and blocks source injection', () => {
    expect(() =>
      createFirewallRulePlan({
        tool: 'ufw',
        ports: '443',
        protocol: 'tcp',
        sourceMode: 'custom',
        customSources: '203.0.113.8;touch /tmp/a',
        sshClientIp: ''
      })
    ).toThrow('来源地址格式不正确')
  })

  it('marks public database ports as dangerous', () => {
    const plan = createFirewallRulePlan({
      tool: 'ufw',
      ports: '3306,5432',
      protocol: 'tcp',
      sourceMode: 'any',
      customSources: '',
      sshClientIp: '203.0.113.8'
    })
    expect(plan.risk).toBe('danger')
    expect(plan.sources).toEqual([])
    expect(plan.warnings).toContainEqual(expect.stringContaining('暴露到公网'))
  })

  it('protects the active SSH source before enabling UFW or Firewalld', () => {
    const ufw = buildEnableFirewallCommand('ufw', '203.0.113.8', 2222)
    expect(ufw.indexOf('ufw allow from')).toBeLessThan(ufw.indexOf('ufw --force enable'))
    expect(ufw).toContain("SSH_PORT='2222'")
    const firewalld = buildEnableFirewallCommand('firewalld', '2001:db8::1', 22)
    expect(firewalld.indexOf('firewall-offline-cmd')).toBeLessThan(
      firewalld.indexOf('systemctl enable --now firewalld')
    )
    expect(() => buildEnableFirewallCommand('nftables', '203.0.113.8', 22)).toThrow()
    expect(() => buildEnableFirewallCommand('ufw', '', 22)).toThrow('已阻止一键启用')
  })

  it('recognizes and deletes only MShell-managed persistent iptables rules', () => {
    const data = parseFirewallOverview(
      overviewOutput
        .replace('META|mshell_persistence|no', 'META|mshell_persistence|yes')
        .concat(
          '\nRULE_RAW|iptables|__MSHELL_MANAGED_V4__ Chain MSHELL-INPUT (1 references)',
          '\nRULE_RAW|iptables|__MSHELL_MANAGED_V4__ num target prot opt source destination',
          '\nRULE_RAW|iptables|__MSHELL_MANAGED_V4__ 1 ACCEPT tcp -- 203.0.113.8 0.0.0.0/0 tcp dpt:443',
          '\nRULE_RAW|iptables|__MSHELL_SYSTEM_V4__ 1 ACCEPT tcp -- 198.51.100.8 0.0.0.0/0 tcp dpt:80'
        )
    )
    const rules = normalizeFirewallRules(data)
    const managed = rules.find((rule) => rule.managed)
    const system = rules.find((rule) => !rule.managed)
    expect(managed).toMatchObject({ family: 'IPv4', persistent: true, deletable: true })
    expect(system).toMatchObject({ persistent: false, deletable: false })
    const command = buildDeleteFirewallCommand(managed!)
    expect(command).toContain("ENTRY='4|tcp|443|203.0.113.8'")
    expect(command).toContain('/usr/local/sbin/mshell-firewall-restore')
    expect(command).not.toContain('iptables -D INPUT')
  })

  it('detects dedicated persistence, IPv4, IPv6 and Docker ports separately', () => {
    const command = buildFirewallDetectCommand()
    expect(command).toContain('systemctl is-enabled --quiet mshell-firewall.service')
    expect(command).toContain('inspect_iptables_family iptables V4')
    expect(command).toContain('inspect_iptables_family ip6tables V6')
    expect(command).toContain('meta iptables_policy_v4')
    expect(command).toContain("docker ps --format '{{.Names}}|{{.Ports}}'")
  })

  it('does not offer package installation when iptables is already available', () => {
    const overview = parseFirewallOverview(overviewOutput)
    expect(shouldOfferFirewallInstall(overview)).toBe(false)
    const withoutManagers = parseFirewallOverview(
      overviewOutput
        .replace(
          'TOOL|iptables|yes|no|no-input-rules|iptables v1.8.7 (nf_tables)',
          'TOOL|iptables|no|no||'
        )
        .replace(
          'TOOL|nftables|yes|no|backend-only|nftables v0.9.8',
          'TOOL|nftables|yes|no|backend-only|nftables v0.9.8'
        )
    )
    expect(shouldOfferFirewallInstall(withoutManagers)).toBe(true)
  })

  it.each([
    ['Release file for security.debian.org is expired (invalid since 1d)', 'REPOSITORY_EXPIRED'],
    ['__MSHELL_FIREWALL_ERROR__|REPOSITORY_UNAVAILABLE', 'REPOSITORY_UNAVAILABLE'],
    ['Temporary failure resolving deb.debian.org', 'NETWORK_UNAVAILABLE'],
    ['__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED', 'PACKAGE_INSTALL_FAILED']
  ] as const)(
    'classifies package installation errors without bypassing repositories',
    (message, code) => {
      expect(classifyFirewallInstallError(new Error(message)).errorCode).toBe(code)
    }
  )

  it('keeps repository validity checks enabled in the install command', () => {
    const command = buildInstallFirewallCommand('ufw')
    expect(command).toContain('REPOSITORY_EXPIRED')
    expect(command).toContain('REPOSITORY_UNAVAILABLE')
    expect(command).toContain('NETWORK_UNAVAILABLE')
    expect(command).not.toMatch(
      /Check-Valid-Until=false|AllowInsecureRepositories|allow-unauthenticated/i
    )
  })
})
