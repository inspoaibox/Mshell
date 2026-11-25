export type PortProtocol = 'tcp' | 'udp'

/** all：监听所有地址（0.0.0.0 / ::）；local：仅本机回环；specific：指定网卡地址 */
export type PortExposure = 'all' | 'local' | 'specific'

export interface PortProcess {
  pid: number
  ppid?: number
  name: string
  user: string
  /** 运行时长（ps etime 格式，如 3-04:05:06） */
  elapsed: string
  cpu: string
  memory: string
  /** 常驻内存（KB） */
  rssKb?: number
  command: string
  /** 所属 systemd 服务（如 nginx.service） */
  unit?: string
}

export interface PortEntry {
  /** protocol/port，如 tcp/22 */
  key: string
  protocol: PortProtocol
  port: number
  addresses: string[]
  exposure: PortExposure
  /** 监听该端口的全部进程（包含 worker） */
  processes: PortProcess[]
  /** 主进程 PID（父进程不在监听集合中的进程），关闭端口时作用于这些进程 */
  rootPids: number[]
  /** 已建立的入站连接数（仅 TCP） */
  connections: number
  /** 入站连接的不同来源 IP 数 */
  remoteClients: number
  /** Docker 发布该端口的容器名 */
  containers: string[]
  /** 当前 SSH 会话所用端口 */
  isSshPort: boolean
  /** 进程信息不可见（非 root 且无免密 sudo） */
  processHidden: boolean
}

export interface PortOverview {
  hostname: string
  tool: 'ss' | 'netstat' | ''
  privileged: boolean
  sshServerPort?: number
  ports: PortEntry[]
  warnings: string[]
  collectedAt: string
}

export type PortCloseMode = 'term' | 'kill' | 'service'

export interface PortCloseRequest {
  protocol: PortProtocol
  port: number
  mode: PortCloseMode
  /** 界面上看到的主进程 PID，用于确认端口占用没有变化 */
  expectedPids: number[]
}

export interface PortCloseResult {
  /** 端口已不再监听 */
  closed: boolean
  message: string
  output: string
  /** 关闭后端口仍在监听时的最新占用 */
  current?: PortEntry
}
