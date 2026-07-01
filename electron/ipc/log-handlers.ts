import { ipcMain } from 'electron'
import { logger } from '../utils/logger'

export function registerLogHandlers() {
  // 获取日志
  ipcMain.handle('log:getLogs', async (_event, filter?: { startDate?: string; endDate?: string; host?: string; level?: string }) => {
    try {
      const parsedFilter = filter ? {
        ...filter,
        startDate: filter.startDate ? new Date(filter.startDate) : undefined,
        endDate: filter.endDate ? new Date(filter.endDate) : undefined
      } : undefined
      
      const logs = logger.getLogs(parsedFilter)
      
      // 手动序列化每个日志条目，确保所有字段都是可序列化的
      return logs.map(log => ({
        id: String(log.id),
        timestamp: typeof log.timestamp === 'string' ? log.timestamp : new Date(log.timestamp).toISOString(),
        level: String(log.level),
        category: String(log.category),
        sessionId: log.sessionId ? String(log.sessionId) : undefined,
        sessionName: log.sessionName ? String(log.sessionName) : undefined,
        host: log.host ? String(log.host) : undefined,
        username: log.username ? String(log.username) : undefined,
        message: String(log.message),
        details: log.details ? String(log.details) : undefined,
        error: log.error ? String(log.error) : undefined
      }))
    } catch (error) {
      console.error('[log-handlers] Error getting logs:', error)
      return []
    }
  })

  // 清空系统日志
  ipcMain.handle('log:clearLogs', async () => {
    try {
      logger.clearLogs()
      return { success: true }
    } catch (error) {
      console.error('[log-handlers] Error clearing logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 启用会话日志
  ipcMain.handle('log:enableSessionLogging', async (_event, sessionId: string) => {
    logger.enableSessionLogging(sessionId)
    return { success: true }
  })

  // 禁用会话日志
  ipcMain.handle('log:disableSessionLogging', async (_event, sessionId: string) => {
    logger.disableSessionLogging(sessionId)
    return { success: true }
  })
}
