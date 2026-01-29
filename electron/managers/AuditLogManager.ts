import { BaseManager } from './BaseManager'
import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'

/**
 * 审计日志级别
 */
export enum AuditLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

/**
 * 审计日志类型
 */
export enum AuditAction {
  // 会话操作
  SESSION_CREATE = 'session.create',
  SESSION_UPDATE = 'session.update',
  SESSION_DELETE = 'session.delete',
  SESSION_CONNECT = 'session.connect',
  SESSION_DISCONNECT = 'session.disconnect',
  
  // 文件操作
  FILE_UPLOAD = 'file.upload',
  FILE_DOWNLOAD = 'file.download',
  FILE_DELETE = 'file.delete',
  FILE_RENAME = 'file.rename',
  FILE_EDIT = 'file.edit',
  
  // 端口转发
  PORT_FORWARD_CREATE = 'portforward.create',
  PORT_FORWARD_START = 'portforward.start',
  PORT_FORWARD_STOP = 'portforward.stop',
  PORT_FORWARD_DELETE = 'portforward.delete',
  
  // 密钥操作
  KEY_GENERATE = 'key.generate',
  KEY_IMPORT = 'key.import',
  KEY_EXPORT = 'key.export',
  KEY_DELETE = 'key.delete',
  
  // 命令执行
  COMMAND_EXECUTE = 'command.execute',
  
  // 设置更改
  SETTINGS_UPDATE = 'settings.update',
  
  // 备份操作
  BACKUP_CREATE = 'backup.create',
  BACKUP_RESTORE = 'backup.restore',
  
  // 认证操作
  AUTH_SUCCESS = 'auth.success',
  AUTH_FAILURE = 'auth.failure',
  
  // 系统操作
  APP_START = 'app.start',
  APP_STOP = 'app.stop'
}

/**
 * 审计日志条目
 */
export interface AuditLog {
  id: string
  timestamp: string
  level: AuditLevel
  action: AuditAction
  userId?: string // 未来可能支持多用户
  sessionId?: string
  resource?: string // 资源标识（如文件路径、会话名称等）
  details?: Record<string, any>
  ipAddress?: string
  success: boolean
  errorMessage?: string
}

/**
 * 审计日志查询过滤器
 */
export interface AuditLogFilter {
  startDate?: string
  endDate?: string
  level?: AuditLevel
  action?: AuditAction
  sessionId?: string
  success?: boolean
  keyword?: string
}

/**
 * AuditLogManager - 管理审计日志
 */
export class AuditLogManager extends BaseManager<AuditLog> {
  private maxLogs: number = 50000 // 最多保存50000条日志
  private alertThreshold: Map<AuditAction, number> // 敏感操作告警阈值
  private alertCallbacks: Array<(log: AuditLog) => void>
  private exportDir: string

  constructor() {
    super('audit-logs.json')
    this.alertThreshold = new Map()
    this.alertCallbacks = []
    this.exportDir = join(app.getPath('userData'), 'audit-exports')

    // 确保导出目录存在
    if (!existsSync(this.exportDir)) {
      mkdirSync(this.exportDir, { recursive: true })
    }

    // 设置敏感操作告警阈值（单位：次/小时）
    this.alertThreshold.set(AuditAction.AUTH_FAILURE, 5)
    this.alertThreshold.set(AuditAction.KEY_EXPORT, 3)
    this.alertThreshold.set(AuditAction.FILE_DELETE, 20)
    this.alertThreshold.set(AuditAction.SESSION_DELETE, 10)

    // 定期清理旧日志
    this.startCleanupTimer()
  }

  /**
   * 记录审计日志
   */
  log(
    action: AuditAction,
    options: {
      level?: AuditLevel
      sessionId?: string
      resource?: string
      details?: Record<string, any>
      success?: boolean
      errorMessage?: string
    } = {}
  ): AuditLog {
    const log: AuditLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      level: options.level || this.getDefaultLevel(action),
      action,
      sessionId: options.sessionId,
      resource: options.resource,
      details: options.details,
      success: options.success !== false,
      errorMessage: options.errorMessage
    }

    // 保存日志
    this.create(log)

    // 检查是否需要告警
    this.checkAlert(log)

    // 限制日志数量
    this.limitLogs()

    return log
  }

  /**
   * 获取默认日志级别
   */
  private getDefaultLevel(action: AuditAction): AuditLevel {
    // 认证失败、密钥导出等为关键操作
    const criticalActions = [
      AuditAction.AUTH_FAILURE,
      AuditAction.KEY_EXPORT,
      AuditAction.KEY_DELETE,
      AuditAction.BACKUP_RESTORE
    ]

    // 删除操作为警告级别
    const warningActions = [
      AuditAction.SESSION_DELETE,
      AuditAction.FILE_DELETE,
      AuditAction.PORT_FORWARD_DELETE
    ]

    if (criticalActions.includes(action)) {
      return AuditLevel.CRITICAL
    } else if (warningActions.includes(action)) {
      return AuditLevel.WARNING
    }

    return AuditLevel.INFO
  }

  /**
   * 检查是否需要告警
   */
  private checkAlert(log: AuditLog): void {
    if (log.level !== AuditLevel.CRITICAL && log.level !== AuditLevel.WARNING) {
      return
    }

    const threshold = this.alertThreshold.get(log.action)
    if (!threshold) {
      return
    }

    // 检查最近一小时内的相同操作次数
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
    const recentLogs = this.getByTimeRange(oneHourAgo, log.timestamp).filter(
      l => l.action === log.action
    )

    if (recentLogs.length >= threshold) {
      // 触发告警
      this.triggerAlert(log, recentLogs.length)
    }
  }

  /**
   * 触发告警
   */
  private triggerAlert(log: AuditLog, count: number): void {
    const alertLog: AuditLog = {
      ...log,
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      level: AuditLevel.CRITICAL,
      details: {
        ...log.details,
        alertReason: `操作频率过高: ${count}次/小时`,
        threshold: this.alertThreshold.get(log.action)
      }
    }

    // 调用告警回调
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alertLog)
      } catch (error) {
        console.error('Alert callback error:', error)
      }
    })
  }

  /**
   * 注册告警回调
   */
  onAlert(callback: (log: AuditLog) => void): void {
    this.alertCallbacks.push(callback)
  }

  /**
   * 限制日志数量
   */
  private limitLogs(): void {
    const logs = this.getAll()
    if (logs.length > this.maxLogs) {
      // 删除最旧的日志
      const toDelete = logs
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, logs.length - this.maxLogs)

      toDelete.forEach(log => this.delete(log.id))
    }
  }

  /**
   * 按时间范围查询
   */
  getByTimeRange(startDate: string, endDate: string): AuditLog[] {
    return this.getAll().filter(log => {
      return log.timestamp >= startDate && log.timestamp <= endDate
    })
  }

  /**
   * 按级别查询
   */
  getByLevel(level: AuditLevel): AuditLog[] {
    return this.getAll().filter(log => log.level === level)
  }

  /**
   * 按操作类型查询
   */
  getByAction(action: AuditAction): AuditLog[] {
    return this.getAll().filter(log => log.action === action)
  }

  /**
   * 按会话查询
   */
  getBySession(sessionId: string): AuditLog[] {
    return this.getAll().filter(log => log.sessionId === sessionId)
  }

  /**
   * 按成功状态查询
   */
  getBySuccess(success: boolean): AuditLog[] {
    return this.getAll().filter(log => log.success === success)
  }

  /**
   * 高级过滤查询
   */
  filter(filter: AuditLogFilter): AuditLog[] {
    let logs = this.getAll()

    if (filter.startDate) {
      logs = logs.filter(log => log.timestamp >= filter.startDate!)
    }

    if (filter.endDate) {
      logs = logs.filter(log => log.timestamp <= filter.endDate!)
    }

    if (filter.level) {
      logs = logs.filter(log => log.level === filter.level)
    }

    if (filter.action) {
      logs = logs.filter(log => log.action === filter.action)
    }

    if (filter.sessionId) {
      logs = logs.filter(log => log.sessionId === filter.sessionId)
    }

    if (filter.success !== undefined) {
      logs = logs.filter(log => log.success === filter.success)
    }

    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase()
      logs = logs.filter(log => {
        return (
          log.action.toLowerCase().includes(keyword) ||
          log.resource?.toLowerCase().includes(keyword) ||
          JSON.stringify(log.details).toLowerCase().includes(keyword)
        )
      })
    }

    return logs
  }

  /**
   * 获取统计信息
   */
  getStatistics(startDate?: string, endDate?: string) {
    let logs = this.getAll()

    if (startDate) {
      logs = logs.filter(log => log.timestamp >= startDate)
    }

    if (endDate) {
      logs = logs.filter(log => log.timestamp <= endDate)
    }

    const byLevel = {
      info: logs.filter(l => l.level === AuditLevel.INFO).length,
      warning: logs.filter(l => l.level === AuditLevel.WARNING).length,
      critical: logs.filter(l => l.level === AuditLevel.CRITICAL).length
    }

    const bySuccess = {
      success: logs.filter(l => l.success).length,
      failure: logs.filter(l => !l.success).length
    }

    const topActions = this.getTopActions(logs, 10)
    const topSessions = this.getTopSessions(logs, 10)
    const failedActions = logs.filter(l => !l.success)

    return {
      total: logs.length,
      byLevel,
      bySuccess,
      topActions,
      topSessions,
      failedActions: failedActions.length,
      recentFailures: failedActions.slice(-10)
    }
  }

  /**
   * 获取最常见的操作
   */
  private getTopActions(logs: AuditLog[], limit: number) {
    const actionCounts = new Map<AuditAction, number>()

    logs.forEach(log => {
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1)
    })

    return Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([action, count]) => ({ action, count }))
  }

  /**
   * 获取最活跃的会话
   */
  private getTopSessions(logs: AuditLog[], limit: number) {
    const sessionCounts = new Map<string, number>()

    logs.forEach(log => {
      if (log.sessionId) {
        sessionCounts.set(log.sessionId, (sessionCounts.get(log.sessionId) || 0) + 1)
      }
    })

    return Array.from(sessionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([sessionId, count]) => ({ sessionId, count }))
  }

  /**
   * 导出日志
   */
  exportLogs(filter?: AuditLogFilter): string {
    const logs = filter ? this.filter(filter) : this.getAll()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `audit-logs-${timestamp}.json`
    const filepath = join(this.exportDir, filename)

    const exportData = {
      exportTime: new Date().toISOString(),
      filter,
      totalLogs: logs.length,
      logs: logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    }

    writeFileSync(filepath, JSON.stringify(exportData, null, 2))

    return filepath
  }

  /**
   * 导出为 CSV
   */
  exportToCSV(filter?: AuditLogFilter): string {
    const logs = filter ? this.filter(filter) : this.getAll()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `audit-logs-${timestamp}.csv`
    const filepath = join(this.exportDir, filename)

    // CSV 头部
    const headers = ['Timestamp', 'Level', 'Action', 'Session ID', 'Resource', 'Success', 'Error Message']
    const rows = [headers.join(',')]

    // CSV 数据行
    logs.forEach(log => {
      const row = [
        log.timestamp,
        log.level,
        log.action,
        log.sessionId || '',
        log.resource || '',
        log.success ? 'Yes' : 'No',
        log.errorMessage || ''
      ].map(field => `"${String(field).replace(/"/g, '""')}"`)

      rows.push(row.join(','))
    })

    writeFileSync(filepath, rows.join('\n'))

    return filepath
  }

  /**
   * 清理旧日志
   */
  private startCleanupTimer(): void {
    // 每天清理一次超过90天的日志
    const cleanupInterval = 24 * 60 * 60 * 1000 // 24小时

    setInterval(() => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const oldLogs = this.getAll().filter(log => log.timestamp < ninetyDaysAgo)

      oldLogs.forEach(log => this.delete(log.id))

      if (oldLogs.length > 0) {
        console.log(`Cleaned up ${oldLogs.length} old audit logs`)
      }
    }, cleanupInterval)
  }

  /**
   * 清除所有日志
   */
  clearAll(): void {
    const logs = this.getAll()
    logs.forEach(log => this.delete(log.id))
  }

  /**
   * 获取今日日志
   */
  getToday(): AuditLog[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return this.getByTimeRange(today.toISOString(), new Date().toISOString())
  }

  /**
   * 获取本周日志
   */
  getWeek(): AuditLog[] {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return this.getByTimeRange(weekAgo.toISOString(), new Date().toISOString())
  }

  /**
   * 获取本月日志
   */
  getMonth(): AuditLog[] {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return this.getByTimeRange(monthAgo.toISOString(), new Date().toISOString())
  }
}

// 导出单例
export const auditLogManager = new AuditLogManager()
