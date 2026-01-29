import { ipcMain } from 'electron'
import { serverMonitorManager } from '../managers/ServerMonitorManager'
import { sshConnectionManager } from '../managers/SSHConnectionManager'

/**
 * Register server monitor IPC handlers
 */
export function registerServerMonitorHandlers() {
  // Start monitoring
  ipcMain.handle('serverMonitor:start', async (_event, sessionId: string, config?: any) => {
    try {
      const connection = sshConnectionManager.getConnection(sessionId)
      if (!connection || !connection.client) {
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
