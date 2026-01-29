import { ipcMain } from 'electron'
import { connectionStatsManager } from '../managers/ConnectionStatsManager'

/**
 * 注册连接统计 IPC 处理器
 */
export function registerConnectionStatsHandlers() {
  // 初始化
  connectionStatsManager.initialize().catch(console.error)

  // 开始记录连接
  ipcMain.handle('connectionStats:start', async (_event, sessionId: string, sessionName: string) => {
    try {
      const id = connectionStatsManager.startConnection(sessionId, sessionName)
      return { success: true, data: id }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 结束连接记录
  ipcMain.handle('connectionStats:end', async (_event, sessionId: string) => {
    try {
      await connectionStatsManager.endConnection(sessionId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 更新流量统计
  ipcMain.handle('connectionStats:updateTraffic', async (_event, sessionId: string, bytesIn: number, bytesOut: number) => {
    try {
      connectionStatsManager.updateTraffic(sessionId, bytesIn, bytesOut)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 增加命令计数
  ipcMain.handle('connectionStats:incrementCommand', async (_event, sessionId: string) => {
    try {
      connectionStatsManager.incrementCommandCount(sessionId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取指定会话的统计
  ipcMain.handle('connectionStats:getBySession', async (_event, sessionId: string) => {
    try {
      const stats = connectionStatsManager.getBySession(sessionId)
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有统计
  ipcMain.handle('connectionStats:getAll', async () => {
    try {
      const stats = connectionStatsManager.getAll()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取总连接时长
  ipcMain.handle('connectionStats:getTotalDuration', async (_event, sessionId?: string) => {
    try {
      const duration = connectionStatsManager.getTotalDuration(sessionId)
      return { success: true, data: duration }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取总流量
  ipcMain.handle('connectionStats:getTotalTraffic', async (_event, sessionId?: string) => {
    try {
      const traffic = connectionStatsManager.getTotalTraffic(sessionId)
      return { success: true, data: traffic }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取平均连接时长
  ipcMain.handle('connectionStats:getAverageDuration', async (_event, sessionId?: string) => {
    try {
      const duration = connectionStatsManager.getAverageDuration(sessionId)
      return { success: true, data: duration }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取最近的连接记录
  ipcMain.handle('connectionStats:getRecent', async (_event, limit: number = 10) => {
    try {
      const stats = connectionStatsManager.getRecent(limit)
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取今天的统计
  ipcMain.handle('connectionStats:getToday', async () => {
    try {
      const stats = connectionStatsManager.getTodayStats()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取本周的统计
  ipcMain.handle('connectionStats:getWeek', async () => {
    try {
      const stats = connectionStatsManager.getWeekStats()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取本月的统计
  ipcMain.handle('connectionStats:getMonth', async () => {
    try {
      const stats = connectionStatsManager.getMonthStats()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取统计摘要
  ipcMain.handle('connectionStats:getSummary', async () => {
    try {
      const summary = connectionStatsManager.getSummary()
      return { success: true, data: summary }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 清理旧数据
  ipcMain.handle('connectionStats:cleanup', async () => {
    try {
      await connectionStatsManager.cleanupOldStats()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
