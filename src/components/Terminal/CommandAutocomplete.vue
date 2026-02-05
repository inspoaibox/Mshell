<template>
  <div v-if="visible && suggestions.length > 0" class="autocomplete-popup" :style="popupStyle">
    <div class="autocomplete-header">
      <span class="hint-text">Tab 补全 · ↑↓ 选择 · Esc 取消</span>
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
            <span class="rest-part">{{ suggestion.displayText ? suggestion.displayText.substring(suggestion.matchPart.length) : suggestion.restPart }}</span>
          </div>
          <div v-if="suggestion.description || suggestion.usage" class="suggestion-description">
             <span v-if="suggestion.usage" class="usage-text">{{ suggestion.usage }}</span>
             <span v-if="suggestion.usage && suggestion.description" class="separator"> - </span>
             <span>{{ suggestion.description }}</span>
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
import { registry } from '@/utils/autocomplete/registry'
import { getRemotePathSuggestions as fetchRemotePaths } from '@/utils/autocomplete/providers/file-system'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

interface Suggestion {
  text: string
  type: 'command' | 'path' | 'history' | 'snippet' | 'shortcut' | 'option' | 'subcommand' | 'hint'
  matchPart: string
  restPart: string
  description?: string
  usageCount?: number
  priority?: number
  displayText?: string
  usage?: string
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
const hasUserSelected = ref(false) // 跟踪用户是否主动选择了建议
const commandHistory = ref<string[]>([])
const commonCommands = ref<string[]>([
  'ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv',
  'chmod', 'chown', 'tar', 'gzip', 'wget', 'curl', 'ssh', 'scp',
  'ps', 'top', 'kill', 'df', 'du', 'free', 'netstat', 'ping',
  'git', 'docker', 'npm', 'yarn', 'python', 'node', 'java', 'gcc',
  'code', 'vim', 'nano', 'gcloud', 'aws', 'kubectl'
])

// 片段缓存
const snippetCache = ref<any[]>([])
const snippetCacheTime = ref(0)
const CACHE_TTL = 5000 
let currentRequestId = 0
let debounceTimer: NodeJS.Timeout | null = null
const DEBOUNCE_DELAY = 150

// 组件实例 ID，用于防止多实例冲突
const instanceId = ref(`autocomplete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
// 上一次处理的输入，用于防止重复处理
let lastProcessedInput = ''

// 计算弹窗位置，智能避免遮挡光标和溢出屏幕
const popupStyle = computed(() => {
  const cursorX = props.cursorPosition.x
  const cursorY = props.cursorPosition.y
  
  // 如果光标位置无效（0,0 或负数），隐藏弹窗或使用默认位置
  if (cursorX <= 0 && cursorY <= 0) {
    // 返回一个屏幕外的位置，让弹窗不可见
    return {
      left: '-9999px',
      top: '-9999px',
      visibility: 'hidden'
    }
  }
  
  // 弹窗的预估尺寸
  const popupWidth = 380 // 预估宽度
  const popupHeight = 250 // 预估高度 (header + 约5个建议)
  const margin = 10 // 与边缘的最小间距
  const cursorOffset = 25 // 光标下方的偏移量，确保不遮挡当前行
  
  // 获取窗口尺寸
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight
  
  // 计算水平位置 - 尽量在光标右侧显示，避免遮挡输入
  let left = cursorX + 20 // 向右偏移一点
  if (left + popupWidth > windowWidth - margin) {
    // 如果右边溢出，尝试在光标左侧显示
    left = Math.max(margin, cursorX - popupWidth - 10)
  }
  
  // 计算垂直位置
  let top = cursorY + cursorOffset // 默认在光标下方，留出足够空间
  let showAbove = false
  
  // 检查下方空间是否足够
  const spaceBelow = windowHeight - cursorY - cursorOffset
  const spaceAbove = cursorY - margin
  
  if (spaceBelow < popupHeight && spaceAbove > popupHeight) {
    // 下方空间不足但上方足够，显示在光标上方
    top = cursorY - popupHeight - 10
    showAbove = true
  } else if (spaceBelow < popupHeight && spaceAbove < popupHeight) {
    // 上下都不够，选择空间更大的一侧，并限制高度
    if (spaceAbove > spaceBelow) {
      top = margin
      showAbove = true
    } else {
      top = cursorY + cursorOffset
    }
  }
  
  // 确保不超出屏幕
  top = Math.max(margin, Math.min(top, windowHeight - popupHeight - margin))
  
  return {
    left: `${left}px`,
    top: `${top}px`,
    '--slide-direction': showAbove ? '10px' : '-10px',
    maxHeight: `${Math.min(popupHeight, showAbove ? spaceAbove : spaceBelow) - 20}px`
  }
})

const getSuggestionIcon = (type: string): string => {
  switch (type) {
    case 'command': return '⚡'
    case 'subcommand': return '🔧'
    case 'option': return '🚩'
    case 'path': return '📁'
    case 'history': return '🕐'
    case 'snippet': return '📝'
    case 'shortcut': return '🚀'
    case 'hint': return '💡'
    default: return '💡'
  }
}

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
  } catch (error) { console.error(error) }
  return snippetCache.value || []
}



// 生成建议（带请求取消）
const generateSuggestions = async () => {
  // 检查输入有效性
  const rawInput = props.input || ''
  
  // 防止重复处理相同输入
  if (rawInput === lastProcessedInput && suggestions.value.length > 0) {
    return
  }
  
  if (!rawInput) {
    suggestions.value = []
    lastProcessedInput = ''
    return
  }
  
  if (!props.visible) {
    suggestions.value = []
    lastProcessedInput = ''
    return
  }

  const words = rawInput.split(' ')
  const currentWord = words[words.length - 1]

  if (words.length === 1 && !currentWord) {
    suggestions.value = []
    lastProcessedInput = ''
    return
  }

  // 记录当前处理的输入
  lastProcessedInput = rawInput
  const requestId = ++currentRequestId

  // 0. Registry Based Completion (Unified System)
  if (words.length >= 2) {
    let cmdName = words[0];
    const currentArgIndex = words.length - 1;
    
    // Check if we have a definition for this command
    let def = registry.getCommand(cmdName);
    let depth = 0;

    // Traverse subcommands to find the most specific definition
    for (let i = 1; i < currentArgIndex; i++) {
        if (def && def.subcommands && def.subcommands[words[i]]) {
            def = def.subcommands[words[i]];
            depth++;
        } else {
            break;
        }
    }

    if (def) {
       try {
         let items: any[] = [];
         
         // Call generate if available
         if (def.generate) {
              try {
                  items = await def.generate({
                      input: rawInput,
                      args: words,
                      currentArgIndex,
                      currentArg: currentWord,
                      sessionId: props.sessionId,
                      electronAPI: window.electronAPI
                  }) || [];
              } catch (genError) {
                  console.warn('Generate error:', genError);
                  items = [];
              }
         }
         
         // Check for stale request after async operation
         if (requestId !== currentRequestId) return;

         // Merge with static options
         let finalItems = items;
         if (def.options) {
             const staticMatches = def.options.filter(opt => {
                 // Context-aware filtering for subcommands
                 if (opt.type === 'subcommand') {
                     // Subcommands are only valid at the immediate level of the definition
                     if (currentArgIndex > (depth + 1)) {
                         return false;
                     }
                     // Also filter out subcommands that have already been selected
                     const usedSubcommands = words.slice(1, currentArgIndex);
                     if (usedSubcommands.includes(opt.text)) {
                         return false;
                     }
                 }
                 
                 // Options can be used multiple times, don't filter them
                 // Hints are contextual suggestions, always show if matching
                 
                 return opt.text.startsWith(currentWord) || (opt.displayText && opt.displayText.startsWith(currentWord));
             });
             finalItems = [...staticMatches, ...finalItems];
         }

         if (finalItems.length > 0) {
             const newSuggestions: Suggestion[] = finalItems.map(item => ({
                 text: item.text,
                 type: item.type as any, // types should match mostly
                 matchPart: item.matchPart || currentWord,
                 restPart: item.restPart || (item.text.startsWith(currentWord) ? item.text.substring(currentWord.length) : item.text),
                 description: item.description,
                 priority: item.priority || 50,
                 displayText: item.displayText,
                 usage: item.usage
             }));
             
             suggestions.value = newSuggestions;
             selectedIndex.value = 0;
             return;
         }
       } catch (error) {
           console.error('Registry completion error:', error);
       }
    }
  }

  // 优先处理快捷命令
  if (currentWord.startsWith('/')) {
    const shortcutSuggestions = await getShortcutSuggestions(currentWord)
    if (requestId !== currentRequestId) return
    suggestions.value = shortcutSuggestions
    selectedIndex.value = 0
    return
  }

  const allSuggestions: Suggestion[] = []

  // 1. 命令历史 & 常用命令 (仅第一个词)
  if (words.length === 1) {
    const historySuggestions = commandHistory.value
      .filter(cmd => cmd.startsWith(currentWord) && cmd !== currentWord)
      .slice(0, 5)
      .map(cmd => ({
        text: cmd,
        type: 'history' as const,
        matchPart: currentWord,
        restPart: cmd.substring(currentWord.length),
        priority: 100 
      }))
    allSuggestions.push(...historySuggestions)

    const commandSuggestions = commonCommands.value
      .filter(cmd => cmd.startsWith(currentWord) && cmd !== currentWord)
      .map(cmd => ({
        text: cmd,
        type: 'command' as const,
        matchPart: currentWord,
        restPart: cmd.substring(currentWord.length),
        priority: 80
      }))
    allSuggestions.push(...commandSuggestions)
  }

  // 2. 路径补全 (Path Completion)
  // 显式路径格式 OR 常用命令启发 (Heuristics)
  const isPathTrigger = currentWord.includes('/') || currentWord.startsWith('.') || currentWord.startsWith('~')
  // 简单的启发式: cd, ls, cat 等命令后通常接路径
  const prevWord = words.length > 1 ? words[words.length - 2] : ''
  const isCommandExpectingPath = ['cd', 'ls', 'cat', 'rm', 'cp', 'mv', 'mkdir', 'touch', 'nano', 'vim', 'vi'].includes(prevWord)

  if (isPathTrigger || isCommandExpectingPath) {
    try {
      let dirPath = '', filePrefix = ''
      if (currentWord.includes('/')) {
        const lastSlash = currentWord.lastIndexOf('/')
        dirPath = currentWord.substring(0, lastSlash + 1)
        filePrefix = currentWord.substring(lastSlash + 1)
      } else {
        dirPath = './'; filePrefix = currentWord
      }
      
      let foldersOnly = false
      if (prevWord === 'cd') foldersOnly = true
      
      const pathSuggestions = await getRemotePathSuggestions(dirPath, filePrefix, foldersOnly)
      if (requestId !== currentRequestId) return
      
      allSuggestions.push(...pathSuggestions.map(s => ({
          ...s, 
          priority: 90 
      })))
    } catch (error) { console.error('Path completion error:', error) }
  }

  // 3. 命令片段补全
  if (words.length === 1) {
    try {
      const snippets = await getSnippets()
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
          restPart: snippet.command.substring(rawInput.length),
          description: snippet.name,
          usageCount: snippet.usageCount,
          priority: 20
      }))
      
      allSuggestions.push(...snippetSuggestions)
    } catch (error) { }
  }

  if (requestId !== currentRequestId) return

  // Final Sort & De-duplicate
  allSuggestions.sort((a, b) => {
      const pA = a.priority ?? 50
      const pB = b.priority ?? 50
      if (pA !== pB) return pB - pA
      return 0
  })

  // 去重并限制数量
  const uniqueSuggestions = Array.from(
    new Map(allSuggestions.map(s => [s.text, s])).values()
  ).slice(0, 20)

  suggestions.value = uniqueSuggestions
  selectedIndex.value = 0
}

// 选择建议
const selectSuggestion = (suggestion: Suggestion) => {
  let text = suggestion.text

  // 如果建议文本包含当前输入的上下文（针对全命令补全如 History/Snippet）
  // 我们需要调整发送的文本，以适配 TerminalTab 的 "删除最后一个单词然后追加" 的逻辑
  // 公式: newText = suggestion.text - (props.input - lastWord)
  if (suggestion.type === 'snippet' || suggestion.type === 'history') {
      // 模拟 TerminalTab 的分词逻辑
      const words = props.input.split(/\s+/)
      const lastWord = words[words.length - 1]
      
      const inputWithoutLastWord = props.input.substring(0, props.input.length - lastWord.length)
      
      if (suggestion.text.startsWith(inputWithoutLastWord)) {
          text = suggestion.text.substring(inputWithoutLastWord.length)
      }
  }

  // 自动追加空格，方便层层递进 (Continuous Completion)
  if (['command', 'subcommand', 'option'].includes(suggestion.type)) {
      text += ' '
  }

  // 对于非目录的路径补全，也追加空格
  if (suggestion.type === 'path' && !text.endsWith('/')) {
      text += ' '
  }

  emit('select', text)
  suggestions.value = []
  hasUserSelected.value = false // 补全后重置选择状态，下次需要重新选择
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
const getRemotePathSuggestions = async (dirPath: string, filePrefix: string, foldersOnly: boolean = false): Promise<Suggestion[]> => {
  try {
    if (!props.sessionId) {
      return []
    }

    const fullInput = dirPath + filePrefix;
    
    // Use unified provider
    const items = await fetchRemotePaths(props.sessionId, fullInput, {
        foldersOnly,
        showHidden: true,
        electronAPI: window.electronAPI
    });
    
    return items.map(item => ({
        text: item.text,
        type: 'path' as const,
        matchPart: item.matchPart || filePrefix,
        restPart: item.restPart || '', 
        description: item.description,
        priority: item.priority,
        displayText: item.displayText
    }));
  } catch (error) {
    console.error('Failed to get remote path suggestions:', error)
    return []
  }
}

// 监听输入变化（带防抖）
watch(() => props.input, (newInput, oldInput) => {
  // 清除之前的定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  
  // 如果输入被清空或组件不可见，立即清空建议
  if (!newInput || !props.visible) {
    suggestions.value = []
    selectedIndex.value = 0
    hasUserSelected.value = false
    lastProcessedInput = ''
    return
  }
  
  // 对于快捷命令（/开头），立即显示，不防抖
  if (newInput.trim().startsWith('/')) {
    lastProcessedInput = '' // 重置，允许重新生成
    generateSuggestions()
    return
  }
  
  // 如果输入没有实际变化且已有建议，不处理
  if (newInput === oldInput && suggestions.value.length > 0) {
    return
  }
  
  // 其他情况使用防抖
  debounceTimer = setTimeout(() => {
    // 再次检查组件是否仍然可见，防止延迟执行时状态已变化
    if (props.visible && props.input === newInput) {
      lastProcessedInput = '' // 重置，允许重新生成
      generateSuggestions()
    }
  }, DEBOUNCE_DELAY)
})

// 监听可见性变化
watch(() => props.visible, (newVal) => {
  if (newVal) {
    // 打开时，只有当输入有效且与上次不同时才生成建议
    // 避免与 input watch 的竞争
    if (props.input && props.input !== lastProcessedInput) {
      // 使用 nextTick 确保 input 已经更新
      nextTick(() => {
        // 再次检查，防止状态变化
        if (props.visible && props.input) {
          lastProcessedInput = '' // 重置，允许重新生成
          generateSuggestions()
        }
      })
    }
  } else {
    // 关闭时立即清空所有状态，避免状态污染
    suggestions.value = []
    selectedIndex.value = 0
    hasUserSelected.value = false
    lastProcessedInput = ''
    // 清除防抖定时器
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    // 取消正在进行的请求
    currentRequestId++
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
  // 取消所有待处理的请求
  currentRequestId++
  // 清空状态
  suggestions.value = []
  lastProcessedInput = ''
})

// 暴露方法供父组件调用
defineExpose({
  selectNext: () => {
    if (suggestions.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % suggestions.value.length
      hasUserSelected.value = true // 用户主动选择了
    }
  },
  selectPrevious: () => {
    if (suggestions.value.length > 0) {
      selectedIndex.value = selectedIndex.value === 0 
        ? suggestions.value.length - 1 
        : selectedIndex.value - 1
      hasUserSelected.value = true // 用户主动选择了
    }
  },
  selectCurrent: () => {
    if (suggestions.value[selectedIndex.value]) {
      selectSuggestion(suggestions.value[selectedIndex.value])
    }
  },
  hasSuggestions: () => {
    return suggestions.value.length > 0
  },
  hasActiveSelection: () => {
    // 返回用户是否主动选择了建议
    return hasUserSelected.value
  },
  resetSelection: () => {
    // 重置选择状态
    hasUserSelected.value = false
    selectedIndex.value = 0
  },
  // 新增：强制清空所有状态
  forceReset: () => {
    suggestions.value = []
    selectedIndex.value = 0
    hasUserSelected.value = false
    lastProcessedInput = ''
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    currentRequestId++
  },
  // 新增：获取实例 ID（用于调试）
  getInstanceId: () => instanceId.value
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
  --slide-direction: -10px; /* 默认从上往下滑入 */
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(var(--slide-direction, -10px));
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
  font-size: var(--text-xs);
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
  font-size: var(--text-base);
  flex-shrink: 0;
}

.suggestion-content {
  flex: 1;
  min-width: 0;
}

.suggestion-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-sm);
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
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
}

.usage-text {
    font-family: 'Consolas', monospace;
    background: var(--bg-tertiary);
    padding: 0 4px;
    border-radius: 3px;
    color: var(--primary-color);
    margin-right: 4px;
}

.suggestion-badge {
  background: var(--primary-color);
  color: white;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: var(--text-xs);
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
