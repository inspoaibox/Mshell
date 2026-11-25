/** 当前登录会话（who） */
export interface SecuritySession {
  user: string
  tty: string
  /** 登录时间（服务器本地时间文本） */
  loginAt: string
  /** 来源：IP、主机名、:0（本地图形）等；本地控制台为空 */
  host: string
  /** host 是 IP 地址时的值 */
  ip?: string
  idle?: string
  pid?: number
}

/** 已建立的 SSH / 远程访问入站连接 */
export interface SecurityConnection {
  ip: string
  port: number
  localPort: number
  process?: string
  pid?: number
}

export interface SecuritySummary {
  collectedAt: string
  hostname: string
  /** 本应用当前连接在服务器看到的来源 IP */
  selfIp?: string
  sshPort: number
  privileged: boolean
  sessions: SecuritySession[]
  connections: SecurityConnection[]
  /** 最近 1 小时 SSH 认证失败次数；无法读取日志时为 null */
  failedLastHour: number | null
  warnings: string[]
}

export interface LoginRecord {
  user: string
  tty: string
  ip: string
  start: string
  /** 结束时间或状态，如 still logged in / gone - no logout */
  end: string
  duration?: string
  active: boolean
}

export type AuthEventType = 'accepted' | 'failed' | 'invalid' | 'disconnected' | 'other'

export interface AuthEvent {
  time: string
  type: AuthEventType
  user?: string
  ip?: string
  port?: number
  method?: string
  message: string
}

export interface FailedSource {
  ip: string
  count: number
  lastTime: string
  users: string[]
}

export interface SecurityDetails extends SecuritySummary {
  logins: LoginRecord[]
  authEvents: AuthEvent[]
  /** journal、日志文件路径，或 none */
  authSource: string
  failedSources: FailedSource[]
}
