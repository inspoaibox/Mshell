import { ipcMain } from 'electron'
import { fail2banManager } from '../managers/Fail2BanManager'

export function registerFail2BanHandlers() {
  ipcMain.handle('fail2ban:getOverview', async (_event, connectionId: string) => {
    try {
      return { success: true, data: await fail2banManager.getOverview(connectionId) }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Fail2Ban 检测失败' }
    }
  })

  ipcMain.handle('fail2ban:install', async (_event, connectionId: string) => {
    try {
      return { success: true, data: await fail2banManager.install(connectionId) }
    } catch (error: any) {
      return { success: false, error: error?.message || 'Fail2Ban 安装失败' }
    }
  })

  ipcMain.handle(
    'fail2ban:unban',
    async (_event, connectionId: string, jail: string, ip: string) => {
      try {
        return { success: true, data: await fail2banManager.unban(connectionId, jail, ip) }
      } catch (error: any) {
        return { success: false, error: error?.message || '解封失败' }
      }
    }
  )
}
