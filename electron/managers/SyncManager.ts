import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { backupManager, BackupData } from './BackupManager'
import { logger } from '../utils/logger'
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
  private configPath: string
  private config: SyncConfig
  private timer: NodeJS.Timeout | null = null
  private isSyncing: boolean = false

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
      this.config = { ...this.config, ...JSON.parse(data) }
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
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
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

  /**
   * 更新配置
   */
  async updateConfig(updates: Partial<SyncConfig>): Promise<void> {
    this.config = { ...this.config, ...updates }
    await this.saveConfig()
    
    // 重启自动同步
    this.stopAutoSync()
    if (this.config.enabled && this.config.autoSync) {
      this.startAutoSync()
    }
  }


  /**
   * 计算数据校验和
   */
  private calculateChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').substring(0, 16)
  }

  /**
   * 收集同步数据
   */
  private async collectSyncData(): Promise<BackupData> {
    // 复用 BackupManager 的数据收集逻辑
    const { sessionManager } = await import('./SessionManager')
    const { snippetManager } = await import('./SnippetManager')
    const { commandHistoryManager } = await import('./CommandHistoryManager')
    const { sshKeyManager } = await import('./SSHKeyManager')
    const { portForwardManager } = await import('./PortForwardManager')
    const { sessionTemplateManager } = await import('./SessionTemplateManager')
    const { taskSchedulerManager } = await import('./TaskSchedulerManager')
    const { workflowManager } = await import('./WorkflowManager')
    const { appSettingsManager } = await import('../utils/app-settings')

    // 收集 AI 配置
    let aiConfig = null
    try {
      const aiConfigPath = join(app.getPath('userData'), 'ai-config.json')
      const data = await fs.readFile(aiConfigPath, 'utf-8')
      aiConfig = JSON.parse(data)
    } catch {
      // AI 配置不存在
    }

    // 收集 AI 全局聊天历史
    let aiChatHistory = undefined
    try {
      const chatHistoryPath = join(app.getPath('userData'), 'ai-chat-history.json')
      const data = await fs.readFile(chatHistoryPath, 'utf-8')
      aiChatHistory = JSON.parse(data)
    } catch {
      // AI 聊天历史不存在
    }

    // 收集终端 AI 聊天历史
    let aiTerminalChatHistory: Record<string, any[]> | undefined = undefined
    try {
      const historyDir = join(app.getPath('userData'), 'ai-terminal-history')
      const files = await fs.readdir(historyDir)
      const history: Record<string, any[]> = {}

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const content = await fs.readFile(join(historyDir, file), 'utf-8')
        history[file] = JSON.parse(content)
      }

      if (Object.keys(history).length > 0) {
        aiTerminalChatHistory = history
      }
    } catch {
      // 终端 AI 聊天历史不存在
    }

    // 收集 SSH 密钥（包含私钥内容）
    const sshKeysWithContent = await this.collectSSHKeysWithPrivateKeys(sshKeyManager)

    return {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      sessions: sessionManager.getAllSessions(),
      sessionGroups: sessionManager.getAllGroups(),
      snippets: snippetManager.getAll(),
      commandHistory: commandHistoryManager.getAll(),
      sshKeys: sshKeysWithContent,
      portForwards: portForwardManager.getAllForwards(),
      portForwardTemplates: portForwardManager.getAllTemplates(),
      sessionTemplates: sessionTemplateManager.getAll(),
      scheduledTasks: taskSchedulerManager.getAll(),
      workflows: workflowManager.getAll(),
      settings: appSettingsManager.getSettings(),
      aiConfig, // AI 配置（API Key 等）
      aiChatHistory, // AI 全局聊天历史
      aiTerminalChatHistory // 终端 AI 聊天历史
    }
  }

  /**
   * 收集 SSH 密钥（包含私钥内容）
   */
  private async collectSSHKeysWithPrivateKeys(sshKeyManager: any): Promise<any[]> {
    try {
      const keys = sshKeyManager.getAllKeys()
      const keysWithContent = []

      for (const key of keys) {
        try {
          // 读取私钥文件内容
          const privateKeyContent = await fs.readFile(key.privateKeyPath, 'utf-8')

          // 尝试读取公钥文件内容
          let publicKeyContent = key.publicKey
          const publicKeyPath = `${key.privateKeyPath}.pub`
          try {
            const pubKeyFromFile = await fs.readFile(publicKeyPath, 'utf-8')
            if (pubKeyFromFile) {
              publicKeyContent = pubKeyFromFile
            }
          } catch {
            // 公钥文件不存在，使用元数据中的公钥
          }

          keysWithContent.push({
            ...key,
            privateKeyContent, // 添加私钥内容
            publicKeyContent   // 添加公钥内容
          })
        } catch (error) {
          console.error(`[SyncManager] Failed to read SSH key file: ${key.name}`, error)
          // 如果读取失败，仍然保存元数据
          keysWithContent.push(key)
        }
      }

      return keysWithContent
    } catch (error) {
      console.error('[SyncManager] Failed to collect SSH keys', error)
      return []
    }
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
    
    const parts = encryptedData.split(':')
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format')
    }
    
    const iv = Buffer.from(parts[0], 'hex')
    const encrypted = parts[1]
    
    const key = (await scryptAsync(password, 'mshell-sync-salt', 32)) as Buffer
    
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  }

  // ==================== GitHub Gist 同步 ====================

  /**
   * 验证 GitHub Token
   */
  async verifyGitHubToken(token: string): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      // 清理 token 中的空白字符
      const cleanToken = token.trim().replace(/[\r\n]/g, '')
      
      const response = await axios.get('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${cleanToken}`,
          'Accept': 'application/vnd.github.v3+json'
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
   * 创建 GitHub Gist
   */
  private async createGist(token: string, content: string): Promise<{ id: string; url: string }> {
    const response = await axios.post('https://api.github.com/gists', {
      description: 'MShell Sync Data - DO NOT DELETE',
      public: false,
      files: {
        'mshell-sync.json': {
          content: content
        }
      }
    }, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    
    return {
      id: response.data.id,
      url: response.data.html_url
    }
  }

  /**
   * 更新 GitHub Gist
   */
  private async updateGist(token: string, gistId: string, content: string): Promise<void> {
    await axios.patch(`https://api.github.com/gists/${gistId}`, {
      files: {
        'mshell-sync.json': {
          content: content
        }
      }
    }, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
  }

  /**
   * 获取 GitHub Gist 内容
   */
  private async getGist(token: string, gistId: string): Promise<{ content: string; updatedAt: string } | null> {
    try {
      const response = await axios.get(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
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
  async verifyGitLabToken(token: string, instanceUrl?: string): Promise<{ valid: boolean; username?: string; error?: string }> {
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
   * 创建 GitLab Snippet
   */
  private async createSnippet(token: string, content: string): Promise<{ id: number; url: string }> {
    const baseUrl = this.getGitLabApiUrl()
    const response = await axios.post(`${baseUrl}/api/v4/snippets`, {
      title: 'MShell Sync Data - DO NOT DELETE',
      description: 'MShell 同步数据，请勿删除',
      visibility: 'private',
      files: [{
        file_path: 'mshell-sync.json',
        content: content
      }]
    }, {
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      }
    })
    
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
    await axios.put(`${baseUrl}/api/v4/snippets/${snippetId}`, {
      files: [{
        action: 'update',
        file_path: 'mshell-sync.json',
        content: content
      }]
    }, {
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * 获取 GitLab Snippet 内容
   */
  private async getSnippet(token: string, snippetId: string): Promise<{ content: string; updatedAt: string } | null> {
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
        content: typeof rawResponse.data === 'string' ? rawResponse.data : JSON.stringify(rawResponse.data),
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
    
    if (!this.config.encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集数据
      const backupData = await this.collectSyncData()
      const jsonData = JSON.stringify(backupData)
      
      // 加密数据
      const encryptedData = await this.encryptData(jsonData, this.config.encryptionPassword)
      
      // 构建同步数据
      const syncData: SyncData = {
        version: '1.0.0',
        appVersion: app.getVersion(),
        lastModified: new Date().toISOString(),
        checksum: this.calculateChecksum(jsonData),
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
    
    if (!this.config.encryptionPassword) {
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
        jsonData = await this.decryptData(syncData.data, this.config.encryptionPassword)
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
        restoreCommandHistory: true,
        restoreSSHKeys: true, // 恢复 SSH 密钥（包含私钥）
        restorePortForwards: true,
        restoreSessionTemplates: true,
        restoreScheduledTasks: true,
        restoreWorkflows: true,
        restoreAIConfig: true, // 恢复 AI 配置
        restoreAIChatHistory: true // 恢复 AI 聊天历史（全局 + 终端）
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
    
    if (!this.config.encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集本地数据
      const localData = await this.collectSyncData()
      const localJson = JSON.stringify(localData)
      const localChecksum = this.calculateChecksum(localJson)
      
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
      
      // 比较时间戳决定同步方向
      const localTime = new Date(localData.timestamp).getTime()
      const remoteTime = new Date(remoteSyncData.lastModified).getTime()
      
      if (localTime > remoteTime) {
        return await this.uploadToGitLab()
      } else {
        return await this.downloadFromGitLab()
      }
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
    
    if (!this.config.encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集数据
      const backupData = await this.collectSyncData()
      const jsonData = JSON.stringify(backupData)
      
      // 加密数据
      const encryptedData = await this.encryptData(jsonData, this.config.encryptionPassword)
      
      // 构建同步数据
      const syncData: SyncData = {
        version: '1.0.0',
        appVersion: app.getVersion(),
        lastModified: new Date().toISOString(),
        checksum: this.calculateChecksum(jsonData),
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
    
    if (!this.config.encryptionPassword) {
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
        jsonData = await this.decryptData(syncData.data, this.config.encryptionPassword)
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
        restoreCommandHistory: true,
        restoreSSHKeys: true, // 恢复 SSH 密钥（包含私钥）
        restorePortForwards: true,
        restoreSessionTemplates: true,
        restoreScheduledTasks: true,
        restoreWorkflows: true,
        restoreAIConfig: true, // 恢复 AI 配置
        restoreAIChatHistory: true // 恢复 AI 聊天历史（全局 + 终端）
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
    
    if (!this.config.encryptionPassword) {
      return { success: false, message: '未设置同步加密密码' }
    }

    try {
      // 收集本地数据
      const localData = await this.collectSyncData()
      const localJson = JSON.stringify(localData)
      const localChecksum = this.calculateChecksum(localJson)
      
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
      
      // 比较时间戳决定同步方向
      const localTime = new Date(localData.timestamp).getTime()
      const remoteTime = new Date(remoteSyncData.lastModified).getTime()
      
      if (localTime > remoteTime) {
        // 本地更新，上传
        return await this.uploadToGitHub()
      } else {
        // 远程更新，下载
        return await this.downloadFromGitHub()
      }
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
    
    if (this.config.provider === 'github' && this.config.github?.token && this.config.github?.gistId) {
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
    
    console.log(`[SyncManager] Auto sync started with interval: ${this.config.syncInterval} minutes`)
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
