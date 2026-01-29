import { BaseManager } from './BaseManager'

/**
 * 连接统计记录接口
 */
export interface ConnectionStat {
  id: string
  sessionId: string
  sessionName: string
  connectedAt: string
  disconnectedAt?: string
  duration?: number // 连接时长（秒）
  bytesIn?: number // 接收字节数
  bytesOut?: number // 发送字节数
  commandCount?: number // 执行命令数
}

/**
 * ConnectionStatsManager - 管理连接统计
 */
export class ConnectionStatsManager extends BaseManager<ConnectionStat> {
  private activeConnections: Map<string, { startTime: number; bytesIn: number; bytesOut: number; commandCount: number }>

  constructor() {
    super('connection-stats.json')
    this.activeConnections = new Map()
  }

  /**
   * 开始记录连接
   */
  startConnection(sessionId: string, sessionName: string): string {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()
    
    // 记录活动连接
    this.activeConnections.set(sessionId, {
      startTime: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      commandCount: 0
    })
    
    // 创建统计记录
    const stat: ConnectionStat = {
      id,
      sessionId,
      sessionName,
      connectedAt: now
    }
    
    this.create(stat).catch(console.error)
    
    return id
  }

  /**
   * 结束连接记录
   */
  async endConnection(sessionId: string): Promise<void> {
    const active = this.activeConnections.get(sessionId)
    if (!active) return
    
    const duration = Math.floor((Date.now() - active.startTime) / 1000)
    const now = new Date().toISOString()
    
    // 查找对应的统计记录
    const stat = this.getAll().find(s => 
      s.sessionId === sessionId && !s.disconnectedAt
    )
    
    if (stat) {
      await this.update(stat.id, {
        disconnectedAt: now,
        duration,
        bytesIn: active.bytesIn,
        bytesOut: active.bytesOut,
        commandCount: active.commandCount
      })
    }
    
    this.activeConnections.delete(sessionId)
  }

  /**
   * 更新流量统计
   */
  updateTraffic(sessionId: string, bytesIn: number, bytesOut: number): void {
    const active = this.activeConnections.get(sessionId)
    if (active) {
      active.bytesIn += bytesIn
      active.bytesOut += bytesOut
    }
  }

  /**
   * 增加命令计数
   */
  incrementCommandCount(sessionId: string): void {
    const active = this.activeConnections.get(sessionId)
    if (active) {
      active.commandCount++
    }
  }

  /**
   * 获取指定会话的统计
   */
  getBySession(sessionId: string): ConnectionStat[] {
    return this.getAll()
      .filter(s => s.sessionId === sessionId)
      .sort((a, b) => new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime())
  }

  /**
   * 获取总连接时长
   */
  getTotalDuration(sessionId?: string): number {
    let stats = this.getAll()
    if (sessionId) {
      stats = stats.filter(s => s.sessionId === sessionId)
    }
    return stats.reduce((acc, s) => acc + (s.duration || 0), 0)
  }

  /**
   * 获取总流量
   */
  getTotalTraffic(sessionId?: string): { bytesIn: number; bytesOut: number; total: number } {
    let stats = this.getAll()
    if (sessionId) {
      stats = stats.filter(s => s.sessionId === sessionId)
    }
    
    const bytesIn = stats.reduce((acc, s) => acc + (s.bytesIn || 0), 0)
    const bytesOut = stats.reduce((acc, s) => acc + (s.bytesOut || 0), 0)
    
    return {
      bytesIn,
      bytesOut,
      total: bytesIn + bytesOut
    }
  }

  /**
   * 获取平均连接时长
   */
  getAverageDuration(sessionId?: string): number {
    let stats = this.getAll().filter(s => s.duration && s.duration > 0)
    if (sessionId) {
      stats = stats.filter(s => s.sessionId === sessionId)
    }
    
    if (stats.length === 0) return 0
    
    const total = stats.reduce((acc, s) => acc + (s.duration || 0), 0)
    return total / stats.length
  }

  /**
   * 获取最近的连接记录
   */
  getRecent(limit: number = 10): ConnectionStat[] {
    return this.getAll()
      .sort((a, b) => new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime())
      .slice(0, limit)
  }

  /**
   * 按时间范围获取统计
   */
  getByTimeRange(startDate: Date, endDate: Date): ConnectionStat[] {
    const start = startDate.getTime()
    const end = endDate.getTime()
    
    return this.getAll()
      .filter(s => {
        const time = new Date(s.connectedAt).getTime()
        return time >= start && time <= end
      })
      .sort((a, b) => new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime())
  }

  /**
   * 获取今天的统计
   */
  getTodayStats(): ConnectionStat[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    return this.getByTimeRange(today, tomorrow)
  }

  /**
   * 获取本周的统计
   */
  getWeekStats(): ConnectionStat[] {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    weekStart.setHours(0, 0, 0, 0)
    
    return this.getByTimeRange(weekStart, now)
  }

  /**
   * 获取本月的统计
   */
  getMonthStats(): ConnectionStat[] {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    
    return this.getByTimeRange(monthStart, now)
  }

  /**
   * 清理旧数据（保留最近90天）
   */
  async cleanupOldStats(): Promise<void> {
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    
    const oldStats = this.getAll().filter(s => 
      new Date(s.connectedAt).getTime() < ninetyDaysAgo.getTime()
    )
    
    for (const stat of oldStats) {
      await this.delete(stat.id)
    }
  }

  /**
   * 获取统计摘要
   */
  getSummary(): {
    totalConnections: number
    totalDuration: number
    averageDuration: number
    totalTraffic: { bytesIn: number; bytesOut: number; total: number }
    todayConnections: number
    weekConnections: number
    monthConnections: number
  } {
    return {
      totalConnections: this.count(),
      totalDuration: this.getTotalDuration(),
      averageDuration: this.getAverageDuration(),
      totalTraffic: this.getTotalTraffic(),
      todayConnections: this.getTodayStats().length,
      weekConnections: this.getWeekStats().length,
      monthConnections: this.getMonthStats().length
    }
  }
}

// 导出单例
export const connectionStatsManager = new ConnectionStatsManager()
