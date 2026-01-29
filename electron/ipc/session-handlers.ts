import { ipcMain } from 'electron'
import { sessionManager } from '../managers/SessionManager'

// Session IPC handlers
export function registerSessionHandlers() {
  // 初始化 session manager
  sessionManager.initialize().catch(console.error)

  ipcMain.handle('session:getAll', async () => {
    await sessionManager.initialize()
    return sessionManager.getAllSessions()
  })

  ipcMain.handle('session:search', async (_event, query: string) => {
    await sessionManager.initialize()
    return sessionManager.searchSessions(query)
  })

  ipcMain.handle('session:get', async (_event, id: string) => {
    await sessionManager.initialize()
    return sessionManager.getSession(id)
  })

  ipcMain.handle('session:create', async (_event, config: any) => {
    await sessionManager.initialize()
    return sessionManager.createSession(config)
  })

  ipcMain.handle('session:update', async (_event, id: string, updates: any) => {
    await sessionManager.initialize()
    sessionManager.updateSession(id, updates)
  })

  ipcMain.handle('session:delete', async (_event, id: string) => {
    try {
      await sessionManager.initialize()
      sessionManager.deleteSession(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('session:export', async (_event, filePath: string) => {
    await sessionManager.initialize()
    await sessionManager.exportSessions(filePath)
  })

  ipcMain.handle('session:import', async (_event, filePath: string) => {
    await sessionManager.initialize()
    return await sessionManager.importSessions(filePath)
  })

  // Group management
  ipcMain.handle('session:createGroup', async (_event, name: string, description?: string) => {
    await sessionManager.initialize()
    return await sessionManager.createGroup(name)
  })

  ipcMain.handle('session:getAllGroups', async () => {
    await sessionManager.initialize()
    return sessionManager.getAllGroups()
  })

  ipcMain.handle('session:addToGroup', async (_event, sessionId: string, groupId: string) => {
    await sessionManager.initialize()
    await sessionManager.addSessionToGroup(sessionId, groupId)
  })

  ipcMain.handle('session:renameGroup', async (_event, groupId: string, newName: string) => {
    await sessionManager.initialize()
    await sessionManager.renameGroup(groupId, newName)
  })

  ipcMain.handle('session:deleteGroup', async (_event, groupId: string) => {
    await sessionManager.initialize()
    await sessionManager.deleteGroup(groupId)
  })
}
