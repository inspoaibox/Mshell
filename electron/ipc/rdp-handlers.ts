/**
 * RDP IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron'
import { rdpManager, RDPConnectionConfig } from '../managers/RDPManager'

export function registerRDPHandlers(): void {
  // 连接 RDP
  ipcMain.handle('rdp:connect', async (_event, config: RDPConnectionConfig) => {
    console.log('[RDP Handler] Connecting to:', config.host)
    return await rdpManager.connect(config)
  })

  // 断开 RDP
  ipcMain.handle('rdp:disconnect', async (_event, connectionId: string) => {
    console.log('[RDP Handler] Disconnecting:', connectionId)
    return await rdpManager.disconnect(connectionId)
  })

  // 获取连接状态
  ipcMain.handle('rdp:getStatus', async (_event, connectionId: string) => {
    const status = rdpManager.getStatus(connectionId)
    if (status) {
      return {
        success: true,
        data: {
          id: status.id,
          status: status.status,
          startTime: status.startTime
        }
      }
    }
    return { success: false, error: '连接不存在' }
  })

  // 获取所有连接
  ipcMain.handle('rdp:getAllConnections', async () => {
    const connections = rdpManager.getAllConnections()
    return {
      success: true,
      data: connections.map(c => ({
        id: c.id,
        host: c.config.host,
        status: c.status,
        startTime: c.startTime
      }))
    }
  })

  // 监听 RDP 事件并转发到渲染进程
  rdpManager.on('connected', (connectionId: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('rdp:connected', connectionId)
    })
  })

  rdpManager.on('disconnected', (connectionId: string, code: number | null) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('rdp:disconnected', connectionId, code)
    })
  })

  rdpManager.on('error', (connectionId: string, error: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('rdp:error', connectionId, error)
    })
  })

  console.log('[RDP Handler] RDP handlers registered')
}
