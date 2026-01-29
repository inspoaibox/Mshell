import { ipcMain, dialog } from 'electron'
import { sshKeyManager } from '../managers/SSHKeyManager'

/**
 * Register SSH key IPC handlers
 */
export function registerSSHKeyHandlers() {
  // Get all keys
  ipcMain.handle('sshKey:getAll', async () => {
    try {
      const keys = sshKeyManager.getAllKeys()
      return { success: true, data: keys }
    } catch (error) {
      console.error('Failed to get SSH keys:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get key by ID
  ipcMain.handle('sshKey:get', async (_event, id: string) => {
    try {
      const key = sshKeyManager.getKey(id)
      if (!key) {
        return { success: false, error: 'Key not found' }
      }
      return { success: true, data: key }
    } catch (error) {
      console.error('Failed to get SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Generate key pair
  ipcMain.handle('sshKey:generate', async (_event, options: any) => {
    try {
      const key = sshKeyManager.generateKeyPair(options)
      return { success: true, data: key }
    } catch (error) {
      console.error('Failed to generate SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Add key manually
  ipcMain.handle('sshKey:add', async (_event, keyData: any) => {
    try {
      const key = sshKeyManager.addKey(keyData)
      return { success: true, data: key }
    } catch (error) {
      console.error('Failed to add SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Import key
  ipcMain.handle('sshKey:import', async (_event, name: string, privateKeyPath: string, passphrase?: string) => {
    try {
      const key = sshKeyManager.importKey(name, privateKeyPath, passphrase)
      return { success: true, data: key }
    } catch (error) {
      console.error('Failed to import SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Export key
  ipcMain.handle('sshKey:export', async (_event, id: string, exportPath: string) => {
    try {
      sshKeyManager.exportKey(id, exportPath)
      return { success: true }
    } catch (error) {
      console.error('Failed to export SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update key
  ipcMain.handle('sshKey:update', async (_event, id: string, updates: any) => {
    try {
      sshKeyManager.updateKey(id, updates)
      return { success: true }
    } catch (error) {
      console.error('Failed to update SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Delete key
  ipcMain.handle('sshKey:delete', async (_event, id: string) => {
    try {
      sshKeyManager.deleteKey(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to delete SSH key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Read private key
  ipcMain.handle('sshKey:readPrivateKey', async (_event, id: string) => {
    try {
      const privateKey = sshKeyManager.readPrivateKey(id)
      return { success: true, data: privateKey }
    } catch (error) {
      console.error('Failed to read private key:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get statistics
  ipcMain.handle('sshKey:getStatistics', async () => {
    try {
      const stats = sshKeyManager.getStatistics()
      return { success: true, data: stats }
    } catch (error) {
      console.error('Failed to get SSH key statistics:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Select private key file (for import)
  ipcMain.handle('sshKey:selectPrivateKeyFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Private Key File',
        filters: [
          { name: 'Private Key', extensions: ['pem', 'key', '*'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      return { success: true, data: result.filePaths[0] }
    } catch (error) {
      console.error('Failed to select private key file:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Select export path
  ipcMain.handle('sshKey:selectExportPath', async (_event, defaultName: string) => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Private Key',
        defaultPath: defaultName,
        filters: [
          { name: 'Private Key', extensions: ['pem'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      return { success: true, data: result.filePath }
    } catch (error) {
      console.error('Failed to select export path:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
