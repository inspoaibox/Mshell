import type {
  PortCloseMode,
  PortEntry,
  PortExposure,
  PortOverview,
  PortProcess,
  PortProtocol
} from '../../src/types/ports'
import { isStoppableUnit } from '../../src/utils/port-utils'

export { isDockerProxy, isStoppableUnit } from '../../src/utils/port-utils'

const MARK = '__MSHELL_PORTS_'
export const SECTION_META = `${MARK}META__`
export const SECTION_LISTEN = `${MARK}LISTEN__`
export const SECTION_ESTABLISHED = `${MARK}ESTABLISHED__`
export const SECTION_PROCESSES = `${MARK}PROCESSES__`
export const SECTION_UNITS = `${MARK}UNITS__`
export const SECTION_DOCKER = `${MARK}DOCKER__`
export const SECTION_END = `${MARK}END__`
export const CLOSE_RESULT = `${MARK}CLOSE_RESULT__`

const SECTIONS = [
  SECTION_META,
  SECTION_LISTEN,
  SECTION_ESTABLISHED,
  SECTION_PROCESSES,
  SECTION_UNITS,
  SECTION_DOCKER,
  SECTION_END
]

const wrap = (script: string) => `sh <<'MSHELL_PORTS_SCRIPT'\n${script}\nMSHELL_PORTS_SCRIPT`

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
`

/**
 * 采集监听端口、进程、连接数和 Docker 端口映射。优先使用 ss，不存在时退回 netstat。
 * 非 root 时尝试免密 sudo，否则其它用户的进程信息不可见。
 */
export function buildPortOverviewScript(): string {
  return wrap(`${prelude}
tool=""
if command -v ss >/dev/null 2>&1; then tool=ss; elif command -v netstat >/dev/null 2>&1; then tool=netstat; fi
echo '${SECTION_META}'
echo "privileged=$privileged"
echo "tool=$tool"
echo "ssh=$SSH_CONNECTION"
echo "hostname=$(hostname 2>/dev/null)"
echo '${SECTION_LISTEN}'
listen=""
if [ "$tool" = ss ]; then
  listen="$($SUDO ss -H -tulnp 2>&1)"
elif [ "$tool" = netstat ]; then
  listen="$($SUDO netstat -tulnp 2>&1)"
fi
printf '%s\\n' "$listen"
echo '${SECTION_ESTABLISHED}'
if [ "$tool" = ss ]; then
  ss -H -tan 2>/dev/null | awk '$1 == "ESTAB" { print $4, $5 }'
elif [ "$tool" = netstat ]; then
  netstat -tan 2>/dev/null | awk '$6 == "ESTABLISHED" { print $4, $5 }'
fi
pids="$(printf '%s\\n' "$listen" | grep -oE 'pid=[0-9]+|[[:space:]][0-9]+/' | grep -oE '[0-9]+' | sort -un | tr '\\n' ',' | sed 's/,$//')"
echo '${SECTION_PROCESSES}'
if [ -n "$pids" ]; then
  ps -ww -o pid=,ppid=,user:32=,etime=,pcpu=,pmem=,rss=,args= -p "$pids" 2>/dev/null ||
    ps -ww -o pid=,ppid=,user=,etime=,pcpu=,pmem=,rss=,args= -p "$pids" 2>/dev/null
fi
echo '${SECTION_UNITS}'
for p in $(printf '%s' "$pids" | tr ',' ' '); do
  unit="$(grep -oE '[^/]+\\.service' "/proc/$p/cgroup" 2>/dev/null | tail -n 1)"
  [ -n "$unit" ] && echo "$p $unit"
done
echo '${SECTION_DOCKER}'
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null ||
    { [ -n "$SUDO" ] && $SUDO docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null; }
fi
echo '${SECTION_END}'
`)
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`


/**
 * 结束进程或停止 systemd 服务。普通权限失败时尝试免密 sudo，随后最多等待 5 秒让进程退出。
 */
export function buildPortCloseScript(mode: PortCloseMode, pids: number[], unit?: string): string {
  if (!pids.length || pids.some((pid) => !Number.isInteger(pid) || pid <= 1)) {
    throw new Error('进程 PID 无效')
  }
  const pidList = pids.join(' ')
  let action: string
  if (mode === 'service') {
    if (!isStoppableUnit(unit)) throw new Error('服务名称无效')
    const name = quote(unit)
    action = `if systemctl --no-ask-password stop ${name} 2>/tmp/.mshell-port-err.$$ ||
  { [ -n "$SUDO" ] && $SUDO systemctl stop ${name} 2>/tmp/.mshell-port-err.$$; }; then
  echo "已停止服务 ${unit.replace(/[^A-Za-z0-9@._:-]/g, '')}"
else
  status=1
  cat /tmp/.mshell-port-err.$$ 2>/dev/null
fi
rm -f /tmp/.mshell-port-err.$$`
  } else {
    const signal = mode === 'kill' ? 'KILL' : 'TERM'
    action = `for p in ${pidList}; do
  if err="$(kill -${signal} "$p" 2>&1)"; then
    echo "已向进程 $p 发送 SIG${signal}"
  elif [ -n "$SUDO" ] && err="$($SUDO kill -${signal} "$p" 2>&1)"; then
    echo "已向进程 $p 发送 SIG${signal}（sudo）"
  else
    status=1
    echo "进程 $p：$err"
  fi
done`
  }

  return wrap(`${prelude}
status=0
${action}
i=0
while [ "$i" -lt 10 ]; do
  alive=""
  for p in ${pidList}; do [ -d "/proc/$p" ] && alive="$alive $p"; done
  [ -z "$alive" ] && break
  sleep 0.5 2>/dev/null || sleep 1
  i=$((i + 1))
done
echo '${CLOSE_RESULT}' "status=$status" "alive=$alive"
`)
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

/** 拆分 `addr:port`，支持 [::]:22、*:80、127.0.0.53%lo:53、:::22（netstat） */
export const splitHostPort = (value: string): { host: string; port: number } | undefined => {
  const index = value.lastIndexOf(':')
  if (index < 0) return undefined
  const port = Number(value.slice(index + 1))
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined
  let host = value.slice(0, index)
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  host = host.replace(/%[^%]*$/, '')
  if (host === '' || host === '::' || host === '*') host = host === '' ? '::' : host
  return { host, port }
}

const isWildcard = (host: string) => host === '0.0.0.0' || host === '::' || host === '*'
const isLoopback = (host: string) =>
  /^127\./.test(host) || host === '::1' || host === 'localhost' || /^::ffff:127\./i.test(host)

export const exposureOf = (addresses: string[]): PortExposure => {
  if (addresses.some(isWildcard)) return 'all'
  if (addresses.length && addresses.every(isLoopback)) return 'local'
  return 'specific'
}

interface ListenSocket {
  protocol: PortProtocol
  host: string
  port: number
  owners: Array<{ pid: number; name: string }>
}

const parseSsListen = (line: string): ListenSocket | undefined => {
  const tokens = line.split(/\s+/)
  if (tokens.length < 5) return undefined
  const netid = tokens[0].toLowerCase()
  if (netid !== 'tcp' && netid !== 'udp') return undefined
  // ss -H -tulnp：Netid State Recv-Q Send-Q Local Peer [Process]
  const local = splitHostPort(tokens[4])
  if (!local) return undefined
  const processText = tokens.slice(6).join(' ')
  const owners: ListenSocket['owners'] = []
  for (const match of processText.matchAll(/\("((?:[^"\\]|\\.)*)",pid=(\d+)/g)) {
    owners.push({ name: match[1], pid: Number(match[2]) })
  }
  return { protocol: netid, host: local.host, port: local.port, owners }
}

const parseNetstatListen = (line: string): ListenSocket | undefined => {
  const tokens = line.split(/\s+/)
  const proto = tokens[0]?.toLowerCase() || ''
  const protocol: PortProtocol | undefined = proto.startsWith('tcp')
    ? 'tcp'
    : proto.startsWith('udp')
      ? 'udp'
      : undefined
  if (!protocol || tokens.length < 6) return undefined
  if (protocol === 'tcp' && tokens[5] !== 'LISTEN') return undefined
  const local = splitHostPort(tokens[3])
  if (!local) return undefined
  const program = tokens[tokens.length - 1]
  const match = program.match(/^(\d+)\/(.*)$/)
  return {
    protocol,
    host: local.host,
    port: local.port,
    owners: match ? [{ pid: Number(match[1]), name: match[2] }] : []
  }
}

const parseProcesses = (lines: string[]): Map<number, PortProcess> => {
  const map = new Map<number, PortProcess>()
  for (const line of lines) {
    const match = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    const command = match[8].trim()
    map.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      user: match[3],
      elapsed: match[4],
      cpu: match[5],
      memory: match[6],
      rssKb: Number(match[7]),
      command,
      name: command.split(/\s+/)[0]?.split('/').pop() || ''
    })
  }
  return map
}

/** 解析 docker ps 的 Ports 列，返回 “协议/宿主端口” → 容器名 */
export const parseDockerPorts = (lines: string[]): Map<string, string[]> => {
  const map = new Map<string, string[]>()
  for (const line of lines) {
    const separator = line.indexOf('|')
    if (separator < 0) continue
    const name = line.slice(0, separator).trim()
    const ports = line.slice(separator + 1)
    for (const match of ports.matchAll(/:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/(tcp|udp)/g)) {
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : start
      for (let port = start; port <= end && port - start < 1024; port++) {
        const key = `${match[3]}/${port}`
        const names = map.get(key) || []
        if (!names.includes(name)) names.push(name)
        map.set(key, names)
      }
    }
  }
  return map
}

export function parsePortOverview(stdout: string, collectedAt = new Date()): PortOverview {
  const sections = splitSections(stdout)
  if (!sections[SECTION_META] || !sections[SECTION_END]) {
    throw new Error('端口检测输出不完整，请重新刷新')
  }

  const meta: Record<string, string> = {}
  for (const line of sections[SECTION_META]) {
    const index = line.indexOf('=')
    if (index > 0) meta[line.slice(0, index)] = line.slice(index + 1)
  }
  const tool = meta.tool === 'ss' || meta.tool === 'netstat' ? meta.tool : ''
  const privileged = meta.privileged === 'yes'
  const sshServerPort = Number((meta.ssh || '').trim().split(/\s+/)[3]) || undefined
  const warnings: string[] = []
  if (!tool) warnings.push('服务器上没有 ss 或 netstat 命令，无法读取端口信息')

  const sockets: ListenSocket[] = []
  for (const line of sections[SECTION_LISTEN] || []) {
    const socket = tool === 'netstat' ? parseNetstatListen(line) : parseSsListen(line)
    if (socket) sockets.push(socket)
    else if (!/^(Active|Proto)\b/.test(line)) warnings.push(line)
  }

  const processes = parseProcesses(sections[SECTION_PROCESSES] || [])
  for (const line of sections[SECTION_UNITS] || []) {
    const [pid, unit] = line.split(/\s+/)
    const process = processes.get(Number(pid))
    if (process && unit) process.unit = unit
  }
  const docker = parseDockerPorts(sections[SECTION_DOCKER] || [])

  const connections = new Map<number, { count: number; clients: Set<string> }>()
  for (const line of sections[SECTION_ESTABLISHED] || []) {
    const [localText, peerText] = line.split(/\s+/)
    const local = splitHostPort(localText || '')
    const peer = splitHostPort(peerText || '')
    if (!local) continue
    const stats = connections.get(local.port) || { count: 0, clients: new Set<string>() }
    stats.count++
    if (peer) stats.clients.add(peer.host)
    connections.set(local.port, stats)
  }

  const entries = new Map<string, PortEntry>()
  let hiddenOwners = false
  for (const socket of sockets) {
    const key = `${socket.protocol}/${socket.port}`
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        key,
        protocol: socket.protocol,
        port: socket.port,
        addresses: [],
        exposure: 'specific',
        processes: [],
        rootPids: [],
        connections: 0,
        remoteClients: 0,
        containers: docker.get(key) || [],
        isSshPort: socket.protocol === 'tcp' && socket.port === sshServerPort,
        processHidden: false
      }
      entries.set(key, entry)
    }
    if (!entry.addresses.includes(socket.host)) entry.addresses.push(socket.host)
    if (!socket.owners.length) {
      entry.processHidden = true
      hiddenOwners = true
    }
    for (const owner of socket.owners) {
      if (entry.processes.some((item) => item.pid === owner.pid)) continue
      const detail = processes.get(owner.pid)
      entry.processes.push(
        detail
          ? { ...detail, name: owner.name || detail.name }
          : { pid: owner.pid, name: owner.name, user: '', elapsed: '', cpu: '', memory: '', command: '' }
      )
    }
  }

  for (const entry of entries.values()) {
    entry.exposure = exposureOf(entry.addresses)
    if (entry.processes.length) entry.processHidden = false
    const pids = new Set(entry.processes.map((item) => item.pid))
    entry.rootPids = entry.processes
      .filter((item) => !item.ppid || !pids.has(item.ppid))
      .map((item) => item.pid)
      .sort((a, b) => a - b)
    entry.processes.sort((a, b) => a.pid - b.pid)
    if (entry.protocol === 'tcp') {
      const stats = connections.get(entry.port)
      entry.connections = stats?.count || 0
      entry.remoteClients = stats?.clients.size || 0
    }
  }

  if (hiddenOwners && !privileged) {
    warnings.unshift('当前用户不是 root 且没有免密 sudo，其它用户进程的占用信息不可见，也无法关闭这些端口')
  }

  return {
    hostname: meta.hostname || '',
    tool,
    privileged,
    sshServerPort,
    ports: [...entries.values()].sort(
      (a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol)
    ),
    warnings,
    collectedAt: collectedAt.toISOString()
  }
}

export function parseCloseResult(stdout: string): { status: number; alive: number[]; log: string } {
  const lines = stdout.split(/\r?\n/)
  const resultLine = lines.find((line) => line.startsWith(CLOSE_RESULT))
  const log = lines
    .filter((line) => line && !line.startsWith(CLOSE_RESULT))
    .join('\n')
    .trim()
  if (!resultLine) return { status: 1, alive: [], log: log || '未收到操作结果' }
  const status = Number(resultLine.match(/status=(\d+)/)?.[1] ?? 1)
  const alive = (resultLine.match(/alive=(.*)$/)?.[1] || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
  return { status, alive, log }
}
