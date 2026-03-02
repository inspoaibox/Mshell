import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// 快捷键配置
export interface ShortcutConfig {
  key: string  // 空字符串表示未配置/已清除
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  description: string
}

export interface AppSettings {
  general: {
    language: 'zh-CN' | 'en-US'
    theme: 'light' | 'dark' | 'auto'
    startWithSystem: boolean
    minimizeToTray: boolean
    closeToTray: boolean
  }
  terminal: {
    fontSize: number
    fontFamily: string
    theme: string
    scrollback: number
    cursorStyle: 'block' | 'underline' | 'bar'
    cursorBlink: boolean
    rendererType: 'auto' | 'webgl' | 'canvas' | 'dom'
  }
  sftp: {
    maxConcurrentTransfers: number
    defaultLocalPath: string
    confirmBeforeDelete: boolean
    showHiddenFiles: boolean
  }
  ssh: {
    timeout: number
    keepalive: boolean
    keepaliveInterval: number
  }
  security: {
    savePasswords: boolean
    sessionTimeout: number
    verifyHostKey: boolean
  }
  updates: {
    autoCheck: boolean
    autoDownload: boolean
  }
  // 全局快捷键配置
  shortcuts?: Record<string, ShortcutConfig>
}

class AppSettingsManager {
  private settingsFile: string
  private settings: AppSettings

  constructor() {
    const userDataPath = app.getPath('userData')
    this.settingsFile = path.join(userDataPath, 'settings.json')
    this.settings = this.getDefaultSettings()
    this.load()
  }

  private getDefaultSettings(): AppSettings {
    return {
      general: {
        language: 'zh-CN',
        theme: 'dark',
        startWithSystem: false,
        minimizeToTray: false,
        closeToTray: false
      },
      terminal: {
        fontSize: 14,
        fontFamily: 'Consolas, monospace',
        theme: 'dark',
        scrollback: 10000,
        cursorStyle: 'block',
        cursorBlink: true,
        rendererType: 'auto'
      },
      sftp: {
        maxConcurrentTransfers: 3,
        defaultLocalPath: app.getPath('downloads'),
        confirmBeforeDelete: true,
        showHiddenFiles: false
      },
      ssh: {
        timeout: 30,
        keepalive: true,
        keepaliveInterval: 60,
        commandAutocomplete: true,
        aiCommandSuggest: true,
        riskWarning: true,
        commandCorrection: true,
        commandExplain: true
      },
      security: {
        savePasswords: true,
        sessionTimeout: 0,
        verifyHostKey: true
      },
      updates: {
        autoCheck: true,
        autoDownload: false
      }
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const data = fs.readFileSync(this.settingsFile, 'utf-8')
        const loaded = JSON.parse(data)
        this.settings = { ...this.settings, ...loaded }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  private async save(): Promise<void> {
    try {
      const data = JSON.stringify(this.settings, null, 2)
      await fs.promises.writeFile(this.settingsFile, data)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    this.settings = {
      ...this.settings,
      ...updates,
      general: { ...this.settings.general, ...updates.general },
      terminal: { ...this.settings.terminal, ...updates.terminal },
      sftp: { ...this.settings.sftp, ...updates.sftp },
      ssh: { ...this.settings.ssh, ...updates.ssh },
      security: { ...this.settings.security, ...updates.security },
      updates: { ...this.settings.updates, ...updates.updates },
      shortcuts: updates.shortcuts !== undefined ? updates.shortcuts : this.settings.shortcuts
    }
    await this.save()
  }

  /**
   * 获取快捷键配置
   * @param id 快捷键 ID
   * @returns 快捷键配置，如果未配置或已清除返回 null
   */
  getShortcut(id: string): ShortcutConfig | null {
    const shortcut = this.settings.shortcuts?.[id]
    // 如果快捷键不存在或 key 为空，返回 null
    if (!shortcut || !shortcut.key) {
      return null
    }
    return shortcut
  }

  /**
   * 检查快捷键是否匹配
   * @param id 快捷键 ID
   * @param key 按键
   * @param ctrl Ctrl 键
   * @param alt Alt 键
   * @param shift Shift 键
   * @returns 是否匹配
   */
  matchShortcut(id: string, key: string, ctrl: boolean, alt: boolean, shift: boolean): boolean {
    const shortcut = this.getShortcut(id)
    if (!shortcut) return false
    
    return shortcut.key.toLowerCase() === key.toLowerCase() &&
           !!shortcut.ctrl === ctrl &&
           !!shortcut.alt === alt &&
           !!shortcut.shift === shift
  }

  async resetToDefaults(): Promise<void> {
    this.settings = this.getDefaultSettings()
    await this.save()
  }
}

export const appSettingsManager = new AppSettingsManager()
