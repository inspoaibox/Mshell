import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface LogEntry {
  id: string
  timestamp: string | Date
  level: 'info' | 'warn' | 'error'
  category: 'connection' | 'sftp' | 'system' | 'session'
  sessionId?: string
  sessionName?: string
  host?: string
  username?: string
  message: string
  details?: string
  error?: string
}

class Logger {
  private logDir: string
  private currentLogFile: string
  private sessionLogging: Map<string, boolean>
  private sessionLogFiles: Map<string, string>
  private readonly MAX_LOG_ENTRIES = 10000 // 最大日志条目数
  private readonly MAX_LOG_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  constructor() {
    const userDataPath = app.getPath('userData')
    this.logDir = path.join(userDataPath, 'logs')
    this.sessionLogging = new Map()
    this.sessionLogFiles = new Map()

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }

    const date = new Date().toISOString().split('T')[0]
    this.currentLogFile = path.join(this.logDir, `mshell-${date}.log`)
    
    // 启动时清理旧日志
    this.cleanOldLogs()
  }

  private sanitize(text: string): string {
    return text
      .replace(/password[=:]\s*[^\s&]+/gi, 'password=***')
      .replace(/passphrase[=:]\s*[^\s&]+/gi, 'passphrase=***')
      .replace(/-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/gi, '***PRIVATE KEY***')
  }

  private writeLog(entry: LogEntry): void {
    // 检查日志轮转
    this.checkLogRotation()
    
    const sanitizedEntry = {
      ...entry,
      message: this.sanitize(entry.message),
      details: entry.details ? this.sanitize(entry.details) : undefined,
      error: entry.error ? this.sanitize(entry.error) : undefined
    }

    const logLine = JSON.stringify(sanitizedEntry) + '\n'
    fs.appendFileSync(this.currentLogFile, logLine)
  }

  logConnection(sessionId: string, sessionName: string, host: string, username: string, action: 'connect' | 'disconnect', error?: string): void {
    const { v4: uuidv4 } = require('uuid')
    this.writeLog({
      id: uuidv4(),
      timestamp: new Date(),
      level: error ? 'error' : 'info',
      category: 'connection',
      sessionId,
      sessionName,
      host,
      username,
      message: `${action} ${username}@${host}`,
      error
    })
  }

  logInfo(category: 'connection' | 'sftp' | 'system' | 'session', message: string, details?: string): void {
    const { v4: uuidv4 } = require('uuid')
    this.writeLog({
      id: uuidv4(),
      timestamp: new Date(),
      level: 'info',
      category,
      message,
      details
    })
  }

  logError(category: 'connection' | 'sftp' | 'system' | 'session', message: string, error: Error): void {
    const { v4: uuidv4 } = require('uuid')
    this.writeLog({
      id: uuidv4(),
      timestamp: new Date(),
      level: 'error',
      category,
      message,
      error: error.message,
      details: error.stack
    })
  }

  enableSessionLogging(sessionId: string): void {
    this.sessionLogging.set(sessionId, true)
    const date = new Date().toISOString().split('T')[0]
    const logFile = path.join(this.logDir, `session-${sessionId}-${date}.log`)
    this.sessionLogFiles.set(sessionId, logFile)
  }

  disableSessionLogging(sessionId: string): void {
    this.sessionLogging.delete(sessionId)
    this.sessionLogFiles.delete(sessionId)
  }

  logSessionData(sessionId: string, direction: 'input' | 'output', data: string): void {
    if (!this.sessionLogging.get(sessionId)) return

    const logFile = this.sessionLogFiles.get(sessionId)
    if (!logFile) return

    const sanitizedData = this.sanitize(data)
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${direction}: ${sanitizedData}\n`

    fs.appendFileSync(logFile, logLine)
  }

  getLogs(filter?: { startDate?: Date; endDate?: Date; host?: string; level?: string }): LogEntry[] {
    const logs: LogEntry[] = []
    const files = fs.readdirSync(this.logDir).filter(f => f.startsWith('mshell-') && f.endsWith('.log'))

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.logDir, file), 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())

      for (const line of lines) {
        try {
          const entry: LogEntry = JSON.parse(line)
          const entryDate = new Date(entry.timestamp)

          if (filter) {
            if (filter.startDate && entryDate < filter.startDate) continue
            if (filter.endDate && entryDate > filter.endDate) continue
            if (filter.host && entry.host !== filter.host) continue
            if (filter.level && entry.level !== filter.level) continue
          }

          logs.push(entry)
          
          // 限制返回的日志数量，防止内存溢出
          if (logs.length >= this.MAX_LOG_ENTRIES) {
            console.warn(`[Logger] Reached max log entries limit (${this.MAX_LOG_ENTRIES})`)
            break
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
      
      if (logs.length >= this.MAX_LOG_ENTRIES) break
    }

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * 清理旧日志文件（保留最近30天）
   */
  private cleanOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir)
      const now = Date.now()
      const maxAge = 30 * 24 * 60 * 60 * 1000 // 30天

      for (const file of files) {
        if (file.startsWith('mshell-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file)
          const stats = fs.statSync(filePath)
          
          if (now - stats.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath)
            console.log(`[Logger] Deleted old log file: ${file}`)
          }
        }
      }
    } catch (error) {
      console.error('[Logger] Error cleaning old logs:', error)
    }
  }

  /**
   * 检查并轮转日志文件
   */
  private checkLogRotation(): void {
    try {
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile)
        
        if (stats.size > this.MAX_LOG_FILE_SIZE) {
          const timestamp = Date.now()
          const newName = this.currentLogFile.replace('.log', `-${timestamp}.log`)
          fs.renameSync(this.currentLogFile, newName)
          console.log(`[Logger] Rotated log file to: ${newName}`)
        }
      }
    } catch (error) {
      console.error('[Logger] Error checking log rotation:', error)
    }
  }
}

export const logger = new Logger()
