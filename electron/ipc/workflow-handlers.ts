import { ipcMain, BrowserWindow } from 'electron'
import { workflowManager } from '../managers/WorkflowManager'

export function registerWorkflowHandlers() {
  ipcMain.handle('workflow:getAll', async () => {
    try {
      return { success: true, data: workflowManager.getAll() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:get', async (_event, id: string) => {
    try {
      const workflow = workflowManager.get(id)
      return workflow ? { success: true, data: workflow } : { success: false, error: 'Not found' }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:create', async (_event, data: any) => {
    try {
      return { success: true, data: workflowManager.create(data) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:update', async (_event, id: string, updates: any) => {
    try {
      workflowManager.update(id, updates)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:delete', async (_event, id: string) => {
    try {
      workflowManager.delete(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:execute', async (_event, id: string, variables?: any) => {
    try {
      const execution = await workflowManager.execute(id, variables)
      return { success: true, data: execution }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:getExecutions', async (_event, workflowId: string, limit?: number) => {
    try {
      return { success: true, data: workflowManager.getExecutions(workflowId, limit) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:search', async (_event, query: string) => {
    try {
      return { success: true, data: workflowManager.search(query) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:getByTag', async (_event, tag: string) => {
    try {
      return { success: true, data: workflowManager.getByTag(tag) }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('workflow:getStatistics', async () => {
    try {
      return { success: true, data: workflowManager.getStatistics() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  workflowManager.on('workflow-started', (data: any) => {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workflow:started', data)
    })
  })

  workflowManager.on('workflow-completed', (data: any) => {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workflow:completed', data)
    })
  })

  workflowManager.on('workflow-failed', (data: any) => {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('workflow:failed', data)
    })
  })
}
