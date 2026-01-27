import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerSSHHandlers } from './ipc/ssh-handlers'
import { registerSessionHandlers } from './ipc/session-handlers'
import { registerSFTPHandlers } from './ipc/sftp-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerLogHandlers } from './ipc/log-handlers'
import { registerDialogHandlers } from './ipc/dialog-handlers'
import { registerFsHandlers } from './ipc/fs-handlers'
import { registerPortForwardHandlers } from './ipc/port-forward-handlers'
import { registerSnippetHandlers } from './ipc/snippet-handlers'
import { registerBackupHandlers } from './ipc/backup-handlers'
import { crashRecoveryManager } from './utils/crash-recovery'
import { logger } from './utils/logger'
import { backupManager } from './managers/BackupManager'

let mainWindow: BrowserWindow | null = null

// Register IPC handlers
registerSSHHandlers()
registerSessionHandlers()
registerSFTPHandlers()
registerSettingsHandlers()
registerLogHandlers()
registerDialogHandlers()
import { ipcMain } from 'electron'
ipcMain.handle('app:getVersion', () => app.getVersion())
registerFsHandlers()
registerPortForwardHandlers()
registerSnippetHandlers()
registerBackupHandlers()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'MShell - SSH Client',
    show: false,
    autoHideMenuBar: true, // 自动隐藏菜单栏
    frame: true // 保留窗口边框
  })

  // 完全移除菜单栏
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setMenu(null)

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    // 开发模式：等待 Vite 服务器准备好
    const loadDevServer = async () => {
      // 强制使用IPv4地址，避免localhost解析问题
      const url = 'http://127.0.0.1:5173'
      let retries = 0
      const maxRetries = 15

      console.log('Waiting for Vite dev server at', url)

      while (retries < maxRetries) {
        try {
          // 先测试服务器是否可达
          const http = require('http')
          await new Promise<void>((resolve, reject) => {
            const req = http.get(url, (res: any) => {
              if (res.statusCode === 200 || res.statusCode === 304) {
                resolve()
              } else {
                reject(new Error(`Server returned ${res.statusCode}`))
              }
            })
            req.on('error', reject)
            req.setTimeout(2000, () => {
              req.destroy()
              reject(new Error('Timeout'))
            })
          })

          // 服务器可达，加载页面
          await mainWindow!.loadURL(url)
          mainWindow!.webContents.openDevTools()
          console.log('Successfully loaded dev server')
          break
        } catch (error) {
          retries++
          if (retries >= maxRetries) {
            logger.logError('system', 'Failed to load dev server', error as Error)
            console.error('Failed to load dev server after', maxRetries, 'retries:', error)
            console.error('Please make sure Vite dev server is running on http://127.0.0.1:5173')
          } else {
            console.log(`Waiting for dev server... (attempt ${retries}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
        }
      }
    }

    loadDevServer()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  // Handle local shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Check for Ctrl/Cmd modifier
    const control = process.platform === 'darwin' ? input.meta : input.control

    if (control && input.type === 'keyDown') {
      switch (input.key.toLowerCase()) {
        case 'n':
          mainWindow?.webContents.send('shortcut:new-connection')
          event.preventDefault()
          break
        case 'k':
          mainWindow?.webContents.send('shortcut:quick-connect')
          event.preventDefault()
          break
        case 'f':
          mainWindow?.webContents.send('shortcut:search')
          event.preventDefault()
          break
        case 'w':
          mainWindow?.webContents.send('shortcut:close-tab')
          event.preventDefault()
          break
        case ',':
          mainWindow?.webContents.send('shortcut:settings')
          event.preventDefault()
          break
        case 'tab':
          if (input.shift) {
            mainWindow?.webContents.send('shortcut:prev-tab')
          } else {
            mainWindow?.webContents.send('shortcut:next-tab')
          }
          event.preventDefault()
          break
      }
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      require('electron').shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  crashRecoveryManager.start()

  const crashCheck = crashRecoveryManager.checkForCrash()
  if (crashCheck.crashed) {
    logger.logError('system', 'Application crashed on previous run', new Error('Crash detected'))
  }

  // 初始化备份管理器
  await backupManager.initialize()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  crashRecoveryManager.stop()
  backupManager.cleanup()
})


