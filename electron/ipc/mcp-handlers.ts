import { ipcMain } from 'electron'
import { appSettingsManager } from '../utils/app-settings'
import type { AgentMcpPermissionMode } from '../utils/app-settings'
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

  ipcMain.handle('mcp:setWriteEnabled', async (_event, enabled: boolean) => {
    return mcpServerManager.setWriteEnabled(enabled === true)
  })

  ipcMain.handle('mcp:setPermissionMode', async (_event, mode: AgentMcpPermissionMode) => {
    return mcpServerManager.setPermissionMode(mode)
  })

  ipcMain.handle('mcp:resolveApproval', async (_event, approvalId: string, approved: boolean) => ({
    success: mcpServerManager.resolveApproval(approvalId, approved)
  }))

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
