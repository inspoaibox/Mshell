export interface SessionConfig {
  id: string
  name: string
  group?: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  privateKey?: string // For runtime connection use
  passphrase?: string
  portForwards?: any[]
  color?: string
  sortOrder?: number // 用于拖拽排序
  // Proxy Jump (跳板机) Configuration
  proxyJump?: ProxyJumpConfig
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

export interface SessionGroup {
  id: string
  name: string
  sessions: string[] // For compatibility, populated dynamically
}
