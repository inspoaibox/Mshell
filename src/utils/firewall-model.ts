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
export interface FirewallZone {
  name: string
  interfaces: string[]
  sources: string[]
  target: string
  active: boolean
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
  persistent?: boolean
  runtime?: boolean
  managed?: boolean
  family?: 'IPv4' | 'IPv6'
  zone?: string
  kind?: 'port' | 'service' | 'rich'
  definition?: string
  configEntries?: string[]
  runtimeEntries?: string[]
  deleteArgs?: string[]
  protectionReason?: string
}
export interface FirewallOverview {
  osId: string
  osName: string
  packageManager: string
  needsPrivilege: boolean
  canSudo: boolean
  sshClientIp: string
  sshServerIp: string
  sshServerPort?: number
  sshInterface: string
  iptablesBackend: 'legacy' | 'nf_tables' | 'unknown'
  iptablesPolicies: { ipv4: string; ipv6: string }
  nftHasRules: boolean
  nativeNftInput: boolean
  persistenceEnabled: boolean
  canPersist: boolean
  canWatchdog: boolean
  containerPorts: Array<{ container: string; published: string }>
  tools: FirewallTool[]
  rawRules: Record<FirewallToolId, string[]>
  zones: FirewallZone[]
  defaultZone: string
  sshZone?: string
  zoneError?: string
  rules: FirewallRule[]
  errors: string[]
  servicePorts: Record<string, string>
  capturedAt: number
}
export interface FirewallRuleDraft {
  tool: FirewallToolId
  ports: string
  protocol: RuleProtocol
  sourceMode: RuleSourceMode
  customSources: string
  sshClientIp: string
  sshServerPort?: number
  persist?: boolean
  zone?: string
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
  zone?: string
}
export type FirewallAction =
  | { type: 'allow'; draft: FirewallRuleDraft }
  | { type: 'delete'; key: string }
  | { type: 'enable' | 'disable' | 'install'; tool: 'ufw' | 'firewalld' }
export interface FirewallActionResult {
  output: string
  overview: FirewallOverview
  pending?: { token: string; expiresAt: number }
}
export const FIREWALL_TOOL_LABELS: Record<FirewallToolId, string> = {
  ufw: 'UFW',
  firewalld: 'Firewalld',
  iptables: 'iptables',
  nftables: 'nftables'
}
export const FIREWALL_PORT_PRESETS = [
  { label: '自定义端口', value: 'custom', ports: '', protocol: 'tcp' as RuleProtocol },
  ...[
    ['SSH', 'ssh', '22'],
    ['HTTP', 'http', '80'],
    ['HTTPS', 'https', '443'],
    ['Web 应用', 'web-app', '3000'],
    ['MySQL', 'mysql', '3306'],
    ['PostgreSQL', 'postgresql', '5432'],
    ['Redis', 'redis', '6379']
  ].map(([label, value, ports]) => ({ label, value, ports, protocol: 'tcp' as RuleProtocol }))
]
const toolIds: FirewallToolId[] = ['ufw', 'firewalld', 'iptables', 'nftables']
export const isFirewallToolId = (value: string): value is FirewallToolId =>
  toolIds.includes(value as FirewallToolId)
export const shellQuote = (value: string) => "'" + String(value).replace(/'/g, "'\\''") + "'"
export const parseListInput = (value: string) =>
  String(value)
    .split(/[,\s，]+/)
    .filter(Boolean)
function addressValue(input: string): { value: bigint; bits: 32 | 128; prefix: number } {
  const [address, mask, ...extra] = input.split('/')
  if (extra.length) throw new Error('地址无效')
  let bits: 32 | 128, value: bigint
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const octets = address.split('.').map(Number)
    if (octets.some((n) => n > 255) || address.split('.').some((p) => p.length > 3))
      throw new Error('IPv4 无效')
    bits = 32
    value = octets.reduce((a, n) => (a << 8n) | BigInt(n), 0n)
  } else {
    if (!address.includes(':') || /[^\da-f:.]/i.test(address)) throw new Error('IPv6 无效')
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
    const [left, right] = normalized.split('::')
    const a = left ? left.split(':') : [],
      b = right ? right.split(':') : []
    const parts =
      right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
    if (parts.length !== 8) throw new Error('IPv6 无效')
    bits = 128
    value = parts.reduce((v, p) => (v << 16n) | BigInt('0x' + p), 0n)
  }
  const prefix = mask === undefined ? bits : Number(mask)
  if ((mask !== undefined && !/^\d{1,3}$/.test(mask)) || prefix > bits || prefix < 0)
    throw new Error('CIDR 无效')
  return { value, bits, prefix }
}
export function isValidIpOrCidr(value: string) {
  try {
    addressValue(value)
    return true
  } catch {
    return false
  }
}
export function normalizeSource(input: string): string {
  const { value, bits, prefix } = addressValue(input)
  const network = (value >> BigInt(bits - prefix)) << BigInt(bits - prefix)
  const address =
    bits === 32
      ? [24, 16, 8, 0].map((shift) => Number((network >> BigInt(shift)) & 255n)).join('.')
      : new URL(
          'http://[' +
            Array.from({ length: 8 }, (_, i) =>
              ((network >> BigInt((7 - i) * 16)) & 65535n).toString(16)
            ).join(':') +
            ']/'
        ).hostname.slice(1, -1)
  return address + (prefix === bits ? '' : '/' + prefix)
}
export function sourceContains(network: string, ip: string): boolean {
  if (!network || network === '*' || /^Anywhere(?: \(v6\))?$/.test(network)) return true
  try {
    const a = addressValue(network),
      b = addressValue(ip)
    return (
      a.bits === b.bits &&
      a.value >> BigInt(a.bits - a.prefix) === b.value >> BigInt(a.bits - a.prefix)
    )
  } catch {
    return true
  }
}
export function normalizeSources(input: string) {
  return [
    ...new Set(
      parseListInput(input).map((value) => {
        if (!isValidIpOrCidr(value)) throw new Error('来源地址格式不正确：' + value)
        return normalizeSource(value)
      })
    )
  ]
}
export function normalizePorts(input: string): string[] {
  const values = parseListInput(input)
  if (!values.length) throw new Error('请输入至少一个端口')
  return [
    ...new Set(
      values.map((value) => {
        if (!/^\d{1,5}(?:[-:]\d{1,5})?$/.test(value)) throw new Error('端口格式不正确：' + value)
        const [a, b] = value.split(/[-:]/).map(Number)
        if (a < 1 || a > 65535 || (b !== undefined && (b < a || b > 65535)))
          throw new Error('端口范围不正确：' + value)
        return b === undefined || a === b ? String(a) : `${a}-${b}`
      })
    )
  ]
}
export function portContains(value: string, port: number) {
  return value.split(',').some((part) => {
    if (!/^\d+(?:[-:]\d+)?$/.test(part)) return true
    const [a, b] = part.split(/[-:]/).map(Number)
    return port >= a && port <= (b ?? a)
  })
}
export function createFirewallRulePlan(draft: FirewallRuleDraft): FirewallRulePlan {
  if (!['ufw', 'firewalld', 'iptables'].includes(draft.tool))
    throw new Error('当前只支持查看 nftables 原始规则，不能自动改写')
  if (
    !['tcp', 'udp', 'both'].includes(draft.protocol) ||
    !['current', 'custom', 'any'].includes(draft.sourceMode)
  )
    throw new Error('规则类型无效')
  const ports = normalizePorts(draft.ports)
  const sources =
    draft.sourceMode === 'any'
      ? []
      : normalizeSources(draft.sourceMode === 'current' ? draft.sshClientIp : draft.customSources)
  if (draft.sourceMode !== 'any' && !sources.length)
    throw new Error('请输入允许访问的 IP 或 CIDR 地址段')
  const publicAccess =
    draft.sourceMode === 'any' || sources.some((source) => addressValue(source).prefix === 0)
  const warnings: string[] = []
  let risk: FirewallRisk = 'safe'
  if (publicAccess) {
    risk = 'warning'
    warnings.push('该规则允许整个 IP 地址族访问，请确认服务已配置身份认证。')
    if (
      ports.some((port) =>
        [3306, 5432, 6379, 27017, 9200, 11211].some((p) => portContains(port, p))
      )
    ) {
      risk = 'danger'
      warnings.push('数据库或缓存端口将暴露到公网，建议使用可信来源。')
    }
    if (ports.some((port) => portContains(port, draft.sshServerPort || 22)))
      warnings.push('当前 SSH 端口将允许所有来源访问。')
  }
  if (draft.tool === 'iptables' && draft.persist === false)
    warnings.push('临时规则仅在本次开机期间保留。')
  if (draft.zone && !/^[\w-]+$/.test(draft.zone)) throw new Error('zone 无效')
  return {
    tool: draft.tool as FirewallRulePlan['tool'],
    ports,
    protocols: draft.protocol === 'both' ? ['tcp', 'udp'] : [draft.protocol],
    sources,
    sourceMode: draft.sourceMode,
    risk,
    warnings,
    persistent: draft.tool !== 'iptables' || draft.persist !== false,
    zone: draft.zone
  }
}

function ruleKey(rule: FirewallRule) {
  return JSON.stringify([rule.tool, rule.zone, rule.kind, rule.definition, rule.family, rule.raw])
}
export function parseFirewallOverview(output: string): FirewallOverview {
  const lines = output.replace(/\r/g, '').trim().split('\n')
  if (lines[0] !== '__MSHELL_FIREWALL_V3__' || lines.at(-1) !== '__MSHELL_FIREWALL_END__')
    throw new Error('防火墙检测结果不完整，请重新检测')
  const meta: Record<string, string> = {},
    tools = new Map<FirewallToolId, FirewallTool>(),
    errors: string[] = [],
    rules: FirewallRule[] = []
  const rawRules: FirewallOverview['rawRules'] = {
    ufw: [],
    firewalld: [],
    iptables: [],
    nftables: []
  }
  const dumps = { runtime: [] as string[], permanent: [] as string[] },
    config = { persistent: [] as string[], runtime: [] as string[] }
  const servicePorts: Record<string, string> = {},
    containerPorts: FirewallOverview['containerPorts'] = []
  let nftJson = ''
  for (const line of lines.slice(1, -1)) {
    const [type, a, b, ...rest] = line.split('|')
    if (type === 'META') meta[a] = [b, ...rest].join('|')
    else if (type === 'ERROR') errors.push(a + '：' + [b, ...rest].join('|'))
    else if (type === 'TOOL' && isFirewallToolId(a))
      tools.set(a, {
        id: a,
        label: FIREWALL_TOOL_LABELS[a],
        installed: b === 'yes',
        active: rest[0] === 'yes',
        status: rest[1],
        version: rest.slice(2).join('|')
      })
    else if (type === 'RULE_RAW' && isFirewallToolId(a)) rawRules[a].push([b, ...rest].join('|'))
    else if (type === 'FW_DUMP' && (a === 'runtime' || a === 'permanent')) {
      const text = [b, ...rest].join('|')
      dumps[a].push(text)
      rawRules.firewalld.push(a + ': ' + text)
    } else if (type === 'CONFIG' && (a === 'persistent' || a === 'runtime'))
      config[a].push([b, ...rest].join('|'))
    else if (type === 'SERVICE') servicePorts[a + ':' + b] = rest.join('|')
    else if (type === 'NFT_JSON')
      nftJson += [a, b, ...rest].filter((v) => v !== undefined).join('|') + '\n'
    else if (type === 'CONTAINER_PORT')
      containerPorts.push({ container: a, published: [b, ...rest].join('|') })
  }
  if (toolIds.some((id) => !tools.has(id)) || !['yes', 'no'].includes(meta.needs_privilege))
    throw new Error('防火墙检测缺少工具或权限信息')
  const overview: FirewallOverview = {
    osId: meta.os_id || '',
    osName: meta.os_name || '',
    packageManager: meta.package_manager || 'unknown',
    needsPrivilege: meta.needs_privilege === 'yes',
    canSudo: meta.can_sudo === 'yes',
    sshClientIp: meta.ssh_client_ip || '',
    sshServerIp: meta.ssh_server_ip || '',
    sshServerPort: Number(meta.ssh_server_port) || undefined,
    sshInterface: meta.ssh_interface || '',
    iptablesBackend:
      meta.iptables_backend === 'nf_tables'
        ? 'nf_tables'
        : meta.iptables_backend === 'legacy'
          ? 'legacy'
          : 'unknown',
    iptablesPolicies: { ipv4: meta.iptables_policy_v4 || '', ipv6: meta.iptables_policy_v6 || '' },
    nftHasRules: false,
    nativeNftInput: false,
    persistenceEnabled: meta.mshell_persistence === 'yes',
    canPersist: meta.systemd === 'yes',
    canWatchdog: meta.watchdog === 'yes',
    containerPorts,
    tools: toolIds.map((id) => tools.get(id)!),
    rawRules,
    zones: [],
    defaultZone: meta.default_zone || '',
    rules,
    errors,
    servicePorts,
    capturedAt: Date.now()
  }
  if (nftJson.trim())
    try {
      const objects = JSON.parse(nftJson).nftables
      if (!Array.isArray(objects)) throw new Error()
      overview.nftHasRules = objects.some((item: any) => item.rule || item.chain)
      overview.nativeNftInput = objects.some((item: any) => {
        const chain = item.chain
        if (chain?.hook !== 'input') return false
        if (chain.table === 'firewalld' && tools.get('firewalld')?.active) return false
        return !(
          overview.iptablesBackend === 'nf_tables' &&
          ['ip', 'ip6'].includes(chain.family) &&
          chain.table === 'filter' &&
          chain.name === 'INPUT'
        )
      })
    } catch {
      errors.push('nftables：无法解析内核规则，不能确定当前防护状态')
    }

  const zones = new Map<string, FirewallZone>(),
    merged = new Map<string, FirewallRule>()
  for (const scope of ['runtime', 'permanent'] as const) {
    let zone = ''
    for (const line of dumps[scope]) {
      const header = /^([\w-]+)(?:\s+\(active\))?$/.exec(line)
      if (header) {
        zone = header[1]
        if (!zones.has(zone) || scope === 'runtime')
          zones.set(zone, {
            name: zone,
            interfaces: [],
            sources: [],
            target: '',
            active: line.includes('(active)')
          })
        continue
      }
      if (!zone) continue
      const text = line.trim(),
        z = zones.get(zone)!
      const field = /^(interfaces|sources|target):\s*(.*)$/.exec(text)
      if (field && (scope === 'runtime' || !dumps.runtime.length)) {
        if (field[1] === 'target') z.target = field[2]
        else z[field[1] as 'interfaces' | 'sources'] = field[2].split(/\s+/).filter(Boolean)
      }
      const ports = /^ports:\s*(.*)$/.exec(text),
        services = /^services:\s*(.*)$/.exec(text)
      const definitions = ports
        ? ports[1].split(/\s+/).filter(Boolean)
        : services
          ? services[1].split(/\s+/).filter(Boolean)
          : /^rule\s/.test(text)
            ? [text]
            : []
      for (const definition of definitions) {
        const kind = ports ? 'port' : services ? 'service' : 'rich'
        const key = JSON.stringify(['firewalld', zone, kind, definition])
        const rule = merged.get(key) || {
          key,
          tool: 'firewalld' as const,
          raw: definition,
          action: 'allow' as const,
          actionLabel: '允许',
          summary: definition,
          zone,
          kind,
          definition,
          deletable: true,
          persistent: false,
          runtime: false
        }
        if (scope === 'runtime') rule.runtime = true
        else rule.persistent = true
        if (kind === 'port') {
          const [port, protocol] = definition.split('/')
          Object.assign(rule, { port, protocol })
        }
        if (kind === 'service') Object.assign(rule, { service: definition })
        if (kind === 'rich') {
          const action = /\b(accept|reject|drop)\s*(?:limit\s.*)?$/.exec(definition)?.[1]
          const source = /\bsource (?:not )?address="([^"]+)"/.exec(definition)?.[1]
          Object.assign(rule, {
            port: /\bport port="([^"]+)"/.exec(definition)?.[1],
            protocol: /\bprotocol="([^"]+)"/.exec(definition)?.[1],
            source: source && definition.includes('source not ') ? 'NOT ' + source : source,
            service: /\bservice name="([^"]+)"/.exec(definition)?.[1],
            action:
              action === 'accept'
                ? 'allow'
                : action === 'drop'
                  ? 'deny'
                  : action === 'reject'
                    ? 'reject'
                    : 'unknown',
            actionLabel:
              action === 'accept'
                ? '允许'
                : action === 'drop'
                  ? '拒绝'
                  : action === 'reject'
                    ? '拦截'
                    : '复杂规则'
          })
        }
        merged.set(key, rule)
      }
    }
  }
  overview.zones = [...zones.values()]
  rules.push(...merged.values())
  const sourceZones = overview.zones.filter((z) =>
    z.sources.some(
      (source) => isValidIpOrCidr(source) && sourceContains(source, overview.sshClientIp)
    )
  )
  if (overview.zones.some((z) => z.sources.some((source) => !isValidIpOrCidr(source))))
    overview.zoneError = '存在 ipset 或非 IP 来源绑定，无法自动确定 SSH zone'
  else if (sourceZones.length === 1) overview.sshZone = sourceZones[0].name
  else if (sourceZones.length > 1) overview.zoneError = '多个来源 zone 匹配当前 SSH，需先核对绑定'
  else if (overview.sshInterface) {
    const bound = overview.zones.filter((z) => z.interfaces.includes(overview.sshInterface))
    if (bound.length === 1) overview.sshZone = bound[0].name
    else if (!bound.length) overview.sshZone = overview.defaultZone
    else overview.zoneError = '多个 zone 绑定 SSH 网卡'
  } else if (overview.zones.length) overview.zoneError = '无法确定 SSH 网卡，不能自动启用 Firewalld'
  for (const raw of rawRules.ufw) {
    const match = /^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT)(?:\s+(IN|OUT|FWD))?\s+(.+)$/.exec(
      raw.trim()
    )
    if (!match || match[4] === 'OUT' || match[4] === 'FWD') continue
    const family = raw.includes('(v6)') ? 'IPv6' : 'IPv4',
      target = match[2].replace(/\s*\(v6\)/g, ''),
      source = match[5]
        .replace(/\s*\(v6\)/g, '')
        .split(/\s+#/)[0]
        .trim()
    const [port, protocol] = target.split('/'),
      action = match[3].toLowerCase() as FirewallRule['action']
    const simple =
      /^\d+(?:[:,\-]\d+)*$/.test(port) &&
      (!protocol || ['tcp', 'udp'].includes(protocol)) &&
      (source === 'Anywhere' || isValidIpOrCidr(source))
    const normalizedSource =
      source === 'Anywhere' ? '' : isValidIpOrCidr(source) ? normalizeSource(source) : source
    const rule: FirewallRule = {
      key: '',
      tool: 'ufw',
      raw: raw.replace(/^\[\s*\d+\]\s*/, ''),
      action,
      actionLabel: action === 'allow' ? '允许' : '拒绝',
      summary: target,
      port,
      protocol,
      source: normalizedSource,
      family,
      index: Number(match[1]),
      deletable: simple,
      persistent: true,
      runtime: tools.get('ufw')!.active
    }
    if (simple)
      rule.deleteArgs = [
        action === 'allow' ? 'allow' : action === 'deny' ? 'deny' : 'reject',
        'from',
        source === 'Anywhere' ? (family === 'IPv6' ? '::/0' : '0.0.0.0/0') : source,
        'to',
        'any',
        'port',
        port.replace('-', ':'),
        ...(protocol ? ['proto', protocol] : [])
      ]
    rule.key = ruleKey(rule)
    rules.push(rule)
  }
  const configs = new Map<string, FirewallRule>()
  for (const scope of ['persistent', 'runtime'] as const)
    for (const entry of config[scope]) {
      const [family, protocol, port, source, ...extra] = entry.split('|')
      if (!entry || entry.startsWith('#')) continue
      try {
        if (extra.length || !['4', '6'].includes(family) || !['tcp', 'udp'].includes(protocol))
          throw new Error()
        const normalizedPort = normalizePorts(port).join(','),
          normalizedSource =
            source === '*' || addressValue(source).prefix === 0 ? '' : normalizeSource(source)
        const key = JSON.stringify(['iptables', family, protocol, normalizedPort, normalizedSource])
        const rule: FirewallRule = configs.get(key) || {
          key,
          tool: 'iptables',
          raw: entry,
          action: 'allow',
          actionLabel: '允许',
          summary: normalizedPort,
          port: normalizedPort,
          protocol,
          source: normalizedSource,
          family: family === '6' ? 'IPv6' : 'IPv4',
          managed: true,
          chain: 'MSHELL-INPUT',
          deletable: true,
          persistent: false,
          runtime: false,
          configEntries: [],
          runtimeEntries: []
        }
        if (scope === 'persistent') {
          rule.configEntries!.push(entry)
          rule.persistent = true
        } else rule.runtimeEntries!.push(entry)
        configs.set(key, rule)
      } catch {
        errors.push('iptables：MShell 规则文件含无效记录，已禁止修改')
      }
    }
  rules.push(...configs.values())
  for (const raw of rawRules.iptables) {
    const [family, ...rest] = raw.split('|'),
      spec = rest.join('|')
    if (spec.startsWith('-A MSHELL-INPUT ')) {
      try {
        const tokens = spec.split(/\s+/),
          fields: Record<string, string> = {}
        for (let i = 0; i < tokens.length; i += 2) {
          if (!['-A', '-s', '-p', '-m', '--dport', '-j'].includes(tokens[i]) || !tokens[i + 1])
            throw new Error()
          fields[tokens[i]] = tokens[i + 1]
        }
        if (fields['-j'] !== 'ACCEPT' || !['tcp', 'udp'].includes(fields['-p'])) throw new Error()
        const source =
          fields['-s'] && addressValue(fields['-s']).prefix !== 0
            ? normalizeSource(fields['-s'])
            : ''
        const key = JSON.stringify([
          'iptables',
          family,
          fields['-p'],
          normalizePorts(fields['--dport']).join(','),
          source
        ])
        const rule = configs.get(key)
        if (!rule) throw new Error()
        rule.runtime = rawRules.iptables.some(
          (line) => line === family + '|-A INPUT -j MSHELL-INPUT'
        )
      } catch {
        errors.push('iptables：专用链包含未登记或复杂规则，已禁止自动覆盖')
      }
      continue
    }
    if (spec.startsWith('-A INPUT ') && spec.includes('MSHELL-INPUT')) {
      if (spec !== '-A INPUT -j MSHELL-INPUT')
        errors.push('iptables：专用链入口已被外部修改，不能自动重写')
      continue
    }
    if (!spec.startsWith('-A INPUT ')) continue
    const port = /--dport\s+(\S+)/.exec(spec)?.[1],
      source = /-s\s+(\S+)/.exec(spec)?.[1],
      protocol = /-p\s+(\S+)/.exec(spec)?.[1]
    const action = spec.includes('-j ACCEPT')
      ? 'allow'
      : spec.includes('-j DROP')
        ? 'deny'
        : spec.includes('-j REJECT')
          ? 'reject'
          : 'unknown'
    rules.push({
      key: JSON.stringify(['iptables-system', family, spec]),
      tool: 'iptables',
      raw: spec,
      summary: port || spec,
      port,
      source,
      protocol,
      family: family === '6' ? 'IPv6' : 'IPv4',
      action,
      actionLabel: action === 'allow' ? '允许' : action === 'unknown' ? '系统规则' : '拒绝',
      deletable: false,
      managed: false
    })
  }
  for (const rule of rules) {
    rule.protectionReason = sshProtectionReason(rule, overview)
    if (rule.protectionReason) rule.deletable = false
  }
  return overview
}
export function sshProtectionReason(
  rule: FirewallRule,
  overview: FirewallOverview
): string | undefined {
  if (rule.action === 'deny' || rule.action === 'reject') return
  if (!overview.sshClientIp || !overview.sshServerPort)
    return '无法确认当前 SSH 来源与端口，已禁止删除允许规则'
  if (rule.tool === 'firewalld' && rule.zone !== overview.sshZone) {
    if (overview.sshZone) return
  }
  if (rule.protocol && rule.protocol !== 'tcp' && rule.protocol !== 'all') return
  if (rule.family && (rule.family === 'IPv6') !== overview.sshClientIp.includes(':')) return
  if (rule.source && !sourceContains(rule.source, overview.sshClientIp)) return
  if (rule.service) {
    const ports =
      overview.servicePorts['runtime:' + rule.service] ||
      overview.servicePorts['permanent:' + rule.service]
    if (
      ports &&
      ports !== 'unknown' &&
      !ports.split(/\s+/).some((p) => {
        const [port, proto] = p.split('/')
        return proto === 'tcp' && portContains(port, overview.sshServerPort!)
      })
    )
      return
  } else if (rule.port && !portContains(rule.port, overview.sshServerPort)) return
  if (rule.tool === 'firewalld' && !overview.sshZone)
    return '无法确认 SSH zone，已禁止删除可能影响 SSH 的规则'
  return '该规则可能放行当前 SSH 连接，已保护，不能在此删除'
}
export function firewallConflict(overview: FirewallOverview) {
  const high = overview.tools.filter((t) => t.active && ['ufw', 'firewalld'].includes(t.id))
  return high.length > 1 || (high.length > 0 && overview.nativeNftInput)
}
export function selectPrimaryFirewall(overview: FirewallOverview): FirewallTool | undefined {
  const get = (id: FirewallToolId) => overview.tools.find((t) => t.id === id)
  for (const id of ['ufw', 'firewalld'] as const) if (get(id)?.active) return get(id)
  if (overview.nativeNftInput) return get('nftables')
  if (get('iptables')?.installed) return get('iptables')
  return get(recommendedFirewall(overview))?.installed
    ? get(recommendedFirewall(overview))
    : overview.tools.find((t) => t.installed)
}
export const displayFirewallLabel = (tool: FirewallTool | undefined, overview: FirewallOverview) =>
  tool?.id === 'iptables' && overview.iptablesBackend === 'nf_tables'
    ? 'iptables（nftables 后端）'
    : tool?.label || '未检测到'
export const normalizeFirewallRules = (overview: FirewallOverview | null) => overview?.rules || []
export const recommendedFirewall = (overview: FirewallOverview): 'ufw' | 'firewalld' =>
  /centos|rhel|rocky|almalinux|fedora|opensuse|sles/.test(overview.osId) ? 'firewalld' : 'ufw'
export const shouldOfferFirewallInstall = (overview: FirewallOverview) =>
  !overview.tools.some((t) => t.installed)
