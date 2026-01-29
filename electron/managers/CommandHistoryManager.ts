import { BaseManager } from './BaseManager'

/**
 * 命令历史记录接口
 */
export interface CommandHistory {
  id: string
  command: string
  sessionId: string
  sessionName: string
  timestamp: string
  exitCode?: number
  duration?: number // 执行时长（毫秒）
  favorite: boolean
}

/**
 * CommandHistoryManager - 管理命令历史
 */
export class CommandHistoryManager extends BaseManager<CommandHistory> {
  private maxHistorySize: number = 10000 // 最多保存10000条历史

  constructor() {
    super('command-history.json')
  }

  /**
   * 添加命令到历史
   */
  async addCommand(data: {
    command: string
    sessionId: string
    sessionName: string
    exitCode?: number
    duration?: number
  }): Promise<CommandHistory> {
    const now = new Date().toISOString()
    
    const history: CommandHistory = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      command: data.command,
      sessionId: data.sessionId,
      sessionName: data.sessionName,
      timestamp: now,
      exitCode: data.exitCode,
      duration: data.duration,
      favorite: false
    }

    await this.create(history)
    
    // 检查历史大小，超过限制则删除最旧的
    await this.trimHistory()
    
    return history
  }

  /**
   * 获取指定会话的历史
   */
  getBySession(sessionId: string): CommandHistory[] {
    return this.getAll()
      .filter(h => h.sessionId === sessionId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * 获取所有会话的历史（跨会话）
   */
  getAllHistory(limit?: number): CommandHistory[] {
    const all = this.getAll()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    
    return limit ? all.slice(0, limit) : all
  }

  /**
   * 搜索命令历史
   */
  searchCommands(query: string, sessionId?: string): CommandHistory[] {
    let results = this.search(query, ['command', 'sessionName'])
    
    if (sessionId) {
      results = results.filter(h => h.sessionId === sessionId)
    }
    
    return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * 获取收藏的命令
   */
  getFavorites(): CommandHistory[] {
    return this.getAll()
      .filter(h => h.favorite)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(id: string): Promise<void> {
    const history = this.get(id)
    if (history) {
      await this.update(id, { favorite: !history.favorite })
    }
  }

  /**
   * 获取最常用的命令
   */
  getMostUsedCommands(limit: number = 10): Array<{ command: string; count: number }> {
    const commandCounts = new Map<string, number>()
    
    for (const history of this.getAll()) {
      const count = commandCounts.get(history.command) || 0
      commandCounts.set(history.command, count + 1)
    }
    
    return Array.from(commandCounts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  /**
   * 获取最近使用的唯一命令（用于自动补全）
   */
  getRecentUniqueCommands(limit: number = 50): string[] {
    const seen = new Set<string>()
    const unique: string[] = []
    
    const sorted = this.getAll()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    
    for (const history of sorted) {
      if (!seen.has(history.command)) {
        seen.add(history.command)
        unique.push(history.command)
        
        if (unique.length >= limit) {
          break
        }
      }
    }
    
    return unique
  }

  /**
   * 按时间范围获取历史
   */
  getByTimeRange(startDate: Date, endDate: Date): CommandHistory[] {
    const start = startDate.getTime()
    const end = endDate.getTime()
    
    return this.getAll()
      .filter(h => {
        const time = new Date(h.timestamp).getTime()
        return time >= start && time <= end
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * 获取今天的历史
   */
  getTodayHistory(): CommandHistory[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    return this.getByTimeRange(today, tomorrow)
  }

  /**
   * 导出历史记录
   */
  async exportHistory(filePath: string): Promise<void> {
    const fs = require('fs').promises
    const history = this.getAll()
    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8')
  }

  /**
   * 清理旧历史（保留最近的记录）
   */
  private async trimHistory(): Promise<void> {
    const all = this.getAllHistory()
    
    if (all.length > this.maxHistorySize) {
      // 保留收藏的命令和最近的命令
      const favorites = all.filter(h => h.favorite)
      const recent = all.filter(h => !h.favorite).slice(0, this.maxHistorySize - favorites.length)
      
      // 删除其他的
      const toKeep = new Set([...favorites.map(h => h.id), ...recent.map(h => h.id)])
      
      for (const history of all) {
        if (!toKeep.has(history.id)) {
          await this.delete(history.id)
        }
      }
    }
  }

  /**
   * 清理指定会话的历史
   */
  async clearSessionHistory(sessionId: string): Promise<void> {
    const sessionHistory = this.getBySession(sessionId)
    
    for (const history of sessionHistory) {
      if (!history.favorite) {
        await this.delete(history.id)
      }
    }
  }

  /**
   * 清理所有历史（保留收藏）
   */
  async clearAllHistory(keepFavorites: boolean = true): Promise<void> {
    const all = this.getAll()
    
    for (const history of all) {
      if (!keepFavorites || !history.favorite) {
        await this.delete(history.id)
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalCommands: number
    uniqueCommands: number
    favoritesCount: number
    sessionsCount: number
    todayCount: number
  } {
    const all = this.getAll()
    const uniqueCommands = new Set(all.map(h => h.command)).size
    const favoritesCount = all.filter(h => h.favorite).length
    const sessionsCount = new Set(all.map(h => h.sessionId)).size
    const todayCount = this.getTodayHistory().length
    
    return {
      totalCommands: all.length,
      uniqueCommands,
      favoritesCount,
      sessionsCount,
      todayCount
    }
  }
}

// 导出单例
export const commandHistoryManager = new CommandHistoryManager()
