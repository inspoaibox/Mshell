import { ipcMain } from 'electron'
import { appSettingsManager } from '../utils/app-settings'
import { mcpServerManager } from '../managers/MCPServerManager'

export function registerMCPHandlers() {
  ipcMain.handle('mcp:getStatus', async () => {
    return { success: true, data: mcpServerManager.getStatus() }
  })

  ipcMain.handle('mcp:start', async () => {
    return mcpServerManager.setEnabled(true)
  })

  ipcMain.handle('mcp:stop', async () => {
    return mcpServerManager.setEnabled(false)
  })

  ipcMain.handle('mcp:regenerateToken', async () => {
    return mcpServerManager.regenerateToken()
  })

  ipcMain.handle('mcp:getConfig', async () => {
    const settings = appSettingsManager.getSettings().agentMcp
    return {
      success: true,
      data: {
        ...mcpServerManager.getStatus(),
        enabled: settings.enabled
      }
    }
  })
}
