import { ipcMain } from 'electron'
import { portManager } from '../managers/PortManager'
import type { PortCloseRequest } from '../../src/types/ports'

export function registerPortHandlers() {
  ipcMain.handle('ports:inspect', async (_event, connectionId: string) => {
    try {
      return { success: true, data: await portManager.inspect(connectionId) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '端口检测失败' }
    }
  })

  ipcMain.handle('ports:close', async (_event, connectionId: string, request: PortCloseRequest) => {
    try {
      return { success: true, data: await portManager.close(connectionId, request) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '关闭端口失败' }
    }
  })
}
