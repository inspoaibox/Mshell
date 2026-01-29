import { ipcMain } from 'electron'
import { commandHistoryManager } from '../managers/CommandHistoryManager'

/**
 * 注册命令历史 IPC 处理器
 */
export function registerCommandHistoryHandlers() {
  // 初始化
  commandHistoryManager.initialize().catch(console.error)

  // 添加命令到历史
  ipcMain.handle('commandHistory:add', async (_event, data: any) => {
    try {
      const history = await commandHistoryManager.addCommand(data)
      return { success: true, data: history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有历史
  ipcMain.handle('commandHistory:getAll', async (_event, limit?: number) => {
    try {
      const history = commandHistoryManager.getAllHistory(limit)
      return { success: true, data: history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取指定会话的历史
  ipcMain.handle('commandHistory:getBySession', async (_event, sessionId: string) => {
    try {
      const history = commandHistoryManager.getBySession(sessionId)
      return { success: true, data: history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 搜索命令历史
  ipcMain.handle('commandHistory:search', async (_event, query: string, sessionId?: string) => {
    try {
      const results = commandHistoryManager.searchCommands(query, sessionId)
      return { success: true, data: results }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取收藏的命令
  ipcMain.handle('commandHistory:getFavorites', async () => {
    try {
      const favorites = commandHistoryManager.getFavorites()
      return { success: true, data: favorites }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 切换收藏状态
  ipcMain.handle('commandHistory:toggleFavorite', async (_event, id: string) => {
    try {
      await commandHistoryManager.toggleFavorite(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取最常用的命令
  ipcMain.handle('commandHistory:getMostUsed', async (_event, limit: number = 10) => {
    try {
      const commands = commandHistoryManager.getMostUsedCommands(limit)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取最近使用的唯一命令
  ipcMain.handle('commandHistory:getRecentUnique', async (_event, limit: number = 50) => {
    try {
      const commands = commandHistoryManager.getRecentUniqueCommands(limit)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取今天的历史
  ipcMain.handle('commandHistory:getToday', async () => {
    try {
      const history = commandHistoryManager.getTodayHistory()
      return { success: true, data: history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按时间范围获取历史
  ipcMain.handle('commandHistory:getByTimeRange', async (_event, startDate: string, endDate: string) => {
    try {
      const history = commandHistoryManager.getByTimeRange(new Date(startDate), new Date(endDate))
      return { success: true, data: history }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 导出历史
  ipcMain.handle('commandHistory:export', async (_event, filePath: string) => {
    try {
      await commandHistoryManager.exportHistory(filePath)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 清理会话历史
  ipcMain.handle('commandHistory:clearSession', async (_event, sessionId: string) => {
    try {
      await commandHistoryManager.clearSessionHistory(sessionId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 清理所有历史
  ipcMain.handle('commandHistory:clearAll', async (_event, keepFavorites: boolean = true) => {
    try {
      await commandHistoryManager.clearAllHistory(keepFavorites)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取统计信息
  ipcMain.handle('commandHistory:getStatistics', async () => {
    try {
      const stats = commandHistoryManager.getStatistics()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除单条历史
  ipcMain.handle('commandHistory:delete', async (_event, id: string) => {
    try {
      await commandHistoryManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
