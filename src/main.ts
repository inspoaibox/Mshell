import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/main.css'
import App from './App.vue'
import i18n from './i18n'
import { applyAppShellTheme } from './utils/app-appearance'
import { translateLegacy } from './i18n/legacy'
import { installDomTranslator } from './i18n/dom-translator'

// 在应用挂载前应用主题，避免闪烁
async function initializeTheme() {
  try {
    const settings = await window.electronAPI.settings.get()
    if (settings?.general?.language === 'zh-CN' || settings?.general?.language === 'en-US') {
      i18n.global.locale.value = settings.general.language
      localStorage.setItem('locale', settings.general.language)
      document.documentElement.lang = settings.general.language
    }
    if (settings?.general?.theme) {
      applyAppShellTheme({
        theme: settings.general.theme,
        appearance: settings.general.appearance
      })
    }
  } catch (error) {
    console.error('Failed to initialize theme:', error)
  }
}

// 初始化主题后再挂载应用
initializeTheme().then(() => {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(ElementPlus)
  app.use(i18n)
  app.config.globalProperties.$legacyT = translateLegacy

  app.mount('#app')
  installDomTranslator(document.body)
})


