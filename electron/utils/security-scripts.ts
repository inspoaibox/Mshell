import type {
  AuthEvent,
  FailedSource,
  LoginRecord,
  SecurityConnection,
  SecurityDetails,
  SecuritySession,
  SecuritySummary
} from '../../src/types/security'

const MARK = '__MSHELL_SEC_'
export const SEC_META = `${MARK}META__`
export const SEC_WHO = `${MARK}WHO__`
export const SEC_CONN = `${MARK}CONN__`
export const SEC_FAILED = `${MARK}FAILED__`
export const SEC_LAST = `${MARK}LAST__`
export const SEC_AUTH = `${MARK}AUTH__`
export const SEC_END = `${MARK}END__`
const SECTIONS = [SEC_META, SEC_WHO, SEC_CONN, SEC_FAILED, SEC_LAST, SEC_AUTH, SEC_END]

/** 远程访问类进程：SSH、远程桌面、VNC、telnet 及常见远控软件 */
const REMOTE_PROCESS = 'sshd|xrdp|vnc|telnetd|teamviewer|rustdesk|anydesk|dropbear'
const AUTH_PATTERN =
  'Accepted |Failed |Invalid user|authentication failure|Disconnected from (invalid |authenticating )?user|Connection closed by (invalid |authenticating )?user'

const wrap = (script: string) => `sh <<'MSHELL_SECURITY_SCRIPT'\n${script}\nMSHELL_SECURITY_SCRIPT`

const prelude = String.raw`
set +e
LC_ALL=C
export LC_ALL
SUDO=""
privileged=no
if [ "$(id -u 2>/dev/null)" = 0 ]; then
  privileged=yes
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  SUDO="sudo -n"
  privileged=yes
fi
journal_ok=no
if command -v journalctl >/dev/null 2>&1; then
  if [ "$privileged" = yes ]; then journal_ok=yes
  else
    case " $(id -nG 2>/dev/null) " in *" adm "*|*" systemd-journal "*|*" wheel "*) journal_ok=yes ;; esac
  fi
fi
sshport="$(printf '%s' "$SSH_CONNECTION" | awk '{print $4}')"
[ -n "$sshport" ] || sshport=22
`

const commonSections = String.raw`
echo '${SEC_META}'
echo "self=$SSH_CONNECTION"
echo "privileged=$privileged"
echo "sshport=$sshport"
echo "hostname=$(hostname 2>/dev/null)"
echo '${SEC_WHO}'
who -u 2>/dev/null || who 2>/dev/null
echo '${SEC_CONN}'
if command -v ss >/dev/null 2>&1; then
  $SUDO ss -H -tnp 2>/dev/null | awk -v p="$sshport" '$1 == "ESTAB" && ($4 ~ (":" p "$") || $0 ~ /${REMOTE_PROCESS}/) { print "ss", $0 }'
elif command -v netstat >/dev/null 2>&1; then
  $SUDO netstat -tnp 2>/dev/null | awk -v p="$sshport" '$6 == "ESTABLISHED" && ($4 ~ (":" p "$") || $7 ~ /${REMOTE_PROCESS}/) { print "netstat", $0 }'
fi
`

const sshJournal = (args: string) =>
  `$SUDO journalctl -t sshd -t sshd-session ${args} --no-pager 2>/dev/null`

/** 每 15 秒执行的轻量采集：在线会话、远程连接、近 1 小时认证失败次数 */
export function buildSecuritySummaryScript(): string {
  return wrap(`${prelude}
${commonSections}
echo '${SEC_FAILED}'
if [ "$journal_ok" = yes ]; then
  ${sshJournal("--since '1 hour ago' -o cat")} | grep -cE 'Failed |Invalid user|authentication failure'
else
  echo '-'
fi
echo '${SEC_END}'
exit 0`)
}

/** 详情：额外读取登录历史和最近 24 小时的 SSH 认证日志 */
export function buildSecurityDetailsScript(): string {
  return wrap(`${prelude}
${commonSections}
echo '${SEC_LAST}'
last -i -F -w -n 100 2>/dev/null || last -i -n 100 2>/dev/null || last -n 100 2>/dev/null
echo '${SEC_AUTH}'
auth=""
source=none
if [ "$journal_ok" = yes ]; then
  auth="$(${sshJournal("--since '24 hours ago' -o short-iso")} | grep -E '${AUTH_PATTERN}' | tail -n 500)"
  [ -n "$auth" ] && source=journal
fi
if [ -z "$auth" ]; then
  for f in /var/log/auth.log /var/log/secure; do
    [ -f "$f" ] || continue
    if [ -r "$f" ]; then lines="$(tail -n 20000 "$f" 2>/dev/null)"
    elif [ -n "$SUDO" ]; then lines="$($SUDO tail -n 20000 "$f" 2>/dev/null)"
    else lines=""; source="unreadable:$f"; fi
    auth="$(printf '%s\\n' "$lines" | grep -E 'sshd' | grep -E '${AUTH_PATTERN}' | tail -n 500)"
    if [ -n "$auth" ]; then source="$f"; break; fi
  done
fi
echo "source=$source"
[ -n "$auth" ] && printf '%s\\n' "$auth"
echo '${SEC_END}'
exit 0`)
}

const splitSections = (stdout: string): Record<string, string[]> => {
  const result: Record<string, string[]> = {}
  let current: string | undefined
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (SECTIONS.includes(line)) {
      current = line
      result[current] = []
      continue
    }
    if (current && line) result[current].push(line)
  }
  return result
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^[0-9a-f:]+:[0-9a-f:.]*$/i

export const normalizeIp = (value: string): string => {
  const ip = value.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  return /^::ffff:(\d{1,3}\.){3}\d{1,3}$/i.test(ip) ? ip.slice(7) : ip
}

export const looksLikeIp = (value: string): boolean => {
  const ip = normalizeIp(value)
  return IPV4.test(ip) || (IPV6.test(ip) && ip.includes(':'))
}

const splitHostPort = (value: string): { host: string; port: number } | undefined => {
  const index = value.lastIndexOf(':')
  if (index < 0) return undefined
  const port = Number(value.slice(index + 1))
  if (!Number.isInteger(port)) return undefined
  return { host: normalizeIp(value.slice(0, index)), port }
}

const WHO_LINE =
  /^(\S+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2})(?:\s+(\S+)\s+(\d+))?(?:\s+\((.*)\))?\s*$/

export const parseWho = (lines: string[]): SecuritySession[] =>
  lines.flatMap((line) => {
    const match = line.match(WHO_LINE)
    if (!match) return []
    const host = (match[6] || '').trim()
    const session: SecuritySession = {
      user: match[1],
      tty: match[2],
      loginAt: match[3].replace(/\s+/g, ' '),
      host
    }
    if (match[4]) session.idle = match[4]
    if (match[5]) session.pid = Number(match[5])
    if (host && looksLikeIp(host)) session.ip = normalizeIp(host)
    return [session]
  })

export const parseConnections = (lines: string[]): SecurityConnection[] => {
  const result: SecurityConnection[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const tokens = line.split(/\s+/)
    const kind = tokens.shift()
    // ss -tnp：State Recv-Q Send-Q Local Peer Process；netstat -tnp：Proto Recv-Q Send-Q Local Foreign State PID/Program
    const local = splitHostPort(tokens[3] || '')
    const peer = splitHostPort(tokens[4] || '')
    if (!local || !peer) continue
    let process: string | undefined
    let pid: number | undefined
    if (kind === 'ss') {
      const match = tokens.slice(5).join(' ').match(/\("([^"]*)",pid=(\d+)/)
      if (match) [process, pid] = [match[1], Number(match[2])]
    } else {
      const match = (tokens[6] || '').match(/^(\d+)\/(.*)$/)
      if (match) [pid, process] = [Number(match[1]), match[2]]
    }
    const key = `${peer.host}:${peer.port}-${local.port}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ip: peer.host, port: peer.port, localPort: local.port, process, pid })
  }
  return result
}

const LAST_SKIP = /^(reboot|shutdown|wtmp|btmp|runlevel)\b|^\s*$/
// -F 格式：root pts/0 1.2.3.4 Mon Oct 20 10:00:01 2026 - Mon Oct 20 11:00:00 2026 (00:59)
const LAST_FULL =
  /^(\S+)\s+(\S+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.*)$/
const LAST_SHORT = /^(\S+)\s+(\S+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2})\s+(.*)$/

export const parseLast = (lines: string[]): LoginRecord[] =>
  lines.flatMap((line) => {
    if (LAST_SKIP.test(line)) return []
    const match = line.match(LAST_FULL) || line.match(LAST_SHORT)
    if (!match) return []
    const rest = match[5].trim()
    const duration = rest.match(/\(([^)]+)\)\s*$/)?.[1]
    const end = rest
      .replace(/\([^)]+\)\s*$/, '')
      .replace(/^-\s*/, '')
      .trim()
    return [
      {
        user: match[1],
        tty: match[2],
        ip: normalizeIp(match[3]),
        start: match[4].replace(/\s+/g, ' '),
        end,
        duration,
        active: /still logged in/.test(rest)
      }
    ]
  })

const AUTH_RULES: Array<{ type: AuthEvent['type']; pattern: RegExp; map: (m: RegExpMatchArray) => Partial<AuthEvent> }> = [
  {
    type: 'accepted',
    pattern: /Accepted (\S+) for (\S+) from (\S+) port (\d+)/,
    map: (m) => ({ method: m[1], user: m[2], ip: m[3], port: Number(m[4]) })
  },
  {
    type: 'failed',
    pattern: /Failed (\S+) for (?:invalid user )?(\S+) from (\S+) port (\d+)/,
    map: (m) => ({ method: m[1], user: m[2], ip: m[3], port: Number(m[4]) })
  },
  {
    type: 'invalid',
    pattern: /Invalid user (\S*) from (\S+)(?: port (\d+))?/,
    map: (m) => ({ user: m[1] || undefined, ip: m[2], port: m[3] ? Number(m[3]) : undefined })
  },
  {
    type: 'failed',
    pattern: /authentication failure;.*rhost=(\S+)(?:\s+user=(\S+))?/,
    map: (m) => ({ ip: m[1], user: m[2] })
  },
  {
    type: 'disconnected',
    pattern: /(?:Disconnected from|Connection closed by) (?:invalid |authenticating )?user (\S+) (\S+) port (\d+)/,
    map: (m) => ({ user: m[1], ip: m[2], port: Number(m[3]) })
  }
]

/** 解析 journalctl short-iso 或 syslog 格式的 sshd 日志行 */
export const parseAuthLine = (line: string): AuthEvent | undefined => {
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?)\s+\S+\s+(.*)$/)
  const syslog = iso ? undefined : line.match(/^([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2})\s+\S+\s+(.*)$/)
  const match = iso || syslog
  if (!match) return undefined
  const body = match[2]
  const message = body.replace(/^[^:]*?\[\d+\]:\s*|^[\w.-]+:\s*/, '')
  for (const rule of AUTH_RULES) {
    const found = message.match(rule.pattern)
    if (found) {
      const event: AuthEvent = { time: match[1].replace(/\s+/g, ' '), type: rule.type, message, ...rule.map(found) }
      if (event.ip) event.ip = normalizeIp(event.ip)
      return event
    }
  }
  return { time: match[1], type: 'other', message }
}

export const summarizeFailures = (events: AuthEvent[]): FailedSource[] => {
  const map = new Map<string, FailedSource>()
  for (const event of events) {
    if ((event.type !== 'failed' && event.type !== 'invalid') || !event.ip) continue
    const item = map.get(event.ip) || { ip: event.ip, count: 0, lastTime: '', users: [] }
    item.count++
    item.lastTime = event.time
    if (event.user && !item.users.includes(event.user) && item.users.length < 10) item.users.push(event.user)
    map.set(event.ip, item)
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 50)
}

export function parseSecuritySummary(stdout: string, collectedAt = new Date()): SecuritySummary {
  const sections = splitSections(stdout)
  if (!sections[SEC_META] || !sections[SEC_END]) throw new Error('安全信息采集输出不完整')
  const meta: Record<string, string> = {}
  for (const line of sections[SEC_META]) {
    const index = line.indexOf('=')
    if (index > 0) meta[line.slice(0, index)] = line.slice(index + 1)
  }
  const privileged = meta.privileged === 'yes'
  const selfParts = (meta.self || '').trim().split(/\s+/)
  const failedText = (sections[SEC_FAILED] || [])[0]?.trim()
  const failedLastHour = failedText && /^\d+$/.test(failedText) ? Number(failedText) : null
  const warnings: string[] = []
  const connections = parseConnections(sections[SEC_CONN] || [])
  if (!privileged) {
    warnings.push('当前用户不是 root 且没有免密 sudo，部分连接的进程信息和认证日志可能不可见')
  }
  return {
    collectedAt: collectedAt.toISOString(),
    hostname: meta.hostname || '',
    selfIp: selfParts[0] ? normalizeIp(selfParts[0]) : undefined,
    sshPort: Number(meta.sshport) || 22,
    privileged,
    sessions: parseWho(sections[SEC_WHO] || []),
    connections,
    failedLastHour,
    warnings
  }
}

export function parseSecurityDetails(stdout: string, collectedAt = new Date()): SecurityDetails {
  const summary = parseSecuritySummary(stdout, collectedAt)
  const sections = splitSections(stdout)
  const authLines = sections[SEC_AUTH] || []
  const sourceLine = authLines.find((line) => line.startsWith('source='))
  const authSource = sourceLine?.slice('source='.length) || 'none'
  // 日志按时间正序；失败来源按正序汇总（lastTime 为最近一次），列表展示时倒序
  const chronological = authLines
    .filter((line) => !line.startsWith('source='))
    .map(parseAuthLine)
    .filter((event): event is AuthEvent => !!event)
  const failedSources = summarizeFailures(chronological)
  const authEvents = [...chronological].reverse()
  const warnings = [...summary.warnings]
  if (authSource === 'none') warnings.push('没有读取到 SSH 认证日志（需要 journald 读取权限或 /var/log/auth.log、/var/log/secure）')
  else if (authSource.startsWith('unreadable:')) {
    warnings.push(`没有权限读取 ${authSource.slice('unreadable:'.length)}，需要 root 或免密 sudo`)
  }
  return {
    ...summary,
    warnings,
    logins: parseLast(sections[SEC_LAST] || []),
    authEvents,
    authSource,
    failedSources
  }
}
