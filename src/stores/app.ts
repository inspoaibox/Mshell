import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SessionConfig, SessionGroup } from '@/types/session'

export interface Tab {
  id: string
  name: string
  session: SessionConfig
}

export interface TerminalOptions {
  theme: string
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  rendererType: 'dom' | 'canvas' | 'webgl'
}

/**
 * 应用全局状态管理
 * 集中管理所有跨组件共享的状态
 */
export const useAppStore = defineStore('app', () => {
  // ============ 视图状态 ============
  const activeView = ref<'sessions' | 'sftp' | 'port-forward' | 'snippets' | 'statistics' | 'logs' | 'settings'>('sessions')
  
  // ============ 标签页管理 ============
  const tabs = ref<Tab[]>([])
  const activeTab = ref<string>('')
  
  // 当前活动的会话
  const currentSession = computed(() => {
    const tab = tabs.value.find(t => t.id === activeTab.value)
    return tab?.session || null
  })
  
  // 添加标签页
  function addTab(tab: Tab) {
    tabs.value.push(tab)
    activeTab.value = tab.id
  }
  
  // 移除标签页
  async function removeTab(tabId: string) {
    const index = tabs.value.findIndex(t => t.id === tabId)
    if (index !== -1) {
      console.log(`[Store] Removing tab ${tabId}`)
      
      // 先断开连接，清理资源
      try {
        await window.electronAPI.ssh.disconnect(tabId)
        console.log(`[Store] Disconnected ${tabId}`)
      } catch (error) {
        console.error(`[Store] Error disconnecting ${tabId}:`, error)
      }
      
      // 移除标签
      tabs.value.splice(index, 1)
      
      // 如果关闭的是当前标签，切换到相邻标签
      if (activeTab.value === tabId) {
        if (tabs.value.length > 0) {
          activeTab.value = tabs.value[Math.max(0, index - 1)].id
        } else {
          activeTab.value = ''
        }
      }
      
      // 触发垃圾回收提示（仅在开发模式）
      if (import.meta.env.DEV && typeof global !== 'undefined' && global.gc) {
        setTimeout(() => {
          global.gc?.()
          console.log('[Store] Garbage collection triggered')
        }, 100)
      }
    }
  }
  
  // 切换到下一个标签
  function nextTab() {
    const currentIndex = tabs.value.findIndex(t => t.id === activeTab.value)
    if (currentIndex < tabs.value.length - 1) {
      activeTab.value = tabs.value[currentIndex + 1].id
    }
  }
  
  // 切换到上一个标签
  function prevTab() {
    const currentIndex = tabs.value.findIndex(t => t.id === activeTab.value)
    if (currentIndex > 0) {
      activeTab.value = tabs.value[currentIndex - 1].id
    }
  }
  
  // ============ 会话管理 ============
  const sessions = ref<SessionConfig[]>([])
  const groups = ref<SessionGroup[]>([])
  const isLoadingSessions = ref(false)
  const searchQuery = ref('')
  const filteredSessions = computed(() => {
    if (!searchQuery.value.trim()) {
      return sessions.value
    }
    const query = searchQuery.value.toLowerCase().trim()
    return sessions.value.filter(session => {
      return session.name.toLowerCase().includes(query) ||
             session.host.toLowerCase().includes(query) ||
             session.username.toLowerCase().includes(query) ||
             (session.provider && session.provider.toLowerCase().includes(query)) ||
             (session.region && session.region.toLowerCase().includes(query)) ||
             (session.notes && session.notes.toLowerCase().includes(query))
    })
  })
  
  // 加载会话数据
  async function loadSessions() {
    isLoadingSessions.value = true
    try {
      const [allSessions, allGroups] = await Promise.all([
        window.electronAPI.session.getAll(),
        window.electronAPI.session.getAllGroups()
      ])
      sessions.value = allSessions
      groups.value = allGroups
    } catch (error) {
      console.error('Failed to load sessions:', error)
      throw error
    } finally {
      isLoadingSessions.value = false
    }
  }
  
  // 创建会话
  async function createSession(config: Partial<SessionConfig>) {
    const newSession = await window.electronAPI.session.create(config)
    sessions.value.push(newSession)
    await loadSessions() // 重新加载以确保分组正确
    return newSession
  }
  
  // 更新会话
  async function updateSession(id: string, updates: Partial<SessionConfig>) {
    await window.electronAPI.session.update(id, updates)
    await loadSessions() // 重新加载
  }
  
  // 删除会话
  async function deleteSession(id: string) {
    await window.electronAPI.session.delete(id)
    sessions.value = sessions.value.filter(s => s.id !== id)
  }
  
  // 创建分组
  async function createGroup(name: string, description?: string) {
    const newGroup = await window.electronAPI.session.createGroup(name, description)
    groups.value.push(newGroup)
    await loadSessions()
    return newGroup
  }
  
  // 重命名分组
  async function renameGroup(groupId: string, newName: string) {
    await window.electronAPI.session.renameGroup(groupId, newName)
    await loadSessions()
  }
  
  // 删除分组
  async function deleteGroup(groupId: string) {
    await window.electronAPI.session.deleteGroup(groupId)
    await loadSessions()
  }
  
  // ============ 对话框状态 ============
  const showSessionForm = ref(false)
  const showQuickConnect = ref(false)
  const showTerminalSettings = ref(false)
  const editingSession = ref<SessionConfig | null>(null)
  
  // 打开会话编辑表单
  function openSessionForm(session?: SessionConfig) {
    editingSession.value = session || null
    showSessionForm.value = true
  }
  
  // 关闭会话表单
  function closeSessionForm() {
    showSessionForm.value = false
    editingSession.value = null
  }
  
  // ============ 终端配置 ============
  const terminalOptions = ref<TerminalOptions>({
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'JetBrains Mono, "Fira Code", Consolas, monospace',
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    rendererType: 'webgl'
  })
  
  // 更新终端配置
  function updateTerminalOptions(options: Partial<TerminalOptions>) {
    terminalOptions.value = { ...terminalOptions.value, ...options }
  }
  
  // ============ 应用设置 ============
  async function loadSettings() {
    try {
      const settings = await window.electronAPI.settings.get()
      if (settings) {
        applySettings(settings)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }
  
  function applySettings(settings: any) {
    // 应用主题
    if (settings.general?.theme) {
      applyTheme(settings.general.theme)
    }
    
    // 应用终端设置
    if (settings.terminal) {
      updateTerminalOptions({
        theme: settings.terminal.theme,
        fontSize: settings.terminal.fontSize,
        fontFamily: settings.terminal.fontFamily,
        cursorStyle: settings.terminal.cursorStyle,
        cursorBlink: settings.terminal.cursorBlink,
        scrollback: settings.terminal.scrollback,
        rendererType: settings.terminal.rendererType || 'webgl'
      })
    }
  }
  
  function applyTheme(theme: 'light' | 'dark' | 'auto') {
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
    
    // 自动切换终端主题
    const currentTerminalTheme = terminalOptions.value.theme
    if (currentTerminalTheme === 'dark' || currentTerminalTheme === 'light') {
      terminalOptions.value.theme = isDark ? 'dark' : 'light'
    }
  }
  
  // ============ 初始化 ============
  async function initialize() {
    await Promise.all([
      loadSessions(),
      loadSettings()
    ])
  }
  
  return {
    // 视图状态
    activeView,
    
    // 标签页
    tabs,
    activeTab,
    currentSession,
    addTab,
    removeTab,
    nextTab,
    prevTab,
    
    // 会话管理
    sessions,
    groups,
    isLoadingSessions,
    searchQuery,
    filteredSessions,
    loadSessions,
    createSession,
    updateSession,
    deleteSession,
    createGroup,
    renameGroup,
    deleteGroup,
    
    // 对话框
    showSessionForm,
    showQuickConnect,
    showTerminalSettings,
    editingSession,
    openSessionForm,
    closeSessionForm,
    
    // 终端配置
    terminalOptions,
    updateTerminalOptions,
    
    // 设置
    loadSettings,
    applySettings,
    
    // 初始化
    initialize
  }
})
