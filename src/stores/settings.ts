import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface AppSettings {
  general: {
    language: 'zh-CN' | 'en-US'
    theme: 'light' | 'dark' | 'auto'
    startWithSystem: boolean
    minimizeToTray: boolean
    closeToTray: boolean
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
      startWithSystem: false,
      minimizeToTray: false,
      closeToTray: false
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
