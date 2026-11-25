import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { credentialManager } from './CredentialManager'
import { v4 as uuidv4 } from 'uuid'
import type {
  ProxyJumpConfig,
  ProxyConfig,
  SessionType,
  RDPOptions,
  VNCOptions,
  IPMIOptions,
  SessionGroup,
  SessionGroupOrderAction,
  SessionOrderAction
} from '../../src/types/session'
import { sortSessionGroups } from '../../src/utils/session-groups'
import { sortSessions } from '../../src/utils/session-order'
import type { TerminalBackgroundConfig } from '../../src/types/terminal-background'
import { appSettingsManager } from '../utils/app-settings'

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
  terminalBackground?: TerminalBackgroundConfig
  color?: string
  sortOrder?: number // 用于拖拽排序
  isPinned?: boolean
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
  // IPMI / Redfish 带外管理配置
  ipmiOptions?: IPMIOptions
}

export type { SessionGroup } from '../../src/types/session'

type SessionCreateConfig = Omit<SessionConfig, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<SessionConfig, 'id' | 'createdAt' | 'updatedAt'>>

/**
 * SessionManager - 管理会话配置的 CRUD 操作
 */
export class SessionManager {
  private configPath: string
  private sessions: Map<string, SessionConfig>
  private groups: Map<string, SessionGroup>
  private initialized: boolean = false
  private saveQueue: Promise<void> = Promise.resolve()

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
          this.groups.set(group.id, {
            ...group,
            ...this.groupOrderMetadata(group, this.groups.size)
          })
        }
      }

      if (appSettingsManager.getSettings().security.savePasswords === false) {
        this.clearStoredSecrets()
        await this.saveSessions()
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
    return this.enqueueSave(() => this.writeSessions())
  }

  private enqueueSave<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.saveQueue.then(operation)
    this.saveQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async writeSessions(groups = this.groups, sessions = this.sessions): Promise<void> {
    try {
      // 确保目录存在
      const dir = join(this.configPath, '..')
      await fs.mkdir(dir, { recursive: true })

      // 加密敏感字段
      const sessionsArray = Array.from(sessions.values()).map((session) =>
        this.encryptSession(session)
      )

      const groupsArray = Array.from(groups.values())

      const data = {
        sessions: sessionsArray,
        groups: groupsArray,
        version: '1.0.0',
        lastModified: new Date().toISOString()
      }

      // Serialize writes and replace only after a complete file has been written.
      const temporaryPath = `${this.configPath}.tmp`
      await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf-8')
      await fs.rename(temporaryPath, this.configPath)
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
    const sessionToEncrypt = this.sanitizeSavedSecrets(session) as SessionConfig
    const encrypted = credentialManager.encryptFields(sessionToEncrypt, sensitiveFields)
    
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

  private sanitizeProxyJumpSecrets(config?: ProxyJumpConfig): ProxyJumpConfig | undefined {
    if (!config) return undefined

    const sanitized: ProxyJumpConfig = { ...config }
    sanitized.password = undefined
    sanitized.passphrase = undefined

    if (sanitized.nextJump) {
      sanitized.nextJump = this.sanitizeProxyJumpSecrets(sanitized.nextJump)
    }

    return sanitized
  }

  private sanitizeProxySecrets(config?: ProxyConfig): ProxyConfig | undefined {
    if (!config) return undefined

    const sanitized: ProxyConfig = { ...config }
    sanitized.password = undefined
    return sanitized
  }

  private sanitizeSavedSecrets<T extends Partial<SessionConfig>>(config: T): T {
    const shouldSavePasswords = appSettingsManager.getSettings().security.savePasswords !== false
    if (shouldSavePasswords) return config

    const sanitized = { ...config } as any
    if ('password' in sanitized) {
      sanitized.password = undefined
    }
    if ('passphrase' in sanitized) {
      sanitized.passphrase = undefined
    }

    if (sanitized.proxyJump) {
      sanitized.proxyJump = this.sanitizeProxyJumpSecrets(sanitized.proxyJump)
    }

    if (sanitized.proxy) {
      sanitized.proxy = this.sanitizeProxySecrets(sanitized.proxy)
    }

    return sanitized
  }

  private parseSessionDate(value: unknown, fallback: Date): Date {
    if (!value) return fallback

    const date =
      value instanceof Date || typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null

    return date && !Number.isNaN(date.getTime()) ? date : fallback
  }

  private clearStoredSecrets(): void {
    for (const [id, session] of this.sessions.entries()) {
      this.sessions.set(id, this.sanitizeSavedSecrets(session) as SessionConfig)
    }
  }

  async removeSavedSecrets(): Promise<void> {
    this.clearStoredSecrets()
    await this.saveSessions()
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
  async createSession(config: SessionCreateConfig): Promise<SessionConfig> {
    config = this.sanitizeSavedSecrets(config)

    // 如果没有指定地区，尝试根据Host自动检测
    if (!config.region && config.host) {
      config.region = await this.detectRegion(config.host)
    }

    // 处理日期字段 - 如果是字符串则转换为 Date
    if (config.expiryDate && typeof config.expiryDate === 'string') {
      (config as any).expiryDate = new Date(config.expiryDate)
    }

    const now = new Date()
    const restoredId =
      typeof config.id === 'string' && config.id.trim() && !this.sessions.has(config.id)
        ? config.id
        : undefined
    const newSession: SessionConfig = {
      ...config,
      id: restoredId || uuidv4(),
      createdAt: this.parseSessionDate(config.createdAt, now),
      updatedAt: this.parseSessionDate(config.updatedAt, now)
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

    updates = this.sanitizeSavedSecrets(updates)

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

    // 仅记录连接次数/时间时不算内容修改，避免影响云同步的修改时间比较
    const usageOnly = Object.keys(updates).every((key) =>
      ['usageCount', 'lastConnected'].includes(key)
    )
    const updated: SessionConfig = {
      ...session,
      ...updates,
      id: session.id, // 确保 ID 不被修改
      createdAt: session.createdAt, // 确保创建时间不被修改
      updatedAt: usageOnly ? session.updatedAt : new Date()
    }

    // 处理 null 值：前端用 null 表示"清除此字段"
    // JSON 序列化和 IPC 传输会丢弃 undefined，所以前端用 null 代替
    for (const key of Object.keys(updated) as (keyof SessionConfig)[]) {
      if ((updated as any)[key] === null) {
        delete (updated as any)[key]
      }
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
   * 云同步原样写入会话（保留 id 和时间戳）
   */
  async syncUpsertSession(raw: any): Promise<void> {
    if (!raw?.id) return
    const now = new Date()
    const session = this.sanitizeSavedSecrets({ ...raw }) as SessionConfig
    session.createdAt = this.parseSessionDate(raw.createdAt, now)
    session.updatedAt = this.parseSessionDate(raw.updatedAt, now)
    for (const field of ['expiryDate', 'lastConnected'] as const) {
      if (raw[field]) {
        ;(session as any)[field] = this.parseSessionDate(raw[field], now)
      } else {
        delete (session as any)[field]
      }
    }
    this.sessions.set(session.id, session)
    await this.saveSessions()
  }

  /**
   * 云同步删除会话（不存在时忽略）
   */
  async syncRemoveSession(id: string): Promise<void> {
    if (!this.sessions.delete(id)) return
    await this.saveSessions()
  }

  /**
   * 云同步原样写入分组
   */
  async syncUpsertGroup(raw: any): Promise<void> {
    if (!raw?.id) return
    const existing = this.groups.get(raw.id)
    this.groups.set(raw.id, {
      id: raw.id,
      name: String(raw.name || ''),
      sessions: [],
      ...this.groupOrderMetadata({ ...existing, ...raw }, this.nextGroupOrder())
    })
    await this.saveSessions()
  }

  /**
   * 云同步删除分组（会话的分组引用由会话自身的同步结果决定）
   */
  async syncRemoveGroup(id: string): Promise<void> {
    if (!this.groups.delete(id)) return
    await this.saveSessions()
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

  async updateSessionOrder(id: string, action: SessionOrderAction): Promise<SessionConfig[]> {
    if (!action || !['pin', 'unpin', 'move'].includes(action.type)) {
      throw new Error('无效的会话排序操作')
    }
    return this.enqueueSave(async () => {
      const session = this.sessions.get(id)
      if (!session) throw new Error('会话不存在，请刷新后重试')
      const groupOf = (item: SessionConfig) =>
        item.group && this.groups.has(item.group) ? item.group : undefined
      const ordered = sortSessions(this.getAllSessions().filter(item => groupOf(item) === groupOf(session)))
        .map(item => ({ ...item }))
      const index = ordered.findIndex(item => item.id === id)
      const selected = ordered[index]
      if (action.type === 'move') {
        const target = ordered.findIndex(item => item.id === action.targetId)
        if (target < 0) throw new Error('只能在同一分组内调整会话顺序')
        if ((ordered[target].isPinned === true) !== (selected.isPinned === true)) {
          throw new Error('置顶会话固定显示在前，请在同类会话之间拖拽排序')
        }
        if (target === index) return this.getAllSessions()
        ordered.splice(index, 1)
        ordered.splice(target, 0, selected)
      } else {
        const pinned = action.type === 'pin'
        if ((selected.isPinned === true) === pinned) return this.getAllSessions()
        selected.isPinned = pinned
        ordered.splice(index, 1)
        const firstOrdinary = ordered.findIndex(item => item.isPinned !== true)
        ordered.splice(pinned ? 0 : firstOrdinary < 0 ? ordered.length : firstOrdinary, 0, selected)
      }
      const updatedAt = new Date()
      const candidate = new Map(this.sessions)
      const changed: SessionConfig[] = []
      ordered.forEach((item, sortOrder) => {
        const previous = this.sessions.get(item.id)!
        if (previous.isPinned === item.isPinned && previous.sortOrder === sortOrder) return
        const updated = { ...item, sortOrder, updatedAt }
        candidate.set(item.id, updated)
        changed.push(updated)
      })
      await this.writeSessions(this.groups, candidate)
      // Publish only persisted metadata; preserve concurrent edits to connection details.
      for (const item of changed) {
        const current = this.sessions.get(item.id)
        if (current) {
          this.sessions.set(item.id, {
            ...current,
            isPinned: item.isPinned,
            sortOrder: item.sortOrder,
            updatedAt: current.updatedAt > updatedAt ? current.updatedAt : updatedAt
          })
        }
      }
      return this.getAllSessions()
    })
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
  async createGroup(
    name: string,
    id?: string,
    order: Pick<SessionGroup, 'isPinned' | 'sortOrder'> = {}
  ): Promise<SessionGroup> {
    const newGroup: SessionGroup = {
      id: id || uuidv4(),
      name,
      sessions: [], // Populated dynamically from session.group
      ...this.groupOrderMetadata(order, this.nextGroupOrder())
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
    const groups = sortSessionGroups(Array.from(this.groups.values()))

    // Dynamically populate sessions array for frontend compatibility
    for (const group of groups) {
      group.sessions = Array.from(this.sessions.values())
        .filter(s => s.group === group.id)
        .map(s => s.id)
    }
    return groups
  }

  private groupOrderMetadata(raw: Partial<SessionGroup>, fallback: number) {
    return {
      isPinned: raw.isPinned === true,
      sortOrder: typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)
        ? raw.sortOrder : fallback
    }
  }

  private nextGroupOrder(): number {
    return Math.max(-1, ...Array.from(this.groups.values(), (group, index) =>
      this.groupOrderMetadata(group, index).sortOrder)) + 1
  }

  async updateGroupOrder(groupId: string, action: SessionGroupOrderAction): Promise<SessionGroup[]> {
    if (!['pin', 'unpin', 'up', 'down'].includes(action)) {
      throw new Error('无效的分组排序操作')
    }
    return this.enqueueSave(async () => {
      const ordered = this.getAllGroups().map(group => ({ ...group }))
      const index = ordered.findIndex(group => group.id === groupId)
      if (index < 0) throw new Error('分组不存在，请刷新后重试')
      const group = ordered[index]
      if (action === 'pin' || action === 'unpin') {
        const isPinned = action === 'pin'
        if (Boolean(group.isPinned) === isPinned) return this.getAllGroups()
        ordered.splice(index, 1)
        group.isPinned = isPinned
        // Pin to the very top; unpin to the start of the ordinary groups.
        const firstOrdinary = ordered.findIndex(item => !item.isPinned)
        ordered.splice(isPinned ? 0 : firstOrdinary < 0 ? ordered.length : firstOrdinary, 0, group)
      } else {
        const target = index + (action === 'up' ? -1 : 1)
        if (!ordered[target] || Boolean(ordered[target].isPinned) !== Boolean(group.isPinned)) {
          return this.getAllGroups()
        }
        ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
      }
      ordered.forEach((item, position) => { item.sortOrder = position })
      await this.writeSessions(new Map(ordered.map(item => [item.id, item])))
      // Publish only after saving succeeds. Preserve concurrent name/member changes.
      for (const item of ordered) {
        const current = this.groups.get(item.id)
        if (current) Object.assign(current, { isPinned: item.isPinned, sortOrder: item.sortOrder })
      }
      return this.getAllGroups()
    })
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
      const exported = { ...session } as any

      if (!includePasswords) {
        // 删除主会话的敏感字段
        delete exported.password
        delete exported.passphrase

        // 删除跳板机配置中的敏感字段
        if (exported.proxyJump) {
          exported.proxyJump = this.stripSensitiveFromProxyJump(exported.proxyJump)
        }

        // 删除代理配置中的敏感字段
        if (exported.proxy) {
          const proxy = { ...exported.proxy }
          delete proxy.password
          exported.proxy = proxy
        }
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

  private stripSensitiveFromProxyJump(config: any): any {
    const stripped = { ...config }
    delete stripped.password
    delete stripped.passphrase
    if (stripped.nextJump) {
      stripped.nextJump = this.stripSensitiveFromProxyJump(stripped.nextJump)
    }
    return stripped
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

      // Keep imported group membership and ordering while generating fresh IDs.
      const importedGroupIds = new Map<string, string>()
      if (Array.isArray(parsed.groups)) {
        for (const group of sortSessionGroups(parsed.groups)) {
          if (group.name) {
            const created = await this.createGroup(group.name, undefined, { isPinned: group.isPinned })
            importedGroupIds.set(group.id, created.id)
          }
        }
      }

      for (const session of parsed.sessions) {
        // 验证必需字段
        if (!session.name || !session.host || !session.username) {
          console.warn('Skipping invalid session:', session)
          continue
        }

        // 生成新的 ID 以避免冲突，只传必要字段，避免字段重复覆盖
        const { id: _id, createdAt: _c, updatedAt: _u, ...sessionRest } = session as any
        const newSession = await this.createSession({
          ...sessionRest,
          group: importedGroupIds.get(session.group),
          port: session.port || 22,
          authType: session.authType || 'password',
          expiryDate: session.expiryDate ? new Date(session.expiryDate) : undefined,
        })

        imported.push(newSession)
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
