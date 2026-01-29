<template>
  <div v-if="visible && suggestions.length > 0" class="autocomplete-popup" :style="popupStyle">
    <div class="autocomplete-header">
      <span class="hint-text">Tab 补全 · ↑↓ 选择 · Enter 确认 · Esc 取消</span>
    </div>
    <div class="suggestions-list">
      <div
        v-for="(suggestion, index) in suggestions"
        :key="index"
        :class="['suggestion-item', { active: index === selectedIndex }]"
        @click="selectSuggestion(suggestion)"
        @mouseenter="selectedIndex = index"
      >
        <div class="suggestion-icon">
          {{ getSuggestionIcon(suggestion.type) }}
        </div>
        <div class="suggestion-content">
          <div class="suggestion-text">
            <span class="match-part">{{ suggestion.matchPart }}</span>
            <span class="rest-part">{{ suggestion.restPart }}</span>
          </div>
          <div v-if="suggestion.description" class="suggestion-description">
            {{ suggestion.description }}
          </div>
        </div>
        <div v-if="suggestion.usageCount" class="suggestion-badge">
          {{ suggestion.usageCount }}次
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Suggestion {
  text: string
  type: 'command' | 'path' | 'history' | 'snippet' | 'shortcut'
  matchPart: string
  restPart: string
  description?: string
  usageCount?: number
}

interface Props {
  visible: boolean
  input: string
  cursorPosition: { x: number; y: number }
  sessionId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [text: string]
  close: []
}>()

const suggestions = ref<Suggestion[]>([])
const selectedIndex = ref(0)
const commandHistory = ref<string[]>([])
const commonCommands = ref<string[]>([
  'ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv',
  'chmod', 'chown', 'tar', 'gzip', 'wget', 'curl', 'ssh', 'scp',
  'ps', 'top', 'kill', 'df', 'du', 'free', 'netstat', 'ping',
  'git', 'docker', 'npm', 'yarn', 'python', 'node', 'java', 'gcc'
])

// 片段缓存
const snippetCache = ref<any[]>([])
const snippetCacheTime = ref(0)
const CACHE_TTL = 5000 // 5秒缓存

// 请求取消机制
let currentRequestId = 0

// 防抖定时器
let debounceTimer: NodeJS.Timeout | null = null
const DEBOUNCE_DELAY = 150 // 150ms 防抖

// 弹窗位置
const popupStyle = computed(() => ({
  left: `${props.cursorPosition.x}px`,
  top: `${props.cursorPosition.y + 20}px`
}))

// 获取建议图标
const getSuggestionIcon = (type: string): string => {
  switch (type) {
    case 'command': return '⚡'
    case 'path': return '📁'
    case 'history': return '🕐'
    case 'snippet': return '📝'
    case 'shortcut': return '🚀'
    default: return '💡'
  }
}

// 获取片段（带缓存）
const getSnippets = async (): Promise<any[]> => {
  const now = Date.now()
  if (now - snippetCacheTime.value < CACHE_TTL && snippetCache.value.length > 0) {
    return snippetCache.value
  }
  
  try {
    const snippetResult = await window.electronAPI.snippet?.getAll?.()
    if (snippetResult?.success && snippetResult.data) {
      snippetCache.value = snippetResult.data
      snippetCacheTime.value = now
      return snippetResult.data
    }
  } catch (error) {
    console.error('Failed to load snippets:', error)
  }
  
  return snippetCache.value
}

// 生成建议（带请求取消）
const generateSuggestions = async () => {
  if (!props.input || !props.visible) {
    suggestions.value = []
    return
  }

  const input = props.input.trim()
  const words = input.split(/\s+/)
  const currentWord = words[words.length - 1]

  if (!currentWord) {
    suggestions.value = []
    return
  }

  // 生成唯一请求ID
  const requestId = ++currentRequestId

  // 优先处理快捷命令（以 / 开头）
  if (currentWord.startsWith('/')) {
    const shortcutSuggestions = await getShortcutSuggestions(currentWord)
    
    // 检查是否是最新请求
    if (requestId !== currentRequestId) return
    
    suggestions.value = shortcutSuggestions
    selectedIndex.value = 0
    return // 只显示快捷命令，不混合其他补全
  }

  const allSuggestions: Suggestion[] = []

  // 1. 命令历史补全
  if (words.length === 1) {
    // 从命令历史中查找
    const historySuggestions = commandHistory.value
      .filter(cmd => cmd.startsWith(currentWord) && cmd !== currentWord)
      .slice(0, 5)
      .map(cmd => ({
        text: cmd,
        type: 'history' as const,
        matchPart: currentWord,
        restPart: cmd.substring(currentWord.length),
        description: '历史命令'
      }))
    
    allSuggestions.push(...historySuggestions)

    // 常用命令补全
    const commandSuggestions = commonCommands.value
      .filter(cmd => cmd.startsWith(currentWord) && cmd !== currentWord)
      .map(cmd => ({
        text: cmd,
        type: 'command' as const,
        matchPart: currentWord,
        restPart: cmd.substring(currentWord.length),
        description: '常用命令'
      }))
    
    allSuggestions.push(...commandSuggestions)
  }

  // 2. 路径补全
  if (currentWord.includes('/') || currentWord.startsWith('.') || currentWord.startsWith('~')) {
    try {
      // 解析路径
      let dirPath = ''
      let filePrefix = ''
      
      if (currentWord.includes('/')) {
        const lastSlash = currentWord.lastIndexOf('/')
        dirPath = currentWord.substring(0, lastSlash + 1)
        filePrefix = currentWord.substring(lastSlash + 1)
      } else {
        dirPath = './'
        filePrefix = currentWord
      }
      
      // 通过 SSH 执行 ls 命令获取路径列表
      const pathSuggestions = await getRemotePathSuggestions(dirPath, filePrefix)
      
      // 检查是否是最新请求
      if (requestId !== currentRequestId) return
      
      allSuggestions.push(...pathSuggestions)
    } catch (error) {
      console.error('Path completion error:', error)
    }
  }

  // 3. 命令片段补全（使用缓存）
  try {
    const snippets = await getSnippets()
    
    // 检查是否是最新请求
    if (requestId !== currentRequestId) return
    
    const snippetSuggestions = snippets
      .filter((snippet: any) => {
        const cmd = snippet.command.split(/\s+/)[0]
        return cmd.startsWith(currentWord) && cmd !== currentWord
      })
      .slice(0, 5)
      .map((snippet: any) => ({
        text: snippet.command,
        type: 'snippet' as const,
        matchPart: currentWord,
        restPart: snippet.command.substring(currentWord.length),
        description: snippet.name,
        usageCount: snippet.usageCount
      }))
    
    allSuggestions.push(...snippetSuggestions)
  } catch (error) {
    console.error('Snippet completion error:', error)
  }

  // 最终检查是否是最新请求
  if (requestId !== currentRequestId) return

  // 去重并限制数量
  const uniqueSuggestions = Array.from(
    new Map(allSuggestions.map(s => [s.text, s])).values()
  ).slice(0, 10)

  suggestions.value = uniqueSuggestions
  selectedIndex.value = 0
}

// 选择建议
const selectSuggestion = (suggestion: Suggestion) => {
  emit('select', suggestion.text)
  suggestions.value = []
}

// 加载命令历史
const loadCommandHistory = async () => {
  try {
    const result = await window.electronAPI.commandHistory?.getRecentUnique?.(50)
    if (result?.success && result.data) {
      commandHistory.value = result.data
    }
  } catch (error) {
    console.error('Failed to load command history:', error)
  }
}

// 获取快捷命令建议
const getShortcutSuggestions = async (input: string): Promise<Suggestion[]> => {
  try {
    const result = await window.electronAPI.snippet?.searchByShortcut?.(input)
    if (result?.success && result.data) {
      return result.data.map((snippet: any) => ({
        text: snippet.command,
        type: 'shortcut' as const,
        matchPart: snippet.shortcut || input,
        restPart: ` → ${snippet.command}`,
        description: snippet.name,
        usageCount: snippet.usageCount
      }))
    }
  } catch (error) {
    console.error('Failed to get shortcut suggestions:', error)
  }
  return []
}

// 获取远程路径建议
const getRemotePathSuggestions = async (dirPath: string, filePrefix: string): Promise<Suggestion[]> => {
  try {
    if (!props.sessionId) {
      return []
    }

    // 构建 ls 命令 - 列出目录内容，-1 每行一个，-a 显示隐藏文件，-p 目录后加/
    const lsCommand = `ls -1ap "${dirPath}" 2>/dev/null`
    
    // 执行远程命令
    const result = await window.electronAPI.ssh?.executeCommand?.(props.sessionId, lsCommand, 3000)
    
    if (!result?.success || !result.data) {
      return []
    }

    // 解析输出 - 每行一个文件/目录名
    const files = result.data
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && line !== '.' && line !== '..')
      .filter(line => !filePrefix || line.startsWith(filePrefix))
    
    // 转换为建议列表
    return files.slice(0, 10).map(file => {
      const isDirectory = file.endsWith('/')
      const fileName = isDirectory ? file.slice(0, -1) : file
      const fullPath = dirPath + fileName
      
      return {
        text: fullPath,
        type: 'path' as const,
        matchPart: filePrefix,
        restPart: fileName.substring(filePrefix.length) + (isDirectory ? '/' : ''),
        description: isDirectory ? '目录' : '文件'
      }
    })
  } catch (error) {
    console.error('Failed to get remote path suggestions:', error)
    return []
  }
}

// 监听输入变化（带防抖）
watch(() => props.input, () => {
  // 清除之前的定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  
  // 对于快捷命令（/开头），立即显示，不防抖
  if (props.input.trim().startsWith('/')) {
    generateSuggestions()
    return
  }
  
  // 其他情况使用防抖
  debounceTimer = setTimeout(() => {
    generateSuggestions()
  }, DEBOUNCE_DELAY)
})

// 监听可见性变化
watch(() => props.visible, (newVal) => {
  if (newVal) {
    generateSuggestions()
  } else {
    suggestions.value = []
    selectedIndex.value = 0
    // 清除防抖定时器
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }
})

onMounted(() => {
  loadCommandHistory()
  // 键盘事件现在由父组件 TerminalTab 统一处理
})

onUnmounted(() => {
  // 清理防抖定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
})

// 暴露方法供父组件调用
defineExpose({
  selectNext: () => {
    if (suggestions.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % suggestions.value.length
    }
  },
  selectPrevious: () => {
    if (suggestions.value.length > 0) {
      selectedIndex.value = selectedIndex.value === 0 
        ? suggestions.value.length - 1 
        : selectedIndex.value - 1
    }
  },
  selectCurrent: () => {
    if (suggestions.value[selectedIndex.value]) {
      selectSuggestion(suggestions.value[selectedIndex.value])
    }
  },
  hasSuggestions: () => {
    return suggestions.value.length > 0
  }
})
</script>

<style scoped>
.autocomplete-popup {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 300px;
  max-width: 500px;
  max-height: 400px;
  overflow: hidden;
  z-index: 1000;
  animation: slideIn 0.15s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.autocomplete-header {
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.hint-text {
  font-size: 10px;
  color: var(--text-secondary);
}

.suggestions-list {
  max-height: 200px;
  overflow-y: auto;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border-color);
}

.suggestion-item:last-child {
  border-bottom: none;
}

.suggestion-item:hover,
.suggestion-item.active {
  background: var(--bg-hover);
}

.suggestion-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.suggestion-content {
  flex: 1;
  min-width: 0;
}

.suggestion-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-part {
  color: var(--primary-color);
  font-weight: 600;
}

.rest-part {
  color: var(--text-primary);
}

.suggestion-description {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-badge {
  background: var(--primary-color);
  color: white;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  flex-shrink: 0;
}

/* 滚动条样式 */
.suggestions-list::-webkit-scrollbar {
  width: 6px;
}

.suggestions-list::-webkit-scrollbar-track {
  background: var(--bg-tertiary);
}

.suggestions-list::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.suggestions-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
