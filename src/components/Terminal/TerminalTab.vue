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
            @click="showSnippetDialog = true"
            class="action-btn"
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
        <el-tooltip v-if="!hideCloseButton" content="Disconnect" placement="bottom">
          <el-button
            type="danger"
            link
            :icon="Close"
            @click="handleClose"
            class="action-btn close-btn"
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
    
    <div class="terminal-body">
      <div class="terminal-content" :class="{ 'with-monitor': showMonitor, 'with-history': showCommandHistory }">
        <TerminalView
          v-if="isConnected"
          :connection-id="connectionId"
          :session-name="session?.name"
          :options="terminalOptions"
          ref="terminalRef"
          @input="handleTerminalInput"
          @cursor-position="handleCursorPosition"
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
      </div>
      
      <!-- 命令历史面板 -->
      <transition name="slide-right">
        <div v-if="showCommandHistory" class="history-sidebar">
          <CommandHistoryPanel @select="handleCommandSelect" />
        </div>
      </transition>
      
      <!-- 服务器监控面板 -->
      <transition name="slide-left">
        <div v-if="showMonitor" class="monitor-sidebar">
          <ServerMonitorPanel :session-id="connectionId" />
        </div>
      </transition>
    </div>
    
    <!-- Snippet Drawer -->
    <transition name="slide-right">
      <div v-if="showSnippetDialog" class="snippet-drawer">
        <div class="drawer-header">
          <h3>命令片段</h3>
          <el-button :icon="Close" link @click="showSnippetDialog = false" />
        </div>
        
        <div class="snippet-drawer-content">
          <!-- 搜索栏 -->
          <div class="drawer-search">
            <el-input
              v-model="snippetSearch"
              placeholder="搜索片段..."
              :prefix-icon="Search"
              clearable
            />
          </div>

          <!-- 分类过滤 -->
          <div class="category-filter">
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

          <!-- 标签过滤 -->
          <div v-if="allTags.length > 0" class="tag-filter">
            <div class="filter-title">标签筛选</div>
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

          <!-- 命令列表 -->
          <div class="snippet-list">
            <div
              v-for="snippet in filteredSnippets"
              :key="snippet.id"
              class="snippet-item"
              @click="selectSnippet(snippet)"
            >
              <div class="snippet-header">
                <div class="snippet-name">{{ snippet.name }}</div>
                <div class="snippet-meta">
                  <el-tag v-if="snippet.category" size="small" type="info">
                    {{ snippet.category }}
                  </el-tag>
                  <span class="usage-count">{{ snippet.usageCount }}次</span>
                </div>
              </div>
              <div class="snippet-command">{{ snippet.command }}</div>
              <div class="snippet-tags" v-if="snippet.tags && snippet.tags.length">
                <span v-for="tag in snippet.tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
            <div v-if="filteredSnippets.length === 0" class="empty-snippets">
              <el-icon :size="48"><Document /></el-icon>
              <p>未找到匹配的片段</p>
            </div>
          </div>
        </div>
      </div>
    </transition>
    
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Close, Loading, Search, Document, Brush, Monitor, Clock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TerminalView from './TerminalView.vue'
import TerminalSearch from './TerminalSearch.vue'
import CommandAutocomplete from './CommandAutocomplete.vue'
import CommandHistoryPanel from './CommandHistoryPanel.vue'
import ServerMonitorPanel from '../Monitor/ServerMonitorPanel.vue'
import { themes } from '@/utils/terminal-themes'
import { terminalManager } from '@/utils/terminal-manager'
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
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: [connectionId: string]
}>()

const terminalRef = ref()
const autocompleteRef = ref()
const isConnected = ref(false)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'>('connecting')
const showSearch = ref(false)
const reconnectAttempt = ref(0)
const reconnectMaxAttempts = ref(0)
const showReconnectNotification = ref(false)
const showSnippetDialog = ref(false)
const showVariableDialog = ref(false)
const showMonitor = ref(false)
const showCommandHistory = ref(false)
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

// 搜索相关状态
const currentSearchTerm = ref('')
const currentSearchOptions = ref({ caseSensitive: false, regex: false })

// 主题相关
const availableThemes = themes
const currentTheme = computed(() => props.terminalOptions?.theme || 'dark')

// 键盘事件清理函数（在顶层定义，供 onUnmounted 使用）
let cleanupKeyboard: (() => void) | null = null

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
    reconnectAttempt.value = 0
    ElMessage.info('已取消重连')
  } catch (error: any) {
    ElMessage.error(`取消重连失败: ${error.message}`)
  }
}

onMounted(async () => {
  // Load snippets
  loadSnippets()
  
  // 添加键盘事件监听（处理补全弹窗）
  const handleKeyDown = (e: KeyboardEvent) => {
    // 只在补全弹窗显示时处理键盘事件
    if (!showAutocomplete.value) return
    
    // 检查是否有建议
    const hasSuggestions = autocompleteRef.value?.hasSuggestions?.() || false
    
    // 对于 Enter 和 Tab 键，只有在有建议时才拦截
    if ((e.key === 'Enter' || e.key === 'Tab') && !hasSuggestions) {
      return // 让按键正常传递到终端
    }
    
    // 阻止终端捕获这些按键
    if (['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(e.key)) {
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
        case 'Enter':
          // 确认选择
          if (autocompleteRef.value) {
            autocompleteRef.value.selectCurrent()
          }
          break
        case 'Escape':
          // 关闭补全
          showAutocomplete.value = false
          autocompleteInput.value = ''
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
    }
    // 设置重连事件监听器（即使复用连接也需要监听）
    setupReconnectListeners()
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
    
    // Connect to SSH
    const result = await window.electronAPI.ssh.connect(props.connectionId, {
      host: props.session.host,
      port: props.session.port,
      username: props.session.username,
      password: props.session.password,
      privateKey: props.session.privateKeyPath || props.session.privateKey,
      passphrase: props.session.passphrase,
      // 应用 SSH 设置
      readyTimeout: (sshSettings.timeout || 30) * 1000, // 转换为毫秒
      keepaliveInterval: sshSettings.keepalive ? (sshSettings.keepaliveInterval || 60) * 1000 : undefined,
      keepaliveCountMax: sshSettings.keepalive ? 3 : undefined,
      sessionName: props.session.name
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

const handleClose = () => {
  emit('close', props.connectionId)
}

const handleThemeChange = async (themeName: string) => {
  try {
    // 更新终端选项中的主题
    if (props.terminalOptions) {
      props.terminalOptions.theme = themeName
    }

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

// 处理终端输入（用于智能补全）
const handleTerminalInput = (input: string) => {
  autocompleteInput.value = input
  
  // 智能显示补全的条件：
  // 1. 输入不为空
  // 2. 不是特殊字符（回车、换行）
  // 3. 输入长度 >= 1（至少一个字符）
  // 4. 对于快捷命令（/开头），立即显示
  // 5. 对于普通命令，至少2个字符才显示
  
  const shouldShow = input && 
                     input.length > 0 && 
                     !input.endsWith('\n') && 
                     !input.endsWith('\r') &&
                     (input.startsWith('/') || input.length >= 2)
  
  showAutocomplete.value = shouldShow
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
    
    // 发送退格和新文本
    const backspaces = '\b \b'.repeat(deleteCount) // 退格、空格、退格（完全清除字符）
    window.electronAPI.ssh.write(props.connectionId, backspaces + text)
    
    // 如果是快捷命令，增加使用次数
    if (currentInput.startsWith('/')) {
      // 尝试找到对应的片段并增加使用次数
      window.electronAPI.snippet?.getByShortcut?.(currentInput).then(result => {
        if (result?.success && result.data) {
          window.electronAPI.snippet?.incrementUsage?.(result.data.id)
        }
      })
    }
    
    // 自动聚焦终端，确保用户可以继续输入
    setTimeout(() => {
      if (terminalRef.value) {
        terminalRef.value.focus()
      }
    }, 50)
  }
  showAutocomplete.value = false
  autocompleteInput.value = ''
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.status-text {
  font-size: 11px;
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
  font-size: 14px;
  letter-spacing: 0.5px;
}

/* Snippet Drawer Styling */
.snippet-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 480px;
  background: var(--bg-main);
  border-left: 1px solid var(--border-color);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 2000;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.drawer-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.snippet-drawer-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-search {
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-main);
}

.category-filter {
  flex-shrink: 0;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  max-height: 180px;
  overflow-y: auto;
  background: var(--bg-secondary);
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
  font-size: 13px;
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
}

.tag-filter {
  flex-shrink: 0;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
  max-height: 150px;
  overflow-y: auto;
  background: var(--bg-secondary);
}

.filter-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.snippet-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.snippet-item {
  padding: 10px;
  margin-bottom: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-secondary);
}

.snippet-item:hover {
  background: var(--bg-main);
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.snippet-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
  gap: 8px;
}

.snippet-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
  flex: 1;
  line-height: 1.4;
}

.snippet-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.usage-count {
  font-size: 11px;
  color: var(--text-tertiary);
}

.snippet-command {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  color: #2563eb;
  background: var(--bg-tertiary);
  padding: 6px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
  border: 1px solid var(--border-medium);
  font-weight: 500;
}

/* 深色模式下的代码颜色 */
:global(.dark) .snippet-command {
  color: #60a5fa;
}

.snippet-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.snippet-tags .tag {
  background: var(--bg-main);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.empty-snippets {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
  text-align: center;
  color: var(--text-tertiary);
}

.empty-snippets p {
  margin-top: 12px;
  font-size: 14px;
}

.command-preview {
  margin-top: 20px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.preview-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.command-preview pre {
  margin: 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
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

.reconnect-content {
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;
  font-size: 13px;
  font-weight: 500;
}

.reconnect-icon {
  font-size: 16px;
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
