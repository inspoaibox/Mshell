import { ipcMain } from 'electron'
import { serverMonitorManager } from '../managers/ServerMonitorManager'
import { sshConnectionManager } from '../managers/SSHConnectionManager'
import { serverSecurityManager } from '../managers/ServerSecurityManager'

/**
 * Register server monitor IPC handlers
 */
export function registerServerMonitorHandlers() {
  // Start monitoring
  ipcMain.handle('serverMonitor:start', async (_event, sessionId: string, config?: any) => {
    try {
      const connection = sshConnectionManager.getConnection(sessionId)
      if (!connection || connection.status !== 'connected' || !connection.client) {
        return { success: false, error: 'Connection not found or not active' }
      }

      serverMonitorManager.startMonitoring(sessionId, connection.client, config)
      return { success: true }
    } catch (error) {
      console.error('Failed to start monitoring:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Stop monitoring
  ipcMain.handle('serverMonitor:stop', async (_event, sessionId: string) => {
    try {
      serverMonitorManager.stopMonitoring(sessionId)
      return { success: true }
    } catch (error) {
      console.error('Failed to stop monitoring:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get latest metrics
  ipcMain.handle('serverMonitor:getMetrics', async (_event, sessionId: string) => {
    try {
      const metrics = serverMonitorManager.getLatestMetrics(sessionId)
      if (!metrics) {
        return { success: false, error: 'No metrics available' }
      }
      return { success: true, data: metrics }
    } catch (error) {
      console.error('Failed to get metrics:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Refresh metrics immediately
  ipcMain.handle('serverMonitor:refresh', async (_event, sessionId: string) => {
    try {
      const metrics = await serverMonitorManager.refreshMetrics(sessionId)
      if (!metrics) {
        return { success: false, error: 'No metrics available' }
      }
      return { success: true, data: metrics }
    } catch (error) {
      console.error('Failed to refresh metrics:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get monitored sessions
  ipcMain.handle('serverMonitor:getMonitoredSessions', async () => {
    try {
      const sessions = serverMonitorManager.getMonitoredSessions()
      return { success: true, data: sessions }
    } catch (error) {
      console.error('Failed to get monitored sessions:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update config
  ipcMain.handle('serverMonitor:updateConfig', async (_event, sessionId: string, config: any) => {
    try {
      serverMonitorManager.updateConfig(sessionId, config)
      return { success: true }
    } catch (error) {
      console.error('Failed to update config:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 安全信息（在线会话、SSH 连接、认证失败次数）
  ipcMain.handle('serverMonitor:security', async (_event, sessionId: string) => {
    try {
      return { success: true, data: await serverSecurityManager.getSummary(sessionId) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '安全信息采集失败' }
    }
  })

  // 安全详情（含登录历史和认证日志）
  ipcMain.handle('serverMonitor:securityDetails', async (_event, sessionId: string) => {
    try {
      return { success: true, data: await serverSecurityManager.getDetails(sessionId) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '安全详情读取失败' }
    }
  })

  // Forward metrics events to renderer
  serverMonitorManager.on('metrics', (sessionId: string, metrics: any) => {
    // Send to all windows
    const { BrowserWindow } = require('electron')
    BrowserWindow.getAllWindows().forEach((window: Electron.BrowserWindow) => {
      window.webContents.send('serverMonitor:metrics', sessionId, metrics)
    })
  })

  // Forward error events to renderer
  serverMonitorManager.on('error', (sessionId: string, error: any) => {
    const { BrowserWindow } = require('electron')
    BrowserWindow.getAllWindows().forEach((window: Electron.BrowserWindow) => {
      window.webContents.send('serverMonitor:error', sessionId, error)
    })
  })
}
