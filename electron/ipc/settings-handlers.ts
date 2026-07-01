import { ipcMain, BrowserWindow, app } from 'electron'
import { appSettingsManager, AppSettings } from '../utils/app-settings'
import { auditLogManager, AuditAction } from '../managers/AuditLogManager'
import { sessionManager } from '../managers/SessionManager'

// 缓存上一次的开机启动设置值，避免重复调用
let lastStartWithSystem: boolean | undefined = undefined

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async () => {
    return appSettingsManager.getSettings()
  })

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    const previousSettings = appSettingsManager.getSettings()
    await appSettingsManager.updateSettings(updates)
    const settings = appSettingsManager.getSettings()

    if (
      previousSettings.security.savePasswords !== false &&
      settings.security.savePasswords === false
    ) {
      await sessionManager.removeSavedSecrets()
    }

    if (settings.general.enableAuditLog !== false) {
      auditLogManager.log(AuditAction.SETTINGS_UPDATE, {
        resource: 'app-settings',
        details: { updates },
        success: true
      })
    }

    // 只有当 startWithSystem 值真正改变时才调用 setLoginItemSettings
    // 这个 API 在 Windows 上非常慢（约 2 秒）
    if (updates.general?.startWithSystem !== undefined && 
        updates.general.startWithSystem !== lastStartWithSystem) {
      lastStartWithSystem = updates.general.startWithSystem
      // 异步执行，不阻塞返回
      setImmediate(() => {
        app.setLoginItemSettings({
          openAtLogin: updates.general!.startWithSystem
        })
      })
    }

    // Broadcast change to all windows
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('settings:changed', settings)
    })

    return { success: true }
  })

  ipcMain.handle('settings:reset', async () => {
    await appSettingsManager.resetToDefaults()
    
    const settings = appSettingsManager.getSettings()
    if (settings.general.enableAuditLog !== false) {
      auditLogManager.log(AuditAction.SETTINGS_UPDATE, {
        resource: 'app-settings',
        details: { action: 'reset-to-defaults' },
        success: true
      })
    }
    
    return { success: true }
  })
}
