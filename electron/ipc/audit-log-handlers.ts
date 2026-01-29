import { ipcMain } from 'electron'
import { auditLogManager, AuditAction, AuditLevel } from '../managers/AuditLogManager'

/**
 * Register audit log IPC handlers
 */
export function registerAuditLogHandlers() {
  // Get all logs
  ipcMain.handle('auditLog:getAll', async () => {
    try {
      const logs = auditLogManager.getAll()
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get audit logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get log by ID
  ipcMain.handle('auditLog:get', async (_event, id: string) => {
    try {
      const log = auditLogManager.get(id)
      if (!log) {
        return { success: false, error: 'Log not found' }
      }
      return { success: true, data: log }
    } catch (error) {
      console.error('Failed to get audit log:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Filter logs
  ipcMain.handle('auditLog:filter', async (_event, filter: any) => {
    try {
      const logs = auditLogManager.filter(filter)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to filter audit logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by time range
  ipcMain.handle('auditLog:getByTimeRange', async (_event, startDate: string, endDate: string) => {
    try {
      const logs = auditLogManager.getByTimeRange(startDate, endDate)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get logs by time range:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by level
  ipcMain.handle('auditLog:getByLevel', async (_event, level: AuditLevel) => {
    try {
      const logs = auditLogManager.getByLevel(level)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get logs by level:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by action
  ipcMain.handle('auditLog:getByAction', async (_event, action: AuditAction) => {
    try {
      const logs = auditLogManager.getByAction(action)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get logs by action:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by session
  ipcMain.handle('auditLog:getBySession', async (_event, sessionId: string) => {
    try {
      const logs = auditLogManager.getBySession(sessionId)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get logs by session:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by success status
  ipcMain.handle('auditLog:getBySuccess', async (_event, success: boolean) => {
    try {
      const logs = auditLogManager.getBySuccess(success)
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get logs by success:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get statistics
  ipcMain.handle('auditLog:getStatistics', async (_event, startDate?: string, endDate?: string) => {
    try {
      const stats = auditLogManager.getStatistics(startDate, endDate)
      return { success: true, data: stats }
    } catch (error) {
      console.error('Failed to get audit log statistics:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get today's logs
  ipcMain.handle('auditLog:getToday', async () => {
    try {
      const logs = auditLogManager.getToday()
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get today logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get this week's logs
  ipcMain.handle('auditLog:getWeek', async () => {
    try {
      const logs = auditLogManager.getWeek()
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get week logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get this month's logs
  ipcMain.handle('auditLog:getMonth', async () => {
    try {
      const logs = auditLogManager.getMonth()
      return { success: true, data: logs }
    } catch (error) {
      console.error('Failed to get month logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Export logs
  ipcMain.handle('auditLog:export', async (_event, filter?: any) => {
    try {
      const filepath = auditLogManager.exportLogs(filter)
      return { success: true, data: filepath }
    } catch (error) {
      console.error('Failed to export audit logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Export to CSV
  ipcMain.handle('auditLog:exportToCSV', async (_event, filter?: any) => {
    try {
      const filepath = auditLogManager.exportToCSV(filter)
      return { success: true, data: filepath }
    } catch (error) {
      console.error('Failed to export audit logs to CSV:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Clear all logs
  ipcMain.handle('auditLog:clearAll', async () => {
    try {
      auditLogManager.clearAll()
      return { success: true }
    } catch (error) {
      console.error('Failed to clear audit logs:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Delete log
  ipcMain.handle('auditLog:delete', async (_event, id: string) => {
    try {
      auditLogManager.delete(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to delete audit log:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
