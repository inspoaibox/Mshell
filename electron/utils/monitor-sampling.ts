import type { ServerMetrics, DiskMetrics, DockerContainerInfo } from '../../src/types/monitor'

// One awk process reads procfs directly. getline tolerates PIDs exiting during a sample.
// Never read command-line arguments, environment variables or private process memory.
export function buildCoreMonitorCommand(identity: boolean, processes: boolean): string {
  return (
    `LC_ALL=C awk -v identity=${identity ? 1 : 0} -v processes=${processes ? 1 : 0} '` +
    String.raw`
function text(label, path, value) {
  if ((getline value < path) > 0) { gsub(/[|\r\n]/, " ", value); print label "|" value }
  close(path)
}
BEGIN {
  print "__MSHELL_MONITOR_V1__"
  while ((getline line < "/proc/stat") > 0) {
    split(line, f, / +/)
    if (f[1] == "cpu") {
      total = 0
      for (n = 2; n <= 9; n++) total += f[n]
      printf "CPU|%.0f|%.0f\n", total, f[5] + f[6]
    } else if (f[1] ~ /^cpu[0-9]+$/) cores++
  }
  close("/proc/stat")
  print "CORES|" cores
  if ((getline line < "/proc/uptime") > 0) { split(line, f, / +/); print "UPTIME|" f[1] }
  close("/proc/uptime")
  if ((getline line < "/proc/loadavg") > 0) { split(line, f, / +/); print "LOAD|" f[1] "|" f[2] "|" f[3] }
  close("/proc/loadavg")
  while ((getline line < "/proc/meminfo") > 0) {
    split(line, f, / +/); sub(/:$/, "", f[1]); mem[f[1]] = f[2] * 1024
  }
  close("/proc/meminfo")
  available = ("MemAvailable" in mem) ? mem["MemAvailable"] : mem["MemFree"] + mem["Buffers"] + mem["Cached"] + mem["SReclaimable"] - mem["Shmem"]
  printf "MEM|%.0f|%.0f|%.0f\n", mem["MemTotal"], mem["MemFree"], available
  while ((getline line < "/proc/net/dev") > 0) {
    if (index(line, ":") == 0) continue
    split(line, pair, ":"); name = pair[1]; gsub(/ /, "", name)
    if (name == "lo") continue
    sub(/^ +/, "", pair[2]); split(pair[2], f, / +/)
    printf "NET|%s|%.0f|%.0f|%.0f|%.0f\n", name, f[1], f[9], f[2], f[10]
  }
  close("/proc/net/dev")
  if (identity) {
    text("HOST", "/proc/sys/kernel/hostname")
    text("PLATFORM", "/proc/sys/kernel/ostype")
    text("KERNEL", "/proc/sys/kernel/osrelease")
  }
  if (processes) for (i = 1; i < ARGC; i++) {
    path = ARGV[i]
    if ((getline line < path) <= 0) { close(path); continue }
    close(path)
    pid = substr(line, 1, index(line, " ") - 1)
    rest = line; sub(/^.*\) /, "", rest)
    name = substr(line, 1, length(line) - length(rest) - 2)
    name = substr(name, index(name, "(") + 1)
    gsub(/[|\r\n\t]/, " ", name)
    split(rest, f, / +/)
    ticks = f[12] + f[13]; started = f[20]; state = f[1]
    status = path; sub(/stat$/, "status", status)
    uid = "?"; rss = 0
    while ((getline line < status) > 0) {
      split(line, s, /[ \t]+/)
      if (s[1] == "Uid:") uid = s[2]
      if (s[1] == "VmRSS:") rss = s[2] * 1024
    }
    close(status)
    printf "PROC|%s|%s|%.0f|%.0f|%s|%s|%s\n", pid, started, ticks, rss, uid, state, name
  }
  print "__END_MSHELL_MONITOR__"
  exit
}' /proc/[0-9]*/stat`
  )
}

export const DISK_MONITOR_COMMAND = String.raw`LC_ALL=C df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay | awk 'NR>1 { mount=$6; for(i=7;i<=NF;i++) mount=mount " " $i; print $1 "|" mount "|" $2 "|" $3 "|" $4 }'`

export const DOCKER_MONITOR_COMMAND = String.raw`if ! command -v docker >/dev/null 2>&1; then printf '__NO_DOCKER__\n'; exit 0; fi
printf '__DOCKER_PS__\n'
docker ps -a --format '{{.Names}}|{{.Status}}' || exit 1
printf '__DOCKER_STATS__\n'
docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}|{{.NetIO}}' || exit 1
printf '__END_DOCKER__\n'`

interface ProcessSample {
  pid: number
  started: string
  ticks: number
  rss: number
  user: string
  state: string
  command: string
}
interface NetworkSample {
  bytesIn: number
  bytesOut: number
  packetsIn: number
  packetsOut: number
}
export interface CoreSample {
  totalTicks: number
  idleTicks: number
  uptime: number
  cores: number
  loadAverage: number[]
  memory: ServerMetrics['memory']
  network: Map<string, NetworkSample>
  processes: Map<number, ProcessSample>
  identity: { hostname?: string; platform?: string; kernel?: string }
}
const number = (value: string) => Number(value)
const clamp = (value: number, max = 100) => Math.min(max, Math.max(0, value))

export function parseCoreSample(output: string): CoreSample {
  if (
    !output.startsWith('__MSHELL_MONITOR_V1__\n') ||
    !output.trimEnd().endsWith('__END_MSHELL_MONITOR__')
  ) {
    throw new Error('基础监控数据不完整；请确认服务器支持 Linux /proc 和 awk')
  }
  const sample: CoreSample = {
    totalTicks: NaN,
    idleTicks: NaN,
    uptime: NaN,
    cores: 0,
    loadAverage: [],
    memory: { total: 0, used: 0, free: 0, available: 0, usage: 0 },
    network: new Map(),
    processes: new Map(),
    identity: {}
  }
  for (const line of output.split('\n')) {
    const [kind, ...f] = line.split('|')
    switch (kind) {
      case 'CPU':
        ;[sample.totalTicks, sample.idleTicks] = f.map(number)
        break
      case 'CORES':
        sample.cores = number(f[0])
        break
      case 'UPTIME':
        sample.uptime = number(f[0])
        break
      case 'LOAD':
        sample.loadAverage = f.map(number)
        break
      case 'MEM': {
        const [total, free, available] = f.map(number)
        sample.memory = {
          total,
          free,
          available: clamp(available, total),
          used: total - clamp(available, total),
          usage: total > 0 ? ((total - clamp(available, total)) / total) * 100 : 0
        }
        break
      }
      case 'NET': {
        const [bytesIn, bytesOut, packetsIn, packetsOut] = f.slice(1).map(number)
        if ([bytesIn, bytesOut, packetsIn, packetsOut].every(Number.isFinite))
          sample.network.set(f[0], { bytesIn, bytesOut, packetsIn, packetsOut })
        break
      }
      case 'PROC': {
        const [pid, started, ticks, rss, uid, state, ...command] = f
        if (![number(pid), number(ticks), number(rss)].every(Number.isFinite)) break
        sample.processes.set(number(pid), {
          pid: number(pid),
          started,
          ticks: number(ticks),
          rss: number(rss),
          user: uid === '0' ? 'root' : uid,
          state,
          command: command.join('|')
        })
        break
      }
      case 'HOST':
        sample.identity.hostname = f.join('|')
        break
      case 'PLATFORM':
        sample.identity.platform = f.join('|')
        break
      case 'KERNEL':
        sample.identity.kernel = f.join('|')
        break
    }
  }
  if (
    !Number.isFinite(sample.totalTicks) ||
    !Number.isFinite(sample.idleTicks) ||
    !Number.isFinite(sample.uptime) ||
    sample.totalTicks < 0 ||
    sample.idleTicks < 0 ||
    sample.idleTicks > sample.totalTicks ||
    sample.uptime < 0 ||
    !Number.isInteger(sample.cores) ||
    sample.cores < 1 ||
    !(sample.memory.total > 0) ||
    !Number.isFinite(sample.memory.usage) ||
    sample.loadAverage.length !== 3 ||
    !sample.loadAverage.every(Number.isFinite)
  ) {
    throw new Error('无法读取有效的 Linux CPU、内存或系统时间数据')
  }
  return sample
}

export function calculateCoreMetrics(sample: CoreSample, previous?: CoreSample) {
  const seconds = previous ? sample.uptime - previous.uptime : 0
  const deltaTicks = previous ? sample.totalTicks - previous.totalTicks : 0
  const ready =
    !!previous && seconds > 0 && deltaTicks > 0 && sample.idleTicks >= previous.idleTicks
  const totals = { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0 }
  let received = 0,
    sent = 0
  for (const [name, current] of sample.network) {
    for (const key of Object.keys(totals) as Array<keyof NetworkSample>) totals[key] += current[key]
    const last = ready ? previous?.network.get(name) : undefined
    if (last) {
      received += Math.max(0, current.bytesIn - last.bytesIn)
      sent += Math.max(0, current.bytesOut - last.bytesOut)
    }
  }
  const processes = { total: sample.processes.size, running: 0, sleeping: 0, zombie: 0 }
  const topProcesses = [...sample.processes.values()].map((current) => {
    if (current.state === 'R') processes.running++
    if (['S', 'I', 'D'].includes(current.state)) processes.sleeping++
    if (current.state === 'Z') processes.zombie++
    const last = ready ? previous?.processes.get(current.pid) : undefined
    return {
      pid: current.pid,
      user: current.user,
      command: current.command,
      memory: clamp((current.rss / sample.memory.total) * 100),
      // Match top's convention: 100% is one fully occupied CPU core.
      cpu:
        ready && last?.started === current.started
          ? clamp(
              ((current.ticks - last.ticks) / deltaTicks) * sample.cores * 100,
              sample.cores * 100
            )
          : null
    }
  })
  return {
    cpu: {
      usage: ready
        ? clamp(((deltaTicks - (sample.idleTicks - previous!.idleTicks)) / deltaTicks) * 100)
        : null,
      loadAverage: sample.loadAverage,
      cores: sample.cores
    },
    memory: sample.memory,
    network: {
      ...totals,
      speedIn: ready ? received / seconds : null,
      speedOut: ready ? sent / seconds : null
    },
    processes,
    topProcesses,
    sampleIntervalMs: ready ? seconds * 1000 : null
  }
}

export function parseDiskMetrics(output: string): DiskMetrics {
  const filesystems = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [filesystem, mount, totalText, usedText, freeText] = line.split('|')
      const total = number(totalText),
        used = number(usedText),
        free = number(freeText)
      if (![total, used, free].every(Number.isFinite) || total <= 0)
        throw new Error('磁盘数据格式无效')
      return { filesystem, mount, total, used, free, usage: clamp((used / total) * 100) }
    })
  if (!filesystems.length) throw new Error('没有可读取的磁盘挂载数据')
  const devices = [...new Map(filesystems.map((item) => [item.filesystem, item])).values()]
  const total = devices.reduce((sum, item) => sum + item.total, 0)
  const used = devices.reduce((sum, item) => sum + item.used, 0)
  return {
    total,
    used,
    free: devices.reduce((sum, item) => sum + item.free, 0),
    usage: clamp((used / total) * 100),
    filesystems
  }
}

export function parseDockerMetrics(output: string): {
  available: boolean
  containers: DockerContainerInfo[]
} {
  if (output.trim() === '__NO_DOCKER__') return { available: false, containers: [] }
  if (
    !output.startsWith('__DOCKER_PS__\n') ||
    !output.includes('__DOCKER_STATS__\n') ||
    !output.trimEnd().endsWith('__END_DOCKER__')
  )
    throw new Error('Docker 采集未完成')
  const containers: DockerContainerInfo[] = []
  const stats = new Map<string, string[]>()
  let section = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('__')) {
      section = line
      continue
    }
    if (!line.trim()) continue
    const [name, ...fields] = line.split('|')
    if (section === '__DOCKER_PS__')
      containers.push({ name, status: fields.join('|'), cpu: '-', memory: '-', netIO: '-' })
    if (section === '__DOCKER_STATS__') stats.set(name, fields)
  }
  return {
    available: true,
    containers: containers.map((container) => {
      const values = stats.get(container.name)
      return values
        ? { ...container, cpu: values[0] || '-', memory: values[1] || '-', netIO: values[2] || '-' }
        : container
    })
  }
}
