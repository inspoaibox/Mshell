import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { BrowserWindow, ipcMain, app } from 'electron'
import { logger } from '../utils/logger'

/**
 * 应用更新管理器
 * 使用 electron-updater 实现 GitHub Releases 自动更新
 */
export class UpdateManager {
  private mainWindow: BrowserWindow | null = null
  private isChecking = false

  /**
   * 初始化更新管理器
   */
  init(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow

    // 配置更新源 - GitHub Releases
    // 注意：需要在 electron-builder.json 中配置 publish 选项
    autoUpdater.autoDownload = false // 禁用自动下载，让用户选择
    autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装

    // 设置日志
    autoUpdater.logger = {
      info: (message: string) => logger.info('[AutoUpdater]', message),
      warn: (message: string) => logger.warn('[AutoUpdater]', message),
      error: (message: string) => logger.error('[AutoUpdater]', message),
      debug: (message: string) => logger.debug('[AutoUpdater]', message)
    }

    this.setupEventListeners()
    this.registerIpcHandlers()

    logger.info('[UpdateManager] Initialized')
  }

  /**
   * 设置更新事件监听
   */
  private setupEventListeners() {
    // 正在检查更新
    autoUpdater.on('checking-for-update', () => {
      logger.info('[UpdateManager] Checking for updates...')
      this.sendToRenderer('update:checking')
    })

    // 有可用更新
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('[UpdateManager] Update available:', info.version)
      this.sendToRenderer('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      })
    })

    // 没有可用更新
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info('[UpdateManager] No update available, current version:', info.version)
      this.sendToRenderer('update:not-available', {
        version: info.version
      })
    })

    // 下载进度
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      logger.debug('[UpdateManager] Download progress:', progress.percent.toFixed(2) + '%')
      this.sendToRenderer('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      })
    })

    // 下载完成
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('[UpdateManager] Update downloaded:', info.version)
      this.sendToRenderer('update:downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    })

    // 更新错误
    autoUpdater.on('error', (error: Error) => {
      logger.error('[UpdateManager] Update error:', error.message)
      this.sendToRenderer('update:error', {
        message: error.message
      })
    })
  }

  /**
   * 注册 IPC 处理器
   */
  private registerIpcHandlers() {
    // 检查更新
    ipcMain.handle('update:check', async () => {
      return this.checkForUpdates()
    })

    // 下载更新
    ipcMain.handle('update:download', async () => {
      return this.downloadUpdate()
    })

    // 安装更新并重启
    ipcMain.handle('update:install', async () => {
      return this.installUpdate()
    })

    // 获取当前版本
    ipcMain.handle('update:getVersion', async () => {
      return {
        success: true,
        data: {
          version: app.getVersion(),
          name: app.getName()
        }
      }
    })
  }

  /**
   * 检查更新
   */
  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (this.isChecking) {
      return { success: false, error: '正在检查更新中...' }
    }

    try {
      this.isChecking = true
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error: any) {
      logger.error('[UpdateManager] Check for updates failed:', error.message)
      return { success: false, error: error.message }
    } finally {
      this.isChecking = false
    }
  }

  /**
   * 下载更新
   */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error: any) {
      logger.error('[UpdateManager] Download update failed:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 安装更新并重启应用
   */
  installUpdate(): { success: boolean } {
    try {
      autoUpdater.quitAndInstall(false, true)
      return { success: true }
    } catch (error: any) {
      logger.error('[UpdateManager] Install update failed:', error.message)
      return { success: false }
    }
  }

  /**
   * 发送消息到渲染进程
   */
  private sendToRenderer(channel: string, data?: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }
}

// 单例导出
export const updateManager = new UpdateManager()
