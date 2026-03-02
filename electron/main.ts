import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
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
import { registerCommandHistoryHandlers } from './ipc/command-history-handlers'
import { registerConnectionStatsHandlers } from './ipc/connection-stats-handlers'
import { registerSessionTemplateHandlers } from './ipc/session-template-handlers'
import { registerBackupHandlers } from './ipc/backup-handlers'
import { registerServerMonitorHandlers } from './ipc/server-monitor-handlers'
import { registerSSHKeyHandlers } from './ipc/ssh-key-handlers'
import { registerAuditLogHandlers } from './ipc/audit-log-handlers'
import { registerSessionLockHandlers } from './ipc/session-lock-handlers'
import { registerTaskSchedulerHandlers } from './ipc/task-scheduler-handlers'
import { registerWorkflowHandlers } from './ipc/workflow-handlers'
import { registerAIHandlers } from './ipc/ai-handlers'
import { registerRDPHandlers } from './ipc/rdp-handlers'
import { registerVNCHandlers } from './ipc/vnc-handlers'
import { registerSyncHandlers } from './ipc/sync-handlers'
import { registerQuickCommandHandlers } from './ipc/quick-command-handlers'
import { crashRecoveryManager } from './utils/crash-recovery'
import { logger } from './utils/logger'
import { backupManager } from './managers/BackupManager'
import { syncManager } from './managers/SyncManager'
import { appSettingsManager } from './utils/app-settings'
import { sessionLockManager } from './managers/SessionLockManager'
import { aiManager } from './managers/AIManager'
import { updateManager } from './managers/UpdateManager'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

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
registerCommandHistoryHandlers()
registerConnectionStatsHandlers()
registerSessionTemplateHandlers()
registerBackupHandlers()
registerServerMonitorHandlers()
registerSSHKeyHandlers()
registerAuditLogHandlers()
registerSessionLockHandlers()
registerTaskSchedulerHandlers()
registerWorkflowHandlers()
registerAIHandlers(ipcMain, aiManager)
registerRDPHandlers()
registerVNCHandlers()
registerSyncHandlers()
registerQuickCommandHandlers()

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

  // Handle local shortcuts - 支持用户自定义配置
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Check for Ctrl/Cmd modifier
    const control = process.platform === 'darwin' ? input.meta : input.control
    const settings = appSettingsManager.getSettings()
    const shortcuts = settings.shortcuts || {}

    // 辅助函数：检查快捷键是否匹配（支持用户自定义和清除）
    const matchShortcut = (id: string, defaultKey: string, defaultCtrl = true, defaultAlt = false, defaultShift = false): boolean => {
      const shortcut = shortcuts[id]
      
      // 如果用户配置了该快捷键
      if (shortcut !== undefined) {
        // 如果 key 为空，表示用户清除了该快捷键，不触发
        if (!shortcut.key) return false
        
        // 使用用户配置的快捷键
        const keyMatch = shortcut.key.toLowerCase() === input.key.toLowerCase() ||
                        (typeof input.code === 'string' && shortcut.key.toLowerCase() === input.code.replace('Key', '').toLowerCase())
        const ctrlMatch: boolean = !!shortcut.ctrl === !!control
        const altMatch: boolean = !!shortcut.alt === !!input.alt
        const shiftMatch: boolean = !!shortcut.shift === !!input.shift
        
        return keyMatch && ctrlMatch && altMatch && shiftMatch
      }
      
      // 使用默认快捷键
      const keyMatch = defaultKey.toLowerCase() === input.key.toLowerCase()
      return keyMatch && defaultCtrl === !!control && defaultAlt === !!input.alt && defaultShift === !!input.shift
    }

    if (input.type === 'keyDown') {
      // Ctrl+Alt+L: 锁定会话
      if (matchShortcut('lock-session', 'l', true, true, false)) {
        mainWindow?.webContents.send('shortcut:lock-session')
        event.preventDefault()
        return
      }
      
      // 新建连接 (默认 Ctrl+N)
      if (matchShortcut('new-session', 'n')) {
        mainWindow?.webContents.send('shortcut:new-connection')
        event.preventDefault()
        return
      }
      
      // 快速连接 (默认 Ctrl+T)
      if (matchShortcut('quick-connect', 't')) {
        mainWindow?.webContents.send('shortcut:quick-connect')
        event.preventDefault()
        return
      }
      
      // 搜索 (默认 Ctrl+F)
      if (matchShortcut('search-sessions', 'f')) {
        mainWindow?.webContents.send('shortcut:search')
        event.preventDefault()
        return
      }
      
      // 关闭标签 (默认 Ctrl+W)
      if (matchShortcut('close-tab', 'w')) {
        mainWindow?.webContents.send('shortcut:close-tab')
        event.preventDefault()
        return
      }
      
      // 设置 (默认 Ctrl+,)
      if (matchShortcut('open-settings', ',')) {
        mainWindow?.webContents.send('shortcut:settings')
        event.preventDefault()
        return
      }
      
      // 标签切换快捷键 (Ctrl+Tab / Ctrl+Shift+Tab)
      if (control && !input.alt && input.key.toLowerCase() === 'tab') {
        const nextTabShortcut = shortcuts['next-tab']
        const prevTabShortcut = shortcuts['prev-tab']
        
        // 检查是否被清除
        if (input.shift) {
          if (prevTabShortcut && !prevTabShortcut.key) return // 已清除
          mainWindow?.webContents.send('shortcut:prev-tab')
        } else {
          if (nextTabShortcut && !nextTabShortcut.key) return // 已清除
          mainWindow?.webContents.send('shortcut:next-tab')
        }
        event.preventDefault()
        return
      }
      
      // 数字键切换标签 (Ctrl+1-9)
      if (control && !input.alt && !input.shift) {
        const num = parseInt(input.key)
        if (num >= 1 && num <= 9) {
          const switchTabShortcut = shortcuts[`switch-tab-${num}`]
          // 检查是否被清除
          if (switchTabShortcut && !switchTabShortcut.key) return
          mainWindow?.webContents.send('shortcut:switch-tab', input.key)
          event.preventDefault()
          return
        }
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

  // 处理窗口关闭事件
  mainWindow.on('close', async (event) => {
    const settings = appSettingsManager.getSettings()
    
    // 只有启用了"关闭时最小化"且不是真正退出时，才最小化到托盘
    if (settings.general.closeToTray && !isQuitting) {
      event.preventDefault()
      
      // 检查是否需要锁定（关闭到托盘时锁定）
      try {
        const lockConfig = sessionLockManager.getConfig()
        if (lockConfig.lockOnMinimize && sessionLockManager.hasPassword()) {
          sessionLockManager.lock()
          console.log('[Main] Session locked on close to tray')
        }
      } catch (error) {
        console.error('[Main] Error locking on close to tray:', error)
      }
      
      mainWindow?.hide()
      return false
    }
  })

  // 处理窗口最小化事件
  // minimizeToTray: 点最小化按钮时隐藏到托盘而不是最小化到任务栏
  mainWindow.on('minimize', (event: Electron.Event) => {
    const settings = appSettingsManager.getSettings()
    if (settings.general.minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
      console.log('[Main] Window minimized to tray')
    } else {
      console.log('[Main] Window minimized to taskbar')
    }
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

  // 初始化同步管理器
  await syncManager.initialize()

  // 初始化 AI 管理器
  await aiManager.initialize()

  // 应用启动时打开设置
  const settings = appSettingsManager.getSettings()
  app.setLoginItemSettings({
    openAtLogin: settings.general.startWithSystem
  })

  createWindow()

  // 创建托盘图标（应用启动时就创建）
  createTray()

  // 设置 AI Manager 的主窗口引用
  if (mainWindow) {
    aiManager.setMainWindow(mainWindow)
    
    // 初始化更新管理器
    updateManager.init(mainWindow)
    
    // 启动时检查更新（如果设置中启用了自动检查）
    const settings = appSettingsManager.getSettings()
    if (settings.updates?.autoCheck) {
      // 延迟检查，等待窗口完全加载
      setTimeout(() => {
        updateManager.checkForUpdates()
      }, 5000)
    }
  }

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
  isQuitting = true
  crashRecoveryManager.stop()
  backupManager.cleanup()
  syncManager.cleanup()
  aiManager.cleanup()
})

// 创建托盘图标
function createTray() {
  if (tray) return

  // 使用应用图标作为托盘图标
  // 开发环境和生产环境的路径不同
  let iconPath: string
  
  if (app.isPackaged) {
    // 生产环境：打包后的路径
    iconPath = process.platform === 'win32'
      ? join(process.resourcesPath, 'build', 'icon.ico')
      : join(process.resourcesPath, 'build', 'icon.png')
  } else {
    // 开发环境：项目根目录
    iconPath = process.platform === 'win32'
      ? join(__dirname, '../build/icon.ico')
      : join(__dirname, '../build/icon.png')
  }
  
  const icon = nativeImage.createFromPath(iconPath)
  
  // 检查图标是否加载成功
  if (icon.isEmpty()) {
    console.error('Failed to load tray icon from:', iconPath)
    return
  }
  
  // Windows 托盘图标不需要 resize，使用原始大小
  tray = process.platform === 'win32' 
    ? new Tray(icon)
    : new Tray(icon.resize({ width: 16, height: 16 }))
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show()
      }
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  
  tray.setToolTip('MShell - SSH Client')
  tray.setContextMenu(contextMenu)
  
  // 单击托盘图标显示窗口（Windows 习惯）
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
  
  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    mainWindow?.show()
  })
}


