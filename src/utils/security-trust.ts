import type { SecurityConnection, SecuritySession, SecuritySummary } from '../types/security'

const STORAGE_KEY = 'mshell-security-trusted-ips'

const ipv4ToNumber = (ip: string): number | undefined => {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return undefined
    value = value * 256 + Number(part)
  }
  return value
}

const normalize = (ip: string) => {
  const trimmed = ip.trim().replace(/^\[|\]$/g, '').toLowerCase()
  return /^::ffff:(\d{1,3}\.){3}\d{1,3}$/.test(trimmed) ? trimmed.slice(7) : trimmed
}

/** 规则：单个 IP（IPv4 / IPv6）或 IPv4 CIDR（如 10.0.0.0/8） */
export const isValidTrustRule = (rule: string): boolean => {
  const value = normalize(rule)
  const [address, bits, extra] = value.split('/')
  if (extra !== undefined) return false
  if (bits !== undefined) {
    return ipv4ToNumber(address) !== undefined && /^\d{1,2}$/.test(bits) && Number(bits) <= 32
  }
  return ipv4ToNumber(address) !== undefined || (/^[0-9a-f:]+$/.test(address) && address.includes(':'))
}

export const ipMatchesRule = (ip: string, rule: string): boolean => {
  const target = normalize(ip)
  const value = normalize(rule)
  if (!value.includes('/')) return target === value
  const [address, bitsText] = value.split('/')
  const base = ipv4ToNumber(address)
  const candidate = ipv4ToNumber(target)
  if (base === undefined || candidate === undefined) return false
  const bits = Number(bitsText)
  if (bits === 0) return true
  const block = 2 ** (32 - bits)
  return Math.floor(base / block) === Math.floor(candidate / block)
}

export const isLoopbackIp = (ip: string): boolean => {
  const value = normalize(ip)
  return /^127\./.test(value) || value === '::1'
}

export const isPrivateIp = (ip: string): boolean => {
  const value = normalize(ip)
  return (
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(value) ||
    /^169\.254\./.test(value) ||
    /^f[cd][0-9a-f]{2}:/.test(value) ||
    /^fe80:/.test(value)
  )
}

export type TrustLevel = 'self' | 'trusted' | 'local' | 'untrusted'

export const trustLevelOf = (ip: string, rules: string[], selfIp?: string): TrustLevel => {
  if (selfIp && normalize(ip) === normalize(selfIp)) return 'self'
  if (isLoopbackIp(ip)) return 'local'
  if (rules.some((rule) => ipMatchesRule(ip, rule))) return 'trusted'
  return 'untrusted'
}

export const trustLabel: Record<TrustLevel, string> = {
  self: '本机连接',
  trusted: '已信任',
  local: '本机回环',
  untrusted: '非信任'
}

export interface SourceIp {
  ip: string
  connections: number
  sessions: number
  users: string[]
  level: TrustLevel
}

/** 汇总当前连接和登录会话的来源 IP */
export const collectSourceIps = (summary: SecuritySummary, rules: string[]): SourceIp[] => {
  const map = new Map<string, SourceIp>()
  const get = (ip: string) => {
    const key = normalize(ip)
    let item = map.get(key)
    if (!item) {
      item = { ip: key, connections: 0, sessions: 0, users: [], level: trustLevelOf(key, rules, summary.selfIp) }
      map.set(key, item)
    }
    return item
  }
  summary.connections.forEach((connection: SecurityConnection) => {
    get(connection.ip).connections++
  })
  summary.sessions.forEach((session: SecuritySession) => {
    if (!session.ip) return
    const item = get(session.ip)
    item.sessions++
    if (!item.users.includes(session.user)) item.users.push(session.user)
  })
  const order: Record<TrustLevel, number> = { untrusted: 0, trusted: 1, local: 2, self: 3 }
  return [...map.values()].sort(
    (a, b) => order[a.level] - order[b.level] || b.connections - a.connections || a.ip.localeCompare(b.ip)
  )
}

type TrustStore = Record<string, string[]>

const readStore = (): TrustStore => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const loadTrustRules = (hostKey: string): string[] => {
  const rules = readStore()[hostKey]
  return Array.isArray(rules) ? rules.filter((rule) => typeof rule === 'string' && isValidTrustRule(rule)) : []
}

export const saveTrustRules = (hostKey: string, rules: string[]): void => {
  const store = readStore()
  const unique = [...new Set(rules.map(normalize))].filter(isValidTrustRule)
  if (unique.length) store[hostKey] = unique
  else delete store[hostKey]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}
