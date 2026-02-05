<template>
  <div class="terminal-tab">
    <div class="terminal-header glass-header">
      <div class="status-indicator">
        <span class="status-dot" :class="statusClass"></span>
      </div>
      <div class="connection-info">
        <span class="host-name">{{ displayName }}</span>
        <span class="status-text">{{ connectionStatus }}</span>
      </div>
      <div class="header-actions">
        <el-tooltip content="字体" placement="bottom">
          <el-dropdown @command="handleFontChange" trigger="click">
            <el-button
              type="primary"
              link
              class="action-btn font-btn"
            >
              <span style="font-size: var(--text-sm); font-weight: 500;">A</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="font in fontOptions"
                  :key="font.value"
                  :command="font.value"
                  :class="{ 'is-active': currentFont === font.value }"
                >
                  {{ font.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>
        <el-tooltip content="主题" placement="bottom">
          <el-dropdown @command="handleThemeChange" trigger="click">
            <el-button
              type="primary"
              link
              :icon="Brush"
              class="action-btn"
            />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="(theme, key) in availableThemes"
                  :key="key"
                  :command="key"
                  :class="{ 'is-active': currentTheme === key }"
                >
                  {{ theme.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>
        <el-tooltip content="Snippets" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="Document"
            @click="showSnippetDialog = !showSnippetDialog"
            class="action-btn"
            :class="{ 'is-active': showSnippetDialog }"
          />
        </el-tooltip>
        <el-tooltip content="Search" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="Search"
            @click="showSearch = !showSearch"
            class="action-btn"
          />
        </el-tooltip>
        <el-tooltip content="命令历史" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="Clock"
            @click="showCommandHistory = !showCommandHistory"
            class="action-btn"
            :class="{ 'is-active': showCommandHistory }"
          />
        </el-tooltip>
        <el-tooltip :content="showMonitor ? '隐藏监控' : '显示监控'" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="Monitor"
            @click="showMonitor = !showMonitor"
            class="action-btn"
            :class="{ 'is-active': showMonitor }"
          />
        </el-tooltip>
        <el-tooltip :content="showFilePanel ? '关闭文件' : '文件管理'" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="FolderOpened"
            @click="toggleFilePanel"
            class="action-btn"
            :class="{ 'is-active': showFilePanel }"
          />
        </el-tooltip>
        <el-tooltip :content="showTerminalAI ? '关闭 AI 助手' : 'AI 助手'" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="ChatDotRound"
            @click="showTerminalAI = !showTerminalAI"
            class="action-btn"
            :class="{ 'is-active': showTerminalAI }"
          />
        </el-tooltip>
      </div>
    </div>
    
    <!-- 重连通知栏 -->
    <transition name="slide-down">
      <div v-if="showReconnectNotification && connectionStatus === 'reconnecting'" class="reconnect-notification">
        <div class="reconnect-content">
          <el-icon class="reconnect-icon spinning"><Loading /></el-icon>
          <span class="reconnect-text">{{ reconnectMessage }}</span>
          <el-button 
            size="small" 
            type="danger" 
            link
            @click="handleCancelReconnect"
            class="cancel-reconnect-btn"
          >
            取消重连
          </el-button>
        </div>
      </div>
    </transition>
    
    <!-- 断线通知栏 -->
    <transition name="slide-down">
      <div v-if="showDisconnectedNotification" class="disconnected-notification">
        <div class="reconnect-content">
          <el-icon class="disconnected-icon"><CircleClose /></el-icon>
          <span class="reconnect-text">连接已断开</span>
          <el-button 
            size="small" 
            type="primary"
            @click="handleManualReconnect"
            :loading="isManualReconnecting"
          >
            重新连接
          </el-button>
          <el-button 
            size="small" 
            link
            @click="showDisconnectedNotification = false"
          >
            关闭
          </el-button>
        </div>
      </div>
    </transition>
    
    <div class="terminal-body">
      <div class="terminal-content" :class="{ 'with-monitor': showMonitor, 'with-history': showCommandHistory, 'with-ai': showTerminalAI, 'with-file': showFilePanel, 'with-snippet': showSnippetDialog }">
        <TerminalView
          v-if="isConnected"
          :connection-id="connectionId"
          :session-name="session?.name"
          :options="terminalOptions"
          ref="terminalRef"
          @input="handleTerminalInput"
          @data="handleTerminalData"
          @cursor-position="handleCursorPosition"
          @ai-request="handleAIRequest"
          @ssh-output="handleSSHOutput"
        />
        <div v-else class="connecting-overlay">
          <div class="loader"></div>
          <div class="loading-text">Connecting to {{ session?.host }}...</div>
        </div>
        <TerminalSearch
          v-model:visible="showSearch"
          @search="handleSearch"
          @find-next="handleFindNext"
          @find-previous="handleFindPrevious"
        />
        <!-- 命令自动补全 -->
        <CommandAutocomplete
          ref="autocompleteRef"
          :visible="showAutocomplete"
          :input="autocompleteInput"
          :cursor-position="autocompleteCursorPosition"
          :session-id="connectionId"
          @select="handleAutocompleteSelect"
          @close="showAutocomplete = false"
        />
        
        <!-- 内联预览补全 (Ghost Text) -->
        <GhostText
          :visible="showGhostText"
          :ghost-text="ghostText"
          :cursor-position="autocompleteCursorPosition"
          :font-size="terminalOptions?.fontSize || 14"
          :font-family="terminalOptions?.fontFamily || 'Consolas, monospace'"
        />
        
        <!-- AI 命令建议 -->
        <AICommandSuggest
          ref="aiCommandSuggestRef"
          :visible="showAICommandSuggest"
          :query="aiCommandQuery"
          :position="autocompleteCursorPosition"
          :session-id="connectionId"
          @execute="handleAICommandExecute"
          @edit="handleAICommandEdit"
          @close="showAICommandSuggest = false"
        />
        
        <!-- 命令解释 -->
        <CommandExplain
          ref="commandExplainRef"
          :visible="showCommandExplain"
          :command="explainCommand"
          :position="autocompleteCursorPosition"
          @close="showCommandExplain = false"
        />
      </div>
      
      <!-- 命令历史面板 -->
      <div v-if="showCommandHistory" class="history-sidebar">
        <CommandHistoryPanel @select="handleCommandSelect" />
      </div>
      
      <!-- 服务器监控面板 -->
      <transition name="slide-left">
        <div v-if="showMonitor" class="monitor-sidebar">
          <ServerMonitorPanel :session-id="connectionId" />
        </div>
      </transition>
      
      <!-- 终端 AI 助手面板 -->
      <transition name="slide-left">
        <div v-if="showTerminalAI" class="ai-sidebar">
          <TerminalAIChatPanel 
            ref="terminalAIRef"
            :connection-id="connectionId" 
            :session-name="session?.name"
            :storage-id="aiStorageId"
            :current-dir="currentWorkingDir"
            @close="showTerminalAI = false"
          />
        </div>
      </transition>
      
      <!-- 文件管理面板 -->
      <transition name="slide-left">
        <div v-if="showFilePanel" class="file-sidebar">
          <TerminalFilePanel
            :connection-id="connectionId"
            :session-name="session?.name"
            :username="session?.username"
            :current-dir="currentWorkingDir"
            @close="showFilePanel = false"
            @request-current-dir="updateCurrentWorkingDir"
          />
        </div>
      </transition>
      
      <!-- 命令片段面板 -->
      <transition name="slide-left">
        <div v-if="showSnippetDialog" class="snippet-sidebar">
          <div class="sidebar-header">
            <h3>命令片段</h3>
            <el-button :icon="Close" link @click="showSnippetDialog = false" />
          </div>
          <div class="snippet-panel-content">
            <!-- 左侧：分类和标签 -->
            <div class="snippet-categories">
              <div class="category-section">
                <div class="section-title">分类</div>
                <div class="category-list">
                  <div 
                    class="category-item"
                    :class="{ active: filterCategory === '' }"
                    @click="filterCategory = ''"
                  >
                    <span>全部</span>
                    <el-tag size="small" round>{{ snippets.length }}</el-tag>
                  </div>
                  <div 
                    v-for="cat in categories"
                    :key="cat"
                    class="category-item"
                    :class="{ active: filterCategory === cat }"
                    @click="filterCategory = cat"
                  >
                    <span>{{ cat }}</span>
                    <el-tag size="small" round>{{ getCategoryCount(cat) }}</el-tag>
                  </div>
                </div>
              </div>
              <div v-if="allTags.length > 0" class="category-section">
                <div class="section-title">标签</div>
                <div class="tag-list">
                  <el-tag
                    v-for="tag in allTags"
                    :key="tag"
                    :type="filterTags.includes(tag) ? 'primary' : 'info'"
                    size="small"
                    @click="toggleTag(tag)"
                    style="cursor: pointer; margin: 2px;"
                  >
                    {{ tag }}
                  </el-tag>
                </div>
              </div>
            </div>
            <!-- 右侧：搜索和列表 -->
            <div class="snippet-main">
              <div class="snippet-search">
                <el-input
                  v-model="snippetSearch"
                  placeholder="搜索片段..."
                  :prefix-icon="Search"
                  clearable
                  size="small"
                />
              </div>
              <div class="snippet-list">
                <div
                  v-for="snippet in filteredSnippets"
                  :key="snippet.id"
                  class="snippet-item"
                  @click="selectSnippet(snippet)"
                >
                  <div class="snippet-header">
                    <div class="snippet-name">{{ snippet.name }}</div>
                    <span class="usage-count">{{ snippet.usageCount }}次</span>
                  </div>
                  <div class="snippet-command">{{ snippet.command }}</div>
                  <div class="snippet-tags" v-if="snippet.tags && snippet.tags.length">
                    <span v-for="tag in snippet.tags" :key="tag" class="tag">{{ tag }}</span>
                  </div>
                </div>
                <div v-if="filteredSnippets.length === 0" class="empty-snippets">
                  <el-icon :size="32"><Document /></el-icon>
                  <p>未找到匹配的片段</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>
    
    <!-- Variable Input Dialog -->
    <el-dialog v-model="showVariableDialog" title="Enter Variables" width="500px" class="custom-dialog">
      <el-form v-if="selectedSnippet" label-position="top">
        <el-form-item
          v-for="variable in selectedSnippet.variables"
          :key="variable.name"
          :label="variable.name"
        >
          <el-input
            v-model="variableValues[variable.name]"
            :placeholder="variable.description || variable.defaultValue"
          />
        </el-form-item>
      </el-form>
      <div v-if="finalCommand" class="command-preview">
        <div class="preview-label">Preview:</div>
        <pre>{{ finalCommand }}</pre>
      </div>
      <template #footer>
        <el-button @click="showVariableDialog = false">Cancel</el-button>
        <el-button type="primary" @click="executeSnippet">Execute</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Close, Loading, Search, Document, Brush, Monitor, Clock, ChatDotRound, CircleClose, FolderOpened } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TerminalView from './TerminalView.vue'
import TerminalSearch from './TerminalSearch.vue'
import CommandAutocomplete from './CommandAutocomplete.vue'
import CommandHistoryPanel from './CommandHistoryPanel.vue'
import ServerMonitorPanel from '../Monitor/ServerMonitorPanel.vue'
import TerminalAIChatPanel from '../AI/TerminalAIChatPanel.vue'
import TerminalFilePanel from './TerminalFilePanel.vue'
import GhostText from './GhostText.vue'
import AICommandSuggest from './AICommandSuggest.vue'
import CommandExplain from './CommandExplain.vue'
import { themes } from '@/utils/terminal-themes'
import { terminalManager } from '@/utils/terminal-manager'
import { getInlineSuggestion, shouldShowInlineSuggestion } from '@/utils/autocomplete/inline-suggest'
import { isExplainQuery, parseExplainQuery } from '@/utils/command-intelligence'
import type { SessionConfig as BaseSessionConfig } from '@/types/session'
import { useAppStore } from '@/stores/app'

// 全局连接跟踪 - 防止重复连接
const connectingIds = new Set<string>()
const connectedIds = new Set<string>()

// Extend base config if needed, or simply alias it
type SessionConfig = BaseSessionConfig

interface CommandSnippet {
  id: string
  name: string
  description?: string
  command: string
  variables?: {
    name: string
    description: string
    defaultValue?: string
  }[]
  tags: string[]
  category?: string
  usageCount: number
}

interface Props {
  connectionId: string
  session: SessionConfig
  terminalOptions?: any
  hideCloseButton?: boolean
  broadcastMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  broadcastMode: false
})
const emit = defineEmits<{
  close: [connectionId: string]
  'broadcast-input': [data: string, sourceId: string]
}>()

// AI 历史记录存储 ID：优先使用 session ID（如果是保存的会话），否则使用连接 ID
const aiStorageId = computed(() => props.session?.id || props.connectionId)

const terminalRef = ref()
const terminalAIRef = ref()
const autocompleteRef = ref()
const isConnected = ref(false)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'>('connecting')
const showSearch = ref(false)
const reconnectAttempt = ref(0)
const reconnectMaxAttempts = ref(0)
const showReconnectNotification = ref(false)
const showDisconnectedNotification = ref(false)
const isManualReconnecting = ref(false)
const showSnippetDialog = ref(false)
const showVariableDialog = ref(false)
const showMonitor = ref(false)
const showCommandHistory = ref(false)
const showTerminalAI = ref(false)
const showFilePanel = ref(false)
const snippetSearch = ref('')
const filterCategory = ref('')
const filterTags = ref<string[]>([])
const snippets = ref<CommandSnippet[]>([])
const selectedSnippet = ref<CommandSnippet | null>(null)
const variableValues = ref<Record<string, string>>({})

// 智能补全相关
const showAutocomplete = ref(false)
const autocompleteInput = ref('')
const autocompleteCursorPosition = ref({ x: 0, y: 0 })

// 内联预览补全 (Ghost Text)
const showGhostText = ref(false)
const ghostText = ref('')
const ghostFullText = ref('')

// AI 命令建议 (# 触发)
const showAICommandSuggest = ref(false)
const aiCommandQuery = ref('')
const aiCommandSuggestRef = ref()

// 命令智能功能
const showCommandExplain = ref(false)
const explainCommand = ref('')
const commandExplainRef = ref()

// 命令智能设置（从设置中加载）
const commandIntelligenceSettings = ref({
  commandAutocomplete: true,
  aiCommandSuggest: true,
  commandExplain: true
})

// Ghost text 请求 ID（用于取消过期请求）
let ghostTextRequestId = 0

// 当前工作目录（从终端提示符解析）- 备用方案
const currentWorkingDir = ref('')

// 更新当前工作目录
const updateCurrentWorkingDir = () => {
  const cwd = terminalManager.getCurrentWorkingDirectory(props.connectionId)
  if (cwd) {
    currentWorkingDir.value = cwd
    console.log('[TerminalTab] Updated currentWorkingDir:', cwd)
  } else {
    console.log('[TerminalTab] Could not detect currentWorkingDir from terminal')
  }
}

// 切换文件面板（打开时更新当前目录）
const toggleFilePanel = () => {
  if (!showFilePanel.value) {
    // 打开面板前，获取当前工作目录
    updateCurrentWorkingDir()
  }
  showFilePanel.value = !showFilePanel.value
}

// 搜索相关状态
const currentSearchTerm = ref('')
const currentSearchOptions = ref({ caseSensitive: false, regex: false })

// 主题相关
const availableThemes = themes
const currentTheme = computed(() => props.terminalOptions?.theme || 'dark')

// 字体相关
const fontOptions = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Lucida Console', value: "'Lucida Console', monospace" },
  { label: 'Monaco', value: 'Monaco, monospace' }
]
const currentFont = computed(() => props.terminalOptions?.fontFamily || "'JetBrains Mono', monospace")

// 键盘事件清理函数（在顶层定义，供 onUnmounted 使用）
let cleanupKeyboard: (() => void) | null = null

// 监听标签页切换，当切换到其他标签页时清理补全状态
// 这可以防止多标签页时的状态污染
watch(() => useAppStore().activeTab, (newActiveTab) => {
  if (newActiveTab !== props.connectionId) {
    // 当前标签页不再激活，清理所有智能功能状态
    clearAllIntelligenceStates()
  }
})

const filteredSnippets = computed(() => {
  let result = snippets.value
  
  // 按分类过滤
  if (filterCategory.value) {
    result = result.filter(s => s.category === filterCategory.value)
  }
  
  // 按标签过滤
  if (filterTags.value.length > 0) {
    result = result.filter(s => 
      filterTags.value.some(tag => s.tags?.includes(tag))
    )
  }
  
  // 按搜索词过滤
  if (snippetSearch.value) {
    const query = snippetSearch.value.toLowerCase()
    result = result.filter(
      (snippet) =>
        snippet.name.toLowerCase().includes(query) ||
        snippet.command.toLowerCase().includes(query) ||
        snippet.category?.toLowerCase().includes(query) ||
        snippet.description?.toLowerCase().includes(query)
    )
  }
  
  return result
})

const categories = computed(() => {
  const cats = new Set<string>()
  snippets.value.forEach(s => {
    if (s.category) cats.add(s.category)
  })
  return Array.from(cats)
})

const allTags = computed(() => {
  const tags = new Set<string>()
  snippets.value.forEach(s => {
    s.tags?.forEach(t => tags.add(t))
  })
  return Array.from(tags)
})

const finalCommand = computed(() => {
  if (!selectedSnippet.value) return ''
  
  let command = selectedSnippet.value.command
  
  // 替换变量
  if (selectedSnippet.value.variables) {
    for (const variable of selectedSnippet.value.variables) {
      const value = variableValues.value[variable.name] || variable.defaultValue || ''
      command = command.replace(new RegExp(`\\$\\{${variable.name}\\}`, 'g'), value)
    }
  }
  
  return command
})

const displayName = computed(() => {
  return props.session.name || `${props.session.username}@${props.session.host}`
})

const statusClass = computed(() => {
  return {
    'status-connecting': connectionStatus.value === 'connecting',
    'status-connected': connectionStatus.value === 'connected',
    'status-disconnected': connectionStatus.value === 'disconnected',
    'status-error': connectionStatus.value === 'error',
    'status-reconnecting': connectionStatus.value === 'reconnecting'
  }
})

const reconnectMessage = computed(() => {
  if (connectionStatus.value === 'reconnecting') {
    return `正在重连... (${reconnectAttempt.value}/${reconnectMaxAttempts.value})`
  }
  return ''
})

// 设置重连事件监听器
const setupReconnectListeners = () => {
  // 监听重连开始事件
  window.electronAPI.ssh.onReconnecting((id: string, attempt: number, maxAttempts: number) => {
    if (id === props.connectionId) {
      console.log(`[TerminalTab] Reconnecting ${id}: attempt ${attempt}/${maxAttempts}`)
      connectionStatus.value = 'reconnecting'
      reconnectAttempt.value = attempt
      reconnectMaxAttempts.value = maxAttempts
      showReconnectNotification.value = true
      
      ElMessage.warning({
        message: `连接断开，正在尝试重连... (${attempt}/${maxAttempts})`,
        duration: 3000
      })
    }
  })
  
  // 监听重连成功事件
  window.electronAPI.ssh.onReconnected((id: string) => {
    if (id === props.connectionId) {
      console.log(`[TerminalTab] Reconnected ${id}`)
      connectionStatus.value = 'connected'
      isConnected.value = true
      showReconnectNotification.value = false
      reconnectAttempt.value = 0
      
      ElMessage.success({
        message: '重连成功！',
        duration: 2000
      })
    }
  })
  
  // 监听重连失败事件
  window.electronAPI.ssh.onReconnectFailed((id: string, reason: string) => {
    if (id === props.connectionId) {
      console.log(`[TerminalTab] Reconnect failed ${id}: ${reason}`)
      connectionStatus.value = 'error'
      isConnected.value = false
      showReconnectNotification.value = false
      showDisconnectedNotification.value = true
      reconnectAttempt.value = 0
      
      ElMessage.error({
        message: `重连失败: ${reason}`,
        duration: 5000
      })
    }
  })
}

// 取消重连
const handleCancelReconnect = async () => {
  try {
    await window.electronAPI.ssh.cancelReconnect(props.connectionId)
    showReconnectNotification.value = false
    showDisconnectedNotification.value = true
    reconnectAttempt.value = 0
    ElMessage.info('已取消重连')
  } catch (error: any) {
    ElMessage.error(`取消重连失败: ${error.message}`)
  }
}

// 加载命令智能设置
const loadCommandIntelligenceSettings = async () => {
  try {
    const settings = await window.electronAPI.settings.get()
    const sshSettings = settings?.ssh || {}
    
    commandIntelligenceSettings.value = {
      commandAutocomplete: sshSettings.commandAutocomplete !== false,
      aiCommandSuggest: sshSettings.aiCommandSuggest !== false,
      commandExplain: sshSettings.commandExplain !== false
    }
    console.log('[TerminalTab] Loaded command intelligence settings:', commandIntelligenceSettings.value)
  } catch (error) {
    console.error('Failed to load command intelligence settings:', error)
  }
}

// 手动重连
const handleManualReconnect = async () => {
  if (!props.sessionId) return
  
  isManualReconnecting.value = true
  showDisconnectedNotification.value = false
  
  try {
    // 获取会话配置
    const session = await window.electronAPI.session.get(props.sessionId)
    if (!session) {
      ElMessage.error('会话不存在')
      return
    }
    
    // 断开旧连接
    try {
      await window.electronAPI.ssh.disconnect(props.connectionId)
    } catch (e) {
      // 忽略断开错误
    }
    
    // 重新连接 - 序列化 session 以便 IPC 传输
    connectionStatus.value = 'connecting'
    const sessionData = JSON.parse(JSON.stringify(session))
    const result = await window.electronAPI.ssh.connect(props.connectionId, sessionData)
    
    if (result.success) {
      connectionStatus.value = 'connected'
      isConnected.value = true
      ElMessage.success('重连成功！')
    } else {
      connectionStatus.value = 'error'
      showDisconnectedNotification.value = true
      ElMessage.error(result.error || '重连失败')
    }
  } catch (error: any) {
    connectionStatus.value = 'error'
    showDisconnectedNotification.value = true
    ElMessage.error(`重连失败: ${error.message}`)
  } finally {
    isManualReconnecting.value = false
  }
}

onMounted(async () => {
  // Load snippets
  loadSnippets()
  
  // 获取 appStore 用于检查当前激活的标签页
  const appStore = useAppStore()
  
  // 添加键盘事件监听（处理补全弹窗、Ghost Text、AI 命令）
  const handleKeyDown = (e: KeyboardEvent) => {
    // 首先检查当前标签页是否激活，避免多标签页时的事件冲突
    // 只有当前激活的标签页才处理键盘事件
    if (appStore.activeTab !== props.connectionId) {
      return // 不是当前激活的标签页，不处理
    }
    
    // 0. 命令解释模式
    if (showCommandExplain.value) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        showCommandExplain.value = false
        return
      }
      return
    }
    
    // 1. AI 命令建议模式
    if (showAICommandSuggest.value) {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        // 检查是否正在加载或没有建议
        const isLoading = aiCommandSuggestRef.value?.isLoading?.()
        const suggestion = aiCommandSuggestRef.value?.getSuggestion?.()
        if (!isLoading && suggestion) {
          handleAICommandExecute(suggestion)
        }
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const isLoading = aiCommandSuggestRef.value?.isLoading?.()
        const suggestion = aiCommandSuggestRef.value?.getSuggestion?.()
        if (!isLoading && suggestion) {
          handleAICommandEdit(suggestion)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        showAICommandSuggest.value = false
        aiCommandQuery.value = ''
        return
      }
      return
    }
    
    // 2. Ghost Text 模式 - Tab 接受补全（不拦截 ArrowRight，避免与光标移动冲突）
    if (showGhostText.value && ghostText.value) {
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        acceptGhostText()
        return
      }
      // Escape 关闭 ghost text
      if (e.key === 'Escape') {
        showGhostText.value = false
        ghostText.value = ''
        return
      }
      // 其他按键会自动清除 ghost text（在 handleTerminalInput 中处理）
    }
    
    // 3. 弹窗补全模式
    if (!showAutocomplete.value) return
    
    // 检查是否有建议
    const hasSuggestions = autocompleteRef.value?.hasSuggestions?.() || false
    // 检查用户是否主动选择了建议（使用了上下键）
    const hasActiveSelection = autocompleteRef.value?.hasActiveSelection?.() || false
    
    // Enter 键的处理逻辑：
    // - 如果用户主动选择了建议（用上下键），则确认选择
    // - 如果用户没有主动选择，则关闭弹窗并执行命令
    if (e.key === 'Enter') {
      if (hasActiveSelection && hasSuggestions) {
        // 用户主动选择了，确认补全
        e.preventDefault()
        e.stopPropagation()
        if (autocompleteRef.value) {
          autocompleteRef.value.selectCurrent()
        }
      } else {
        // 用户没有主动选择，关闭弹窗，让 Enter 正常执行命令
        showAutocomplete.value = false
        autocompleteInput.value = ''
        showGhostText.value = false
        ghostText.value = ''
        // 不阻止事件，让终端正常处理
      }
      return
    }
    
    // 对于 Tab 键，只有在有建议时才拦截
    if (e.key === 'Tab' && !hasSuggestions) {
      return // 让按键正常传递到终端
    }
    
    // 阻止终端捕获这些按键（除了 Enter）
    if (['ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      
      // 处理不同的按键
      switch (e.key) {
        case 'ArrowDown':
          // 向下选择
          if (autocompleteRef.value) {
            autocompleteRef.value.selectNext()
          }
          break
        case 'ArrowUp':
          // 向上选择
          if (autocompleteRef.value) {
            autocompleteRef.value.selectPrevious()
          }
          break
        case 'Tab':
          // Tab 键确认补全
          if (autocompleteRef.value) {
            autocompleteRef.value.selectCurrent()
          }
          break
        case 'Escape':
          // 关闭补全
          showAutocomplete.value = false
          autocompleteInput.value = ''
          showGhostText.value = false
          ghostText.value = ''
          break
      }
    }
  }
  
  // 使用 capture 模式确保优先捕获事件
  window.addEventListener('keydown', handleKeyDown, true)
  
  // 保存 cleanup 函数供 onUnmounted 使用
  cleanupKeyboard = () => {
    window.removeEventListener('keydown', handleKeyDown, true)
  }
  
  // 检查是否已经连接或正在连接（防止重复连接）
  if (connectingIds.has(props.connectionId) || connectedIds.has(props.connectionId)) {
    console.log(`[TerminalTab] Connection ${props.connectionId} already exists or connecting, reusing existing connection`)
    if (connectedIds.has(props.connectionId)) {
      isConnected.value = true
      connectionStatus.value = 'connected'
    } else if (connectingIds.has(props.connectionId)) {
      // 连接正在进行中，等待连接完成
      connectionStatus.value = 'connecting'
      // 检查终端实例是否已经存在且有数据（说明已经连接成功）
      const instance = terminalManager.get(props.connectionId)
      if (instance?.terminal) {
        // 终端实例存在，说明连接已经成功，只是状态没同步
        isConnected.value = true
        connectionStatus.value = 'connected'
        connectedIds.add(props.connectionId)
        connectingIds.delete(props.connectionId)
      }
    }
    // 设置重连事件监听器（即使复用连接也需要监听）
    setupReconnectListeners()
    
    // 复用连接时也需要加载设置
    loadCommandIntelligenceSettings()
    
    return
  }
  
  // 标记为正在连接
  connectingIds.add(props.connectionId)
  
  // 设置重连事件监听器
  setupReconnectListeners()
  
  try {
    // 获取 SSH 设置
    const settings = await window.electronAPI.settings.get()
    const sshSettings = settings?.ssh || {}
    
    // 加载命令智能设置（使用统一函数）
    await loadCommandIntelligenceSettings()
    
    // Connect to SSH
    // 注意：privateKeyId 会在后端 ssh-handlers.ts 中处理
    // 优先使用 privateKeyId，如果没有则使用 privateKeyPath 或 privateKey
    const result = await window.electronAPI.ssh.connect(props.connectionId, {
      host: props.session.host,
      port: props.session.port,
      username: props.session.username,
      password: props.session.password,
      privateKey: props.session.privateKeyId ? undefined : (props.session.privateKeyPath || props.session.privateKey),
      privateKeyId: props.session.privateKeyId,
      passphrase: props.session.passphrase,
      // 应用 SSH 设置
      readyTimeout: (sshSettings.timeout || 30) * 1000, // 转换为毫秒
      keepaliveInterval: sshSettings.keepalive ? (sshSettings.keepaliveInterval || 60) * 1000 : undefined,
      keepaliveCountMax: sshSettings.keepalive ? 3 : undefined,
      sessionName: props.session.name,
      // 跳板机和代理配置 - 序列化以便 IPC 传输
      proxyJump: props.session.proxyJump ? JSON.parse(JSON.stringify(props.session.proxyJump)) : undefined,
      proxy: props.session.proxy ? JSON.parse(JSON.stringify(props.session.proxy)) : undefined
    })

    if (result.success) {
      isConnected.value = true
      connectionStatus.value = 'connected'
      connectedIds.add(props.connectionId)
      ElMessage.success(`Connected to ${props.session.host}`)
      
      // 记录连接统计开始
      try {
        await window.electronAPI.connectionStats?.start?.(
          props.connectionId,
          props.session.name
        )
      } catch (error) {
        console.error('Failed to start connection stats:', error)
      }
    } else {
      connectionStatus.value = 'error'
      ElMessage.error(`Connection failed: ${result.error}`)
    }
  } catch (error: any) {
    connectionStatus.value = 'error'
    ElMessage.error(`Connection error: ${error.message}`)
  } finally {
    // 移除正在连接标记
    connectingIds.delete(props.connectionId)
  }
})

onUnmounted(async () => {
  // 清理键盘事件监听器
  if (cleanupKeyboard) {
    cleanupKeyboard()
    cleanupKeyboard = null
  }
  
  // 清理 AI 建议防抖定时器
  if (aiSuggestDebounceTimer) {
    clearTimeout(aiSuggestDebounceTimer)
    aiSuggestDebounceTimer = null
  }
  
  // 清理所有智能功能状态，避免状态污染
  clearAllIntelligenceStates()
  
  // 强制重置 autocomplete 组件
  if (autocompleteRef.value?.forceReset) {
    autocompleteRef.value.forceReset()
  }
  
  // 清理资源
  console.log(`[TerminalTab] Cleaning up resources for ${props.connectionId}`)
  
  const appStore = useAppStore()
  
  // 检查是否在 store 中仍然存在该 tab (如果存在，说明只是视图切换导致组件卸载，不需要断开连接)
  const isTabActive = appStore.tabs.some(t => t.id === props.connectionId)
  
  if (isTabActive) {
    console.log(`[TerminalTab] Tab ${props.connectionId} is still active in store, skipping disconnect`)
    // 清理引用但保持连接
    if (terminalRef.value) {
      try {
        terminalRef.value = null
      } catch (e) {
        console.error(e)
      }
    }
    return
  }
  
  // 1. 清理终端引用
  if (terminalRef.value) {
    try {
      terminalRef.value = null
    } catch (error) {
      console.error('Error clearing terminal ref:', error)
    }
  }
  
  // 2. 断开 SSH 连接（只在最后一个实例时断开）
  if (isConnected.value) {
    try {
      // 从已连接集合中移除
      connectedIds.delete(props.connectionId)
      
      // 只有当没有其他实例使用这个连接时才断开
      if (!connectedIds.has(props.connectionId)) {
        // 记录连接统计结束
        try {
          await window.electronAPI.connectionStats?.end?.(props.connectionId)
        } catch (error) {
          console.error('Failed to end connection stats:', error)
        }
        
        await window.electronAPI.ssh.disconnect(props.connectionId)
        console.log(`[TerminalTab] Disconnected ${props.connectionId}`)
        
        // 销毁终端实例
        terminalManager.destroy(props.connectionId)
      }
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }
  
  // 3. 清理状态
  snippets.value = []
  selectedSnippet.value = null
  variableValues.value = {}
  
  // 4. 清理搜索状态
  currentSearchTerm.value = ''
  showSearch.value = false
  showSnippetDialog.value = false
  showVariableDialog.value = false
  
  console.log(`[TerminalTab] Cleanup completed for ${props.connectionId}`)
})

// 处理来自终端的 AI 请求
const handleAIRequest = async (text: string) => {
  showTerminalAI.value = true
  await nextTick()
  if (terminalAIRef.value) {
    terminalAIRef.value.performAction(text)
  }
}

const handleClose = () => {
  emit('close', props.connectionId)
}

const handleFontChange = async (fontFamily: string) => {
  try {
    // 更新 appStore 中的终端选项
    const appStore = useAppStore()
    appStore.updateTerminalOptions({ fontFamily })

    // 保存到设置中
    await window.electronAPI.settings.update({
      terminal: {
        fontFamily: fontFamily
      }
    })

    // 获取字体显示名称
    const fontLabel = fontOptions.find(f => f.value === fontFamily)?.label || fontFamily
    ElMessage.success(`字体已切换到 ${fontLabel}`)
  } catch (error: any) {
    ElMessage.error(`切换字体失败: ${error.message}`)
  }
}

const handleThemeChange = async (themeName: string) => {
  try {
    // 更新 appStore 中的终端选项
    const appStore = useAppStore()
    appStore.updateTerminalOptions({ theme: themeName })

    // 保存到设置中
    await window.electronAPI.settings.update({
      terminal: {
        theme: themeName
      }
    })

    ElMessage.success(`主题已切换到 ${themes[themeName].name}`)
  } catch (error: any) {
    ElMessage.error(`切换主题失败: ${error.message}`)
  }
}

const handleSearch = (term: string, options: { caseSensitive: boolean; regex: boolean }) => {
  currentSearchTerm.value = term
  currentSearchOptions.value = options
  if (terminalRef.value) {
    terminalRef.value.search(term, options)
  }
}

const handleFindNext = () => {
  if (terminalRef.value && currentSearchTerm.value) {
    terminalRef.value.findNext(currentSearchTerm.value, currentSearchOptions.value)
  }
}

const handleFindPrevious = () => {
  if (terminalRef.value && currentSearchTerm.value) {
    terminalRef.value.findPrevious(currentSearchTerm.value, currentSearchOptions.value)
  }
}

const handleCommandSelect = (command: string) => {
  // 直接发送到SSH，依赖SSH的回显来显示在终端上，避免重复显示
  window.electronAPI.ssh.write(props.connectionId, command)
}

const loadSnippets = async () => {
  try {
    console.log('Loading snippets in TerminalTab...')
    const result = await window.electronAPI.snippet.getAll()
    console.log('Snippet result:', result)
    if (result.success) {
      // 转换数据格式：将 variables 从 string[] 转换为对象数组
      const rawSnippets = result.data || []
      snippets.value = rawSnippets.map((snippet: any) => ({
        ...snippet,
        variables: Array.isArray(snippet.variables)
          ? snippet.variables.map((v: any) => 
              typeof v === 'string' 
                ? { name: v, description: '', defaultValue: '' }
                : v
            )
          : []
      }))
      console.log('Loaded snippets count:', snippets.value.length)
    } else {
      console.error('Failed to load snippets:', result.error)
    }
  } catch (error) {
    console.error('Exception loading snippets:', error)
  }
}

// 监听snippet对话框打开，自动刷新列表
watch(showSnippetDialog, (newValue) => {
  if (newValue) {
    loadSnippets()
    // 重置过滤条件
    filterCategory.value = ''
    filterTags.value = []
    snippetSearch.value = ''
  }
  // 侧边栏状态变化时，延迟调整终端大小
  setTimeout(() => {
    terminalRef.value?.fit?.()
  }, 300)
})

// 监听所有侧边栏状态变化，调整终端大小
watch([showMonitor, showCommandHistory, showTerminalAI], () => {
  // 侧边栏状态变化时，延迟调整终端大小
  setTimeout(() => {
    terminalRef.value?.fit?.()
  }, 300)
})

const getCategoryCount = (category: string) => {
  return snippets.value.filter(s => s.category === category).length
}

const toggleTag = (tag: string) => {
  const index = filterTags.value.indexOf(tag)
  if (index > -1) {
    filterTags.value.splice(index, 1)
  } else {
    filterTags.value.push(tag)
  }
}

const selectSnippet = (snippet: CommandSnippet) => {
  selectedSnippet.value = snippet
  showSnippetDialog.value = false
  
  // 如果有变量，显示变量输入对话框
  if (snippet.variables && snippet.variables.length > 0) {
    // 初始化变量值
    variableValues.value = {}
    snippet.variables.forEach((variable) => {
      variableValues.value[variable.name] = variable.defaultValue || ''
    })
    showVariableDialog.value = true
  } else {
    // 没有变量，直接执行
    executeSnippet()
  }
}

const executeSnippet = async () => {
  if (!selectedSnippet.value) return
  
  try {
    const command = finalCommand.value
    
    // 发送命令到终端
    await window.electronAPI.ssh.write(props.connectionId, command + '\n')
    
    // 记录命令到历史
    await window.electronAPI.commandHistory?.add?.({
      command,
      sessionId: props.connectionId,
      sessionName: props.session.name || 'Unknown Session',
      duration: undefined
    })
    
    // 增加使用计数
    await window.electronAPI.snippet.incrementUsage(selectedSnippet.value.id)
    
    ElMessage.success('命令已执行')
    showVariableDialog.value = false
    selectedSnippet.value = null
    variableValues.value = {}
  } catch (error: any) {
    ElMessage.error(`执行失败: ${error.message}`)
  }
}

// AI 命令建议防抖定时器
let aiSuggestDebounceTimer: ReturnType<typeof setTimeout> | null = null

// 清除所有智能功能状态（用于模式切换时避免状态污染）
const clearAllIntelligenceStates = (except?: 'autocomplete' | 'aiSuggest' | 'explain') => {
  if (except !== 'autocomplete') {
    showAutocomplete.value = false
    autocompleteInput.value = '' // 同时清空输入，避免状态不一致
    // 强制重置 autocomplete 组件状态
    if (autocompleteRef.value?.forceReset) {
      autocompleteRef.value.forceReset()
    }
  }
  if (except !== 'aiSuggest') {
    showAICommandSuggest.value = false
    aiCommandQuery.value = ''
    if (aiSuggestDebounceTimer) {
      clearTimeout(aiSuggestDebounceTimer)
      aiSuggestDebounceTimer = null
    }
  }
  if (except !== 'explain') {
    showCommandExplain.value = false
    explainCommand.value = ''
  }
  showGhostText.value = false
  ghostText.value = ''
}

// 处理终端输入（用于智能补全）
const handleTerminalInput = async (input: string) => {
  console.log(`[TerminalTab] handleTerminalInput called: input="${input}"`)
  
  // 保存原始输入用于各种模式判断
  const rawInput = input
  
  // 0. 命令解释模式 (? 开头或结尾) - 需要检查开关
  if (commandIntelligenceSettings.value.commandExplain && isExplainQuery(rawInput)) {
    const command = parseExplainQuery(rawInput)
    if (command && command.length >= 2) {
      // 清除其他所有状态，避免状态污染
      clearAllIntelligenceStates('explain')
      // 不更新 autocompleteInput，因为命令解释模式不需要补全
      explainCommand.value = command
      showCommandExplain.value = true
      return
    }
  } else {
    // 不是解释查询，关闭解释面板
    if (showCommandExplain.value) {
      showCommandExplain.value = false
    }
  }
  
  // 1. AI 命令模式 (# 开头) - 检查开关
  if (rawInput.startsWith('#') && commandIntelligenceSettings.value.aiCommandSuggest) {
    const query = rawInput.substring(1).trim()
    console.log('[TerminalTab] AI command mode, input:', rawInput, 'query:', query)
    
    // 更新 autocompleteInput 以便执行时能正确清除输入
    autocompleteInput.value = rawInput
    
    // 只有当 query 有实际内容时才显示 AI 建议
    if (query.length >= 2) {
      // 清除其他状态
      clearAllIntelligenceStates('aiSuggest')
      
      // 防抖：用户停止输入 800ms 后才触发 AI 请求
      if (aiSuggestDebounceTimer) {
        clearTimeout(aiSuggestDebounceTimer)
      }
      
      // 立即显示面板（显示加载状态）
      showAICommandSuggest.value = true
      
      aiSuggestDebounceTimer = setTimeout(() => {
        // 只有当 query 真正变化时才更新（触发 AI 请求）
        if (aiCommandQuery.value !== query) {
          aiCommandQuery.value = query
          console.log('[TerminalTab] AI query updated:', query)
        }
      }, 800)
    } else {
      // query 太短，隐藏 AI 建议但不显示其他补全
      clearAllIntelligenceStates()
    }
    return
  } else if (rawInput.startsWith('#') && !commandIntelligenceSettings.value.aiCommandSuggest) {
    // AI 命令建议已关闭，不处理 # 开头的输入
    clearAllIntelligenceStates()
    return
  } else {
    // 不是 # 开头，清除 AI 建议状态
    if (showAICommandSuggest.value) {
      showAICommandSuggest.value = false
      aiCommandQuery.value = ''
    }
    if (aiSuggestDebounceTimer) {
      clearTimeout(aiSuggestDebounceTimer)
      aiSuggestDebounceTimer = null
    }
  }
  
  // 如果命令补全已关闭，直接返回
  if (!commandIntelligenceSettings.value.commandAutocomplete) {
    showAutocomplete.value = false
    autocompleteInput.value = '' // 同时清空输入
    showGhostText.value = false
    return
  }
  
  // 从这里开始，更新 autocompleteInput（仅用于补全模式）
  autocompleteInput.value = rawInput
  
  // 2. 快捷命令模式 (/ 开头) - 检查开关
  if (rawInput.startsWith('/') && commandIntelligenceSettings.value.commandAutocomplete) {
    showGhostText.value = false
    showAutocomplete.value = true
    return
  } else if (rawInput.startsWith('/')) {
    // 命令补全已关闭
    showAutocomplete.value = false
    showGhostText.value = false
    return
  }
  
  // 3. 内联预览补全 (Ghost Text) - 检查开关
  if (commandIntelligenceSettings.value.commandAutocomplete && shouldShowInlineSuggestion(rawInput)) {
    const currentRequestId = ++ghostTextRequestId
    try {
      const suggestion = await getInlineSuggestion(rawInput, props.connectionId)
      // 检查请求是否过期
      if (currentRequestId !== ghostTextRequestId) return
      
      if (suggestion && suggestion.ghostText) {
        ghostText.value = suggestion.ghostText
        ghostFullText.value = suggestion.text
        showGhostText.value = true
      } else {
        showGhostText.value = false
        ghostText.value = ''
      }
    } catch (e) {
      if (currentRequestId === ghostTextRequestId) {
        showGhostText.value = false
      }
    }
  } else {
    showGhostText.value = false
    ghostText.value = ''
  }
  
  // 4. 弹窗补全（与内联预览共存）- 检查开关
  if (commandIntelligenceSettings.value.commandAutocomplete) {
    const shouldShowPopup = rawInput && 
                       rawInput.length > 0 && 
                       !rawInput.endsWith('\n') && 
                       !rawInput.endsWith('\r') &&
                       rawInput.length >= 2
    
    if (shouldShowPopup) {
      // 显示补全时清除其他状态
    }
    showAutocomplete.value = Boolean(shouldShowPopup)
  } else {
    showAutocomplete.value = false
  }
}

// 处理终端数据（用于广播模式）
const handleTerminalData = (data: string) => {
  // 如果启用了广播模式，向父组件发送广播事件
  if (props.broadcastMode) {
    emit('broadcast-input', data, props.connectionId)
  }
}

// 处理光标位置（用于定位补全弹窗）
const handleCursorPosition = (position: { x: number; y: number }) => {
  autocompleteCursorPosition.value = position
}

// 处理补全选择
const handleAutocompleteSelect = (text: string) => {
  if (terminalRef.value) {
    // 获取当前输入
    const currentInput = autocompleteInput.value
    
    // 计算需要删除的字符数
    let deleteCount = 0
    
    // 如果是快捷命令（以 / 开头），需要删除整个快捷命令
    if (currentInput.startsWith('/')) {
      deleteCount = currentInput.length
    } else {
      // 常规补全：只删除当前单词
      const words = currentInput.split(/\s+/)
      const lastWord = words[words.length - 1]
      deleteCount = lastWord.length
    }
    // 发送退格删除当前单词，然后发送新文本
    // 使用 \x7f (DEL) 或 \b 来删除字符
    const backspaces = '\x7f'.repeat(deleteCount)
    window.electronAPI.ssh.write(props.connectionId, backspaces + text)
    
    // 计算补全后的完整命令并更新终端的命令缓冲
    const newCommand = currentInput.slice(0, currentInput.length - deleteCount) + text
    terminalRef.value.updateCommandBuffer?.(newCommand.trim())
    
    // 如果是快捷命令，增加使用次数
    if (currentInput.startsWith('/')) {
      // 尝试找到对应的片段并增加使用次数
      window.electronAPI.snippet?.getByShortcut?.(currentInput).then(result => {
        if (result?.success && result.data) {
          window.electronAPI.snippet?.incrementUsage?.(result.data.id)
        }
      })
    }
    
    // 自动聚焦终端
    setTimeout(() => {
      if (terminalRef.value) {
        terminalRef.value.focus()
      }
    }, 50)

    // --- 连续补全逻辑 (Continuous Completion) ---
    // 如果补全文本自带空格 (如 "restart ")，说明用户可能需要立即补全下一个参数
    // 我们手动更新 input 状态，并保持弹窗打开
    // 注意：需要检查 commandAutocomplete 开关是否开启
    if (text.endsWith(' ') && commandIntelligenceSettings.value.commandAutocomplete) {
        autocompleteInput.value = newCommand
        // 确保符合显示条件 (非空等)，通常来说加上命令后肯定符合
        showAutocomplete.value = true
        return // 早期返回，跳过下面的关闭逻辑
    }
  }
  
  // 默认：补全结束，关闭弹窗并清理状态
  showAutocomplete.value = false
  autocompleteInput.value = ''
  showGhostText.value = false
  ghostText.value = ''
  
  // 强制重置 CommandAutocomplete 组件的所有状态，确保下次能正常触发
  if (autocompleteRef.value) {
    autocompleteRef.value.forceReset?.()
  }
}

// 处理 Ghost Text 接受（Tab 或 → 键）
const acceptGhostText = () => {
  if (!showGhostText.value || !ghostText.value) return false
  
  // 发送补全文本到终端
  window.electronAPI.ssh.write(props.connectionId, ghostText.value)
  
  // 更新命令缓冲
  if (terminalRef.value) {
    terminalRef.value.updateCommandBuffer?.(ghostFullText.value)
  }
  
  // 清除 ghost text
  showGhostText.value = false
  ghostText.value = ''
  ghostFullText.value = ''
  
  return true
}

// 处理 AI 命令执行
const handleAICommandExecute = async (command: string) => {
  if (!command) return
  
  // 使用 Ctrl+U 清除当前行输入，然后发送新命令
  // \x15 = Ctrl+U (清除光标前的所有内容)
  // \x0b = Ctrl+K (清除光标后的所有内容，可选)
  window.electronAPI.ssh.write(props.connectionId, '\x15' + command + '\r')
  
  // 记录 AI 生成的命令到历史
  try {
    await window.electronAPI.commandHistory?.add?.({
      command,
      sessionId: props.connectionId,
      sessionName: props.session.name || 'Unknown Session',
      duration: undefined
    })
  } catch (error) {
    console.error('Failed to record AI command:', error)
  }
  
  // 更新命令缓冲
  if (terminalRef.value) {
    terminalRef.value.updateCommandBuffer?.('')
  }
  
  // 关闭 AI 建议
  showAICommandSuggest.value = false
  aiCommandQuery.value = ''
  autocompleteInput.value = ''
  
  // 聚焦终端
  setTimeout(() => terminalRef.value?.focus(), 50)
}

// 处理 AI 命令编辑（Tab 键）
const handleAICommandEdit = (command: string) => {
  if (!command) return
  
  // 使用 Ctrl+U 清除当前行输入，然后发送新命令（不执行）
  window.electronAPI.ssh.write(props.connectionId, '\x15' + command)
  
  // 更新命令缓冲
  if (terminalRef.value) {
    terminalRef.value.updateCommandBuffer?.(command)
  }
  
  // 关闭 AI 建议
  showAICommandSuggest.value = false
  aiCommandQuery.value = ''
  autocompleteInput.value = command
  
  // 聚焦终端
  setTimeout(() => terminalRef.value?.focus(), 50)
}

// ========== 命令智能功能 ==========

// 处理命令解释查询（? 触发）
const handleExplainQuery = (input: string) => {
  // 检查开关是否开启
  if (!commandIntelligenceSettings.value.commandExplain) return false
  
  if (isExplainQuery(input)) {
    const command = parseExplainQuery(input)
    if (command) {
      explainCommand.value = command
      showCommandExplain.value = true
      return true
    }
  }
  return false
}

// 处理 SSH 输出（预留接口）
const handleSSHOutput = (_output: string) => {
  // 预留接口，可用于未来扩展
}

defineExpose({
  focus: () => {
    if (terminalRef.value) {
      terminalRef.value.focus()
    }
  },
  clear: () => {
    if (terminalRef.value) {
      terminalRef.value.clear()
    }
  },
  toggleSearch: () => {
    showSearch.value = !showSearch.value
  }
})
</script>

<style scoped>
.terminal-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-main);
  position: relative;
}

.terminal-header {
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 36px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
  flex-shrink: 0;
  z-index: 10;
}

.terminal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.glass-header {
  background: var(--bg-secondary);
  backdrop-filter: blur(10px);
}

.status-indicator {
  display: flex;
  align-items: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: all 0.3s;
}

.status-connecting {
  background-color: var(--warning-color);
  box-shadow: 0 0 8px var(--warning-color);
  animation: pulse 1.5s infinite;
}

.status-connected {
  background-color: var(--success-color);
  box-shadow: 0 0 8px var(--success-color);
}

.status-disconnected {
  background-color: var(--text-tertiary);
}

.status-error {
  background-color: var(--error-color);
}

.status-reconnecting {
  background-color: var(--warning-color);
  box-shadow: 0 0 8px var(--warning-color);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.connection-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', sans-serif;
}

.host-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.status-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-transform: capitalize;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* 确保下拉菜单和按钮宽度一致 */
.header-actions :deep(.el-dropdown) {
  display: inline-flex;
}

/* 移除按钮之间的默认 margin，通过 gap 统一控制 */
.header-actions :deep(.el-button + .el-button) {
  margin-left: 0 !important;
}

.header-actions :deep(.el-dropdown .el-button) {
  padding: 2px !important;
  height: 20px !important;
  width: 20px !important;
  min-width: 20px !important;
}

.action-btn {
  padding: 2px !important;
  height: 20px !important;
  width: 20px !important;
  min-width: 20px !important;
  border-radius: 4px;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.action-btn:hover {
  background-color: var(--bg-tertiary);
  color: var(--primary-color);
}

.action-btn.is-active {
  background-color: rgba(14, 165, 233, 0.15);
  color: var(--primary-color);
}

.font-btn {
  font-family: serif;
}

.close-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--error-color);
}

.terminal-content {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: #0d1117;
  transition: all 0.3s ease;
}

.terminal-content.with-monitor {
  flex: 1;
}

.terminal-content.with-history {
  flex: 1;
}

.terminal-content.with-ai {
  flex: 1;
}

.terminal-content.with-file {
  flex: 1;
}

.terminal-content.with-snippet {
  flex: 1;
}

.history-sidebar {
  width: 480px;
  background: var(--bg-main);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
}

.monitor-sidebar {
  width: 320px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  overflow-y: auto;
  flex-shrink: 0;
}

.ai-sidebar {
  width: 380px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.file-sidebar {
  width: 320px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 滑动动画 */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-left-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-left-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.slide-right-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-right-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

/* Connecting Overlay */
.connecting-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 20px;
  background: var(--bg-main);
  color: var(--text-secondary);
}

.loader {
  width: 40px;
  height: 40px;
  border: 3px solid var(--bg-tertiary);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: var(--text-base);
  letter-spacing: 0.5px;
}

/* Snippet Sidebar - 左右布局样式 */
.snippet-sidebar {
  width: 480px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.sidebar-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.snippet-panel-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧分类区域 */
.snippet-categories {
  width: 140px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-main);
  overflow-y: auto;
}

.category-section {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.category-section:last-child {
  border-bottom: none;
}

.section-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  padding: 0 10px 6px;
  letter-spacing: 0.5px;
}

.category-list {
  max-height: 200px;
  overflow-y: auto;
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.category-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.category-item.active {
  background: rgba(14, 165, 233, 0.12);
  color: var(--primary-color);
  font-weight: 600;
}

.category-item span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 0 10px;
}

/* 右侧主区域 */
.snippet-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.snippet-search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.snippet-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.snippet-item {
  padding: 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-main);
}

.snippet-item:hover {
  background: var(--bg-tertiary);
  border-color: var(--primary-color);
  box-shadow: var(--shadow-sm);
}

.snippet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 8px;
}

.snippet-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: var(--text-sm);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.snippet-command {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: var(--text-xs);
  color: #2563eb;
  background: var(--bg-secondary);
  padding: 4px 6px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
  border: 1px solid var(--border-color);
}

:global(.dark) .snippet-command {
  color: #60a5fa;
}

.snippet-tags {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}

.snippet-tags .tag {
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.empty-snippets {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
}

.empty-snippets p {
  margin-top: 8px;
  font-size: var(--text-sm);
}

.command-preview {
  margin-top: 20px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.preview-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.command-preview pre {
  margin: 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  color: var(--success-color);
  white-space: pre-wrap;
  word-break: break-all;
}

/* 主题切换下拉菜单样式 */
.el-dropdown-menu__item.is-active {
  color: var(--primary-color);
  font-weight: 600;
  background: rgba(14, 165, 233, 0.1);
}

.el-dropdown-menu__item.is-active::before {
  content: '✓';
  margin-right: 8px;
  color: var(--primary-color);
}

/* 重连通知栏样式 */
.reconnect-notification {
  background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
  border-bottom: 1px solid rgba(251, 146, 60, 0.3);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9;
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
}

/* 断线通知栏样式 */
.disconnected-notification {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-bottom: 1px solid rgba(239, 68, 68, 0.3);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.2);
}

.disconnected-icon {
  font-size: var(--text-lg);
}

.reconnect-content {
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
}

.reconnect-icon {
  font-size: var(--text-lg);
}

.reconnect-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.reconnect-text {
  letter-spacing: 0.3px;
}

.cancel-reconnect-btn {
  color: white !important;
  font-weight: 600;
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  transition: all 0.2s;
}

.cancel-reconnect-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.5);
}

/* 滑动动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
