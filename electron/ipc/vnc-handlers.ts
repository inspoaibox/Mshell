/**
 * VNC IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron'
import { vncManager, VNCConnectionConfig } from '../managers/VNCManager'

export function registerVNCHandlers(): void {
  // 连接 VNC（启动 WebSocket 代理）
  ipcMain.handle('vnc:connect', async (_event, config: VNCConnectionConfig) => {
    console.log('[VNC Handler] Connecting to:', config.host)
    return await vncManager.connect(config)
  })

  // 断开 VNC
  ipcMain.handle('vnc:disconnect', async (_event, connectionId: string) => {
    console.log('[VNC Handler] Disconnecting:', connectionId)
    return await vncManager.disconnect(connectionId)
  })

  // 获取连接状态
  ipcMain.handle('vnc:getStatus', async (_event, connectionId: string) => {
    const status = vncManager.getStatus(connectionId)
    if (status) {
      return {
        success: true,
        data: {
          id: status.id,
          wsPort: status.wsPort,
          status: status.status,
          startTime: status.startTime
        }
      }
    }
    return { success: false, error: '连接不存在' }
  })

  // 获取所有连接
  ipcMain.handle('vnc:getAllConnections', async () => {
    const connections = vncManager.getAllConnections()
    return {
      success: true,
      data: connections.map(c => ({
        id: c.id,
        host: c.config.host,
        wsPort: c.wsPort,
        status: c.status,
        startTime: c.startTime
      }))
    }
  })

  // 监听 VNC 事件并转发到渲染进程
  vncManager.on('connected', (connectionId: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('vnc:connected', connectionId)
    })
  })

  vncManager.on('disconnected', (connectionId: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('vnc:disconnected', connectionId)
    })
  })

  vncManager.on('error', (connectionId: string, error: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('vnc:error', connectionId, error)
    })
  })

  console.log('[VNC Handler] VNC handlers registered')
}
