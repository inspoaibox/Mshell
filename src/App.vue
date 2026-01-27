<template>
  <div id="app">
    <div class="app-layout">
      <Sidebar @menu-select="handleMenuSelect" />
      
      <div class="app-main">
        <!-- Moved Toolbar inside specific views or make it global if needed. 
             For now, keeping it but styling it better. -->
        <div class="app-header">
           <div class="app-title-drag"></div> <!-- draggable region if electron -->
           <div class="header-actions">
              <el-button type="primary" size="small" :icon="Plus" @click="showSessionForm = true" circle />
              <el-button size="small" :icon="Lightning" @click="showQuickConnect = true" circle />
           </div>
        </div>
        
        <div class="app-content">
          <div v-show="activeView === 'sessions'" class="content-panel">
            <div class="sessions-panel glass-panel">
              <SessionList
                :sessions="sessions"
                :groups="groups"
                @connect="handleConnect"
                @edit="handleEditSession"
                @refresh="loadData"
                @create-group="handleCreateGroup"
                @rename-group="handleRenameGroup"
                @delete-group="handleDeleteGroup"
              />
            </div>
            <div class="terminal-panel">
              <el-tabs
                v-model="activeTab"
                type="card"
                closable
                class="premium-tabs"
                @tab-remove="handleTabRemove"
                @tab-click="handleTabClick"
              >
                <el-tab-pane
                  v-for="tab in tabs"
                  :key="tab.id"
                  :label="tab.name"
                  :name="tab.id"
                >
                  <TerminalTab
                    :connection-id="tab.id"
                    :session="tab.session"
                    :terminal-options="terminalOptions"
                    @close="handleTabRemove"
                  />
                </el-tab-pane>
                
                <template v-if="tabs.length === 0">
                  <div class="empty-state">
                    <div class="empty-state-content">
                      <div class="empty-icon-wrapper">
                         <el-icon :size="48"><Connection /></el-icon>
                      </div>
                      <h3>Ready to Connect</h3>
                      <p>Select a session from the list or create a new one to get started.</p>
                      <div class="empty-actions">
                        <el-button type="primary" @click="showSessionForm = true" size="large">
                          Create New Session
                        </el-button>
                        <el-button @click="showQuickConnect = true" size="large">
                          Quick Connect
                        </el-button>
                      </div>
                    </div>
                  </div>
                </template>
              </el-tabs>
            </div>
          </div>
          
          <div v-show="activeView === 'sftp'" class="content-panel">
            <SFTPPanel />
          </div>
          
          <div v-show="activeView === 'port-forward'" class="content-panel">
            <PortForwardPanel v-if="activeTab && tabs.length > 0" :connection-id="activeTab" />
            <div v-else class="empty-state">
               <div class="empty-state-content">
                  <el-icon :size="64"><Connection /></el-icon>
                  <p>Please establish an SSH connection first.</p>
               </div>
            </div>
          </div>
          
          <div v-show="activeView === 'snippets'" class="content-panel">
            <SnippetPanel />
          </div>

          <div v-show="activeView === 'statistics'" class="content-panel">
            <StatisticsPanel ref="statisticsPanel" />
          </div>
          
          <div v-show="activeView === 'logs'" class="content-panel">
            <LogViewer />
          </div>
          
          <div v-show="activeView === 'settings'" class="content-panel">
            <SettingsPanel />
          </div>
        </div>
        
        <StatusBar
          :active-connections="tabs.length"
          :current-session="currentSession"
          :transfer-count="0"
          class="app-statusbar"
        />
      </div>
    </div>
    
    <!-- Dialogs -->
    <SessionForm
      v-model="showSessionForm"
      :session="editingSession"
      :groups="groups"
      @save="handleSaveSession"
    />
    
    <QuickConnect v-model="showQuickConnect" @connect="handleQuickConnectSubmit" />
    
    <TerminalSettings
      v-model="showTerminalSettings"
      :current-settings="terminalOptions"
      @save="handleSaveTerminalSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, FolderOpened, Plus, Lightning } from '@element-plus/icons-vue'
import Sidebar from './components/Common/Sidebar.vue'
import Toolbar from './components/Common/Toolbar.vue'
import StatusBar from './components/Common/StatusBar.vue'
import SessionList from './components/Session/SessionList.vue'
import SessionForm from './components/Session/SessionForm.vue'
import QuickConnect from './components/Session/QuickConnect.vue'
import TerminalTab from './components/Terminal/TerminalTab.vue'
import TerminalSettings from './components/Terminal/TerminalSettings.vue'
import SettingsPanel from './components/Common/SettingsPanel.vue'
import LogViewer from './components/Common/LogViewer.vue'
import SFTPPanel from './components/SFTP/SFTPPanel.vue'
import PortForwardPanel from './components/PortForward/PortForwardPanel.vue'
import SnippetPanel from './components/Snippet/SnippetPanel.vue'
import StatisticsPanel from './components/Statistics/StatisticsPanel.vue'
import type { SessionConfig, SessionGroup } from './types/session'
import { v4 as uuidv4 } from 'uuid'

interface Tab {
  id: string
  name: string
  session: SessionConfig
}

const activeView = ref('sessions')
const activeTab = ref('')
const tabs = ref<Tab[]>([])
const sessions = ref<SessionConfig[]>([])
const groups = ref<SessionGroup[]>([])
const showSessionForm = ref(false)
const showQuickConnect = ref(false)
const showTerminalSettings = ref(false)
const editingSession = ref<SessionConfig | null>(null)
const statisticsPanel = ref()

const terminalOptions = ref({
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'JetBrains Mono, "Fira Code", Consolas, monospace', // Enhanced font stack
  cursorStyle: 'block' as 'block' | 'underline' | 'bar',
  cursorBlink: true,
  scrollback: 10000,
  rendererType: 'webgl' as 'dom' | 'canvas' | 'webgl',
  transparency: 0 // 0 means opaque, but if we want transparency we might need a different renderer setup. Keeping as number to satisfy type.
})

const currentSession = computed(() => {
  const currentTab = tabs.value.find((tab) => tab.id === activeTab.value)
  return currentTab?.session || null
})

onMounted(async () => {
  // Load sessions from backend
  try {
    const allSessions = await window.electronAPI.session.getAll()
    sessions.value = allSessions
    
    // Load groups from backend
    // @ts-ignore
    const allGroups = await window.electronAPI.session.getAllGroups()
    groups.value = allGroups
  } catch (error) {
    console.error('Failed to load sessions:', error)
  }

  // Load and sync settings
  try {
    const settings = await window.electronAPI.settings.get()
    if (settings) {
      applySettings(settings)
    }
    
    window.electronAPI.settings.onChange((newSettings) => {
      applySettings(newSettings)
    })
  } catch (error) {
    console.error('Failed to load settings:', error)
  }

  // Register keyboard shortcuts
  // @ts-ignore
  window.electronAPI.onShortcut('new-connection', () => {
    showSessionForm.value = true
  })

  // @ts-ignore
  window.electronAPI.onShortcut('quick-connect', () => {
    showQuickConnect.value = true
  })

  // @ts-ignore
  window.electronAPI.onShortcut('settings', () => {
    activeView.value = 'settings'
  })

  // @ts-ignore
  window.electronAPI.onShortcut('close-tab', () => {
    if (activeTab.value) {
      handleTabRemove(activeTab.value)
    }
  })

  // @ts-ignore
  window.electronAPI.onShortcut('next-tab', () => {
    const currentIndex = tabs.value.findIndex(t => t.id === activeTab.value)
    if (currentIndex < tabs.value.length - 1) {
      activeTab.value = tabs.value[currentIndex + 1].id
    }
  })

  // @ts-ignore
  window.electronAPI.onShortcut('prev-tab', () => {
    const currentIndex = tabs.value.findIndex(t => t.id === activeTab.value)
    if (currentIndex > 0) {
      activeTab.value = tabs.value[currentIndex - 1].id
    }
  })
})

const applySettings = (settings: any) => {
  // Apply theme
  if (settings.general && settings.general.theme) {
    applyTheme(settings.general.theme)
  }

  if (settings.terminal) {
    terminalOptions.value = {
      ...terminalOptions.value,
      theme: settings.terminal.theme,
      fontSize: settings.terminal.fontSize,
      fontFamily: settings.terminal.fontFamily,
      cursorStyle: settings.terminal.cursorStyle,
      cursorBlink: settings.terminal.cursorBlink,
      scrollback: settings.terminal.scrollback,
      rendererType: settings.terminal.rendererType || 'auto'
    }
  }
}

const applyTheme = (theme: 'light' | 'dark' | 'auto') => {
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

  // 自动切换终端主题以匹配应用主题
  // 只有当终端主题是默认的 dark/light 时才自动切换
  // 如果用户选择了其他主题（如 monokai, dracula），则保持不变
  const currentTerminalTheme = terminalOptions.value.theme
  if (currentTerminalTheme === 'dark' || currentTerminalTheme === 'light') {
    terminalOptions.value.theme = isDark ? 'dark' : 'light'
  }
}

const handleMenuSelect = (index: string) => {
  activeView.value = index
}

const handleSearch = (query: string) => {
  console.log('Search:', query)
}

const handleConnect = async (session: SessionConfig) => {
  const tabId = uuidv4()
  const tab: Tab = {
    id: tabId,
    name: session.name || `${session.username}@${session.host}`,
    session
  }
  
  tabs.value.push(tab)
  activeTab.value = tabId

  // Update usage stats
  try {
    const usageCount = (session.usageCount || 0) + 1
    const lastConnected = new Date()
    await window.electronAPI.session.update(session.id, { usageCount, lastConnected })
    
    // Update local session data to reflect changes immediately in UI if needed, 
    // although reloading data might be safer but stats usually don't need instant refresh
    session.usageCount = usageCount
    session.lastConnected = lastConnected
    
    // Refresh stats panel if active
    if (activeView.value === 'statistics' && statisticsPanel.value) {
      statisticsPanel.value.loadData()
    }
  } catch (error) {
    console.error('Failed to update session usage stats:', error)
  }
}

const handleQuickConnectSubmit = (config: {
  host: string
  port: number
  username: string
  password: string
}) => {
  const session: SessionConfig = {
    id: uuidv4(),
    name: `${config.username}@${config.host}`,
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    authType: 'password',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  handleConnect(session)
}

const handleEditSession = (session: SessionConfig) => {
  editingSession.value = session
  showSessionForm.value = true
}

const loadData = async () => {
  try {
    const allSessions = await window.electronAPI.session.getAll()
    sessions.value = allSessions
    
    // Load groups from backend
    // @ts-ignore
    const allGroups = await window.electronAPI.session.getAllGroups()
    groups.value = allGroups
  } catch (error) {
    console.error('Failed to load data:', error)
  }
}

const handleSaveSession = async (sessionData: Partial<SessionConfig>) => {
  try {
    if (sessionData.id) {
      // Update existing session
      await window.electronAPI.session.update(sessionData.id, sessionData)
      // Refresh all data to ensure grouping is correct
      await loadData()
      ElMessage.success('会话已更新')
    } else {
      // Create new session
      const newSession = await window.electronAPI.session.create(sessionData)
      sessions.value.push(newSession)
      await loadData()
      ElMessage.success('会话已创建')
    }
    
    editingSession.value = null
  } catch (error: any) {
    ElMessage.error(`保存会话失败: ${error.message}`)
  }
}

const handleCreateGroup = async (groupData: { name: string; description?: string }) => {
  try {
    const newGroup = await window.electronAPI.session.createGroup(groupData.name, groupData.description)
    // Reload all groups to ensure consistency
    const allGroups = await window.electronAPI.session.getAllGroups()
    groups.value = allGroups
    ElMessage.success('分组已创建')
  } catch (error: any) {
    ElMessage.error(`创建分组失败: ${error.message}`)
  }
}

const handleRenameGroup = async (groupId: string, newName: string) => {
  try {
    await window.electronAPI.session.renameGroup(groupId, newName)
    const allGroups = await window.electronAPI.session.getAllGroups()
    groups.value = allGroups
    ElMessage.success('分组已重命名')
  } catch (error: any) {
    ElMessage.error(`重命名失败: ${error.message}`)
  }
}

const handleDeleteGroup = async (groupId: string) => {
  try {
    await window.electronAPI.session.deleteGroup(groupId)
    const allGroups = await window.electronAPI.session.getAllGroups()
    groups.value = allGroups
    ElMessage.success('分组已删除')
  } catch (error: any) {
    ElMessage.error(`删除失败: ${error.message}`)
  }
}

const handleTabRemove = (tabId: string) => {
  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index !== -1) {
    tabs.value.splice(index, 1)
    
    if (activeTab.value === tabId && tabs.value.length > 0) {
      activeTab.value = tabs.value[Math.max(0, index - 1)].id
    }
  }
}

const handleTabClick = () => {
  // Tab clicked
}

const handleSaveTerminalSettings = (settings: any) => {
  terminalOptions.value = settings
  ElMessage.success('Terminal settings saved')
}
</script>

<style>
/* Reset & Global */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-main);
  color: var(--text-primary);
}
</style>

<style scoped>
/* 主布局 */
.app-layout {
  display: flex;
  height: 100%;
  background: var(--bg-main);
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 1;
  min-width: 0; /* Prevent flex overflow */
}

/* 顶部工具栏 */
.app-header {
  height: 56px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--spacing-lg);
  -webkit-app-region: drag;
  box-shadow: var(--shadow-sm);
  z-index: 5;
}

.app-title-drag {
  flex: 1;
  height: 100%;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
  -webkit-app-region: no-drag;
}

.header-actions .el-button {
  box-shadow: var(--shadow-sm);
}

.header-actions .el-button:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

/* 内容区域 */
.app-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.content-panel {
  width: 100%;
  height: 100%;
  display: flex;
  overflow: hidden;
}

/* 会话面板 */
.sessions-panel {
  width: 320px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  z-index: 5;
}

/* 终端面板 */
.terminal-panel {
  flex: 1;
  overflow: hidden;
  background: var(--bg-main);
  display: flex;
  flex-direction: column;
}

/* 专业标签页样式 */
.premium-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
  --el-tabs-header-height: 44px;
}

.premium-tabs :deep(.el-tabs__header) {
  margin: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 0 var(--spacing-sm);
}

.premium-tabs :deep(.el-tabs__nav) {
  border: none !important;
}

.premium-tabs :deep(.el-tabs__item) {
  height: 44px;
  line-height: 44px;
  padding: 0 var(--spacing-lg);
  border: none !important;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--transition-fast);
  background: transparent;
  position: relative;
  margin-right: 4px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.premium-tabs :deep(.el-tabs__item::before) {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--primary-color);
  transform: scaleX(0);
  transition: transform var(--transition-normal);
}

.premium-tabs :deep(.el-tabs__item.is-active) {
  background: var(--bg-main);
  color: var(--primary-color);
  font-weight: 600;
}

.premium-tabs :deep(.el-tabs__item.is-active::before) {
  transform: scaleX(1);
}

.premium-tabs :deep(.el-tabs__item:hover) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.premium-tabs :deep(.el-tabs__item .el-icon-close) {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.premium-tabs :deep(.el-tabs__item .el-icon-close:hover) {
  background: var(--error-color);
  color: white;
}

.premium-tabs :deep(.el-tabs__content) {
  flex: 1;
  padding: 0;
  overflow: hidden;
}

.premium-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.premium-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

/* 空状态优化 */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: radial-gradient(
    ellipse at center,
    var(--bg-secondary) 0%,
    var(--bg-main) 70%
  );
  position: relative;
  overflow: hidden;
}

.empty-state::before {
  content: '';
  position: absolute;
  width: 500px;
  height: 500px;
  background: radial-gradient(
    circle,
    rgba(14, 165, 233, 0.05) 0%,
    transparent 70%
  );
  border-radius: 50%;
  animation: pulse 4s ease-in-out infinite;
}

.empty-state-content {
  text-align: center;
  max-width: 480px;
  padding: var(--spacing-2xl);
  position: relative;
  z-index: 1;
  animation: fadeIn 0.6s ease-out;
}

.empty-icon-wrapper {
  width: 120px;
  height: 120px;
  background: linear-gradient(
    135deg,
    rgba(14, 165, 233, 0.15),
    rgba(99, 102, 241, 0.15)
  );
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto var(--spacing-xl);
  color: var(--primary-color);
  box-shadow: 0 0 60px rgba(14, 165, 233, 0.2);
  position: relative;
}

.empty-icon-wrapper::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    var(--primary-color),
    var(--accent-color)
  );
  opacity: 0.2;
  filter: blur(20px);
  z-index: -1;
}

.empty-state h3 {
  font-size: var(--text-2xl);
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
  font-weight: 700;
  letter-spacing: -0.5px;
}

.empty-state p {
  color: var(--text-secondary);
  margin-bottom: var(--spacing-xl);
  line-height: 1.6;
  font-size: var(--text-base);
}

.empty-actions {
  display: flex;
  gap: var(--spacing-md);
  justify-content: center;
  flex-wrap: wrap;
}

.empty-actions .el-button {
  min-width: 140px;
}

/* 状态栏 */
.app-statusbar {
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  height: 32px;
  line-height: 32px;
  font-size: var(--text-xs);
  box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.1);
}

/* 占位符 */
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: var(--text-2xl);
  color: var(--text-tertiary);
  font-weight: 300;
  letter-spacing: 2px;
}

/* 响应式 */
@media (max-width: 1024px) {
  .sessions-panel {
    width: 280px;
  }
}

@media (max-width: 768px) {
  .sessions-panel {
    width: 240px;
  }
  
  .app-header {
    height: 48px;
    padding: 0 var(--spacing-md);
  }
  
  .empty-icon-wrapper {
    width: 96px;
    height: 96px;
  }
  
  .empty-state h3 {
    font-size: var(--text-xl);
  }
}

/* 动画 */
@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
