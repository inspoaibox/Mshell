import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface AppSettings {
  general: {
    language: 'zh-CN' | 'en-US'
    theme: 'light' | 'dark' | 'auto'
    appearance: 'modern' | 'terminal' | 'minimal'
    startWithSystem: boolean
    minimizeToTray: boolean
    closeToTray: boolean
    enableAuditLog: boolean
    enableSystemLog: boolean
  }
  terminal: {
    defaultFontSize: number
    defaultFontFamily: string
    defaultTheme: string
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
  security: {
    savePasswords: boolean
    sessionTimeout: number
    verifyHostKey: boolean
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    general: {
      language: 'zh-CN',
      theme: 'auto',
      appearance: 'modern',
      startWithSystem: false,
      minimizeToTray: false,
      closeToTray: false,
      enableAuditLog: true,
      enableSystemLog: true
    },
    terminal: {
      defaultFontSize: 14,
      defaultFontFamily: 'Consolas, monospace',
      defaultTheme: 'dark',
      scrollback: 1000,
      cursorStyle: 'block',
      cursorBlink: true,
      rendererType: 'auto'
    },
    sftp: {
      maxConcurrentTransfers: 3,
      defaultLocalPath: '',
      confirmBeforeDelete: true,
      showHiddenFiles: false
    },
    security: {
      savePasswords: true,
      sessionTimeout: 0,
      verifyHostKey: true
    }
  })

  function updateSettings(updates: Partial<AppSettings>) {
    settings.value = { ...settings.value, ...updates }
  }

  return {
    settings,
    updateSettings
  }
})
