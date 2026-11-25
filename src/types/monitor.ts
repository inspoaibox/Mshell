export const MONITOR_INTERVALS = [1000, 2000, 3000, 5000] as const

export interface ProcessInfo {
  pid: number
  user: string
  cpu: number | null
  memory: number
  command: string
}

export interface DockerContainerInfo {
  name: string
  cpu: string
  memory: string
  netIO: string
  status: string
}

export interface DiskMetrics {
  total: number
  used: number
  free: number
  usage: number
  filesystems: Array<{
    filesystem: string
    mount: string
    total: number
    used: number
    free: number
    usage: number
  }>
}

export interface MetricSource {
  timestamp?: string
  error?: string
  available?: boolean
}

export interface ServerMetrics {
  sessionId: string
  /** Only advances when a new core sample arrives. */
  timestamp: string
  interval: number
  sampleIntervalMs: number | null
  collectionDurationMs: number
  connection: 'connected' | 'waiting'
  cpu: { usage: number | null; loadAverage: number[]; cores: number }
  memory: { total: number; used: number; free: number; available: number; usage: number }
  disk: DiskMetrics | null
  network: {
    bytesIn: number
    bytesOut: number
    packetsIn: number
    packetsOut: number
    speedIn: number | null
    speedOut: number | null
  }
  processes: { total: number; running: number; sleeping: number; zombie: number }
  topProcesses: ProcessInfo[]
  dockerContainers: DockerContainerInfo[]
  system: { uptime: number; hostname: string; platform: string; kernel: string }
  sources: { core: MetricSource; disk: MetricSource; docker: MetricSource }
}

export interface MonitorConfig {
  interval: number
  enabled: boolean
  metrics: {
    cpu: boolean
    memory: boolean
    disk: boolean
    network: boolean
    processes: boolean
    topProcesses: boolean
    docker: boolean
  }
}

export type MonitorConfigUpdate = Partial<Omit<MonitorConfig, 'metrics'>> & {
  metrics?: Partial<MonitorConfig['metrics']>
}
