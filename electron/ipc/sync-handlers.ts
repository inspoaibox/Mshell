import { ipcMain } from 'electron'
import { syncManager } from '../managers/SyncManager'

/**
 * 注册同步相关的 IPC 处理器
 */
export function registerSyncHandlers(): void {
  // 获取同步配置
  ipcMain.handle('sync:getConfig', async () => {
    try {
      return { success: true, data: syncManager.getConfig() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 更新同步配置
  ipcMain.handle('sync:updateConfig', async (_event, updates) => {
    try {
      await syncManager.updateConfig(updates)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 验证 GitHub Token
  ipcMain.handle('sync:verifyGitHubToken', async (_event, token: string) => {
    try {
      const result = await syncManager.verifyGitHubToken(token)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 上传到 GitHub
  ipcMain.handle('sync:uploadToGitHub', async () => {
    try {
      const result = await syncManager.uploadToGitHub()
      return { success: result.success, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 GitHub 下载
  ipcMain.handle('sync:downloadFromGitHub', async () => {
    try {
      const result = await syncManager.downloadFromGitHub()
      return { success: result.success, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 断开 GitHub 连接
  ipcMain.handle('sync:disconnectGitHub', async () => {
    try {
      await syncManager.disconnectGitHub()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 验证 GitLab Token
  ipcMain.handle('sync:verifyGitLabToken', async (_event, token: string, instanceUrl?: string) => {
    try {
      const result = await syncManager.verifyGitLabToken(token, instanceUrl)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 上传到 GitLab
  ipcMain.handle('sync:uploadToGitLab', async () => {
    try {
      const result = await syncManager.uploadToGitLab()
      return { success: result.success, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 GitLab 下载
  ipcMain.handle('sync:downloadFromGitLab', async () => {
    try {
      const result = await syncManager.downloadFromGitLab()
      return { success: result.success, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 断开 GitLab 连接
  ipcMain.handle('sync:disconnectGitLab', async () => {
    try {
      await syncManager.disconnectGitLab()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 智能同步
  ipcMain.handle('sync:sync', async () => {
    try {
      const result = await syncManager.sync()
      return { success: result.success, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取同步状态
  ipcMain.handle('sync:getStatus', async () => {
    try {
      const status = await syncManager.getSyncStatus()
      return { success: true, data: status }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  console.log('[IPC] Sync handlers registered')
}
