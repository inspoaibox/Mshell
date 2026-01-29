<template>
  <div id="app">
    <!-- 锁定屏幕 -->
    <LockScreen v-if="isLocked" @unlock="handleUnlock" />
    
    <div class="app-layout" v-show="!isLocked">
      <Sidebar @menu-select="handleMenuSelect" />
      
      <div class="app-main">
        <div class="app-header">
           <div class="app-title-drag"></div>
           <div class="header-actions">
              <el-tooltip content="分屏视图" placement="bottom">
                <el-button 
                  size="small" 
                  :icon="Grid" 
                  @click="toggleSplitView" 
                  :disabled="appStore.tabs.length < 2"
                  :type="showSplitView ? 'primary' : ''"
                  circle 
                />
              </el-tooltip>
              <el-button type="primary" size="small" :icon="Plus" @click="appStore.showSessionForm = true" circle />
              <el-button size="small" :icon="Lightning" @click="appStore.showQuickConnect = true" circle />
           </div>
        </div>
        
        <div class="app-content">
          <div v-show="appStore.activeView === 'sessions'" class="content-panel">
            <div class="sessions-panel glass-panel">
              <SessionList
                @connect="handleConnect"
                @edit="handleEditSession"
              />
            </div>
            <div class="terminal-panel" :class="{ 'split-mode': showSplitView && sshTerminals.length >= 2 }">
              <!-- 分屏工具栏 -->
              <div v-show="showSplitView && sshTerminals.length >= 2" class="split-toolbar">
                <div class="toolbar-left">
                  <span class="terminal-count">{{ sshTerminals.length }} 个终端</span>
                </div>
                <div class="toolbar-right">
                  <el-button-group>
                    <el-tooltip content="自动网格 (自适应)" placement="bottom">
                      <el-button
                        :type="layoutMode === 'auto' ? 'primary' : ''"
                        size="small"
                        @click="layoutMode = 'auto'"
                      >
                        ⊞ 自动
                      </el-button>
                    </el-tooltip>
                    <el-tooltip content="水平分屏 (左右并排)" placement="bottom">
                      <el-button
                        :type="layoutMode === 'horizontal' ? 'primary' : ''"
                        size="small"
                        @click="layoutMode = 'horizontal'"
                      >
                        ⬌ 水平
                      </el-button>
                    </el-tooltip>
                    <el-tooltip content="垂直分屏 (上下堆叠)" placement="bottom">
                      <el-button
                        :type="layoutMode === 'vertical' ? 'primary' : ''"
                        size="small"
                        @click="layoutMode = 'vertical'"
                      >
                        ⬍ 垂直
                      </el-button>
                    </el-tooltip>
                  </el-button-group>
                  
                  <div class="divider-vertical"></div>

                  <el-button size="small" @click="showSplitView = false">
                    退出分屏
                  </el-button>
                </div>
              </div>

              <!-- 分屏内容区域 -->
              <div 
                v-if="showSplitView && sshTerminals.length >= 2" 
                class="split-terminals-container"
                :style="gridStyle"
              >
                <div
                  v-for="(tab, index) in sshTerminals"
                  :key="`split-${tab.id}`"
                  class="split-terminal-pane"
                  :class="{ active: appStore.activeTab === tab.id }"
                  @click="appStore.activeTab = tab.id"
                >
                  <div class="pane-header">
                    <span class="pane-title">{{ tab.name }}</span>
                    <el-button 
                      type="danger" 
                      link 
                      size="small"
                      @click.stop="handleCloseTab(tab.id)"
                    >
                      ✖
                    </el-button>
                  </div>
                  <div class="pane-content">
                    <TerminalTab
                      :connection-id="tab.id"
                      :session="tab.session"
                      :terminal-options="appStore.terminalOptions"
                      :hide-close-button="true"
                    />
                  </div>
                </div>
              </div>
              
              <!-- 标签页视图 -->
              <el-tabs
                v-if="!showSplitView || sshTerminals.length < 2"
                v-model="appStore.activeTab"
                type="card"
                closable
                class="premium-tabs"
                @tab-remove="appStore.removeTab"
              >
                <el-tab-pane
                  v-for="(tab, index) in appStore.tabs"
                  :key="tab.id"
                  :name="tab.id"
                >
                  <template #label>
                    <DraggableTab
                      :tab-id="tab.id"
                      :tab-data="tab"
                      :index="index"
                      :is-active="appStore.activeTab === tab.id"
                      @reorder="handleTabReorder"
                      @click="appStore.activeTab = tab.id"
                    >
                      {{ tab.name }}
                    </DraggableTab>
                  </template>
                  <SplitTerminalTab
                    v-if="tab.isSplit"
                    :connection-id="tab.id"
                    :session="tab.session"
                    :terminal-options="appStore.terminalOptions"
                  />
                  <TerminalTab
                    v-else
                    :connection-id="tab.id"
                    :session="tab.session"
                    :terminal-options="appStore.terminalOptions"
                  />
                </el-tab-pane>
                
                <template v-if="appStore.tabs.length === 0">
                  <div class="empty-state">
                    <div class="empty-state-content">
                      <div class="empty-icon-wrapper">
                         <el-icon :size="48"><Connection /></el-icon>
                      </div>
                      <h3>Ready to Connect</h3>
                      <p>Select a session from the list or create a new one to get started.</p>
                      <div class="empty-actions">
                        <el-button type="primary" @click="appStore.showSessionForm = true" size="large">
                          Create New Session
                        </el-button>
                        <el-button @click="appStore.showQuickConnect = true" size="large">
                          Quick Connect
                        </el-button>
                      </div>
                    </div>
                  </div>
                </template>
              </el-tabs>
            </div>
          </div>
          
          <div v-show="appStore.activeView === 'sftp'" class="content-panel">
            <SFTPPanel />
          </div>
          
          <div v-show="appStore.activeView === 'port-forward'" class="content-panel">
            <PortForwardPanel v-if="appStore.activeTab" :connection-id="appStore.activeTab" />
            <div v-else class="empty-state">
               <div class="empty-state-content">
                  <el-icon :size="64"><Connection /></el-icon>
                  <p>Please establish an SSH connection first.</p>
               </div>
            </div>
          </div>
          
          <div v-show="appStore.activeView === 'snippets'" class="content-panel">
            <SnippetPanel />
          </div>

          <div v-show="appStore.activeView === 'statistics'" class="content-panel">
            <StatisticsPanel />
          </div>
          
          <div v-show="appStore.activeView === 'tasks'" class="content-panel">
            <TaskSchedulerPanel />
          </div>
          
          <div v-show="appStore.activeView === 'workflows'" class="content-panel">
            <WorkflowPanel />
          </div>
          
          <div v-show="appStore.activeView === 'keys'" class="content-panel">
            <SSHKeyPanel />
          </div>
          
          <div v-show="appStore.activeView === 'logs'" class="content-panel">
            <LogPanel />
          </div>
          
          <div v-show="appStore.activeView === 'templates'" class="content-panel">
            <SessionTemplatePanel />
          </div>
          
          <div v-show="appStore.activeView === 'settings'" class="content-panel">
            <SettingsPanel />
          </div>
        </div>
        
        <StatusBar
          :active-connections="appStore.tabs.length"
          :current-session="appStore.currentSession"
          :transfer-count="0"
          class="app-statusbar"
        />
      </div>
    </div>
    
    <!-- Dialogs -->
    <SessionForm
      v-model="appStore.showSessionForm"
      :session="appStore.editingSession"
      @save="handleSaveSession"
    />
    
    <QuickConnect 
      v-model="appStore.showQuickConnect" 
      @connect="handleQuickConnectSubmit" 
    />
    
    <TerminalSettings
      v-model="appStore.showTerminalSettings"
      :current-settings="appStore.terminalOptions"
      @save="handleSaveTerminalSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, Plus, Lightning, Grid } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { v4 as uuidv4 } from 'uuid'
import { keyboardShortcutManager } from '@/utils/keyboard-shortcuts'
import { useLocale } from '@/composables/useLocale'

// 组件导入
import Sidebar from './components/Common/Sidebar.vue'
import StatusBar from './components/Common/StatusBar.vue'
import SessionList from './components/Session/SessionList.vue'
import SessionForm from './components/Session/SessionForm.vue'
import QuickConnect from './components/Session/QuickConnect.vue'
import TerminalTab from './components/Terminal/TerminalTab.vue'
import SplitTerminalTab from './components/Terminal/SplitTerminalTab.vue'
import DraggableTab from './components/Terminal/DraggableTab.vue'
import TerminalSettings from './components/Terminal/TerminalSettings.vue'
import SettingsPanel from './components/Common/SettingsPanel.vue'
import LogPanel from './components/Logs/LogPanel.vue'
import SFTPPanel from './components/SFTP/SFTPPanel.vue'
import PortForwardPanel from './components/PortForward/PortForwardPanel.vue'
import SnippetPanel from './components/Snippet/SnippetPanel.vue'
import StatisticsPanel from './components/Statistics/StatisticsPanel.vue'
import SSHKeyPanel from './components/Keys/SSHKeyPanel.vue'
import TaskSchedulerPanel from './components/Tasks/TaskSchedulerPanel.vue'
import WorkflowPanel from './components/Workflows/WorkflowPanel.vue'
import SessionTemplatePanel from './components/Session/SessionTemplatePanel.vue'
import LockScreen from './components/Security/LockScreen.vue'

import type { SessionConfig } from './types/session'

// 国际化
const { t } = useLocale()

// 使用 store - 集中管理所有状态
const appStore = useAppStore()

// 锁定状态
const isLocked = ref(false)

// 搜索框引用
const searchInputRef = ref<HTMLElement | null>(null)

// 分屏视图状态
const showSplitView = ref(false)
const layoutMode = ref<'auto' | 'horizontal' | 'vertical'>('auto')

// 计算 Grid 样式
const gridStyle = computed(() => {
  const count = sshTerminals.value.length
  if (count === 0) return {}

  let cols = 1
  let rows = 1

  if (layoutMode.value === 'horizontal') {
    // 强制水平 (1行 N列)
    cols = count
    rows = 1
  } else if (layoutMode.value === 'vertical') {
    // 强制垂直 (N行 1列)
    cols = 1
    rows = count
  } else {
    // 自动 (Grid) - 尽可能接近正方形，优先增加列数
    cols = Math.ceil(Math.sqrt(count))
    rows = Math.ceil(count / cols)
  }

  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: '4px',
    height: '100%',
    width: '100%'
  }
})

// 计算属性：获取所有SSH终端标签（排除分屏标签）
const sshTerminals = computed(() => {
  return appStore.tabs
    .filter(tab => !tab.isSplit)
    .map(tab => ({
      id: tab.id,
      name: tab.name,
      session: tab.session
    }))
})

// 切换分屏视图
const toggleSplitView = () => {
  if (sshTerminals.value.length < 2) {
    ElMessage.warning('至少需要2个打开的SSH会话才能使用分屏视图')
    return
  }
  showSplitView.value = !showSplitView.value
}

// 在分屏模式下关闭标签
const handleCloseTab = (tabId: string) => {
  appStore.removeTab(tabId)
  
  // 如果关闭后标签数量少于2个，退出分屏模式
  if (sshTerminals.value.length < 2) {
    showSplitView.value = false
  }
}

// 处理标签拖拽重新排序
const handleTabReorder = (fromIndex: number, toIndex: number) => {
  console.log('[App] Reordering tabs:', fromIndex, '->', toIndex)
  const tabs = [...appStore.tabs]
  const [movedTab] = tabs.splice(fromIndex, 1)
  tabs.splice(toIndex, 0, movedTab)
  appStore.tabs = tabs
}

onMounted(async () => {
  // 初始化应用状态
  await appStore.initialize()
  
  // 监听设置变化
  window.electronAPI.settings.onChange((newSettings) => {
    appStore.applySettings(newSettings)
  })

  // 注册快捷键
  setupKeyboardShortcuts()
  
  // 监听锁定事件（从后端触发）
  window.electronAPI.sessionLock?.onLocked?.(() => {
    isLocked.value = true
  })
  
  window.electronAPI.sessionLock?.onUnlocked?.(() => {
    isLocked.value = false
  })
  
  // 监听自定义锁定事件（从前端触发）
  window.addEventListener('session-locked', () => {
    isLocked.value = true
  })
  
  // 检查初始锁定状态
  try {
    const status = await window.electronAPI.sessionLock?.getStatus?.()
    if (status?.success && status.data?.isLocked) {
      isLocked.value = true
    }
  } catch (error) {
    console.error('Failed to check lock status:', error)
  }
})

/**
 * 设置键盘快捷键
 */
function setupKeyboardShortcuts() {
  console.log('[App] Setting up keyboard shortcuts...')
  
  // Ctrl+N: 新建会话
  keyboardShortcutManager.register('new-session', {
    key: 'n',
    ctrl: true,
    description: '新建会话',
    action: () => {
      console.log('[Shortcut] New session triggered')
      appStore.showSessionForm = true
    }
  })

  // Ctrl+T: 快速连接
  keyboardShortcutManager.register('quick-connect', {
    key: 't',
    ctrl: true,
    description: '快速连接',
    action: () => {
      console.log('[Shortcut] Quick connect triggered')
      appStore.showQuickConnect = true
    }
  })

  // Ctrl+W: 关闭当前标签
  keyboardShortcutManager.register('close-tab', {
    key: 'w',
    ctrl: true,
    description: '关闭当前标签',
    action: () => {
      console.log('[Shortcut] Close tab triggered')
      if (appStore.activeTab) {
        appStore.removeTab(appStore.activeTab)
      }
    }
  })

  // Ctrl+Tab: 下一个标签
  keyboardShortcutManager.register('next-tab', {
    key: 'Tab',
    ctrl: true,
    description: '下一个标签',
    action: () => {
      console.log('[Shortcut] Next tab triggered')
      appStore.nextTab()
    }
  })

  // Ctrl+Shift+Tab: 上一个标签
  keyboardShortcutManager.register('prev-tab', {
    key: 'Tab',
    ctrl: true,
    shift: true,
    description: '上一个标签',
    action: () => {
      console.log('[Shortcut] Previous tab triggered')
      appStore.prevTab()
    }
  })

  // Ctrl+F: 搜索会话
  keyboardShortcutManager.register('search-sessions', {
    key: 'f',
    ctrl: true,
    description: '搜索会话',
    action: () => {
      console.log('[Shortcut] Search sessions triggered')
      appStore.activeView = 'sessions'
      // 聚焦到搜索框
      setTimeout(() => {
        const searchInput = document.querySelector('.session-list .el-input__inner') as HTMLInputElement
        if (searchInput) {
          searchInput.focus()
        }
      }, 100)
    }
  })

  // Ctrl+,: 打开设置
  keyboardShortcutManager.register('open-settings', {
    key: ',',
    ctrl: true,
    description: '打开设置',
    action: () => {
      console.log('[Shortcut] Open settings triggered')
      appStore.activeView = 'settings'
    }
  })

  // Ctrl+Alt+L: 锁定会话
  keyboardShortcutManager.register('lock-session', {
    key: 'l',
    ctrl: true,
    alt: true,
    description: '锁定会话',
    action: async () => {
      console.log('[Shortcut] Lock session triggered')
      try {
        const result = await window.electronAPI.sessionLock?.lock?.()
        if (result?.success) {
          isLocked.value = true
        }
      } catch (error) {
        console.error('Failed to lock session:', error)
      }
    }
  })

  // Ctrl+1~9: 切换到指定标签
  for (let i = 1; i <= 9; i++) {
    keyboardShortcutManager.register(`switch-tab-${i}`, {
      key: i.toString(),
      ctrl: true,
      description: `切换到第 ${i} 个标签`,
      action: () => {
        console.log(`[Shortcut] Switch to tab ${i} triggered`)
        if (appStore.tabs.length >= i) {
          appStore.activeTab = appStore.tabs[i - 1].id
        }
      }
    })
  }
  
  console.log('[App] Keyboard shortcuts registered:', keyboardShortcutManager.getAll().size)
}

/**
 * 处理解锁
 */
const handleUnlock = () => {
  isLocked.value = false
}

const handleMenuSelect = (index: string) => {
  appStore.activeView = index as any
}

const handleConnect = async (session: SessionConfig) => {
  const tabId = uuidv4()
  const tab = {
    id: tabId,
    name: session.name || `${session.username}@${session.host}`,
    session,
    isSplit: false
  }
  
  appStore.addTab(tab)

  // 更新使用统计
  try {
    const usageCount = (session.usageCount || 0) + 1
    const lastConnected = new Date()
    await appStore.updateSession(session.id, { usageCount, lastConnected })
  } catch (error) {
    console.error('Failed to update session usage stats:', error)
  }
}

const handleConvertToSplit = (connectionId: string, session: SessionConfig) => {
  // 直接切换到分屏视图，不需要重新创建标签
  if (sshTerminals.value.length < 2) {
    ElMessage.warning('至少需要2个打开的SSH会话才能使用分屏视图')
    return
  }
  
  
  showSplitView.value = true
  
  ElMessage.success('已切换到分屏模式')
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
  appStore.openSessionForm(session)
}

const handleSaveSession = async (sessionData: Partial<SessionConfig>) => {
  try {
    if (sessionData.id) {
      await appStore.updateSession(sessionData.id, sessionData)
      ElMessage.success('会话已更新')
    } else {
      await appStore.createSession(sessionData)
      ElMessage.success('会话已创建')
    }
    appStore.closeSessionForm()
  } catch (error: any) {
    ElMessage.error(`保存会话失败: ${error.message}`)
  }
}

const handleSaveTerminalSettings = (settings: any) => {
  appStore.updateTerminalOptions(settings)
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
  min-width: 0;
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
  width: 300px;
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
  transition: color var(--transition-fast), background-color var(--transition-fast);
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

/* 分屏模式样式 */
.terminal-panel.split-mode {
  display: flex;
  flex-direction: column;
}

.split-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.split-toolbar .toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.split-toolbar .terminal-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.split-toolbar .toolbar-right {
  display: flex;
  gap: 8px;
}

.split-terminals-container {
  flex: 1;
  display: grid;
  gap: 2px;
  background: var(--border-color);
  overflow: hidden;
}


.divider-vertical {
  width: 1px;
  height: 24px;
  background-color: var(--border-color);
  margin: 0 8px;
  align-self: center;
}

.split-terminal-pane {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 2px solid transparent;
  transition: border-color 0.2s;
  overflow: hidden;
}

.split-terminal-pane.active {
  border-color: var(--primary-color);
}

.split-terminal-pane .pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.split-terminal-pane .pane-title {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split-terminal-pane .pane-content {
  flex: 1;
  overflow: hidden;
}
</style>
