import { BrowserWindow, ipcMain } from 'electron'
import { firewallManager, type FirewallContext } from '../managers/FirewallManager'
import type { FirewallAction } from '../../src/utils/firewall-model'
export function registerFirewallHandlers() {
  const sendChanged = (id: string) =>
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send('firewall:changed', id)
    })
  ipcMain.handle('firewall:inspect', async (_event, id: string) => {
    try {
      return { success: true, data: await firewallManager.inspect(id) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '检测失败' }
    }
  })
  ipcMain.handle(
    'firewall:apply',
    async (event, id: string, action: FirewallAction, context: FirewallContext) => {
      const controller = new AbortController(),
        cancel = () => controller.abort()
      event.sender.once('destroyed', cancel)
      try {
        return {
          success: true,
          data: await firewallManager.apply(id, action, context, controller.signal)
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '操作失败' }
      } finally {
        event.sender.removeListener('destroyed', cancel)
        sendChanged(id)
      }
    }
  )
  ipcMain.handle('firewall:confirm', async (_event, id: string, token: string) => {
    try {
      return { success: true, data: await firewallManager.confirm(id, token) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '确认失败' }
    } finally {
      sendChanged(id)
    }
  })
}
