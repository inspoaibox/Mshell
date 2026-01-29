import { ipcMain } from 'electron'
import { sessionLockManager } from '../managers/SessionLockManager'

/**
 * Register session lock IPC handlers
 */
export function registerSessionLockHandlers() {
  // Get config
  ipcMain.handle('sessionLock:getConfig', async () => {
    try {
      const config = sessionLockManager.getConfig()
      return { success: true, data: config }
    } catch (error) {
      console.error('Failed to get lock config:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update config
  ipcMain.handle('sessionLock:updateConfig', async (_event, updates: any) => {
    try {
      sessionLockManager.updateConfig(updates)
      return { success: true }
    } catch (error) {
      console.error('Failed to update lock config:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Set password
  ipcMain.handle('sessionLock:setPassword', async (_event, password: string) => {
    try {
      sessionLockManager.setPassword(password)
      return { success: true }
    } catch (error) {
      console.error('Failed to set password:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Verify password
  ipcMain.handle('sessionLock:verifyPassword', async (_event, password: string) => {
    try {
      const isValid = sessionLockManager.verifyPassword(password)
      return { success: true, data: isValid }
    } catch (error) {
      console.error('Failed to verify password:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Check if has password
  ipcMain.handle('sessionLock:hasPassword', async () => {
    try {
      const hasPassword = sessionLockManager.hasPassword()
      return { success: true, data: hasPassword }
    } catch (error) {
      console.error('Failed to check password:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Remove password
  ipcMain.handle('sessionLock:removePassword', async () => {
    try {
      sessionLockManager.removePassword()
      return { success: true }
    } catch (error) {
      console.error('Failed to remove password:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Lock session
  ipcMain.handle('sessionLock:lock', async () => {
    try {
      sessionLockManager.lock()
      return { success: true }
    } catch (error) {
      console.error('Failed to lock session:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Unlock session
  ipcMain.handle('sessionLock:unlock', async (_event, password?: string) => {
    try {
      const result = sessionLockManager.unlock(password)
      return result
    } catch (error) {
      console.error('Failed to unlock session:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Check if locked
  ipcMain.handle('sessionLock:isLocked', async () => {
    try {
      const isLocked = sessionLockManager.isSessionLocked()
      return { success: true, data: isLocked }
    } catch (error) {
      console.error('Failed to check lock status:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update activity
  ipcMain.handle('sessionLock:updateActivity', async () => {
    try {
      sessionLockManager.updateActivity()
      return { success: true }
    } catch (error) {
      console.error('Failed to update activity:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get status
  ipcMain.handle('sessionLock:getStatus', async () => {
    try {
      const status = sessionLockManager.getStatus()
      return { success: true, data: status }
    } catch (error) {
      console.error('Failed to get lock status:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
