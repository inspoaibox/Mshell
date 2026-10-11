/* global Buffer, NodeJS */

import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { backupManager, BackupData } from './BackupManager'
import { logger } from '../utils/logger'
import { credentialManager } from './CredentialManager'
import { isLocalTerminalBackground } from '../../src/types/terminal-background'
import {
  DESKTOP_SYNC_SCHEMA,
  SYNC_FORMAT_VERSION,
  formatMergeSummary,
  isLegacyMobileEnvelope,
  mergeSnapshot,
  scopeLegacyMobileRemote,
  type MassDeleteWarning,
  type SyncConflict
} from '../../src/lib/sync/merge'
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
  /** 2 = 支持逐条合并的新版客户端写入 */
  syncFormat?: number
  lastModified: string
  checksum: string
  encrypted: boolean
  data: string // 加密后的 JSON 字符串或明文
}

const GITHUB_GIST_RAW_TIMEOUT_MS = 5 * 60 * 1000
const GITHUB_GIST_RAW_MAX_BYTES = 32 * 1024 * 1024
const GITHUB_GIST_RAW_CHUNK_BYTES = 1024 * 1024

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean
  action?: 'uploaded' | 'downloaded' | 'merged' | 'no-change' | 'needs-confirm'
  message: string
  localTime?: string
  remoteTime?: string
  /** 合并同步的条数统计 */
  summary?: { uploaded: number; downloaded: number; deleted: number }
  /** 两边都修改过的记录（已按修改时间较新的一方保留） */
  conflicts?: SyncConflict[]
  /** action 为 needs-confirm 时，将被大量删除的数据类别 */
  massDeletes?: MassDeleteWarning[]
}

export interface SyncOptions {
  /** 确认允许删除本地大量数据 */
  allowMassDelete?: boolean
}

type RemoteSyncProvider = 'github' | 'gitlab'

/** 合并期间云端被其它设备改写时的最大重试次数 */
const MERGE_SYNC_MAX_ATTEMPTS = 3

const FULL_RESTORE_OPTIONS: Parameters<typeof backupManager.applyBackup>[1] = {
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
  restoreAIConfig: true,
  restoreAIChatHistory: true, // 全局 + 终端
  restoreConnectionStats: true,
  restoreAuditLogs: true,
  restoreTransferRecords: true,
  restoreLockConfig: true,
  restoreQuickCommands: true,
  restoreLazyScripts: true
}

const SESSION_SECRET_FIELDS = ['password', 'passphrase']

/**
 * 本地缺失的会话密码（含代理、跳板机）从基准中补回。
 */
const fillMissingSecrets = (target: any, source: any): void => {
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return
  for (const field of SESSION_SECRET_FIELDS) {
    if ((target[field] === undefined || target[field] === null || target[field] === '') && source[field]) {
      target[field] = source[field]
    }
  }
  for (const nested of ['proxy', 'proxyJump', 'nextJump']) {
    if (target[nested] && source[nested]) fillMissingSecrets(target[nested], source[nested])
  }
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
    const data = this.stripLocalTerminalBackgrounds(await backupManager.collectBackupData())
    // MCP 接入的端口、令牌和权限模式是本机配置，不上传
    if (data.settings && typeof data.settings === 'object') {
      delete data.settings.agentMcp
    }
    return data
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

      let content: string
      if (file.truncated) {
        if (typeof file.raw_url !== 'string' || !file.raw_url) {
          throw new Error('GitHub Gist 同步文件内容被截断，且未提供完整文件地址')
        }

        // GitHub only embeds part of a large Gist file in the API response.
        // Read the raw file in bounded ranges so a slow connection does not
        // have to keep one compressed stream open for the entire payload.
        content = await this.downloadRawGistContent(file.raw_url)
      } else if (typeof file.content === 'string') {
        content = file.content
      } else {
        throw new Error('GitHub Gist 同步文件内容缺失')
      }

      return {
        content,
        updatedAt: response.data.updated_at
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  private async downloadRawGistContent(rawUrl: string): Promise<string> {
    const firstResponse = await this.requestRawGistRange(
      rawUrl,
      0,
      GITHUB_GIST_RAW_CHUNK_BYTES - 1
    )
    const firstBuffer = this.toBuffer(firstResponse.data)
    const firstRange = this.parseContentRange(firstResponse.headers?.['content-range'])

    // Small files or endpoints that do not honor Range can still be consumed
    // as one response.
    if (firstResponse.status !== 206 || !firstRange) {
      if (firstBuffer.length > GITHUB_GIST_RAW_MAX_BYTES) {
        throw new Error('GitHub Gist 同步文件超过 32 MB，无法下载')
      }
      return firstBuffer.toString('utf8')
    }

    if (
      firstRange.start !== 0 ||
      firstRange.end < firstRange.start ||
      firstRange.total <= firstRange.end ||
      firstRange.total > GITHUB_GIST_RAW_MAX_BYTES ||
      firstBuffer.length !== firstRange.end - firstRange.start + 1
    ) {
      throw new Error('GitHub Gist 分段响应范围不正确')
    }

    const chunks = [firstBuffer]
    let nextStart = firstRange.end + 1
    while (nextStart < firstRange.total) {
      const nextEnd = Math.min(nextStart + GITHUB_GIST_RAW_CHUNK_BYTES - 1, firstRange.total - 1)
      const response = await this.requestRawGistRange(rawUrl, nextStart, nextEnd)
      const range = this.parseContentRange(response.headers?.['content-range'])
      const chunk = this.toBuffer(response.data)

      if (
        response.status !== 206 ||
        !range ||
        range.start !== nextStart ||
        range.end !== nextEnd ||
        chunk.length !== nextEnd - nextStart + 1
      ) {
        throw new Error('GitHub Gist 分段响应范围不正确')
      }

      chunks.push(chunk)
      nextStart = nextEnd + 1
    }

    return Buffer.concat(chunks).toString('utf8')
  }

  private async requestRawGistRange(rawUrl: string, start: number, end: number): Promise<any> {
    return axios.get(rawUrl, {
      headers: {
        Accept: 'text/plain',
        // Avoid the gzip decompression stream that can be aborted by proxies.
        'Accept-Encoding': 'identity',
        Range: `bytes=${start}-${end}`
      },
      responseType: 'arraybuffer',
      timeout: GITHUB_GIST_RAW_TIMEOUT_MS,
      maxContentLength: GITHUB_GIST_RAW_MAX_BYTES,
      maxBodyLength: GITHUB_GIST_RAW_MAX_BYTES
    })
  }

  private parseContentRange(value: unknown): { start: number; end: number; total: number } | undefined {
    const match = String(value || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/)
    if (!match) {
      return undefined
    }

    return {
      start: Number(match[1]),
      end: Number(match[2]),
      total: Number(match[3])
    }
  }

  private toBuffer(data: unknown): Buffer {
    if (Buffer.isBuffer(data)) {
      return data
    }
    if (typeof data === 'string') {
      return Buffer.from(data, 'utf8')
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data)
    }
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    }
    throw new Error('GitHub Gist 完整文件响应格式不正确')
  }

  private isInterruptedRemoteDownload(error: any): boolean {
    const message = String(error?.message || '').toLowerCase()
    const code = String(error?.code || '').toUpperCase()

    return (
      message === 'aborted' ||
      message.includes('socket hang up') ||
      message.includes('premature close') ||
      code === 'ECONNRESET' ||
      code === 'ERR_STREAM_PREMATURE_CLOSE' ||
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT'
    )
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

  // ==================== 云端读写（GitHub / GitLab 共用） ====================

  private providerLabel(provider: RemoteSyncProvider): string {
    return provider === 'github' ? 'GitHub' : 'GitLab'
  }

  private getProviderToken(provider: RemoteSyncProvider): string | undefined {
    return provider === 'github' ? this.config.github?.token : this.config.gitlab?.token
  }

  private getRemoteId(provider: RemoteSyncProvider): string | undefined {
    return provider === 'github' ? this.config.github?.gistId : this.config.gitlab?.snippetId
  }

  private async forgetRemote(provider: RemoteSyncProvider): Promise<void> {
    if (provider === 'github' && this.config.github) {
      this.config.github.gistId = undefined
      this.config.github.gistUrl = undefined
    } else if (provider === 'gitlab' && this.config.gitlab) {
      this.config.gitlab.snippetId = undefined
      this.config.gitlab.snippetUrl = undefined
    }
    await this.saveConfig()
  }

  private async readRemote(
    provider: RemoteSyncProvider
  ): Promise<{ content: string; updatedAt: string } | null> {
    const token = this.getProviderToken(provider)
    const remoteId = this.getRemoteId(provider)
    if (!token || !remoteId) return null
    return provider === 'github'
      ? await this.getGist(token, remoteId)
      : await this.getSnippet(token, remoteId)
  }

  /**
   * 只读取云端文件的更新时间，用于上传前检查期间是否有其它设备写入。
   */
  private async readRemoteUpdatedAt(provider: RemoteSyncProvider): Promise<string | null> {
    const token = this.getProviderToken(provider)
    const remoteId = this.getRemoteId(provider)
    if (!token || !remoteId) return null

    try {
      if (provider === 'github') {
        const response = await axios.get(`https://api.github.com/gists/${remoteId}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json'
          }
        })
        return response.data?.updated_at ?? null
      }

      const response = await axios.get(`${this.getGitLabApiUrl()}/api/v4/snippets/${remoteId}`, {
        headers: { 'PRIVATE-TOKEN': token }
      })
      return response.data?.updated_at ?? null
    } catch (error: any) {
      if (error.response?.status === 404) return null
      throw error
    }
  }

  private async writeRemote(provider: RemoteSyncProvider, content: string): Promise<void> {
    if (provider === 'github') {
      const github = this.config.github!
      if (github.gistId) {
        await this.updateGist(github.token, github.gistId, content)
      } else {
        const result = await this.createGist(github.token, content)
        github.gistId = result.id
        github.gistUrl = result.url
        await this.saveConfig()
      }
      return
    }

    const gitlab = this.config.gitlab!
    if (gitlab.snippetId) {
      await this.updateSnippet(gitlab.token, gitlab.snippetId, content)
    } else {
      const result = await this.createSnippet(gitlab.token, content)
      gitlab.snippetId = String(result.id)
      gitlab.snippetUrl = result.url
      await this.saveConfig()
    }
  }

  private async decodeRemote(
    content: string,
    password: string
  ): Promise<{ envelope: SyncData; data: BackupData }> {
    const envelope: SyncData = JSON.parse(content)
    const jsonData = envelope.encrypted
      ? await this.decryptData(envelope.data, password)
      : envelope.data
    return { envelope, data: JSON.parse(jsonData) as BackupData }
  }

  /**
   * 上传数据，并把它记为下次合并的基准。
   */
  private async uploadData(
    provider: RemoteSyncProvider,
    data: BackupData,
    password: string
  ): Promise<SyncData> {
    const syncData: SyncData = {
      version: '1.0.0',
      appVersion: app.getVersion(),
      syncFormat: SYNC_FORMAT_VERSION,
      lastModified: new Date().toISOString(),
      checksum: this.calculateBackupChecksum(data),
      encrypted: true,
      data: await this.encryptData(JSON.stringify(data), password)
    }

    await this.writeRemote(provider, JSON.stringify(syncData, null, 2))
    await this.saveBase(provider, data, password)

    this.config.lastSync = new Date().toISOString()
    this.config.lastSyncChecksum = syncData.checksum
    await this.saveConfig()
    return syncData
  }

  // ==================== 合并基准（上次同步结果） ====================

  private getBasePath(provider: RemoteSyncProvider): string {
    return join(app.getPath('userData'), `sync-base-${provider}.enc`)
  }

  /**
   * 读取上次同步结果。文件不存在或无法解密（例如更换了同步密码）时返回 undefined，
   * 按“首次合并”处理。
   */
  private async loadBase(
    provider: RemoteSyncProvider,
    password: string
  ): Promise<BackupData | undefined> {
    try {
      const encrypted = await fs.readFile(this.getBasePath(provider), 'utf-8')
      return JSON.parse(await this.decryptData(encrypted.trim(), password)) as BackupData
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.logError('system', 'Failed to load sync base snapshot', error as Error)
      }
      return undefined
    }
  }

  private async saveBase(
    provider: RemoteSyncProvider,
    data: BackupData,
    password: string
  ): Promise<void> {
    const normalized = this.normalizeForMerge(data)
    const encrypted = await this.encryptData(JSON.stringify(normalized), password)
    await fs.writeFile(this.getBasePath(provider), encrypted, { encoding: 'utf-8', mode: 0o600 })
  }

  private async deleteBase(provider: RemoteSyncProvider): Promise<void> {
    try {
      await fs.rm(this.getBasePath(provider), { force: true })
    } catch (error) {
      logger.logError('system', 'Failed to delete sync base snapshot', error as Error)
    }
  }

  /**
   * 合并前统一数据形态：
   * - 去掉本机 MCP 接入配置（不参与同步）；
   * - 去掉 AI 渠道的 updatedAt（每次保存 AI 配置都会刷新，不代表内容变化）；
   * - 不保存密码时，本地会话缺失的密码从基准补回，避免被当成“本地删除了密码”。
   */
  private normalizeForMerge(data: BackupData, base?: BackupData): BackupData {
    const normalized = JSON.parse(JSON.stringify(data ?? {})) as BackupData

    if (normalized.settings && typeof normalized.settings === 'object') {
      delete normalized.settings.agentMcp
    }

    if (Array.isArray(normalized.aiConfig?.channels)) {
      for (const channel of normalized.aiConfig.channels) {
        if (channel && typeof channel === 'object') delete channel.updatedAt
      }
    }

    if (
      base &&
      Array.isArray(normalized.sessions) &&
      Array.isArray(base.sessions) &&
      normalized.settings?.security?.savePasswords === false
    ) {
      const baseSessions = new Map(base.sessions.map((session: any) => [session?.id, session]))
      for (const session of normalized.sessions) {
        const baseSession = baseSessions.get(session?.id)
        if (baseSession) fillMissingSecrets(session, baseSession)
      }
    }

    return normalized
  }

  private stripLocalOnlySettings(data: BackupData): BackupData {
    const copy = { ...data }
    if (copy.settings && typeof copy.settings === 'object') {
      copy.settings = { ...copy.settings }
      delete copy.settings.agentMcp
    }
    return copy
  }

  // ==================== 上传 / 下载（强制，不合并） ====================

  private checkProviderReady(provider: RemoteSyncProvider): SyncResult | string {
    if (!this.getProviderToken(provider)) {
      return { success: false, message: `未配置 ${this.providerLabel(provider)} Token` }
    }
    const password = this.getEncryptionPassword()
    if (!password) {
      return { success: false, message: '未设置同步加密密码' }
    }
    return password
  }

  private async forceUpload(provider: RemoteSyncProvider): Promise<SyncResult> {
    const ready = this.checkProviderReady(provider)
    if (typeof ready !== 'string') return ready

    try {
      const syncData = await this.uploadData(provider, await this.collectSyncData(), ready)
      return {
        success: true,
        action: 'uploaded',
        message: `数据已上传到 ${this.providerLabel(provider)}（覆盖云端）`,
        localTime: syncData.lastModified
      }
    } catch (error: any) {
      logger.logError('system', `Failed to upload to ${this.providerLabel(provider)}`, error)
      return {
        success: false,
        message: error.response?.data?.message || error.message || '上传失败'
      }
    }
  }

  private async forceDownload(provider: RemoteSyncProvider): Promise<SyncResult> {
    const ready = this.checkProviderReady(provider)
    if (typeof ready !== 'string') return ready

    if (!this.getRemoteId(provider)) {
      return { success: false, message: '未找到同步数据，请先上传' }
    }

    try {
      const remote = await this.readRemote(provider)
      if (!remote) {
        return {
          success: false,
          message: provider === 'github' ? 'Gist 不存在或已被删除' : 'Snippet 不存在或已被删除'
        }
      }

      const { envelope, data } = await this.decodeRemote(remote.content, ready)
      const remoteData = isLegacyMobileEnvelope(envelope)
        ? (scopeLegacyMobileRemote(data, await this.loadBase(provider, ready)) as BackupData)
        : data

      await backupManager.applyBackup(this.stripLocalOnlySettings(remoteData), FULL_RESTORE_OPTIONS)

      // 下载只新增/覆盖、不删除本地数据；以云端内容作为基准，
      // 本地独有的数据会在下次智能同步时作为新增上传。
      await this.saveBase(provider, remoteData, ready)

      this.config.lastSync = new Date().toISOString()
      this.config.lastSyncChecksum = envelope.checksum
      await this.saveConfig()

      return {
        success: true,
        action: 'downloaded',
        message: `数据已从 ${this.providerLabel(provider)} 下载并应用`,
        remoteTime: envelope.lastModified
      }
    } catch (error: any) {
      logger.logError('system', `Failed to download from ${this.providerLabel(provider)}`, error)

      if (error.message?.includes('解密失败') || error.message?.includes('decipher')) {
        return { success: false, message: '解密失败，密码可能不正确' }
      }

      if (this.isInterruptedRemoteDownload(error)) {
        return {
          success: false,
          message: `${this.providerLabel(provider)} 大文件下载连接中断，请检查网络后重试`
        }
      }

      return {
        success: false,
        message: error.message || '下载失败'
      }
    }
  }

  /**
   * 上传到 GitLab Snippet（覆盖云端）
   */
  async uploadToGitLab(): Promise<SyncResult> {
    return this.forceUpload('gitlab')
  }

  /**
   * 从 GitLab Snippet 下载（新增/覆盖本地，不删除）
   */
  async downloadFromGitLab(): Promise<SyncResult> {
    return this.forceDownload('gitlab')
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
    await this.deleteBase('gitlab')
    this.stopAutoSync()
  }

  /**
   * 上传到 GitHub Gist（覆盖云端）
   */
  async uploadToGitHub(): Promise<SyncResult> {
    return this.forceUpload('github')
  }

  /**
   * 从 GitHub Gist 下载（新增/覆盖本地，不删除）
   */
  async downloadFromGitHub(): Promise<SyncResult> {
    return this.forceDownload('github')
  }

  /**
   * 智能同步 - 与云端逐条合并
   */
  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: false, message: '同步正在进行中' }
    }

    if (!this.config.enabled) {
      return { success: false, message: '同步未启用' }
    }

    this.isSyncing = true

    try {
      if (this.config.provider === 'github' || this.config.provider === 'gitlab') {
        return await this.mergeSync(this.config.provider, options)
      }

      return { success: false, message: '不支持的同步方式' }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 三方合并同步：本地、云端各自的修改都保留，删除也会同步；
   * 同一条记录两边都改时保留 updatedAt 较新的版本，并在结果中列出。
   */
  private async mergeSync(
    provider: RemoteSyncProvider,
    options: SyncOptions
  ): Promise<SyncResult> {
    const ready = this.checkProviderReady(provider)
    if (typeof ready !== 'string') return ready
    const password = ready
    const label = this.providerLabel(provider)

    try {
      for (let attempt = 0; attempt < MERGE_SYNC_MAX_ATTEMPTS; attempt++) {
        const remote = await this.readRemote(provider)
        if (!remote) {
          if (this.getRemoteId(provider)) await this.forgetRemote(provider)
          const syncData = await this.uploadData(provider, await this.collectSyncData(), password)
          return {
            success: true,
            action: 'uploaded',
            message: `云端没有同步数据，已上传本地数据到 ${label}`,
            localTime: syncData.lastModified
          }
        }

        const { envelope, data } = await this.decodeRemote(remote.content, password)
        const base = await this.loadBase(provider, password)
        const remoteData = this.normalizeForMerge(
          isLegacyMobileEnvelope(envelope)
            ? (scopeLegacyMobileRemote(data, base) as BackupData)
            : data
        )

        if (!base) {
          // 首次合并（老版本升级或更换了同步密码）：没有基准无法判断删除，
          // 只把云端数据合并进本地（按名称/ID 匹配，不删除），再上传合集。
          await backupManager.applyBackup(this.stripLocalOnlySettings(remoteData), FULL_RESTORE_OPTIONS)
          const merged = await this.collectSyncData()

          if ((await this.readRemoteUpdatedAt(provider)) !== remote.updatedAt) continue

          const syncData = await this.uploadData(provider, merged, password)
          return {
            success: true,
            action: 'merged',
            message: `首次合并同步完成：已合并 ${label} 上的数据并上传本地数据`,
            localTime: syncData.lastModified,
            remoteTime: envelope.lastModified,
            summary: { uploaded: 0, downloaded: 0, deleted: 0 },
            conflicts: []
          }
        }

        const local = this.normalizeForMerge(await this.collectSyncData(), base)
        const result = mergeSnapshot(
          this.normalizeForMerge(base),
          local,
          remoteData,
          DESKTOP_SYNC_SCHEMA
        )

        if (result.massDeletes.length > 0 && !options.allowMassDelete) {
          return {
            success: true,
            action: 'needs-confirm',
            message: `本次同步将删除本地大量数据：${result.massDeletes
              .map((item) => `${item.label} ${item.deleteCount}/${item.localCount} 条`)
              .join('，')}。请确认后再同步。`,
            summary: result.summary,
            conflicts: result.conflicts,
            massDeletes: result.massDeletes
          }
        }

        if (result.remoteChanged) {
          // 先确认云端没有被其它设备改写，再修改本地，避免基于旧数据合并
          if ((await this.readRemoteUpdatedAt(provider)) !== remote.updatedAt) continue
        }

        await backupManager.applySyncChanges(result.localChanges)

        const merged = result.merged as BackupData
        let localTime: string | undefined
        if (result.remoteChanged) {
          localTime = (await this.uploadData(provider, merged, password)).lastModified
        } else {
          await this.saveBase(provider, merged, password)
          this.config.lastSync = new Date().toISOString()
          this.config.lastSyncChecksum = envelope.checksum
          await this.saveConfig()
        }

        const changed =
          result.remoteChanged || Object.keys(result.localChanges).length > 0
        return {
          success: true,
          action: changed ? 'merged' : 'no-change',
          message: changed ? `合并同步完成：${formatMergeSummary(result)}` : '数据已是最新，无需同步',
          localTime,
          remoteTime: envelope.lastModified,
          summary: result.summary,
          conflicts: result.conflicts
        }
      }

      return {
        success: false,
        message: `${label} 上的数据在同步期间被其它设备多次修改，请稍后重试`
      }
    } catch (error: any) {
      logger.logError('system', `${label} sync failed`, error)

      if (error.message?.includes('解密失败') || error.message?.includes('decipher')) {
        return { success: false, message: '解密失败，密码可能不正确' }
      }

      if (this.isInterruptedRemoteDownload(error)) {
        return {
          success: false,
          message: `${label} 大文件下载连接中断，请检查网络后重试`
        }
      }

      return {
        success: false,
        message: error.response?.data?.message || error.message || '同步失败'
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
    await this.deleteBase('github')
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
