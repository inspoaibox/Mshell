import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'
import { sessionManager } from './SessionManager'
import { snippetManager } from './SnippetManager'
import { commandHistoryManager } from './CommandHistoryManager'
import { sshKeyManager } from './SSHKeyManager'
import { portForwardManager } from './PortForwardManager'
import { sessionTemplateManager } from './SessionTemplateManager'
import { taskSchedulerManager } from './TaskSchedulerManager'
import { workflowManager } from './WorkflowManager'
import { connectionStatsManager } from './ConnectionStatsManager'
import { auditLogManager } from './AuditLogManager'
import { transferRecordManager } from './TransferRecordManager'
import { sessionLockManager } from './SessionLockManager'
import { logger } from '../utils/logger'

const scryptAsync = promisify(scrypt)

/**
 * 备份数据接口
 */
export interface BackupData {
  version: string
  timestamp: string
  sessions: any[]
  sessionGroups: any[]
  snippets: any[]
  commandHistory: any[]
  sshKeys: any[]
  portForwards: any[]
  portForwardTemplates: any[]
  sessionTemplates: any[]
  scheduledTasks: any[]
  workflows: any[]
  settings: any
  aiConfig?: any // AI 配置（可选，用于向后兼容）
  aiChatHistory?: any[] // AI 聊天历史（可选）
  aiTerminalChatHistory?: Record<string, any[]> // 终端 AI 聊天历史（可选） { filename: messages }
  // 新增数据类型
  connectionStats?: any[] // 连接统计
  auditLogs?: any[] // 审计日志
  transferRecords?: any[] // 传输记录
  lockConfig?: any // 锁定配置（不包含密码）
}

/**
 * 备份配置接口
 */
export interface BackupConfig {
  enabled: boolean
  interval: number // 小时
  maxBackups: number
  backupDir?: string // 自定义备份目录
  lastBackup?: string
  autoBackupPassword?: string // 自动备份密码（加密存储）
}

/**
 * BackupManager - 管理数据备份与恢复
 */
export class BackupManager {
  private backupDir: string
  private configPath: string
  private config: BackupConfig
  private timer: NodeJS.Timeout | null = null
  private readonly ENCRYPTION_KEY = 'mshell-backup-encryption-key-v1'

  constructor() {
    this.backupDir = join(app.getPath('userData'), 'backups')
    this.configPath = join(app.getPath('userData'), 'backup-config.json')
    this.config = {
      enabled: false,
      interval: 24, // 默认24小时
      maxBackups: 10
    }
  }

  /**
   * 初始化备份管理器
   */
  async initialize(): Promise<void> {
    try {
      // 加载配置
      await this.loadConfig()

      // 如果配置了自定义备份目录，使用它
      if (this.config.backupDir) {
        this.backupDir = this.config.backupDir
      }

      // 创建备份目录
      await fs.mkdir(this.backupDir, { recursive: true })

      // 启动自动备份
      if (this.config.enabled) {
        this.startAutoBackup()
      }
    } catch (error) {
      logger.logError('system', 'Failed to initialize backup manager', error as Error)
    }
  }

  /**
   * 加载备份配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      this.config = JSON.parse(data)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.logError('system', 'Failed to load backup config', error)
      }
    }
  }

  /**
   * 保存备份配置
   */
  private async saveConfig(): Promise<void> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (error) {
      logger.logError('system', 'Failed to save backup config', error as Error)
      throw new Error('保存配置失败')
    }
  }

  /**
   * 获取备份配置
   */
  getConfig(): BackupConfig {
    return {
      ...this.config,
      backupDir: this.config.backupDir || this.backupDir // 返回当前使用的备份目录
    }
  }

  /**
   * 更新备份配置
   */
  async updateConfig(updates: Partial<BackupConfig>): Promise<void> {
    this.config = { ...this.config, ...updates }

    // 如果更新了备份目录，更新backupDir
    if (updates.backupDir) {
      this.backupDir = updates.backupDir
      await fs.mkdir(this.backupDir, { recursive: true })
    }

    await this.saveConfig()

    // 重启自动备份
    this.stopAutoBackup()
    if (this.config.enabled) {
      this.startAutoBackup()
    }
  }

  /**
   * 加密数据
   */
  private async encrypt(data: string, password: string): Promise<string> {
    try {
      // 生成密钥
      const key = (await scryptAsync(password, this.ENCRYPTION_KEY, 32)) as Buffer
      const iv = randomBytes(16)

      // 加密
      const cipher = createCipheriv('aes-256-cbc', key, iv)
      let encrypted = cipher.update(data, 'utf8', 'hex')
      encrypted += cipher.final('hex')

      // 返回 iv + 加密数据
      return iv.toString('hex') + ':' + encrypted
    } catch (error) {
      logger.logError('system', 'Failed to encrypt data', error as Error)
      throw new Error('加密失败')
    }
  }

  /**
   * 解密数据
   */
  private async decrypt(encryptedData: string, password: string): Promise<string> {
    try {
      // 分离 iv 和加密数据
      const parts = encryptedData.split(':')
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format')
      }

      const iv = Buffer.from(parts[0], 'hex')
      const encrypted = parts[1]

      // 生成密钥
      const key = (await scryptAsync(password, this.ENCRYPTION_KEY, 32)) as Buffer

      // 解密
      const decipher = createDecipheriv('aes-256-cbc', key, iv)
      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      logger.logError('system', 'Failed to decrypt data', error as Error)
      throw new Error('解密失败，密码可能不正确')
    }
  }

  /**
   * 创建备份
   */
  async createBackup(password: string, filePath?: string, isAutoBackup: boolean = false): Promise<string> {
    try {
      // 收集所有数据
      const backupData: BackupData = {
        version: '0.2.0', // 升级版本号以支持更多数据类型
        timestamp: new Date().toISOString(),
        sessions: sessionManager.getAllSessions(),
        sessionGroups: sessionManager.getAllGroups(),
        snippets: snippetManager.getAll(),
        commandHistory: commandHistoryManager.getAll(),
        sshKeys: await this.collectSSHKeysWithPrivateKeys(),
        portForwards: portForwardManager.getAllForwards(),
        portForwardTemplates: portForwardManager.getAllTemplates(),
        sessionTemplates: sessionTemplateManager.getAll(),
        scheduledTasks: taskSchedulerManager.getAll(),
        workflows: workflowManager.getAll(),
        settings: await this.getAppSettings(),
        aiConfig: await this.collectAIConfig(), // 收集 AI 配置
        aiChatHistory: await this.collectAIChatHistory(), // 收集 AI 聊天历史
        aiTerminalChatHistory: await this.collectAITerminalChatHistory(), // 收集终端 AI 聊天历史
        // 新增数据
        connectionStats: connectionStatsManager.getAll(), // 连接统计
        auditLogs: auditLogManager.getAll(), // 审计日志
        transferRecords: transferRecordManager.getAllRecords(), // 传输记录
        lockConfig: sessionLockManager.getConfig() // 锁定配置（不包含密码）
      }

      // 序列化数据
      const jsonData = JSON.stringify(backupData, null, 2)

      // 加密数据
      const encryptedData = await this.encrypt(jsonData, password)

      // 确定保存路径
      const prefix = isAutoBackup ? 'auto-backup' : 'backup'
      const fileName = `${prefix}-${Date.now()}.mshell`
      const savePath = filePath || join(this.backupDir, fileName)

      // 保存到文件
      await fs.writeFile(savePath, encryptedData, 'utf-8')

      // 更新最后备份时间
      this.config.lastBackup = new Date().toISOString()
      await this.saveConfig()

      // 清理旧备份（只清理自动备份目录中的文件）
      if (!filePath) {
        await this.cleanOldBackups()
      }

      try {
        logger.logInfo('system', `Backup created: ${savePath}`)
      } catch (error) {
        console.log(`Backup created: ${savePath}`)
      }
      return savePath
    } catch (error) {
      logger.logError('system', 'Failed to create backup', error as Error)
      throw error
    }
  }

  /**
   * 收集AI配置
   */
  private async collectAIConfig(): Promise<any | null> {
    try {
      const aiConfigPath = join(app.getPath('userData'), 'ai-config.json')
      try {
        const data = await fs.readFile(aiConfigPath, 'utf-8')
        return JSON.parse(data)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // 配置文件不存在，返回 null
          return null
        }
        throw error
      }
    } catch (error) {
      logger.logError('system', 'Failed to collect AI config', error as Error)
      return null
    }
  }

  /**
   * 收集AI聊天历史
   */
  private async collectAIChatHistory(): Promise<any[] | undefined> {
    try {
      const chatHistoryPath = join(app.getPath('userData'), 'ai-chat-history.json')
      try {
        const data = await fs.readFile(chatHistoryPath, 'utf-8')
        return JSON.parse(data)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // 聊天历史文件不存在，返回 undefined
          return undefined
        }
        throw error
      }
    } catch (error) {
      logger.logError('system', 'Failed to collect AI chat history', error as Error)
      logger.logError('system', 'Failed to collect AI chat history', error as Error)
      return undefined
    }
  }

  /**
   * 收集终端AI聊天历史
   */
  private async collectAITerminalChatHistory(): Promise<Record<string, any[]> | undefined> {
    try {
      const historyDir = join(app.getPath('userData'), 'ai-terminal-history')
      try {
        const files = await fs.readdir(historyDir)
        const history: Record<string, any[]> = {}

        for (const file of files) {
          if (!file.endsWith('.json')) continue

          const content = await fs.readFile(join(historyDir, file), 'utf-8')
          history[file] = JSON.parse(content)
        }

        // 如果为空，返回 undefined
        if (Object.keys(history).length === 0) return undefined

        return history
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return undefined
        }
        throw error
      }
    } catch (error) {
      logger.logError('system', 'Failed to collect AI terminal chat history', error as Error)
      return undefined
    }
  }

  /**
   * 收集SSH密钥（包含私钥内容）
   */
  private async collectSSHKeysWithPrivateKeys(): Promise<any[]> {
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
          } catch (error) {
            // 公钥文件不存在，使用元数据中的公钥
          }

          keysWithContent.push({
            ...key,
            privateKeyContent, // 添加私钥内容
            publicKeyContent   // 添加公钥内容
          })
        } catch (error) {
          logger.logError('system', `Failed to read SSH key file: ${key.name}`, error as Error)
          // 如果读取失败，仍然保存元数据
          keysWithContent.push(key)
        }
      }

      return keysWithContent
    } catch (error) {
      logger.logError('system', 'Failed to collect SSH keys', error as Error)
      return []
    }
  }

  /**
   * 获取应用设置
   */
  private async getAppSettings(): Promise<any> {
    try {
      const { appSettingsManager } = await import('../utils/app-settings')
      return appSettingsManager.getSettings()
    } catch (error) {
      logger.logError('system', 'Failed to get app settings', error as Error)
      return {}
    }
  }

  /**
   * 恢复备份
   */
  async restoreBackup(filePath: string, password: string): Promise<BackupData> {
    try {
      // 读取加密数据
      const encryptedData = await fs.readFile(filePath, 'utf-8')

      // 解密数据
      const jsonData = await this.decrypt(encryptedData, password)

      // 解析数据
      let backupData: BackupData
      try {
        backupData = JSON.parse(jsonData)
      } catch (e) {
        throw new Error('密码错误或备份文件损坏')
      }

      // 验证数据格式
      if (!backupData.version || !backupData.timestamp) {
        throw new Error('无效的备份文件格式')
      }

      try {
        logger.logInfo('system', `Backup restored from: ${filePath}`)
      } catch (error) {
        console.log(`Backup restored from: ${filePath}`)
      }
      return backupData
    } catch (error: any) {
      logger.logError('system', 'Failed to restore backup', error as Error)
      throw error.message === '密码错误或备份文件损坏' || error.message === '无效的备份文件格式'
        ? error
        : new Error('恢复备份失败: ' + error.message)
    }
  }

  /**
   * 应用备份数据
   */
  async applyBackup(backupData: BackupData, options: {
    restoreSessions: boolean
    restoreSnippets: boolean
    restoreSettings: boolean
    restoreCommandHistory?: boolean
    restoreSSHKeys?: boolean
    restorePortForwards?: boolean
    restoreSessionTemplates?: boolean
    restoreScheduledTasks?: boolean
    restoreWorkflows?: boolean
    restoreAIConfig?: boolean
    restoreAIChatHistory?: boolean
    // 新增选项
    restoreConnectionStats?: boolean
    restoreAuditLogs?: boolean
    restoreTransferRecords?: boolean
    restoreLockConfig?: boolean
  }): Promise<void> {
    try {
      // 恢复会话
      if (options.restoreSessions && backupData.sessions) {
        const currentSessions = sessionManager.getAllSessions()
        for (const session of backupData.sessions) {
          try {
            // 检查是否存在相同会话（通过 ID 或 名称+IP+用户名 判断）
            const existing = currentSessions.find(s =>
              s.id === session.id ||
              (s.name === session.name && s.host === session.host && s.username === session.username)
            )

            if (existing) {
              // 更新现有会话
              const { id, ...updates } = session
              await sessionManager.updateSession(existing.id, updates)
            } else {
              // 创建新会话
              await sessionManager.createSession(session)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore session: ${session.name}`, error as Error)
          }
        }

        // 恢复会话分组
        if (backupData.sessionGroups) {
          const currentGroups = sessionManager.getAllGroups()
          for (const group of backupData.sessionGroups) {
            try {
              const existing = currentGroups.find(g => g.id === group.id || g.name === group.name)
              if (!existing) {
                await sessionManager.createGroup(group.name)
              } else if (existing.name !== group.name) {
                await sessionManager.renameGroup(existing.id, group.name)
              }
            } catch (error) {
              logger.logError('system', `Failed to restore group: ${group.name}`, error as Error)
            }
          }
        }
      }

      // 恢复命令片段
      if (options.restoreSnippets && backupData.snippets) {
        const currentSnippets = snippetManager.getAll()
        for (const snippet of backupData.snippets) {
          try {
            // 检查是否存在相同片段（通过 ID 或 名称 判断）
            const existing = currentSnippets.find(s =>
              s.id === snippet.id || s.name === snippet.name
            )

            if (existing) {
              const { id, ...updates } = snippet
              await snippetManager.update(existing.id, updates)
            } else {
              await snippetManager.create(snippet)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore snippet: ${snippet.name}`, error as Error)
          }
        }
      }

      // 恢复命令历史
      if (options.restoreCommandHistory && backupData.commandHistory) {
        for (const history of backupData.commandHistory) {
          try {
            await commandHistoryManager.create(history)
          } catch (error) {
            logger.logError('system', `Failed to restore command history`, error as Error)
          }
        }
      }

      // 恢复SSH密钥
      if (options.restoreSSHKeys && backupData.sshKeys) {
        for (const key of backupData.sshKeys) {
          try {
            const existing = sshKeyManager.getAllKeys().find(k => k.id === key.id || k.name === key.name)

            // 如果备份中包含私钥内容，恢复完整的密钥
            if (key.privateKeyContent) {
              if (existing) {
                // 更新现有密钥
                logger.logInfo('system', `Updating SSH key: ${key.name}`)
                // 删除旧密钥
                sshKeyManager.deleteKey(existing.id)
              }

              // 使用 addKey 方法恢复密钥（会创建新的密钥文件）
              sshKeyManager.addKey({
                name: key.name,
                privateKey: key.privateKeyContent,
                publicKey: key.publicKeyContent || key.publicKey,
                passphrase: key.protected ? undefined : undefined, // 如果有密码保护，用户需要重新输入
                comment: key.comment
              })

              logger.logInfo('system', `SSH key "${key.name}" restored successfully with private key`)
            } else {
              // 如果没有私钥内容（旧版本备份），只恢复元数据
              if (!existing) {
                logger.logInfo('system', `SSH key "${key.name}" metadata restored, but key file needs manual import`)
              }
            }
          } catch (error) {
            logger.logError('system', `Failed to restore SSH key: ${key.name}`, error as Error)
          }
        }
      }

      // 恢复端口转发配置
      if (options.restorePortForwards && backupData.portForwards) {
        for (const forward of backupData.portForwards) {
          try {
            const existing = portForwardManager.getAllForwards().find(f => f.id === forward.id)
            if (existing) {
              await portForwardManager.updateForward(existing.id, forward)
            } else {
              await portForwardManager.addForward(forward)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore port forward`, error as Error)
          }
        }

        // 恢复端口转发模板
        if (backupData.portForwardTemplates) {
          for (const template of backupData.portForwardTemplates) {
            try {
              const existing = portForwardManager.getAllTemplates().find(t => t.id === template.id || t.name === template.name)
              if (existing) {
                await portForwardManager.updateTemplate(existing.id, template)
              } else {
                await portForwardManager.createTemplate(template)
              }
            } catch (error) {
              logger.logError('system', `Failed to restore port forward template: ${template.name}`, error as Error)
            }
          }
        }
      }

      // 恢复会话模板
      if (options.restoreSessionTemplates && backupData.sessionTemplates) {
        for (const template of backupData.sessionTemplates) {
          try {
            const existing = sessionTemplateManager.getAll().find(t => t.id === template.id || t.name === template.name)
            if (existing) {
              await sessionTemplateManager.updateTemplate(existing.id, template)
            } else {
              await sessionTemplateManager.createTemplate(template)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore session template: ${template.name}`, error as Error)
          }
        }
      }

      // 恢复任务调度
      if (options.restoreScheduledTasks && backupData.scheduledTasks) {
        for (const task of backupData.scheduledTasks) {
          try {
            const existing = taskSchedulerManager.getAll().find(t => t.id === task.id || t.name === task.name)
            if (existing) {
              taskSchedulerManager.update(existing.id, task)
            } else {
              taskSchedulerManager.create(task)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore scheduled task: ${task.name}`, error as Error)
          }
        }
      }

      // 恢复工作流
      if (options.restoreWorkflows && backupData.workflows) {
        for (const workflow of backupData.workflows) {
          try {
            const existing = workflowManager.getAll().find(w => w.id === workflow.id || w.name === workflow.name)
            if (existing) {
              workflowManager.update(existing.id, workflow)
            } else {
              workflowManager.create(workflow)
            }
          } catch (error) {
            logger.logError('system', `Failed to restore workflow: ${workflow.name}`, error as Error)
          }
        }
      }

      // 恢复设置
      if (options.restoreSettings && backupData.settings) {
        try {
          const { appSettingsManager } = await import('../utils/app-settings')
          appSettingsManager.updateSettings(backupData.settings)
        } catch (error) {
          logger.logError('system', 'Failed to restore settings', error as Error)
        }
      }

      // 恢复 AI 配置
      if (options.restoreAIConfig && backupData.aiConfig) {
        try {
          const aiConfigPath = join(app.getPath('userData'), 'ai-config.json')
          await fs.writeFile(aiConfigPath, JSON.stringify(backupData.aiConfig, null, 2), 'utf-8')
          logger.logInfo('system', 'AI config restored successfully')
        } catch (error) {
          logger.logError('system', 'Failed to restore AI config', error as Error)
        }
      } else if (options.restoreAIConfig && !backupData.aiConfig) {
        // 向后兼容：旧版本备份没有 aiConfig 字段
        logger.logInfo('system', 'No AI config found in backup (old version backup)')
      }

      // 恢复 AI 聊天历史
      if (options.restoreAIChatHistory && backupData.aiChatHistory) {
        try {
          const chatHistoryPath = join(app.getPath('userData'), 'ai-chat-history.json')
          await fs.writeFile(chatHistoryPath, JSON.stringify(backupData.aiChatHistory, null, 2), 'utf-8')
          logger.logInfo('system', 'AI chat history restored successfully')
        } catch (error) {
          logger.logError('system', 'Failed to restore AI chat history', error as Error)
        }
      } else if (options.restoreAIChatHistory && !backupData.aiChatHistory) {
        // 向后兼容：旧版本备份没有 aiChatHistory 字段
        logger.logInfo('system', 'No AI chat history found in backup (old version backup)')
      }

      // 恢复终端 AI 聊天历史
      if (options.restoreAIChatHistory && backupData.aiTerminalChatHistory) {
        try {
          const historyDir = join(app.getPath('userData'), 'ai-terminal-history')
          // 确保目录存在
          await fs.mkdir(historyDir, { recursive: true })
          
          // 恢复每个终端的聊天历史文件
          for (const [filename, messages] of Object.entries(backupData.aiTerminalChatHistory)) {
            const filePath = join(historyDir, filename)
            await fs.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8')
          }
          
          const fileCount = Object.keys(backupData.aiTerminalChatHistory).length
          logger.logInfo('system', `AI terminal chat history restored successfully (${fileCount} files)`)
        } catch (error) {
          logger.logError('system', 'Failed to restore AI terminal chat history', error as Error)
        }
      }

      // 恢复连接统计
      if (options.restoreConnectionStats && backupData.connectionStats) {
        try {
          for (const stat of backupData.connectionStats) {
            // ConnectionStatsManager 使用 BaseManager，直接添加记录
            const existing = connectionStatsManager.getAll().find(s => s.id === stat.id)
            if (!existing) {
              // 使用内部方法添加记录
              connectionStatsManager.create(stat)
            }
          }
          logger.logInfo('system', `Connection stats restored: ${backupData.connectionStats.length} records`)
        } catch (error) {
          logger.logError('system', 'Failed to restore connection stats', error as Error)
        }
      }

      // 恢复审计日志
      if (options.restoreAuditLogs && backupData.auditLogs) {
        try {
          for (const log of backupData.auditLogs) {
            const existing = auditLogManager.getAll().find(l => l.id === log.id)
            if (!existing) {
              auditLogManager.create(log)
            }
          }
          logger.logInfo('system', `Audit logs restored: ${backupData.auditLogs.length} records`)
        } catch (error) {
          logger.logError('system', 'Failed to restore audit logs', error as Error)
        }
      }

      // 恢复传输记录
      if (options.restoreTransferRecords && backupData.transferRecords) {
        try {
          for (const record of backupData.transferRecords) {
            const existing = transferRecordManager.getAllRecords().find((r: any) => r.id === record.id)
            if (!existing) {
              // 移除时间戳字段，让 createRecord 自动生成新的时间戳
              const { createdAt, updatedAt, ...recordWithoutTimestamps } = record
              await transferRecordManager.createRecord(recordWithoutTimestamps)
            }
          }
          logger.logInfo('system', `Transfer records restored: ${backupData.transferRecords.length} records`)
        } catch (error) {
          logger.logError('system', 'Failed to restore transfer records', error as Error)
        }
      }

      // 恢复锁定配置（不恢复密码，用户需要重新设置）
      if (options.restoreLockConfig && backupData.lockConfig) {
        try {
          // 只恢复配置，不恢复密码
          const { enabled, autoLockTimeout, lockOnMinimize } = backupData.lockConfig
          sessionLockManager.updateConfig({
            enabled: enabled || false,
            autoLockTimeout: autoLockTimeout || 0,
            lockOnMinimize: lockOnMinimize || false
          })
          logger.logInfo('system', 'Lock config restored (password not restored for security)')
        } catch (error) {
          logger.logError('system', 'Failed to restore lock config', error as Error)
        }
      }

      try {
        logger.logInfo('system', 'Backup applied successfully')
      } catch (error) {
        console.log('Backup applied successfully')
      }
    } catch (error) {
      logger.logError('system', 'Failed to apply backup', error as Error)
      throw error
    }
  }

  /**
   * 获取所有备份文件
   */
  async listBackups(): Promise<Array<{ name: string; path: string; size: number; date: Date }>> {
    try {
      const files = await fs.readdir(this.backupDir)
      const backups = []

      for (const file of files) {
        if (file.endsWith('.mshell')) {
          const filePath = join(this.backupDir, file)
          const stats = await fs.stat(filePath)
          backups.push({
            name: file,
            path: filePath,
            size: stats.size,
            date: stats.mtime
          })
        }
      }

      // 按日期降序排序
      backups.sort((a, b) => b.date.getTime() - a.date.getTime())

      return backups
    } catch (error) {
      logger.logError('system', 'Failed to list backups', error as Error)
      return []
    }
  }

  /**
   * 删除备份文件
   */
  async deleteBackup(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath)
      try {
        logger.logInfo('system', `Backup deleted: ${filePath}`)
      } catch (error) {
        console.log(`Backup deleted: ${filePath}`)
      }
    } catch (error) {
      logger.logError('system', 'Failed to delete backup', error as Error)
      throw new Error('删除备份失败')
    }
  }

  /**
   * 清理旧备份
   */
  private async cleanOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups()

      // 如果备份数量超过限制，删除最旧的
      if (backups.length > this.config.maxBackups) {
        const toDelete = backups.slice(this.config.maxBackups)
        for (const backup of toDelete) {
          await this.deleteBackup(backup.path)
        }
      }
    } catch (error) {
      logger.logError('system', 'Failed to clean old backups', error as Error)
    }
  }

  /**
   * 启动自动备份
   */
  private startAutoBackup(): void {
    if (this.timer) {
      return
    }

    const intervalMs = this.config.interval * 60 * 60 * 1000 // 转换为毫秒

    // 检查是否需要立即执行备份（距离上次备份超过间隔时间）
    const shouldBackupNow = this.shouldRunBackupNow()
    
    if (shouldBackupNow) {
      // 立即执行一次备份
      this.runAutoBackup()
    }

    this.timer = setInterval(async () => {
      await this.runAutoBackup()
    }, intervalMs)

    try {
      logger.logInfo('system', `Auto backup started with interval: ${this.config.interval} hours`)
    } catch (error) {
      console.log(`Auto backup started with interval: ${this.config.interval} hours`)
    }
  }

  /**
   * 检查是否需要立即执行备份
   */
  private shouldRunBackupNow(): boolean {
    if (!this.config.lastBackup) {
      return true // 从未备份过
    }

    const lastBackupTime = new Date(this.config.lastBackup).getTime()
    const now = Date.now()
    const intervalMs = this.config.interval * 60 * 60 * 1000

    return (now - lastBackupTime) >= intervalMs
  }

  /**
   * 执行自动备份
   */
  private async runAutoBackup(): Promise<void> {
    try {
      // 检查是否配置了自动备份密码
      if (!this.config.autoBackupPassword) {
        try {
          logger.logInfo('system', 'Auto backup skipped: no password configured')
        } catch (error) {
          console.log('Auto backup skipped: no password configured')
        }
        return
      }

      await this.createBackup(this.config.autoBackupPassword, undefined, true)
      
      // 更新最后备份时间
      this.config.lastBackup = new Date().toISOString()
      await this.saveConfig()
      
      try {
        logger.logInfo('system', 'Auto backup completed')
      } catch (error) {
        console.log('Auto backup completed')
      }
    } catch (error) {
      try {
        logger.logError('system', 'Auto backup failed', error as Error)
      } catch (e) {
        console.error('Auto backup failed:', error)
      }
    }
  }

  /**
   * 停止自动备份
   */
  private stopAutoBackup(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      try {
        logger.logInfo('system', 'Auto backup stopped')
      } catch (error) {
        console.log('Auto backup stopped')
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stopAutoBackup()
  }
}

// 导出单例
export const backupManager = new BackupManager()
