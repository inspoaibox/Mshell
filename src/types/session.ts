// 会话类型
export type SessionType = 'ssh' | 'rdp' | 'vnc'

export interface SessionConfig {
  id: string
  name: string
  type?: SessionType // 会话类型，默认为 'ssh'
  group?: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyId?: string // SSH密钥管理器中的密钥ID
  privateKeyPath?: string
  privateKey?: string // For runtime connection use
  passphrase?: string
  portForwards?: any[]
  color?: string
  sortOrder?: number // 用于拖拽排序
  // Proxy Jump (跳板机) Configuration
  proxyJump?: ProxyJumpConfig
  // Proxy (代理) Configuration
  proxy?: ProxyConfig
  // Server Management Info
  description?: string
  provider?: string
  region?: string
  expiryDate?: Date
  billingCycle?: 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'biennially' | 'triennially' | 'custom'
  billingAmount?: number
  billingCurrency?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
  usageCount?: number
  lastConnected?: Date
  // RDP 特有配置
  rdpOptions?: RDPOptions
  // VNC 特有配置
  vncOptions?: VNCOptions
}

// RDP 连接选项
export interface RDPOptions {
  width?: number        // 分辨率宽度
  height?: number       // 分辨率高度
  fullscreen?: boolean  // 全屏模式
  multimon?: boolean    // 多显示器
  admin?: boolean       // 管理员模式 (/admin)
  restrictedAdmin?: boolean // 受限管理员模式
  remoteGuard?: boolean // Remote Guard 模式
  // 资源重定向
  drives?: boolean      // 驱动器重定向
  printers?: boolean    // 打印机重定向
  clipboard?: boolean   // 剪贴板重定向
  audio?: 'local' | 'remote' | 'none' // 音频重定向
  // 显示设置
  colorDepth?: 15 | 16 | 24 | 32 // 颜色深度
  compression?: boolean // 压缩
  // 网关设置
  gateway?: {
    enabled: boolean
    host: string
    port?: number
    username?: string
    password?: string
  }
}

// VNC 连接选项
export interface VNCOptions {
  viewOnly?: boolean    // 只读模式
  quality?: number      // 图像质量 (1-9)
  compression?: number  // 压缩级别 (0-9)
  encoding?: 'tight' | 'zrle' | 'hextile' | 'raw'
  colorDepth?: 8 | 16 | 24 | 32
  localCursor?: boolean // 本地光标
  sharedConnection?: boolean // 共享连接
}

export interface ProxyJumpConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  privateKey?: string
  passphrase?: string
  // 支持多级跳板
  nextJump?: ProxyJumpConfig
}

export interface ProxyConfig {
  enabled: boolean
  type: 'socks5' | 'http'
  host: string
  port: number
  username?: string
  password?: string
}

export interface SessionGroup {
  id: string
  name: string
  sessions: string[] // For compatibility, populated dynamically
}
