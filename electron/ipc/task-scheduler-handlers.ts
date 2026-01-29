import { ipcMain, BrowserWindow } from 'electron'
import { taskSchedulerManager } from '../managers/TaskSchedulerManager'

/**
 * Register task scheduler IPC handlers
 */
export function registerTaskSchedulerHandlers() {
  // Get all tasks
  ipcMain.handle('taskScheduler:getAll', async () => {
    try {
      const tasks = taskSchedulerManager.getAll()
      return { success: true, data: tasks }
    } catch (error) {
      console.error('Failed to get tasks:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get task by ID
  ipcMain.handle('taskScheduler:get', async (_event, id: string) => {
    try {
      const task = taskSchedulerManager.get(id)
      if (!task) {
        return { success: false, error: 'Task not found' }
      }
      return { success: true, data: task }
    } catch (error) {
      console.error('Failed to get task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Create task
  ipcMain.handle('taskScheduler:create', async (_event, data: any) => {
    try {
      const task = taskSchedulerManager.create(data)
      return { success: true, data: task }
    } catch (error) {
      console.error('Failed to create task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update task
  ipcMain.handle('taskScheduler:update', async (_event, id: string, updates: any) => {
    try {
      taskSchedulerManager.update(id, updates)
      return { success: true }
    } catch (error) {
      console.error('Failed to update task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Delete task
  ipcMain.handle('taskScheduler:delete', async (_event, id: string) => {
    try {
      taskSchedulerManager.delete(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to delete task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Enable task
  ipcMain.handle('taskScheduler:enable', async (_event, id: string) => {
    try {
      taskSchedulerManager.enableTask(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to enable task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Disable task
  ipcMain.handle('taskScheduler:disable', async (_event, id: string) => {
    try {
      taskSchedulerManager.disableTask(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to disable task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Execute task manually
  ipcMain.handle('taskScheduler:execute', async (_event, id: string) => {
    try {
      const execution = await taskSchedulerManager.executeTask(id, true)
      return { success: true, data: execution }
    } catch (error) {
      console.error('Failed to execute task:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get task executions
  ipcMain.handle('taskScheduler:getExecutions', async (_event, taskId: string, limit?: number) => {
    try {
      const executions = taskSchedulerManager.getExecutions(taskId, limit)
      return { success: true, data: executions }
    } catch (error) {
      console.error('Failed to get executions:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get all executions
  ipcMain.handle('taskScheduler:getAllExecutions', async () => {
    try {
      const executions = taskSchedulerManager.getAllExecutions()
      const executionsArray = Array.from(executions.entries()).map(([taskId, execs]) => ({
        taskId,
        executions: execs
      }))
      return { success: true, data: executionsArray }
    } catch (error) {
      console.error('Failed to get all executions:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Clear task executions
  ipcMain.handle('taskScheduler:clearExecutions', async (_event, taskId: string) => {
    try {
      taskSchedulerManager.clearExecutions(taskId)
      return { success: true }
    } catch (error) {
      console.error('Failed to clear executions:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Search tasks
  ipcMain.handle('taskScheduler:search', async (_event, query: string) => {
    try {
      const tasks = taskSchedulerManager.search(query)
      return { success: true, data: tasks }
    } catch (error) {
      console.error('Failed to search tasks:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get by tag
  ipcMain.handle('taskScheduler:getByTag', async (_event, tag: string) => {
    try {
      const tasks = taskSchedulerManager.getByTag(tag)
      return { success: true, data: tasks }
    } catch (error) {
      console.error('Failed to get tasks by tag:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get statistics
  ipcMain.handle('taskScheduler:getStatistics', async () => {
    try {
      const stats = taskSchedulerManager.getStatistics()
      return { success: true, data: stats }
    } catch (error) {
      console.error('Failed to get statistics:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Forward events to renderer
  taskSchedulerManager.on('task-started', (data: any) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('taskScheduler:task-started', data)
    })
  })

  taskSchedulerManager.on('task-completed', (data: any) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('taskScheduler:task-completed', data)
    })
  })

  taskSchedulerManager.on('task-failed', (data: any) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('taskScheduler:task-failed', data)
    })
  })

  taskSchedulerManager.on('task-notify', (data: any) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('taskScheduler:task-notify', data)
    })
  })
}
