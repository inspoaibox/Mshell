/* global Buffer, NodeJS */

import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { backupManager, BackupData } from './BackupManager'
import { logger } from '../utils/logger'
import { credentialManager } from './CredentialManager'
import { isLocalTerminalBackground } from '../../src/types/terminal-background'
import axios from 'axios'

/**
 * 同步配置接口
 */
export interface SyncConfig {
  enabled: boolean
  provider: 'github' | 'gitlab' | 'webdav' | 's3'
  autoSync: boolean
  syncInterval: number // 分钟
  lastSync?: string
  lastSyncChecksum?: string
  encryptionPassword?: string // 同步数据加密密码

  // GitHub Gist 配置
  github?: {
    token: string
    gistId?: string
    gistUrl?: string
    username?: string
  }

  // GitLab Snippet 配置
  gitlab?: {
    token: string
    snippetId?: string
    snippetUrl?: string
    username?: string
    instanceUrl?: string // 支持自托管 GitLab，默认 https://gitlab.com
  }
}

type SyncConfigUpdate = Partial<
  Omit<SyncConfig, 'github' | 'gitlab'> & {
    github?: Partial<SyncConfig['github']>
    gitlab?: Partial<SyncConfig['gitlab']>
  }
>

/**
 * 同步数据结构
 */
interface SyncData {
  version: string
  appVersion: string
  lastModified: string
  checksum: string
  encrypted: boolean
  data: string // 加密后的 JSON 字符串或明文
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean
  action?: 'uploaded' | 'downloaded' | 'no-change' | 'conflict'
  message: string
  localTime?: string
  remoteTime?: string
}

/**
 * SyncManager - 云同步管理器
 */
export class SyncManager {
  private readonly REDACTED_SECRET = '__mshell_secret_configured__'
  private configPath: string
  private config: SyncConfig
  private timer: NodeJS.Timeout | null = null
  private isSyncing: boolean = false
  private runtimeEncryptionPassword?: string

  constructor() {
    this.configPath = join(app.getPath('userData'), 'sync-config.json')
    this.config = {
      enabled: false,
      provider: 'github',
      autoSync: false,
      syncInterval: 30 // 默认30分钟
    }
  }

  /**
   * 初始化同步管理器
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig()
      await this.saveConfig()

      if (this.config.enabled && this.config.autoSync) {
        this.startAutoSync()
      }

      console.log('[SyncManager] Initialized')
    } catch (error) {
      logger.logError('system', 'Failed to initialize sync manager', error as Error)
    }
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      this.config = this.decryptConfig({ ...this.config, ...JSON.parse(data) })
      this.runtimeEncryptionPassword = this.config.encryptionPassword
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.logError('system', 'Failed to load sync config', error)
      }
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(): Promise<void> {
    try {
      await fs.writeFile(
        this.configPath,
        JSON.stringify(this.encryptConfig(this.config), null, 2),
        'utf-8'
      )
    } catch (error) {
      logger.logError('system', 'Failed to save sync config', error as Error)
      throw new Error('保存同步配置失败')
    }
  }

  /**
   * 获取配置
   */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  getConfigForRenderer(): SyncConfig {
    return this.redactConfig(this.config)
  }

  exportConfigForBackup(): SyncConfig {
    const config = { ...this.config }
    delete config.lastSync
    delete config.lastSyncChecksum
    return config
  }

  async applyConfigFromBackup(config: Partial<SyncConfig>): Promise<void> {
    const restoredConfig = this.restoreConfigForImport(config)
    await this.updateConfig(restoredConfig)
  }

  /**
   * 更新配置
   */
  async updateConfig(updates: Partial<SyncConfig>): Promise<void> {
    const normalizedUpdates = this.normalizeConfigUpdates(updates)
    const { github, gitlab, ...restUpdates } = normalizedUpdates

    this.config = { ...this.config, ...restUpdates }

    if (github) {
      if (this.config.github) {
        this.config.github = { ...this.config.github, ...github }
      } else if (github.token) {
        this.config.github = { ...github, token: github.token }
      }
    }

    if (gitlab) {
      if (this.config.gitlab) {
        this.config.gitlab = { ...this.config.gitlab, ...gitlab }
      } else if (gitlab.token) {
        this.config.gitlab = { ...gitlab, token: gitlab.token }
      }
    }

    this.runtimeEncryptionPassword = this.config.encryptionPassword
    await this.saveConfig()

    // 重启自动同步
    this.stopAutoSync()
    if (this.config.enabled && this.config.autoSync) {
      this.startAutoSync()
    }
  }

  private normalizeConfigUpdates(updates: Partial<SyncConfig>): SyncConfigUpdate {
    const normalized: SyncConfigUpdate = {
      ...updates,
      github: updates.github ? { ...updates.github } : undefined,
      gitlab: updates.gitlab ? { ...updates.gitlab } : undefined
    }

    if (normalized.encryptionPassword === this.REDACTED_SECRET) {
      delete normalized.encryptionPassword
    }
    if (normalized.github?.token === this.REDACTED_SECRET) {
      delete normalized.github.token
    }
    if (normalized.gitlab?.token === this.REDACTED_SECRET) {
      delete normalized.gitlab.token
    }

    return normalized
  }

  /**
   * 设置同步加密密码，仅保存在当前进程内存中。
   * 本地配置文件只保存 safeStorage 加密后的副本，用于下次启动自动同步。
   */
  async setEncryptionPassword(password: string): Promise<void> {
    this.runtimeEncryptionPassword = password
    this.config.encryptionPassword = password
    await this.saveConfig()
  }

  private getEncryptionPassword(): string | undefined {
    return this.runtimeEncryptionPassword || this.config.encryptionPassword
  }

  private encryptConfig(config: SyncConfig): SyncConfig {
    const safeConfig: SyncConfig = {
      ...config,
      github: config.github ? { ...config.github } : undefined,
      gitlab: config.gitlab ? { ...config.gitlab } : undefined
    }

    if (safeConfig.encryptionPassword) {
      safeConfig.encryptionPassword = credentialManager.encrypt(safeConfig.encryptionPassword)
    }
    if (safeConfig.github?.token) {
      safeConfig.github.token = credentialManager.encrypt(safeConfig.github.token)
    }
    if (safeConfig.gitlab?.token) {
      safeConfig.gitlab.token = credentialManager.encrypt(safeConfig.gitlab.token)
    }

    return safeConfig
  }

  private redactConfig(config: SyncConfig): SyncConfig {
    const redacted: SyncConfig = {
      ...config,
      github: config.github ? { ...config.github } : undefined,
      gitlab: config.gitlab ? { ...config.gitlab } : undefined
    }

    if (redacted.encryptionPassword) {
      redacted.encryptionPassword = this.REDACTED_SECRET
    }
    if (redacted.github?.token) {
      redacted.github.token = this.REDACTED_SECRET
    }
    if (redacted.gitlab?.token) {
      redacted.gitlab.token = this.REDACTED_SECRET
    }

    return redacted
  }

  private decryptConfig(config: SyncConfig): SyncConfig {
    const decrypted: SyncConfig = {
      ...config,
      github: config.github ? { ...config.github } : undefined,
      gitlab: config.gitlab ? { ...config.gitlab } : undefined
    }

    if (decrypted.encryptionPassword) {
      decrypted.encryptionPassword = this.decryptMaybeEncrypted(decrypted.encryptionPassword)
    }
    if (decrypted.github?.token) {
      decrypted.github.token = this.decryptMaybeEncrypted(decrypted.github.token)
    }
    if (decrypted.gitlab?.token) {
      decrypted.gitlab.token = this.decryptMaybeEncrypted(decrypted.gitlab.token)
    }

    return decrypted
  }

  private decryptMaybeEncrypted(value: string): string {
    if (!credentialManager.isEncrypted(value)) {
      return credentialManager.decryptLegacyUnprefixed(value) ?? value
    }

    try {
      return credentialManager.decrypt(value)
    } catch (error) {
      logger.logError('system', 'Failed to decrypt sync config value', error as Error)
      return value
    }
  }

  private restoreConfigForImport(config: Partial<SyncConfig>): Partial<SyncConfig> {
    const restored: Partial<SyncConfig> = {
      ...config,
      github: config.github ? { ...config.github } : undefined,
      gitlab: config.gitlab ? { ...config.gitlab } : undefined
    }

    delete restored.lastSync
    delete restored.lastSyncChecksum

    if (restored.encryptionPassword) {
      const password = this.restoreSecretForImport(restored.encryptionPassword)
      if (password) {
        restored.encryptionPassword = password
      } else {
        delete restored.encryptionPassword
        restored.enabled = false
        restored.autoSync = false
      }
    } else {
      restored.enabled = false
      restored.autoSync = false
    }

    if (restored.github?.token) {
      const token = this.restoreSecretForImport(restored.github.token)
      if (token) {
        restored.github.token = token
      } else {
        delete restored.github
        if (restored.provider === 'github') {
          restored.enabled = false
          restored.autoSync = false
        }
      }
    }

    if (restored.gitlab?.token) {
      const token = this.restoreSecretForImport(restored.gitlab.token)
      if (token) {
        restored.gitlab.token = token
      } else {
        delete restored.gitlab
        if (restored.provider === 'gitlab') {
          restored.enabled = false
          restored.autoSync = false
        }
      }
    }

    return restored
  }

  private restoreSecretForImport(value: string): string | undefined {
    if (!value || value === this.REDACTED_SECRET) {
      return undefined
    }

    if (!credentialManager.isEncrypted(value)) {
      return credentialManager.decryptLegacyUnprefixed(value) ?? value
    }

    try {
      return credentialManager.decrypt(value)
    } catch (error) {
      logger.logError(
        'system',
        'Skipped encrypted sync config secret from another machine',
        error as Error
      )
      return undefined
    }
  }

  /**
   * 计算数据校验和
   */
  private calculateChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 16)
  }

  private calculateBackupChecksum(data: BackupData): string {
    const { timestamp, ...stableData } = data
    void timestamp
    return this.calculateChecksum(JSON.stringify(stableData))
  }

  /**
   * 收集同步数据
   */
  private async collectSyncData(): Promise<BackupData> {
    const data = await backupManager.collectBackupData()
    return this.stripLocalTerminalBackgrounds(data)
  }

  private stripLocalTerminalBackgrounds(data: BackupData): BackupData {
    const sanitized = JSON.parse(JSON.stringify(data)) as BackupData
    const terminalBackground = sanitized.settings?.terminal?.background
    delete sanitized.terminalBackgroundAssets

    if (terminalBackground && isLocalTerminalBackground(terminalBackground)) {
      delete sanitized.settings.terminal.background
    }

    if (Array.isArray(sanitized.sessions)) {
      sanitized.sessions = sanitized.sessions.map((session: any) => {
        if (session.terminalBackground && isLocalTerminalBackground(session.terminalBackground)) {
          const cleanSession = { ...session }
          delete cleanSession.terminalBackground
          return cleanSession
        }

        return session
      })
    }

    return sanitized
  }

  /**
   * 加密数据
   */
  private async encryptData(data: string, password: string): Promise<string> {
    const { createCipheriv, randomBytes, scrypt } = await import('crypto')
    const { promisify } = await import('util')
    const scryptAsync = promisify(scrypt)

    const key = (await scryptAsync(password, 'mshell-sync-salt', 32)) as Buffer
    const iv = randomBytes(16)

    const cipher = createCipheriv('aes-256-cbc', key, iv)
    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    return iv.toString('hex') + ':' + encrypted
  }

  /**
   * 解密数据
   */
  private async decryptData(encryptedData: string, password: string): Promise<string> {
    const { createDecipheriv, scrypt } = await import('crypto')
    const { promisify } = await import('util')
    const scryptAsync = promisify(scrypt)

    // 只分割第一个冒号，IV 是32个hex字符
    const colonIndex = encryptedData.indexOf(':')
    if (colonIndex === -1) {
      throw new Error('Invalid encrypted data format')
    }

    const ivHex = encryptedData.slice(0, colonIndex)
    const encrypted = encryptedData.slice(colonIndex + 1)

    if (ivHex.length !== 32 || !encrypted) {
      throw new Error('Invalid encrypted data format')
    }

    const iv = Buffer.from(ivHex, 'hex')
    const key = (await scryptAsync(password, 'mshell-sync-salt', 32)) as Buffer

    try {
      const decipher = createDecipheriv('aes-256-cbc', key, iv)
      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    } catch (error) {
      throw new Error('解密失败，密码可能不正确')
    }
  }

  // ==================== GitHub Gist 同步 ====================

  /**
   * 验证 GitHub Token
   */
  async verifyGitHubToken(
    token: string
  ): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      // 清理 token 中的空白字符
      const cleanToken = token.trim().replace(/[\r\n]/g, '')

      const response = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${cleanToken}`,
          Accept: 'application/vnd.github.v3+json'
        }
      })

      return {
        valid: true,
        username: response.data.login
      }
    } catch (error: any) {
      return {
        valid: false,
        error: error.response?.status === 401 ? 'Token 无效或已过期' : error.message
      }
    }
  }

  /**
   * 查找已存在的 MShell 同步 Gist
   * 用于在新设备上恢复同步
   */
  async findExistingGist(
    token: string
  ): Promise<{ found: boolean; gistId?: string; gistUrl?: string; error?: string }> {
    try {
      const cleanToken = token.trim().replace(/[\r\n]/g, '')

      // 获取用户的所有 Gist
      const response = await axios.get('https://api.github.com/gists', {
        headers: {
          Authorization: `token ${cleanToken}`,
          Accept: 'application/vnd.github.v3+json'
        },
        params: {
          per_page: 100 // 获取最多 100 个 Gist
        }
      })

      // 查找包含 mshell-sync.json 文件的 Gist
      for (const gist of response.data) {
        if (gist.files && gist.files['mshell-sync.json']) {
          console.log('[SyncManager] Found existing MShell Gist:', gist.id)
          return {
            found: true,
            gistId: gist.id,
            gistUrl: gist.html_url
          }
        }
      }

      return { found: false }
    } catch (error: any) {
      console.error('[SyncManager] Error finding existing Gist:', error)
      return {
        found: false,
        error: error.response?.status === 401 ? 'Token 无效或已过期' : error.message
      }
    }
  }

  /**
   * 创建 GitHub Gist
   */
  private async createGist(token: string, content: string): Promise<{ id: string; url: string }> {
    const response = await axios.post(
      'https://api.github.com/gists',
      {
        description: 'MShell Sync Data - DO NOT DELETE',
        public: false,
        files: {
          'mshell-sync.json': {
            content: content
          }
        }
      },
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    )

    return {
      id: response.data.id,
      url: response.data.html_url
    }
  }

  /**
   * 更新 GitHub Gist
   */
  private async updateGist(token: string, gistId: string, content: string): Promise<void> {
    await axios.patch(
      `https://api.github.com/gists/${gistId}`,
      {
        files: {
          'mshell-sync.json': {
            content: content
          }
        }
      },
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    )
  }

  /**
   * 获取 GitHub Gist 内容
   */
  private async getGist(
    token: string,
    gistId: string
  ): Promise<{ content: string; updatedAt: string } | null> {
    try {
      const response = await axios.get(`https://api.github.com/gists/${gistId}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json'
        }
      })

      const file = response.data.files['mshell-sync.json']
      if (!file) {
        return null
      }

      return {
        content: file.content,
        updatedAt: response.data.updated_at
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  // ==================== GitLab Snippet 同步 ====================

  /**
   * 获取 GitLab API 基础 URL
   */
  private getGitLabApiUrl(): string {
    return this.config.gitlab?.instanceUrl || 'https://gitlab.com'
  }

  /**
   * 验证 GitLab Token
   */
  async verifyGitLabToken(
    token: string,
    instanceUrl?: string
  ): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      // 清理 token 中的空白字符
      const cleanToken = token.trim().replace(/[\r\n]/g, '')
      const baseUrl = (instanceUrl || 'https://gitlab.com').trim()

      const response = await axios.get(`${baseUrl}/api/v4/user`, {
        headers: {
          'PRIVATE-TOKEN': cleanToken
        }
      })

      return {
        valid: true,
        username: response.data.username
      }
    } catch (error: any) {
      return {
        valid: false,
        error: error.response?.status === 401 ? 'Token 无效或已过期' : error.message
      }
    }
  }

  /**
   * 查找已存在的 MShell 同步 Snippet
   * 用于在新设备上恢复同步
   */
  async findExistingSnippet(
    token: string,
    instanceUrl?: string
  ): Promise<{ found: boolean; snippetId?: string; snippetUrl?: string; error?: string }> {
    try {
      const cleanToken = token.trim().replace(/[\r\n]/g, '')
      const baseUrl = (instanceUrl || 'https://gitlab.com').trim()

      // 获取用户的所有 Snippet
      const response = await axios.get(`${baseUrl}/api/v4/snippets`, {
        headers: {
          'PRIVATE-TOKEN': cleanToken
        },
        params: {
          per_page: 100
        }
      })

      // 查找包含 mshell-sync.json 文件的 Snippet
      for (const snippet of response.data) {
        // 检查标题或文件名
        if (
          snippet.title?.includes('MShell Sync Data') ||
          snippet.files?.some((f: any) => f.path === 'mshell-sync.json')
        ) {
          console.log('[SyncManager] Found existing MShell Snippet:', snippet.id)
          return {
            found: true,
            snippetId: String(snippet.id),
            snippetUrl: snippet.web_url
          }
        }
      }

      return { found: false }
    } catch (error: any) {
      console.error('[SyncManager] Error finding existing Snippet:', error)
      return {
        found: false,
        error: error.response?.status === 401 ? 'Token 无效或已过期' : error.message
      }
    }
  }

  /**
   * 创建 GitLab Snippet
   */
  private async createSnippet(
    token: string,
    content: string
  ): Promise<{ id: number; url: string }> {
    const baseUrl = this.getGitLabApiUrl()
    const response = await axios.post(
      `${baseUrl}/api/v4/snippets`,
      {
        title: 'MShell Sync Data - DO NOT DELETE',
        description: 'MShell 同步数据，请勿删除',
        visibility: 'private',
        files: [
          {
            file_path: 'mshell-sync.json',
            content: content
          }
        ]
      },
      {
        headers: {
          'PRIVATE-TOKEN': token,
          'Content-Type': 'application/json'
        }
      }
    )

    return {
      id: response.data.id,
      url: response.data.web_url
    }
  }

  /**
   * 更新 GitLab Snippet
   */
  private async updateSnippet(token: string, snippetId: string, content: string): Promise<void> {
    const baseUrl = this.getGitLabApiUrl()
    await axios.put(
      `${baseUrl}/api/v4/snippets/${snippetId}`,
      {
        files: [
          {
            action: 'update',
            file_path: 'mshell-sync.json',
            content: content
          }
        ]
      },
      {
        headers: {
          'PRIVATE-TOKEN': token,
          'Content-Type': 'application/json'
        }
      }
    )
  }

  /**
   * 获取 GitLab Snippet 内容
   */
  private async getSnippet(
    token: string,
    snippetId: string
  ): Promise<{ content: string; updatedAt: string } | null> {
    try {
      const baseUrl = this.getGitLabApiUrl()

      // 获取 snippet 元数据
      const metaResponse = await axios.get(`${baseUrl}/api/v4/snippets/${snippetId}`, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      })

      // 获取 snippet 原始内容
      const rawResponse = await axios.get(`${baseUrl}/api/v4/snippets/${snippetId}/raw`, {
        headers: {
          'PRIVATE-TOKEN': token
        }
      })

      return {
        content:
          typeof rawResponse.data === 'string'
            ? rawResponse.data
            : JSON.stringify(rawResponse.data),
        updatedAt: metaResponse.data.updated_at
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  /**
   * 上传到 GitLab Snippet
   */
  async uploadToGitLab(): Promise<SyncResult> {
    if (!this.config.gitlab?.token) {
      return { success: false, message: '未配置 GitLab Token' }
    }

    const encryptionPassword = this.getEncryptionPassword()
    if (!encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集数据
      const backupData = await this.collectSyncData()
      const jsonData = JSON.stringify(backupData)

      // 加密数据
      const encryptedData = await this.encryptData(jsonData, encryptionPassword)

      // 构建同步数据
      const syncData: SyncData = {
        version: '1.0.0',
        appVersion: app.getVersion(),
        lastModified: new Date().toISOString(),
        checksum: this.calculateBackupChecksum(backupData),
        encrypted: true,
        data: encryptedData
      }

      const content = JSON.stringify(syncData, null, 2)

      // 上传到 Snippet
      if (this.config.gitlab.snippetId) {
        // 更新现有 Snippet
        await this.updateSnippet(this.config.gitlab.token, this.config.gitlab.snippetId, content)
      } else {
        // 创建新 Snippet
        const result = await this.createSnippet(this.config.gitlab.token, content)
        this.config.gitlab.snippetId = String(result.id)
        this.config.gitlab.snippetUrl = result.url
        await this.saveConfig()
      }

      // 更新同步状态
      this.config.lastSync = new Date().toISOString()
      this.config.lastSyncChecksum = syncData.checksum
      await this.saveConfig()

      return {
        success: true,
        action: 'uploaded',
        message: '数据已上传到 GitLab',
        localTime: syncData.lastModified
      }
    } catch (error: any) {
      logger.logError('system', 'Failed to upload to GitLab', error)
      return {
        success: false,
        message: error.response?.data?.message || error.message || '上传失败'
      }
    }
  }

  /**
   * 从 GitLab Snippet 下载
   */
  async downloadFromGitLab(): Promise<SyncResult> {
    if (!this.config.gitlab?.token) {
      return { success: false, message: '未配置 GitLab Token' }
    }

    if (!this.config.gitlab.snippetId) {
      return { success: false, message: '未找到同步数据，请先上传' }
    }

    const encryptionPassword = this.getEncryptionPassword()
    if (!encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 获取 Snippet 内容
      const snippet = await this.getSnippet(this.config.gitlab.token, this.config.gitlab.snippetId)
      if (!snippet) {
        return { success: false, message: 'Snippet 不存在或已被删除' }
      }

      // 解析同步数据
      const syncData: SyncData = JSON.parse(snippet.content)

      // 解密数据
      let jsonData: string
      if (syncData.encrypted) {
        jsonData = await this.decryptData(syncData.data, encryptionPassword)
      } else {
        jsonData = syncData.data
      }

      // 解析备份数据
      const backupData: BackupData = JSON.parse(jsonData)

      // 应用数据
      await backupManager.applyBackup(backupData, {
        restoreSessions: true,
        restoreSnippets: true,
        restoreSettings: true,
        restoreBackupConfig: false,
        restoreSyncConfig: false,
        restoreCommandHistory: true,
        restoreSSHKeys: true, // 恢复 SSH 密钥（包含私钥）
        restorePortForwards: true,
        restoreSessionTemplates: true,
        restoreScheduledTasks: true,
        restoreWorkflows: true,
        restoreAIConfig: true, // 恢复 AI 配置
        restoreAIChatHistory: true, // 恢复 AI 聊天历史（全局 + 终端）
        restoreConnectionStats: true,
        restoreAuditLogs: true,
        restoreTransferRecords: true,
        restoreLockConfig: true,
        restoreQuickCommands: true, // 恢复快捷命令
        restoreLazyScripts: true // 恢复懒人脚本
      })

      // 更新同步状态
      this.config.lastSync = new Date().toISOString()
      this.config.lastSyncChecksum = syncData.checksum
      await this.saveConfig()

      return {
        success: true,
        action: 'downloaded',
        message: '数据已从 GitLab 下载并应用',
        remoteTime: syncData.lastModified
      }
    } catch (error: any) {
      logger.logError('system', 'Failed to download from GitLab', error)

      if (error.message?.includes('解密失败') || error.message?.includes('decipher')) {
        return { success: false, message: '解密失败，密码可能不正确' }
      }

      return {
        success: false,
        message: error.message || '下载失败'
      }
    }
  }

  /**
   * GitLab 智能同步
   */
  private async syncWithGitLab(): Promise<SyncResult> {
    if (!this.config.gitlab?.token) {
      return { success: false, message: '未配置 GitLab Token' }
    }

    if (!this.getEncryptionPassword()) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集本地数据
      const localData = await this.collectSyncData()
      const localChecksum = this.calculateBackupChecksum(localData)

      // 如果没有 Snippet，直接上传
      if (!this.config.gitlab.snippetId) {
        return await this.uploadToGitLab()
      }

      // 获取远程数据
      const snippet = await this.getSnippet(this.config.gitlab.token, this.config.gitlab.snippetId)
      if (!snippet) {
        // Snippet 被删除，重新创建
        this.config.gitlab.snippetId = undefined
        await this.saveConfig()
        return await this.uploadToGitLab()
      }

      const remoteSyncData: SyncData = JSON.parse(snippet.content)

      // 比较校验和
      if (localChecksum === remoteSyncData.checksum) {
        return {
          success: true,
          action: 'no-change',
          message: '数据已是最新，无需同步'
        }
      }

      const localChanged = this.config.lastSyncChecksum !== localChecksum
      const remoteChanged = this.config.lastSyncChecksum !== remoteSyncData.checksum

      if (localChanged && !remoteChanged) {
        return await this.uploadToGitLab()
      } else if (!localChanged && remoteChanged) {
        return await this.downloadFromGitLab()
      } else if (localChanged && remoteChanged) {
        return {
          success: true,
          action: 'conflict',
          message: '本地和云端数据都已变化，请手动选择上传或下载'
        }
      }

      return { success: true, action: 'no-change', message: '数据已是最新，无需同步' }
    } catch (error: any) {
      logger.logError('system', 'GitLab sync failed', error)
      return {
        success: false,
        message: error.message || '同步失败'
      }
    }
  }

  /**
   * 断开 GitLab 连接
   */
  async disconnectGitLab(): Promise<void> {
    this.config.gitlab = undefined
    if (this.config.provider === 'gitlab') {
      this.config.enabled = false
      if (this.config.github) {
        this.config.provider = 'github'
      }
    }
    if (!this.config.github) {
      this.config.encryptionPassword = undefined
      this.runtimeEncryptionPassword = undefined
    }
    this.config.lastSync = undefined
    this.config.lastSyncChecksum = undefined
    await this.saveConfig()
    this.stopAutoSync()
  }

  /**
   * 上传到 GitHub Gist
   */
  async uploadToGitHub(): Promise<SyncResult> {
    if (!this.config.github?.token) {
      return { success: false, message: '未配置 GitHub Token' }
    }

    const encryptionPassword = this.getEncryptionPassword()
    if (!encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集数据
      const backupData = await this.collectSyncData()
      const jsonData = JSON.stringify(backupData)

      // 加密数据
      const encryptedData = await this.encryptData(jsonData, encryptionPassword)

      // 构建同步数据
      const syncData: SyncData = {
        version: '1.0.0',
        appVersion: app.getVersion(),
        lastModified: new Date().toISOString(),
        checksum: this.calculateBackupChecksum(backupData),
        encrypted: true,
        data: encryptedData
      }

      const content = JSON.stringify(syncData, null, 2)

      // 上传到 Gist
      if (this.config.github.gistId) {
        // 更新现有 Gist
        await this.updateGist(this.config.github.token, this.config.github.gistId, content)
      } else {
        // 创建新 Gist
        const result = await this.createGist(this.config.github.token, content)
        this.config.github.gistId = result.id
        this.config.github.gistUrl = result.url
        await this.saveConfig()
      }

      // 更新同步状态
      this.config.lastSync = new Date().toISOString()
      this.config.lastSyncChecksum = syncData.checksum
      await this.saveConfig()

      return {
        success: true,
        action: 'uploaded',
        message: '数据已上传到 GitHub',
        localTime: syncData.lastModified
      }
    } catch (error: any) {
      logger.logError('system', 'Failed to upload to GitHub', error)
      return {
        success: false,
        message: error.response?.data?.message || error.message || '上传失败'
      }
    }
  }

  /**
   * 从 GitHub Gist 下载
   */
  async downloadFromGitHub(): Promise<SyncResult> {
    if (!this.config.github?.token) {
      return { success: false, message: '未配置 GitHub Token' }
    }

    if (!this.config.github.gistId) {
      return { success: false, message: '未找到同步数据，请先上传' }
    }

    const encryptionPassword = this.getEncryptionPassword()
    if (!encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 获取 Gist 内容
      const gist = await this.getGist(this.config.github.token, this.config.github.gistId)
      if (!gist) {
        return { success: false, message: 'Gist 不存在或已被删除' }
      }

      // 解析同步数据
      const syncData: SyncData = JSON.parse(gist.content)

      // 解密数据
      let jsonData: string
      if (syncData.encrypted) {
        jsonData = await this.decryptData(syncData.data, encryptionPassword)
      } else {
        jsonData = syncData.data
      }

      // 解析备份数据
      const backupData: BackupData = JSON.parse(jsonData)

      // 应用数据
      await backupManager.applyBackup(backupData, {
        restoreSessions: true,
        restoreSnippets: true,
        restoreSettings: true,
        restoreBackupConfig: false,
        restoreSyncConfig: false,
        restoreCommandHistory: true,
        restoreSSHKeys: true, // 恢复 SSH 密钥（包含私钥）
        restorePortForwards: true,
        restoreSessionTemplates: true,
        restoreScheduledTasks: true,
        restoreWorkflows: true,
        restoreAIConfig: true, // 恢复 AI 配置
        restoreAIChatHistory: true, // 恢复 AI 聊天历史（全局 + 终端）
        restoreConnectionStats: true,
        restoreAuditLogs: true,
        restoreTransferRecords: true,
        restoreLockConfig: true,
        restoreQuickCommands: true, // 恢复快捷命令
        restoreLazyScripts: true // 恢复懒人脚本
      })

      // 更新同步状态
      this.config.lastSync = new Date().toISOString()
      this.config.lastSyncChecksum = syncData.checksum
      await this.saveConfig()

      return {
        success: true,
        action: 'downloaded',
        message: '数据已从 GitHub 下载并应用',
        remoteTime: syncData.lastModified
      }
    } catch (error: any) {
      logger.logError('system', 'Failed to download from GitHub', error)

      if (error.message?.includes('解密失败') || error.message?.includes('decipher')) {
        return { success: false, message: '解密失败，密码可能不正确' }
      }

      return {
        success: false,
        message: error.message || '下载失败'
      }
    }
  }

  /**
   * 智能同步 - 自动判断上传或下载
   */
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: false, message: '同步正在进行中' }
    }

    if (!this.config.enabled) {
      return { success: false, message: '同步未启用' }
    }

    this.isSyncing = true

    try {
      if (this.config.provider === 'github') {
        return await this.syncWithGitHub()
      } else if (this.config.provider === 'gitlab') {
        return await this.syncWithGitLab()
      }

      return { success: false, message: '不支持的同步方式' }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * GitHub 智能同步
   */
  private async syncWithGitHub(): Promise<SyncResult> {
    if (!this.config.github?.token) {
      return { success: false, message: '未配置 GitHub Token' }
    }

    if (!this.getEncryptionPassword()) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集本地数据
      const localData = await this.collectSyncData()
      const localChecksum = this.calculateBackupChecksum(localData)

      // 如果没有 Gist，直接上传
      if (!this.config.github.gistId) {
        return await this.uploadToGitHub()
      }

      // 获取远程数据
      const gist = await this.getGist(this.config.github.token, this.config.github.gistId)
      if (!gist) {
        // Gist 被删除，重新创建
        this.config.github.gistId = undefined
        await this.saveConfig()
        return await this.uploadToGitHub()
      }

      const remoteSyncData: SyncData = JSON.parse(gist.content)

      // 比较校验和
      if (localChecksum === remoteSyncData.checksum) {
        return {
          success: true,
          action: 'no-change',
          message: '数据已是最新，无需同步'
        }
      }

      const localChanged = this.config.lastSyncChecksum !== localChecksum
      const remoteChanged = this.config.lastSyncChecksum !== remoteSyncData.checksum

      if (localChanged && !remoteChanged) {
        return await this.uploadToGitHub()
      } else if (!localChanged && remoteChanged) {
        return await this.downloadFromGitHub()
      } else if (localChanged && remoteChanged) {
        return {
          success: true,
          action: 'conflict',
          message: '本地和云端数据都已变化，请手动选择上传或下载'
        }
      }

      return { success: true, action: 'no-change', message: '数据已是最新，无需同步' }
    } catch (error: any) {
      logger.logError('system', 'Sync failed', error)
      return {
        success: false,
        message: error.message || '同步失败'
      }
    }
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus(): Promise<{
    enabled: boolean
    provider: string
    lastSync?: string
    gistUrl?: string
    hasRemoteData: boolean
  }> {
    let hasRemoteData = false

    if (
      this.config.provider === 'github' &&
      this.config.github?.token &&
      this.config.github?.gistId
    ) {
      try {
        const gist = await this.getGist(this.config.github.token, this.config.github.gistId)
        hasRemoteData = !!gist
      } catch {
        hasRemoteData = false
      }
    }

    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      lastSync: this.config.lastSync,
      gistUrl: this.config.github?.gistUrl,
      hasRemoteData
    }
  }

  /**
   * 断开 GitHub 连接
   */
  async disconnectGitHub(): Promise<void> {
    this.config.github = undefined
    this.config.enabled = false
    if (this.config.gitlab) {
      this.config.provider = 'gitlab'
    }
    if (!this.config.gitlab) {
      this.config.encryptionPassword = undefined
      this.runtimeEncryptionPassword = undefined
    }
    this.config.lastSync = undefined
    this.config.lastSyncChecksum = undefined
    await this.saveConfig()
    this.stopAutoSync()
  }

  /**
   * 启动自动同步
   */
  private startAutoSync(): void {
    if (this.timer) {
      return
    }

    const intervalMs = this.config.syncInterval * 60 * 1000

    this.timer = setInterval(async () => {
      console.log('[SyncManager] Running auto sync...')
      const result = await this.sync()
      console.log('[SyncManager] Auto sync result:', result.message)
    }, intervalMs)

    console.log(
      `[SyncManager] Auto sync started with interval: ${this.config.syncInterval} minutes`
    )
  }

  /**
   * 停止自动同步
   */
  private stopAutoSync(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[SyncManager] Auto sync stopped')
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stopAutoSync()
  }
}

// 单例导出
export const syncManager = new SyncManager()
