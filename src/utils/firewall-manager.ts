export type FirewallToolId = 'ufw' | 'firewalld' | 'iptables' | 'nftables'
export type RuleProtocol = 'tcp' | 'udp' | 'both'
export type RuleSourceMode = 'current' | 'custom' | 'any'
export type FirewallRisk = 'safe' | 'warning' | 'danger'

export interface FirewallTool {
  id: FirewallToolId
  label: string
  installed: boolean
  active: boolean
  status: string
  version: string
}

export interface FirewallOverview {
  osId: string
  osName: string
  packageManager: string
  needsPrivilege: boolean
  canSudo: boolean
  sshClientIp: string
  sshServerPort?: number
  iptablesBackend: 'legacy' | 'nf_tables' | 'unknown'
  iptablesPolicies: { ipv4: string; ipv6: string }
  nftHasRules: boolean
  persistenceEnabled: boolean
  containerPorts: Array<{ container: string; published: string }>
  tools: FirewallTool[]
  rawRules: Record<FirewallToolId, string[]>
}

export interface FirewallRule {
  key: string
  tool: FirewallToolId
  raw: string
  action: 'allow' | 'deny' | 'reject' | 'unknown'
  actionLabel: string
  summary: string
  port?: string
  protocol?: string
  source?: string
  target?: string
  service?: string
  index?: number
  chain?: string
  deletable: boolean
  deletePayload?: Record<string, string | number | undefined>
  persistent?: boolean
  managed?: boolean
  family?: 'IPv4' | 'IPv6'
}

export interface FirewallRuleDraft {
  tool: FirewallToolId
  ports: string
  protocol: RuleProtocol
  sourceMode: RuleSourceMode
  customSources: string
  sshClientIp: string
  persist?: boolean
}

export interface FirewallRulePlan {
  tool: Exclude<FirewallToolId, 'nftables'>
  ports: string[]
  protocols: Array<'tcp' | 'udp'>
  sources: string[]
  sourceMode: RuleSourceMode
  risk: FirewallRisk
  warnings: string[]
  persistent: boolean
}

export type FirewallInstallErrorCode =
  | 'REPOSITORY_EXPIRED'
  | 'REPOSITORY_UNAVAILABLE'
  | 'NETWORK_UNAVAILABLE'
  | 'PACKAGE_INSTALL_FAILED'

export interface FirewallInstallError {
  errorCode: FirewallInstallErrorCode
  message: string
  guidance: string
}

export const FIREWALL_TOOL_LABELS: Record<FirewallToolId, string> = {
  ufw: 'UFW',
  firewalld: 'Firewalld',
  iptables: 'iptables',
  nftables: 'nftables'
}

export const FIREWALL_PORT_PRESETS = [
  { label: '自定义端口', value: 'custom', ports: '', protocol: 'tcp' as RuleProtocol },
  { label: 'SSH', value: 'ssh', ports: '22', protocol: 'tcp' as RuleProtocol },
  { label: 'HTTP', value: 'http', ports: '80', protocol: 'tcp' as RuleProtocol },
  { label: 'HTTPS', value: 'https', ports: '443', protocol: 'tcp' as RuleProtocol },
  { label: 'Web 应用', value: 'web-app', ports: '3000', protocol: 'tcp' as RuleProtocol },
  { label: 'MySQL', value: 'mysql', ports: '3306', protocol: 'tcp' as RuleProtocol },
  { label: 'PostgreSQL', value: 'postgresql', ports: '5432', protocol: 'tcp' as RuleProtocol },
  { label: 'Redis', value: 'redis', ports: '6379', protocol: 'tcp' as RuleProtocol }
]

const DATABASE_PORTS = new Set([3306, 5432, 6379, 27017, 9200, 11211])

export function isValidIpOrCidr(value: string): boolean {
  const [address, prefixText, extra] = value.split('/')
  if (!address || extra !== undefined) return false
  const ipv4Parts = address.split('.')
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  if (isIpv4) {
    return prefixText === undefined || (/^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32)
  }

  if (!address.includes(':') || /[^0-9a-f:.]/i.test(address)) return false
  try {
    const parsed = new URL(`http://[${address}]/`).hostname
    if (!parsed.startsWith('[')) return false
  } catch {
    return false
  }
  return prefixText === undefined || (/^\d{1,3}$/.test(prefixText) && Number(prefixText) <= 128)
}

export function parseListInput(value: string): string[] {
  return value
    .split(/[,\s，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizePorts(value: string): string[] {
  const ports = parseListInput(value).map((port) => port.replace(':', '-'))
  if (ports.length === 0) throw new Error('请输入至少一个端口')
  const invalid = ports.find((port) => !/^(\d{1,5})(-\d{1,5})?$/.test(port))
  if (invalid) throw new Error(`端口格式不正确：${invalid}`)
  ports.forEach((port) => {
    const [start, end] = port.split('-').map(Number)
    if (
      start < 1 ||
      start > 65535 ||
      (end !== undefined && (end < 1 || end > 65535 || end < start))
    ) {
      throw new Error(`端口范围不正确：${port}`)
    }
  })
  return [...new Set(ports)]
}

export function normalizeSources(value: string): string[] {
  const sources = parseListInput(value)
  const invalid = sources.find((source) => !isValidIpOrCidr(source))
  if (invalid) throw new Error(`来源地址格式不正确：${invalid}`)
  return [...new Set(sources)]
}

function portRangeContains(value: string, expected: number): boolean {
  const [start, end] = value.split('-').map(Number)
  return expected >= start && expected <= (end ?? start)
}

export function createFirewallRulePlan(draft: FirewallRuleDraft): FirewallRulePlan {
  if (draft.tool === 'nftables') throw new Error('当前只支持查看 nftables 原始规则，不能自动改写')
  const ports = normalizePorts(draft.ports)
  const protocols: Array<'tcp' | 'udp'> =
    draft.protocol === 'both' ? ['tcp', 'udp'] : [draft.protocol]
  let sources: string[] = []
  if (draft.sourceMode === 'current') {
    if (!isValidIpOrCidr(draft.sshClientIp))
      throw new Error('未识别到当前 SSH 来源 IP，请选择自定义来源')
    sources = [draft.sshClientIp]
  } else if (draft.sourceMode === 'custom') {
    sources = normalizeSources(draft.customSources)
    if (sources.length === 0) throw new Error('请输入允许访问的 IP 或 CIDR 地址段')
  }

  const warnings: string[] = []
  let risk: FirewallRisk = 'safe'
  if (draft.sourceMode === 'any') {
    risk = 'warning'
    warnings.push('该规则允许任何来源访问，请确认服务本身已配置身份认证。')
    if (
      ports.some((port) =>
        [...DATABASE_PORTS].some((databasePort) => portRangeContains(port, databasePort))
      )
    ) {
      risk = 'danger'
      warnings.push('数据库或缓存端口将暴露到公网，建议改为当前 IP、内网网段或可信来源。')
    }
    if (ports.some((port) => portRangeContains(port, 22))) {
      warnings.push('SSH 端口将允许所有来源访问，请确认已禁用弱密码并限制登录账号。')
    }
  }
  if (draft.tool === 'iptables' && draft.persist === false) {
    warnings.push('iptables 规则可能仅在本次开机期间生效，保存方式取决于服务器配置。')
  }

  return {
    tool: draft.tool,
    ports,
    protocols,
    sources,
    sourceMode: draft.sourceMode,
    risk,
    warnings,
    persistent: draft.tool !== 'iptables' || draft.persist !== false
  }
}

export function parseFirewallOverview(output: string): FirewallOverview {
  const meta: Record<string, string> = {}
  const tools = new Map<FirewallToolId, FirewallTool>()
  const rawRules: Record<FirewallToolId, string[]> = {
    ufw: [],
    firewalld: [],
    iptables: [],
    nftables: []
  }
  const containerPorts: Array<{ container: string; published: string }> = []

  output.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('META|')) {
      const [, key, ...rest] = line.split('|')
      meta[key] = rest.join('|')
    } else if (line.startsWith('TOOL|')) {
      const [, id, installed, active, status, ...versionParts] = line.split('|')
      if (!isFirewallToolId(id)) return
      tools.set(id, {
        id,
        label: FIREWALL_TOOL_LABELS[id],
        installed: installed === 'yes',
        active: active === 'yes',
        status: status || '',
        version: versionParts.join('|') || ''
      })
    } else if (line.startsWith('RULE_RAW|')) {
      const [, id, ...rest] = line.split('|')
      if (isFirewallToolId(id)) rawRules[id].push(rest.join('|'))
    } else if (line.startsWith('CONTAINER_PORT|')) {
      const [, container, ...published] = line.split('|')
      if (container && published.length) {
        containerPorts.push({ container, published: published.join('|') })
      }
    }
  })

  return {
    osId: meta.os_id || '',
    osName: meta.os_name || '',
    packageManager: meta.package_manager || 'unknown',
    needsPrivilege: meta.needs_privilege === 'yes',
    canSudo: meta.can_sudo === 'yes',
    sshClientIp: meta.ssh_client_ip || '',
    sshServerPort: /^\d+$/.test(meta.ssh_server_port || '')
      ? Number(meta.ssh_server_port)
      : undefined,
    iptablesBackend:
      meta.iptables_backend === 'nf_tables' || meta.iptables_backend === 'legacy'
        ? meta.iptables_backend
        : 'unknown',
    iptablesPolicies: {
      ipv4: meta.iptables_policy_v4 || '',
      ipv6: meta.iptables_policy_v6 || ''
    },
    nftHasRules: meta.nft_has_rules === 'yes',
    persistenceEnabled: meta.mshell_persistence === 'yes',
    containerPorts,
    tools: (['ufw', 'firewalld', 'iptables', 'nftables'] as FirewallToolId[]).map(
      (id) =>
        tools.get(id) || {
          id,
          label: FIREWALL_TOOL_LABELS[id],
          installed: false,
          active: false,
          status: '',
          version: ''
        }
    ),
    rawRules
  }
}

export function isFirewallToolId(value: string): value is FirewallToolId {
  return ['ufw', 'firewalld', 'iptables', 'nftables'].includes(value)
}

export function selectPrimaryFirewall(overview: FirewallOverview): FirewallTool | undefined {
  const byId = (id: FirewallToolId) => overview.tools.find((tool) => tool.id === id)
  for (const id of ['ufw', 'firewalld', 'iptables', 'nftables'] as FirewallToolId[]) {
    const tool = byId(id)
    if (tool?.installed && tool.active) return tool
  }
  const os = overview.osId.toLowerCase()
  const preferred: FirewallToolId[] = /centos|rhel|rocky|almalinux|fedora|opensuse|sles/.test(os)
    ? ['firewalld', 'iptables', 'nftables', 'ufw']
    : ['ufw', 'iptables', 'nftables', 'firewalld']
  return preferred.map(byId).find((tool) => tool?.installed)
}

export function displayFirewallLabel(
  tool: FirewallTool | undefined,
  overview: FirewallOverview
): string {
  if (!tool) return '未检测到'
  if (tool.id === 'iptables' && overview.iptablesBackend === 'nf_tables')
    return 'iptables（nftables 后端）'
  return tool.label
}

export function normalizeFirewallRules(data: FirewallOverview | null): FirewallRule[] {
  if (!data) return []
  return (Object.entries(data.rawRules) as [FirewallToolId, string[]][]).flatMap(([tool, lines]) =>
    lines
      .map((line, index) => normalizeFirewallRule(tool, line, index, data))
      .filter((rule): rule is FirewallRule => Boolean(rule))
  )
}

function normalizeFirewallRule(
  tool: FirewallToolId,
  raw: string,
  index: number,
  overview: FirewallOverview
): FirewallRule | null {
  let line = raw.trim()
  let managed = false
  let family: 'IPv4' | 'IPv6' | undefined
  const iptablesMarker = line.match(/^__MSHELL_(MANAGED|SYSTEM)_(V4|V6)__\s+/)
  if (iptablesMarker) {
    managed = iptablesMarker[1] === 'MANAGED'
    family = iptablesMarker[2] === 'V6' ? 'IPv6' : 'IPv4'
    line = line.slice(iptablesMarker[0].length)
  }
  if (!line || /^Status:/i.test(line) || /^To\s+Action\s+From/i.test(line) || /^--/.test(line))
    return null
  if (tool === 'ufw') return normalizeUfwRule(line, index)
  if (tool === 'firewalld') return normalizeFirewalldRule(line)
  if (tool === 'iptables') {
    return normalizeIptablesRule(line, index, managed, family, overview.persistenceEnabled)
  }
  return null
}

function normalizeUfwRule(line: string, index: number): FirewallRule | null {
  const numbered = line.match(/^\[\s*(\d+)\]\s+(.+)$/)
  const body = numbered ? numbered[2].trim() : line
  if (!body || /^Status:/i.test(body)) return null
  const actionMatch = body.match(/\s+(ALLOW|DENY|REJECT)\s+(IN|OUT)?\s*(.*)$/i)
  const target = actionMatch ? body.slice(0, actionMatch.index).trim() : body
  const action = actionMatch?.[1]?.toUpperCase() || 'RULE'
  const [port, protocol] = target.split('/')
  return {
    key: `ufw:${numbered?.[1] || index}:${line}`,
    tool: 'ufw',
    raw: line,
    action:
      action === 'ALLOW'
        ? 'allow'
        : action === 'DENY'
          ? 'deny'
          : action === 'REJECT'
            ? 'reject'
            : 'unknown',
    actionLabel:
      action === 'ALLOW'
        ? '允许'
        : action === 'DENY'
          ? '拒绝'
          : action === 'REJECT'
            ? '拦截'
            : '规则',
    summary: target,
    port: port || target,
    protocol,
    source: actionMatch?.[3]?.trim() || '',
    index: numbered ? Number(numbered[1]) : undefined,
    deletable: Boolean(numbered),
    persistent: true
  }
}

function normalizeFirewalldRule(line: string): FirewallRule | null {
  const portLine = line.match(/^ports:\s*(.*)$/i)
  if (portLine?.[1].trim()) {
    const ports = portLine[1].trim()
    const [port, protocol] = ports.split('/')
    return {
      key: `firewalld:ports:${ports}`,
      tool: 'firewalld',
      raw: line,
      action: 'allow',
      actionLabel: '允许',
      summary: ports,
      port: ports,
      protocol,
      deletable: !ports.includes(' '),
      deletePayload: !ports.includes(' ') ? { port, protocol } : undefined,
      persistent: true
    }
  }
  const serviceLine = line.match(/^services:\s*(.*)$/i)
  if (serviceLine?.[1].trim()) {
    const service = serviceLine[1].trim()
    return {
      key: `firewalld:services:${service}`,
      tool: 'firewalld',
      raw: line,
      action: 'allow',
      actionLabel: '服务',
      summary: service,
      service,
      deletable: !service.includes(' '),
      deletePayload: !service.includes(' ') ? { service } : undefined,
      persistent: true
    }
  }
  return null
}

function normalizeIptablesRule(
  line: string,
  index: number,
  managed: boolean,
  family: 'IPv4' | 'IPv6' | undefined,
  persistenceEnabled: boolean
): FirewallRule | null {
  if (/^Chain\s+/i.test(line) || /^num\s+/i.test(line)) return null
  const parts = line.split(/\s+/)
  const number = Number(parts[0])
  if (!Number.isFinite(number)) return null
  const target = parts[1] || ''
  const protocol = parts[2] && parts[2] !== 'all' ? parts[2] : ''
  const source = parts[4] && parts[4] !== '0.0.0.0/0' && parts[4] !== '::/0' ? parts[4] : ''
  const destination = parts[5] && parts[5] !== '0.0.0.0/0' && parts[5] !== '::/0' ? parts[5] : ''
  const port = line.match(/\bdpt:(\S+)/)?.[1]
  const configEntry =
    managed && target === 'ACCEPT' && (protocol === 'tcp' || protocol === 'udp') && port
      ? `${family === 'IPv6' ? '6' : '4'}|${protocol}|${port.replace(':', '-')}|${source || '*'}`
      : undefined
  return {
    key: `iptables:${number}:${index}:${line}`,
    tool: 'iptables',
    raw: line,
    action:
      target === 'ACCEPT'
        ? 'allow'
        : target === 'DROP'
          ? 'deny'
          : target === 'REJECT'
            ? 'reject'
            : 'unknown',
    actionLabel:
      target === 'ACCEPT'
        ? '允许'
        : target === 'DROP'
          ? '拒绝'
          : target === 'REJECT'
            ? '拦截'
            : target || '规则',
    summary: port || line,
    port,
    protocol,
    source,
    target: destination,
    chain: managed ? 'MSHELL-INPUT' : 'INPUT',
    index: number,
    deletable: Boolean(configEntry),
    deletePayload: configEntry ? { configEntry } : undefined,
    persistent: managed && persistenceEnabled,
    managed,
    family
  }
}

export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function buildFirewallDetectCommand(): string {
  return `
sh <<'MSHELL_FIREWALL_DETECT'
set +e
echo "__MSHELL_FIREWALL_V2__"

os_id=""
os_name=""
if [ -r /etc/os-release ]; then
  os_id=$(sed -n 's/^ID=//p' /etc/os-release | head -n1 | tr -d '"')
  os_name=$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | head -n1 | tr -d '"')
fi

pkg="unknown"
for candidate in apt-get dnf yum zypper pacman apk; do
  if command -v "$candidate" >/dev/null 2>&1; then pkg="$candidate"; break; fi
done

needs_privilege=no
can_sudo=no
SUDO=""
if [ "$(id -u 2>/dev/null)" != "0" ]; then
  needs_privilege=yes
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    can_sudo=yes
    SUDO="sudo -n"
  fi
fi

meta() { printf 'META|%s|%s\n' "$1" "$2"; }
tool() { printf 'TOOL|%s|%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" "$5"; }
rule_raw() { printf 'RULE_RAW|%s|%s\n' "$1" "$2"; }
iptables_rule() { printf 'RULE_RAW|iptables|__MSHELL_%s_%s__ %s\n' "$1" "$2" "$3"; }
container_port() { printf 'CONTAINER_PORT|%s|%s\n' "$1" "$2"; }

set -- \${SSH_CONNECTION:-\${SSH_CLIENT:-}}
meta ssh_client_ip "\${1:-}"
if [ -n "\${4:-}" ]; then meta ssh_server_port "$4"; elif [ -n "\${3:-}" ]; then meta ssh_server_port "$3"; else meta ssh_server_port ""; fi
meta os_id "$os_id"
meta os_name "$os_name"
meta package_manager "$pkg"
meta needs_privilege "$needs_privilege"
meta can_sudo "$can_sudo"
mshell_persistence=no
if [ -x /usr/local/sbin/mshell-firewall-restore ] && command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet mshell-firewall.service 2>/dev/null; then
  mshell_persistence=yes
fi
meta mshell_persistence "$mshell_persistence"

if command -v ufw >/dev/null 2>&1; then
  ufw_status=$($SUDO ufw status 2>/dev/null || ufw status 2>/dev/null || true)
  ufw_version=$(ufw --version 2>/dev/null | head -n1 || true)
  ufw_active=no
  echo "$ufw_status" | grep -qi 'Status:[[:space:]]*active' && ufw_active=yes
  tool ufw yes "$ufw_active" "$(echo "$ufw_status" | head -n1)" "$ufw_version"
  ($SUDO ufw status numbered 2>/dev/null || ufw status numbered 2>/dev/null || true) | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw ufw "$line"
  done
else
  tool ufw no no "" ""
fi

if command -v firewall-cmd >/dev/null 2>&1; then
  fw_state=$($SUDO firewall-cmd --state 2>/dev/null || firewall-cmd --state 2>/dev/null || true)
  fw_version=$(firewall-cmd --version 2>/dev/null | head -n1 || true)
  fw_active=no
  [ "$fw_state" = "running" ] && fw_active=yes
  tool firewalld yes "$fw_active" "$fw_state" "$fw_version"
  if [ "$fw_active" = yes ]; then
    ($SUDO firewall-cmd --list-all 2>/dev/null || firewall-cmd --list-all 2>/dev/null || true) | while IFS= read -r line; do
      [ -n "$line" ] && rule_raw firewalld "$line"
    done
  fi
else
  tool firewalld no no "" ""
fi

iptables_backend=unknown
if command -v iptables >/dev/null 2>&1; then
  iptables_version=$(iptables --version 2>/dev/null | head -n1 || true)
  case "$iptables_version" in *nf_tables*) iptables_backend=nf_tables ;; *legacy*) iptables_backend=legacy ;; esac
  iptables_active=no
  iptables_policy_v4=$($SUDO iptables -S INPUT 2>/dev/null | sed -n 's/^-P INPUT //p' | head -n1)
  iptables_policy_v6=""
  if command -v ip6tables >/dev/null 2>&1; then
    iptables_policy_v6=$($SUDO ip6tables -S INPUT 2>/dev/null | sed -n 's/^-P INPUT //p' | head -n1)
  fi
  case "$iptables_policy_v4" in DROP|REJECT)
    if [ -z "$iptables_policy_v6" ]; then iptables_active=yes; else case "$iptables_policy_v6" in DROP|REJECT) iptables_active=yes ;; esac; fi
  ;; esac
  meta iptables_policy_v4 "$iptables_policy_v4"
  meta iptables_policy_v6 "$iptables_policy_v6"

  inspect_iptables_family() {
    bin="$1"
    family="$2"
    command -v "$bin" >/dev/null 2>&1 || return 0
    input_rules=$($SUDO "$bin" -S INPUT 2>/dev/null || "$bin" -S INPUT 2>/dev/null || true)
    managed_rules=$($SUDO "$bin" -L MSHELL-INPUT -n --line-numbers 2>/dev/null || "$bin" -L MSHELL-INPUT -n --line-numbers 2>/dev/null || true)

    ($SUDO "$bin" -L INPUT -n --line-numbers 2>/dev/null || "$bin" -L INPUT -n --line-numbers 2>/dev/null || true) | while IFS= read -r line; do
      case "$line" in *MSHELL-INPUT*) continue ;; esac
      [ -n "$line" ] && iptables_rule SYSTEM "$family" "$line"
    done
    echo "$managed_rules" | while IFS= read -r line; do
      [ -n "$line" ] && iptables_rule MANAGED "$family" "$line"
    done
  }

  inspect_iptables_family iptables V4
  inspect_iptables_family ip6tables V6
  tool iptables yes "$iptables_active" "$([ "$iptables_active" = yes ] && echo default-deny || echo default-allow)" "$iptables_version"
else
  tool iptables no no "" ""
  meta iptables_policy_v4 ""
  meta iptables_policy_v6 ""
fi
meta iptables_backend "$iptables_backend"

if command -v nft >/dev/null 2>&1; then
  nft_rules=$($SUDO nft list ruleset 2>/dev/null || nft list ruleset 2>/dev/null || true)
  nft_service=no
  command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nftables 2>/dev/null && nft_service=yes
  nft_has_rules=no
  [ -n "$nft_rules" ] && nft_has_rules=yes
  nft_version=$(nft --version 2>/dev/null | head -n1 || true)
  tool nftables yes "$nft_service" "$([ "$nft_service" = yes ] && echo service-active || echo backend-only)" "$nft_version"
  echo "$nft_rules" | sed -n '1,160p' | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw nftables "$line"
  done
  meta nft_has_rules "$nft_has_rules"
else
  tool nftables no no "" ""
  meta nft_has_rules no
fi

if command -v docker >/dev/null 2>&1; then
  ($SUDO docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null || docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null || true) | while IFS='|' read -r name ports; do
    [ -n "$name" ] && [ -n "$ports" ] && container_port "$name" "$ports"
  done
fi

echo "__MSHELL_FIREWALL_END__"
MSHELL_FIREWALL_DETECT
`
}

function privilegePrelude(action: string): string {
  return `
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  SUDO="sudo -n"
else
  echo "当前用户缺少免密 sudo 权限，无法${action}防火墙。"
  exit 1
fi`
}

export function buildAllowFirewallCommand(plan: FirewallRulePlan): string {
  const sourceList = plan.sources.length ? plan.sources.join(' ') : '__MSHELL_ALL__'
  return `
sh <<'MSHELL_FIREWALL_ALLOW'
set -e
TOOL=${shellQuote(plan.tool)}
PORTS=${shellQuote(plan.ports.join(' '))}
SOURCES=${shellQuote(sourceList)}
PROTOCOLS=${shellQuote(plan.protocols.join(' '))}
PERSIST=${shellQuote(plan.persistent ? 'yes' : 'no')}
${privilegePrelude('修改')}

install_mshell_persistence() {
  $SUDO mkdir -p /etc/mshell
  $SUDO touch /etc/mshell/firewall.rules
  $SUDO chmod 600 /etc/mshell/firewall.rules
  $SUDO tee /usr/local/sbin/mshell-firewall-restore >/dev/null <<'MSHELL_RESTORE_SCRIPT'
#!/bin/sh
set -eu
RULES=/etc/mshell/firewall.rules
CHAIN=MSHELL-INPUT

apply_family() {
  family="$1"
  bin="$2"
  if ! command -v "$bin" >/dev/null 2>&1; then
    grep -q "^$family|" "$RULES" 2>/dev/null && { echo "缺少 $bin，无法恢复对应规则。"; return 1; }
    return 0
  fi
  "$bin" -w 5 -D INPUT -j "$CHAIN" 2>/dev/null || true
  "$bin" -w 5 -F "$CHAIN" 2>/dev/null || true
  if ! grep -q "^$family|" "$RULES" 2>/dev/null; then
    "$bin" -w 5 -X "$CHAIN" 2>/dev/null || true
    return 0
  fi
  "$bin" -w 5 -N "$CHAIN" 2>/dev/null || true
  "$bin" -w 5 -I INPUT 1 -j "$CHAIN"
  while IFS='|' read -r entry_family proto port source extra; do
    [ "$entry_family" = "$family" ] || continue
    [ -z "$extra" ] || continue
    case "$proto" in tcp|udp) ;; *) continue ;; esac
    case "$port" in ''|*[!0-9-]*) continue ;; esac
    case "$source" in ''|*[!0-9A-Fa-f:./*]*) continue ;; esac
    ipt_port=$(echo "$port" | tr '-' ':')
    if [ "$source" = "*" ]; then
      "$bin" -w 5 -A "$CHAIN" -p "$proto" --dport "$ipt_port" -j ACCEPT
    else
      "$bin" -w 5 -A "$CHAIN" -p "$proto" -s "$source" --dport "$ipt_port" -j ACCEPT
    fi
  done < "$RULES"
}

[ -r "$RULES" ] || exit 0
apply_family 4 iptables
apply_family 6 ip6tables
MSHELL_RESTORE_SCRIPT
  $SUDO chmod 700 /usr/local/sbin/mshell-firewall-restore
  $SUDO tee /etc/systemd/system/mshell-firewall.service >/dev/null <<'MSHELL_SYSTEMD_UNIT'
[Unit]
Description=Restore MShell-managed firewall rules
After=network.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mshell-firewall-restore
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
MSHELL_SYSTEMD_UNIT
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable mshell-firewall.service
}

append_persistent_rule() {
  family="$1"
  proto="$2"
  port="$3"
  source="$4"
  entry="$family|$proto|$port|$source"
  $SUDO grep -Fqx -- "$entry" /etc/mshell/firewall.rules 2>/dev/null || printf '%s\\n' "$entry" | $SUDO tee -a /etc/mshell/firewall.rules >/dev/null
}

apply_runtime_iptables_rule() {
  family="$1"
  proto="$2"
  port="$3"
  source="$4"
  bin=iptables
  [ "$family" = 6 ] && bin=ip6tables
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "未找到 $bin，已跳过对应 IP 协议规则。"
    return 0
  fi
  ipt_port=$(echo "$port" | tr '-' ':')
  if [ "$source" = "*" ]; then
    $SUDO "$bin" -w 5 -C INPUT -p "$proto" --dport "$ipt_port" -j ACCEPT 2>/dev/null || $SUDO "$bin" -w 5 -I INPUT -p "$proto" --dport "$ipt_port" -j ACCEPT
  else
    $SUDO "$bin" -w 5 -C INPUT -p "$proto" -s "$source" --dport "$ipt_port" -j ACCEPT 2>/dev/null || $SUDO "$bin" -w 5 -I INPUT -p "$proto" -s "$source" --dport "$ipt_port" -j ACCEPT
  fi
}

if [ "$TOOL" = "iptables" ]; then
  [ "$PERSIST" = "yes" ] && install_mshell_persistence
  for port in $PORTS; do
    for proto in $PROTOCOLS; do
      for source in $SOURCES; do
        if [ "$source" = "__MSHELL_ALL__" ]; then
          if [ "$PERSIST" = "yes" ]; then
            append_persistent_rule 4 "$proto" "$port" "*"
            command -v ip6tables >/dev/null 2>&1 && append_persistent_rule 6 "$proto" "$port" "*"
          else
            apply_runtime_iptables_rule 4 "$proto" "$port" "*"
            apply_runtime_iptables_rule 6 "$proto" "$port" "*"
          fi
        else
          family=4
          echo "$source" | grep -q ':' && family=6
          if [ "$PERSIST" = "yes" ]; then
            if [ "$family" = 6 ] && ! command -v ip6tables >/dev/null 2>&1; then
              echo "未找到 ip6tables，无法保存 IPv6 规则。"
              exit 1
            fi
            append_persistent_rule "$family" "$proto" "$port" "$source"
          else
            apply_runtime_iptables_rule "$family" "$proto" "$port" "$source"
          fi
        fi
      done
    done
  done
  if [ "$PERSIST" = "yes" ]; then
    $SUDO /usr/local/sbin/mshell-firewall-restore
    echo "规则已写入 MSHELL-INPUT，并配置为开机自动恢复。"
  else
    echo "临时规则已写入 INPUT，服务器重启后可能失效。"
  fi
  exit 0
fi

for port in $PORTS; do
  for proto in $PROTOCOLS; do
    for source in $SOURCES; do
      [ "$source" = "__MSHELL_ALL__" ] && source=""
      case "$TOOL" in
        ufw)
          ufw_port=$(echo "$port" | tr '-' ':')
          if [ -n "$source" ]; then
            $SUDO ufw allow from "$source" to any port "$ufw_port" proto "$proto"
          else
            $SUDO ufw allow "$ufw_port/$proto"
          fi
          ;;
        firewalld)
          fw_port=$(echo "$port" | tr ':' '-')
          zone=$($SUDO firewall-cmd --get-default-zone)
          if [ -n "$source" ]; then
            family=ipv4
            echo "$source" | grep -q ':' && family=ipv6
            rule="rule family=\\"$family\\" source address=\\"$source\\" port port=\\"$fw_port\\" protocol=\\"$proto\\" accept"
            $SUDO firewall-cmd --permanent --zone="$zone" --query-rich-rule="$rule" >/dev/null 2>&1 || $SUDO firewall-cmd --permanent --zone="$zone" --add-rich-rule="$rule"
          else
            $SUDO firewall-cmd --permanent --zone="$zone" --query-port="$fw_port/$proto" >/dev/null 2>&1 || $SUDO firewall-cmd --permanent --zone="$zone" --add-port="$fw_port/$proto"
          fi
          ;;
      esac
    done
  done
done

[ "$TOOL" = "firewalld" ] && $SUDO firewall-cmd --reload
echo "规则已写入: $TOOL"
MSHELL_FIREWALL_ALLOW
`
}

export function buildEnableFirewallCommand(
  tool: FirewallToolId,
  sshClientIp: string,
  sshServerPort?: number
): string {
  if (tool !== 'ufw' && tool !== 'firewalld') throw new Error('该防火墙不支持安全的一键启用')
  if (
    !isValidIpOrCidr(sshClientIp) ||
    !sshServerPort ||
    sshServerPort < 1 ||
    sshServerPort > 65535
  ) {
    throw new Error('无法识别当前 SSH 来源 IP 或服务端口，为避免断开连接，已阻止一键启用')
  }
  return `
sh <<'MSHELL_FIREWALL_ENABLE'
set -e
TOOL=${shellQuote(tool)}
SSH_SOURCE=${shellQuote(sshClientIp)}
SSH_PORT=${shellQuote(String(sshServerPort))}
${privilegePrelude('启用')}

case "$TOOL" in
  ufw)
    $SUDO ufw allow from "$SSH_SOURCE" to any port "$SSH_PORT" proto tcp
    $SUDO ufw --force enable
    ;;
  firewalld)
    if ! command -v firewall-offline-cmd >/dev/null 2>&1; then
      echo "缺少 firewall-offline-cmd，无法在启动前保护当前 SSH 连接。"
      exit 1
    fi
    zone=$($SUDO firewall-offline-cmd --get-default-zone 2>/dev/null || echo public)
    family=ipv4
    echo "$SSH_SOURCE" | grep -q ':' && family=ipv6
    rule="rule family=\\"$family\\" source address=\\"$SSH_SOURCE\\" port port=\\"$SSH_PORT\\" protocol=\\"tcp\\" accept"
    $SUDO firewall-offline-cmd --zone="$zone" --query-rich-rule="$rule" >/dev/null 2>&1 || $SUDO firewall-offline-cmd --zone="$zone" --add-rich-rule="$rule"
    $SUDO systemctl enable --now firewalld
    ;;
esac
echo "已保护当前 SSH 来源并启用: $TOOL"
MSHELL_FIREWALL_ENABLE
`
}

export function buildDisableFirewallCommand(tool: FirewallToolId): string {
  if (tool !== 'ufw' && tool !== 'firewalld') throw new Error('该防火墙不支持一键停用')
  return `
sh <<'MSHELL_FIREWALL_DISABLE'
set -e
TOOL=${shellQuote(tool)}
${privilegePrelude('停用')}
case "$TOOL" in
  ufw) $SUDO ufw disable ;;
  firewalld) $SUDO systemctl disable --now firewalld ;;
esac
echo "已停用: $TOOL"
MSHELL_FIREWALL_DISABLE
`
}

export function recommendedFirewall(overview: FirewallOverview): 'ufw' | 'firewalld' {
  return /centos|rhel|rocky|almalinux|fedora|opensuse|sles/.test(overview.osId.toLowerCase()) ||
    ['dnf', 'yum', 'zypper'].includes(overview.packageManager)
    ? 'firewalld'
    : 'ufw'
}

export function shouldOfferFirewallInstall(overview: FirewallOverview): boolean {
  return !overview.tools.some(
    (tool) =>
      tool.installed && (tool.id === 'ufw' || tool.id === 'firewalld' || tool.id === 'iptables')
  )
}

export function classifyFirewallInstallError(error: unknown): FirewallInstallError {
  const raw = error instanceof Error ? error.message : String(error)
  if (/REPOSITORY_EXPIRED|release file.+expired|invalid since/i.test(raw)) {
    return {
      errorCode: 'REPOSITORY_EXPIRED',
      message: '软件源元数据已过期，已停止安装',
      guidance:
        'MShell 不会关闭仓库有效期校验。当前已有 iptables 时无需安装 UFW；否则请配置受支持的软件源。'
    }
  }
  if (/REPOSITORY_UNAVAILABLE|does not have a release file|404 not found/i.test(raw)) {
    return {
      errorCode: 'REPOSITORY_UNAVAILABLE',
      message: '当前系统软件源不可用',
      guidance: '请配置仍受支持的可信软件源或合规的离线软件源后重试。'
    }
  }
  if (
    /NETWORK_UNAVAILABLE|temporary failure resolving|could not resolve|network is unreachable/i.test(
      raw
    )
  ) {
    return {
      errorCode: 'NETWORK_UNAVAILABLE',
      message: '服务器无法连接软件源',
      guidance: '请检查 DNS、服务器网络和代理配置后重试。'
    }
  }
  return {
    errorCode: 'PACKAGE_INSTALL_FAILED',
    message: '防火墙软件包安装失败',
    guidance: '请检查包管理器锁、依赖冲突和系统软件源状态，修复后重试。'
  }
}

export function buildInstallFirewallCommand(tool: 'ufw' | 'firewalld'): string {
  return `
sh <<'MSHELL_FIREWALL_INSTALL'
set -e
TARGET=${shellQuote(tool)}
${privilegePrelude('安装')}
install_pkg() {
  if command -v apt-get >/dev/null 2>&1; then
    update_output=$($SUDO apt-get update 2>&1) || {
      case "$update_output" in
        *"Release file"*"expired"*|*"invalid since"*) echo "__MSHELL_FIREWALL_ERROR__|REPOSITORY_EXPIRED" >&2 ;;
        *"does not have a Release file"*|*"404 Not Found"*) echo "__MSHELL_FIREWALL_ERROR__|REPOSITORY_UNAVAILABLE" >&2 ;;
        *"Temporary failure resolving"*|*"Could not resolve"*|*"Network is unreachable"*) echo "__MSHELL_FIREWALL_ERROR__|NETWORK_UNAVAILABLE" >&2 ;;
        *) echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2 ;;
      esac
      exit 100
    }
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  elif command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  elif command -v yum >/dev/null 2>&1; then $SUDO yum install -y "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  elif command -v zypper >/dev/null 2>&1; then $SUDO zypper --non-interactive install "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  elif command -v pacman >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  elif command -v apk >/dev/null 2>&1; then $SUDO apk add "$1" || { echo "__MSHELL_FIREWALL_ERROR__|PACKAGE_INSTALL_FAILED" >&2; exit 1; }
  else echo "__MSHELL_FIREWALL_ERROR__|REPOSITORY_UNAVAILABLE" >&2; exit 1; fi
}
install_pkg "$TARGET"
echo "安装完成: $TARGET"
MSHELL_FIREWALL_INSTALL
`
}

export function buildDeleteFirewallCommand(rule: FirewallRule): string {
  if (rule.tool === 'ufw' && rule.index) {
    return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
${privilegePrelude('删除')}
$SUDO ufw --force delete ${Number(rule.index)}
MSHELL_FIREWALL_DELETE
`
  }
  if (rule.tool === 'firewalld') {
    const payload = rule.deletePayload || {}
    const remove =
      payload.port && payload.protocol
        ? `--remove-port=${shellQuote(`${payload.port}/${payload.protocol}`)}`
        : payload.service
          ? `--remove-service=${shellQuote(String(payload.service))}`
          : ''
    if (!remove) throw new Error('该规则暂不支持可视化删除')
    return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
${privilegePrelude('删除')}
zone=$($SUDO firewall-cmd --get-default-zone)
$SUDO firewall-cmd --permanent --zone="$zone" ${remove}
$SUDO firewall-cmd --reload
MSHELL_FIREWALL_DELETE
`
  }
  if (rule.tool === 'iptables' && rule.deletePayload?.configEntry) {
    return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
${privilegePrelude('删除')}
ENTRY=${shellQuote(String(rule.deletePayload.configEntry))}
RULES=/etc/mshell/firewall.rules
TMP=/etc/mshell/firewall.rules.tmp
if [ ! -x /usr/local/sbin/mshell-firewall-restore ] || [ ! -r "$RULES" ]; then
  echo "MShell 持久化配置不存在，请刷新后重试。"
  exit 2
fi
$SUDO awk -v entry="$ENTRY" '$0 != entry' "$RULES" | $SUDO tee "$TMP" >/dev/null
$SUDO chmod 600 "$TMP"
$SUDO mv "$TMP" "$RULES"
$SUDO /usr/local/sbin/mshell-firewall-restore
echo "MShell 持久化规则已删除。"
MSHELL_FIREWALL_DELETE
`
  }
  throw new Error('该规则暂不支持可视化删除')
}
