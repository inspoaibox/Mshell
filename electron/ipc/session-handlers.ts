import { ipcMain } from 'electron'
import { sessionManager } from '../managers/SessionManager'
import { auditLogManager, AuditAction } from '../managers/AuditLogManager'

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
    try {
      await sessionManager.initialize()
      
      // 清理配置，确保可序列化
      const cleanConfig = JSON.parse(JSON.stringify(config))
      const session = await sessionManager.createSession(cleanConfig)
      
      // 记录审计日志
      auditLogManager.log(AuditAction.SESSION_CREATE, {
        sessionId: session.id,
        resource: config.name || config.host,
        details: { name: config.name, host: config.host, port: config.port, username: config.username },
        success: true
      })
      
      return { success: true, data: session }
    } catch (error: any) {
      console.error('Failed to create session:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('session:update', async (_event, id: string, updates: any) => {
    try {
      await sessionManager.initialize()
      
      // 清理更新数据，确保可序列化
      const cleanUpdates = JSON.parse(JSON.stringify(updates))
      await sessionManager.updateSession(id, cleanUpdates)
      
      // 记录审计日志
      auditLogManager.log(AuditAction.SESSION_UPDATE, {
        sessionId: id,
        resource: updates.name || id,
        details: { name: updates.name, host: updates.host },
        success: true
      })
      
      return { success: true }
    } catch (error: any) {
      console.error('Failed to update session:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('session:delete', async (_event, id: string) => {
    try {
      await sessionManager.initialize()
      const session = sessionManager.getSession(id)
      sessionManager.deleteSession(id)
      
      // 记录审计日志
      auditLogManager.log(AuditAction.SESSION_DELETE, {
        sessionId: id,
        resource: session?.name || id,
        details: { sessionName: session?.name, host: session?.host },
        success: true
      })
      
      return { success: true }
    } catch (error: any) {
      auditLogManager.log(AuditAction.SESSION_DELETE, {
        sessionId: id,
        success: false,
        errorMessage: error.message
      })
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
