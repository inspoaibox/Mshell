import { parseFirewallOverview } from '../firewall-model'
export function firewallOutput(
  extra: string[] = [],
  tool: 'iptables' | 'firewalld' | 'ufw' = 'iptables'
) {
  return [
    '__MSHELL_FIREWALL_V3__',
    'META|os_id|debian',
    'META|os_name|Debian Linux',
    'META|package_manager|apt-get',
    'META|needs_privilege|no',
    'META|can_sudo|no',
    'META|ssh_client_ip|203.0.113.8',
    'META|ssh_server_ip|198.51.100.2',
    'META|ssh_server_port|2222',
    'META|ssh_interface|eth0',
    'META|systemd|yes',
    'META|watchdog|yes',
    'META|mshell_persistence|yes',
    'META|iptables_backend|nf_tables',
    'META|iptables_policy_v4|DROP',
    'META|iptables_policy_v6|DROP',
    'META|default_zone|public',
    ...(['ufw', 'firewalld', 'iptables', 'nftables'] as const).map(
      (id) =>
        `TOOL|${id}|${id === tool || id === 'iptables' ? 'yes' : 'no'}|${id === tool ? 'yes' : 'no'}|${id === tool ? 'active' : 'inactive'}|1.0`
    ),
    'RULE_RAW|iptables|4|-P INPUT DROP',
    'RULE_RAW|iptables|6|-P INPUT DROP',
    ...['4', '6']
      .filter((family) =>
        extra.some((line) => line.startsWith(`RULE_RAW|iptables|${family}|-A MSHELL-INPUT `))
      )
      .map((family) => `RULE_RAW|iptables|${family}|-A INPUT -j MSHELL-INPUT`),
    ...extra,
    '__MSHELL_FIREWALL_END__'
  ].join('\n')
}
export function zoneLines(
  scope: 'runtime' | 'permanent',
  ports = '80/tcp 443/tcp',
  rich = 'rule family="ipv4" source address="203.0.113.8" port port="8443" protocol="tcp" accept'
) {
  return [
    'public',
    '  target: default',
    '  interfaces:',
    '  sources:',
    'external (active)',
    '  target: default',
    '  interfaces: eth0',
    '  sources:',
    '  services: ssh http',
    '  ports: ' + ports,
    '  rich rules:',
    ...(rich ? ['    ' + rich] : [])
  ]
    .map((line) => `FW_DUMP|${scope}|${line}`)
    .concat([`SERVICE|${scope}|ssh|2222/tcp`, `SERVICE|${scope}|http|80/tcp`])
}
export const firewallOverview = (
  extra: string[] = [],
  tool: 'iptables' | 'firewalld' | 'ufw' = 'iptables'
) => parseFirewallOverview(firewallOutput(extra, tool))
export function unwrapRoot(command: string): string {
  const start = command.indexOf("script='")
  if (start < 0) throw new Error('Missing root body')
  let i = start + 8,
    result = ''
  while (i < command.length) {
    if (command.slice(i, i + 4) === "'\\''") {
      result += "'"
      i += 4
    } else if (command[i] === "'") return result
    else result += command[i++]
  }
  throw new Error('Incomplete root body')
}
