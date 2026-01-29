import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/main.css'
import App from './App.vue'
import i18n from './i18n'

// 在应用挂载前应用主题，避免闪烁
async function initializeTheme() {
  try {
    const settings = await window.electronAPI.settings.get()
    if (settings?.general?.theme) {
      const theme = settings.general.theme
      const root = document.documentElement
      let isDark = true
      
      if (theme === 'auto') {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      } else {
        isDark = theme === 'dark'
      }
      
      if (isDark) {
        root.classList.remove('light-theme')
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
        root.classList.add('light-theme')
      }
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

  app.mount('#app')
})
