import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { credentialManager } from './CredentialManager'
import { v4 as uuidv4 } from 'uuid'
import type { ProxyJumpConfig, ProxyConfig, SessionType, RDPOptions, VNCOptions } from '../../src/types/session'

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
  passphrase?: string
  portForwards?: any[]
  color?: string
  sortOrder?: number // 用于拖拽排序
  // 跳板机配置
  proxyJump?: ProxyJumpConfig
  // 代理配置
  proxy?: ProxyConfig
  // 服务器管理字段
  description?: string
  provider?: string // 提供商
  region?: string // 地区
  expiryDate?: Date // 到期时间
  billingCycle?: 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'biennially' | 'triennially' | 'custom' // 计费周期
  billingAmount?: number // 计费费用
  billingCurrency?: string // 货币单位，默认 CNY
  notes?: string // 备注
  createdAt: Date
  updatedAt: Date
  usageCount?: number
  lastConnected?: Date
  // RDP 特有配置
  rdpOptions?: RDPOptions
  // VNC 特有配置
  vncOptions?: VNCOptions
}

export interface SessionGroup {
  id: string
  name: string
  sessions: string[]
}

/**
 * SessionManager - 管理会话配置的 CRUD 操作
 */
export class SessionManager {
  private configPath: string
  private sessions: Map<string, SessionConfig>
  private groups: Map<string, SessionGroup>
  private initialized: boolean = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.configPath = join(userDataPath, 'sessions.json')
    this.sessions = new Map()
    this.groups = new Map()
  }

  /**
   * 初始化并加载会话配置
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.loadSessions()
      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize SessionManager:', error)
      // 如果加载失败，使用空配置
      this.sessions = new Map()
      this.groups = new Map()
      this.initialized = true
    }
  }

  /**
   * 从文件加载会话配置
   */
  async loadSessions(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(data)

      // 加载会话并解密敏感字段
      if (parsed.sessions && Array.isArray(parsed.sessions)) {
        for (const session of parsed.sessions) {
          // 解密敏感字段
          const decrypted = this.decryptSession(session)
          // 转换日期字符串为 Date 对象
          decrypted.createdAt = new Date(decrypted.createdAt)
          decrypted.updatedAt = new Date(decrypted.updatedAt)
          this.sessions.set(decrypted.id, decrypted)
        }
      }

      // 加载分组
      if (parsed.groups && Array.isArray(parsed.groups)) {
        for (const group of parsed.groups) {
          this.groups.set(group.id, group)
        }
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，创建新的
        await this.saveSessions()
      } else {
        throw error
      }
    }
  }

  /**
   * 保存会话配置到文件
   */
  async saveSessions(): Promise<void> {
    try {
      // 确保目录存在
      const dir = join(this.configPath, '..')
      await fs.mkdir(dir, { recursive: true })

      // 加密敏感字段
      const sessionsArray = Array.from(this.sessions.values()).map((session) =>
        this.encryptSession(session)
      )

      const groupsArray = Array.from(this.groups.values())

      const data = {
        sessions: sessionsArray,
        groups: groupsArray,
        version: '1.0.0',
        lastModified: new Date().toISOString()
      }

      await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save sessions:', error)
      throw new Error('Failed to save session configuration')
    }
  }

  /**
   * 加密会话中的敏感字段
   */
  private encryptSession(session: SessionConfig): any {
    const sensitiveFields = ['password', 'passphrase'] as (keyof SessionConfig)[]
    const encrypted = credentialManager.encryptFields(session, sensitiveFields)
    
    // 处理跳板机配置中的敏感字段
    if (encrypted.proxyJump) {
      encrypted.proxyJump = this.encryptProxyJump(encrypted.proxyJump)
    }
    
    // 处理代理配置中的敏感字段
    if (encrypted.proxy) {
      encrypted.proxy = this.encryptProxy(encrypted.proxy)
    }
    
    return encrypted
  }

  /**
   * 解密会话中的敏感字段
   */
  private decryptSession(session: any): SessionConfig {
    const sensitiveFields = ['password', 'passphrase'] as (keyof SessionConfig)[]
    const decrypted = credentialManager.decryptFields(session, sensitiveFields)
    
    // 处理跳板机配置中的敏感字段
    if (decrypted.proxyJump) {
      decrypted.proxyJump = this.decryptProxyJump(decrypted.proxyJump)
    }
    
    // 处理代理配置中的敏感字段
    if (decrypted.proxy) {
      decrypted.proxy = this.decryptProxy(decrypted.proxy)
    }
    
    return decrypted
  }

  /**
   * 递归加密跳板机配置
   */
  private encryptProxyJump(config: ProxyJumpConfig): any {
    const sensitiveFields = ['password', 'passphrase'] as (keyof ProxyJumpConfig)[]
    const encrypted = credentialManager.encryptFields({ ...config }, sensitiveFields)
    
    if (encrypted.nextJump) {
      encrypted.nextJump = this.encryptProxyJump(encrypted.nextJump)
    }
    
    return encrypted
  }

  /**
   * 递归解密跳板机配置
   */
  private decryptProxyJump(config: any): ProxyJumpConfig {
    const sensitiveFields = ['password', 'passphrase'] as (keyof ProxyJumpConfig)[]
    const decrypted = credentialManager.decryptFields({ ...config }, sensitiveFields)
    
    if (decrypted.nextJump) {
      decrypted.nextJump = this.decryptProxyJump(decrypted.nextJump)
    }
    
    return decrypted
  }

  /**
   * 加密代理配置
   */
  private encryptProxy(config: ProxyConfig): any {
    const sensitiveFields = ['password'] as (keyof ProxyConfig)[]
    return credentialManager.encryptFields({ ...config }, sensitiveFields)
  }

  /**
   * 解密代理配置
   */
  private decryptProxy(config: any): ProxyConfig {
    const sensitiveFields = ['password'] as (keyof ProxyConfig)[]
    return credentialManager.decryptFields({ ...config }, sensitiveFields)
  }

  /**
   * 自动检测区域
   */
  private async detectRegion(host: string): Promise<string | undefined> {
    try {
      // 动态引入以免影响启动速度
      const geoip = require('geoip-lite')
      const dns = require('dns').promises
      const net = require('net')

      let ip = host
      // 如果不是IP，尝试解析域名
      if (!net.isIP(host)) {
        const res = await dns.lookup(host)
        ip = res.address
      }

      const geo = geoip.lookup(ip)
      return geo?.country
    } catch (error) {
      // 解析失败或查不到，忽略
      return undefined
    }
  }

  /**
   * 创建新会话
   */
  async createSession(config: Omit<SessionConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionConfig> {
    // 如果没有指定地区，尝试根据Host自动检测
    if (!config.region && config.host) {
      config.region = await this.detectRegion(config.host)
    }

    // 处理日期字段 - 如果是字符串则转换为 Date
    if (config.expiryDate && typeof config.expiryDate === 'string') {
      (config as any).expiryDate = new Date(config.expiryDate)
    }

    const now = new Date()
    const newSession: SessionConfig = {
      ...config,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(newSession.id, newSession)
    await this.saveSessions()

    return newSession
  }

  /**
   * 更新会话
   */
  async updateSession(id: string, updates: Partial<SessionConfig>): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) {
      throw new Error(`Session not found: ${id}`)
    }

    // 如果当前没有地区且更新中也没指定，尝试自动检测
    if (!updates.region && !session.region) {
      const host = updates.host || session.host
      if (host) {
        updates.region = await this.detectRegion(host)
      }
    }

    // 处理日期字段 - 如果是字符串则转换为 Date
    if (updates.expiryDate && typeof updates.expiryDate === 'string') {
      (updates as any).expiryDate = new Date(updates.expiryDate)
    }

    const updated: SessionConfig = {
      ...session,
      ...updates,
      id: session.id, // 确保 ID 不被修改
      createdAt: session.createdAt, // 确保创建时间不被修改
      updatedAt: new Date()
    }

    this.sessions.set(id, updated)
    await this.saveSessions()
  }

  /**
   * 删除会话
   */
  deleteSession(id: string): void {
    if (!this.sessions.has(id)) {
      throw new Error(`Session not found: ${id}`)
    }

    this.sessions.delete(id)
    this.saveSessions().catch((error) => console.error('Failed to save after delete:', error))
  }

  /**
   * 获取单个会话
   */
  getSession(id: string): SessionConfig | undefined {
    return this.sessions.get(id)
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): SessionConfig[] {
    return Array.from(this.sessions.values())
  }

  /**
   * 搜索会话
   */
  searchSessions(query: string): SessionConfig[] {
    if (!query || query.trim() === '') {
      return this.getAllSessions()
    }

    const lowerQuery = query.toLowerCase().trim()
    return Array.from(this.sessions.values()).filter(session => {
      // 搜索名称
      if (session.name.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      // 搜索主机
      if (session.host.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      // 搜索用户名
      if (session.username.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      // 搜索提供商
      if (session.provider && session.provider.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      // 搜索地区
      if (session.region && session.region.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      // 搜索备注
      if (session.notes && session.notes.toLowerCase().includes(lowerQuery)) {
        return true
      }
      
      return false
    })
  }

  /**
   * 创建分组
   */
  async createGroup(name: string): Promise<SessionGroup> {
    const newGroup: SessionGroup = {
      id: uuidv4(),
      name,
      sessions: [] // Keep for compatibility but don't persist
    }

    this.groups.set(newGroup.id, newGroup)
    await this.saveSessions()

    return newGroup
  }

  /**
   * 将会话添加到分组
   */
  async addSessionToGroup(sessionId: string, groupId: string): Promise<void> {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Group not found: ${groupId}`)
    }

    await this.updateSession(sessionId, { group: groupId })
  }

  /**
   * 获取所有分组
   */
  getAllGroups(): SessionGroup[] {
    const groups = Array.from(this.groups.values())

    // Dynamically populate sessions array for frontend compatibility
    for (const group of groups) {
      group.sessions = Array.from(this.sessions.values())
        .filter(s => s.group === group.id)
        .map(s => s.id)
    }
    return groups
  }

  /**
   * 重命名分组
   */
  async renameGroup(groupId: string, newName: string): Promise<void> {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Group not found: ${groupId}`)
    }

    group.name = newName
    await this.saveSessions()
  }

  /**
   * 删除分组
   */
  async deleteGroup(groupId: string): Promise<void> {
    if (!this.groups.has(groupId)) {
      throw new Error(`Group not found: ${groupId}`)
    }

    // Ungroup all sessions in this group
    const sessions = Array.from(this.sessions.values()).filter(s => s.group === groupId)
    for (const session of sessions) {
      await this.updateSession(session.id, { group: undefined })
    }

    this.groups.delete(groupId)
    await this.saveSessions()
  }

  /**
   * 导出会话配置
   */
  async exportSessions(filePath: string, includePasswords: boolean = false): Promise<void> {
    const sessionsArray = Array.from(this.sessions.values()).map((session) => {
      const exported = { ...session }

      // 如果不包含密码，移除敏感字段
      if (!includePasswords) {
        delete exported.password
        delete exported.passphrase
      }

      return exported
    })

    const data = {
      sessions: sessionsArray,
      groups: Array.from(this.groups.values()),
      exportedAt: new Date().toISOString(),
      version: '1.0.0'
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  /**
   * 导入会话配置
   */
  async importSessions(filePath: string): Promise<SessionConfig[]> {
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(data)

      if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
        throw new Error('Invalid session file format')
      }

      const imported: SessionConfig[] = []

      for (const session of parsed.sessions) {
        // 验证必需字段
        if (!session.name || !session.host || !session.username) {
          console.warn('Skipping invalid session:', session)
          continue
        }

        // 生成新的 ID 以避免冲突
        const newSession = await this.createSession({
          name: session.name,
          group: session.group,
          host: session.host,
          port: session.port || 22,
          username: session.username,
          authType: session.authType || 'password',
          password: session.password,
          privateKeyPath: session.privateKeyPath,
          passphrase: session.passphrase,
          portForwards: session.portForwards,
          color: session.color,
          region: session.region, // Import region if exists
          provider: session.provider,
          expiryDate: session.expiryDate ? new Date(session.expiryDate) : undefined,
          // ... mapping others if needed, but 'session' likely has them. 
          // Simpler: Omit id/createdAt/updatedAt from source
          ...(({ id, createdAt, updatedAt, ...rest }) => rest)(session as any)
        })

        imported.push(newSession)
      }

      // 导入分组
      if (parsed.groups && Array.isArray(parsed.groups)) {
        for (const group of parsed.groups) {
          if (group.name) {
            this.createGroup(group.name)
          }
        }
      }

      return imported
    } catch (error) {
      console.error('Failed to import sessions:', error)
      throw new Error('Failed to import session configuration')
    }
  }
}

// 导出单例实例
export const sessionManager = new SessionManager()
