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
        <el-tooltip content="Disconnect" placement="bottom">
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
    
    <div class="terminal-content">
      <TerminalView
        v-if="isConnected"
        :connection-id="connectionId"
        :options="terminalOptions"
        ref="terminalRef"
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
    </div>
    
    <!-- Snippet Dialog -->
    <el-dialog 
      v-model="showSnippetDialog" 
      title="Command Snippets" 
      width="800px" 
      class="custom-dialog snippet-dialog"
      :close-on-click-modal="false"
    >
      <div class="snippet-dialog-content">
        <!-- 左侧：分类和搜索 -->
        <div class="snippet-sidebar">
          <!-- 搜索栏 -->
          <div class="sidebar-search">
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
        </div>

        <!-- 右侧：命令列表 -->
        <div class="snippet-list-container">
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
    </el-dialog>
    
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
import { Close, Loading, Search, Document, Brush } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TerminalView from './TerminalView.vue'
import TerminalSearch from './TerminalSearch.vue'
import { themes } from '@/utils/terminal-themes'
import type { SessionConfig as BaseSessionConfig } from '@/types/session'

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
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: [connectionId: string]
}>()

const terminalRef = ref()
const isConnected = ref(false)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const showSearch = ref(false)
const showSnippetDialog = ref(false)
const showVariableDialog = ref(false)
const snippetSearch = ref('')
const filterCategory = ref('')
const filterTags = ref<string[]>([])
const snippets = ref<CommandSnippet[]>([])
const selectedSnippet = ref<CommandSnippet | null>(null)
const variableValues = ref<Record<string, string>>({})

// 主题相关
const availableThemes = themes
const currentTheme = computed(() => props.terminalOptions?.theme || 'dark')

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
    'status-error': connectionStatus.value === 'error'
  }
})

onMounted(async () => {
  // Load snippets
  loadSnippets()
  
  try {
    // Connect to SSH
    const result = await window.electronAPI.ssh.connect(props.connectionId, {
      host: props.session.host,
      port: props.session.port,
      username: props.session.username,
      password: props.session.password,
      privateKey: props.session.privateKeyPath || props.session.privateKey,
      passphrase: props.session.passphrase
    })

    if (result.success) {
      isConnected.value = true
      connectionStatus.value = 'connected'
      ElMessage.success(`Connected to ${props.session.host}`)
    } else {
      connectionStatus.value = 'error'
      ElMessage.error(`Connection failed: ${result.error}`)
    }
  } catch (error: any) {
    connectionStatus.value = 'error'
    ElMessage.error(`Connection error: ${error.message}`)
  }
})

onUnmounted(async () => {
  // Disconnect SSH when component is unmounted
  if (isConnected.value) {
    try {
      await window.electronAPI.ssh.disconnect(props.connectionId)
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }
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
  if (terminalRef.value) {
    terminalRef.value.search(term, options)
  }
}

const handleFindNext = () => {
  if (terminalRef.value) {
    terminalRef.value.findNext()
  }
}

const handleFindPrevious = () => {
  if (terminalRef.value) {
    terminalRef.value.findPrevious()
  }
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
  gap: 4px;
}

.action-btn {
  padding: 4px;
  height: 24px;
  width: 24px;
  border-radius: 4px;
  color: var(--text-secondary);
}

.action-btn:hover {
  background-color: var(--bg-tertiary);
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
  background-color: #0d1117; /* Dedicated terminal bg */
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

/* Snippet Dialog Styling */
.snippet-dialog :deep(.el-dialog__body) {
  padding: 0;
  height: 500px;
}

.snippet-dialog-content {
  display: flex;
  height: 100%;
}

.snippet-sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-search {
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.category-filter {
  flex-shrink: 0;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  max-height: 200px;
  overflow-y: auto;
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
  flex: 1;
  padding: 12px;
  overflow-y: auto;
}

.filter-title {
  font-size: 12px;
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

.snippet-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.snippet-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.snippet-item {
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-secondary);
}

.snippet-item:hover {
  background: var(--bg-tertiary);
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.snippet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.snippet-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
  flex: 1;
}

.snippet-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.usage-count {
  font-size: 11px;
  color: var(--text-tertiary);
}

.snippet-command {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #2563eb;
  background: var(--bg-tertiary);
  padding: 6px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
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
</style>
