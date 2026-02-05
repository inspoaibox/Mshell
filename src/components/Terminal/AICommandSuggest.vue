<template>
  <transition name="fade-slide">
    <div v-if="visible" class="ai-command-suggest" :style="positionStyle">
      <div class="suggest-header">
        <span class="ai-icon">✨</span>
        <span class="ai-label">AI 命令建议</span>
        <span v-if="loading" class="loading-dot">●</span>
      </div>
      
      <div class="suggest-content">
        <div class="original-query">
          <span class="query-icon">#</span>
          <span class="query-text">{{ query }}</span>
        </div>
        
        <!-- 加载中 -->
        <div v-if="loading" class="loading-state">
          <span class="loading-text">正在生成命令...</span>
        </div>
        
        <!-- 错误信息 -->
        <div v-else-if="errorMessage" class="error-state">
          <span class="error-icon">❌</span>
          <span class="error-text">{{ errorMessage }}</span>
        </div>
        
        <!-- 命令建议 -->
        <template v-else-if="suggestion">
          <div class="command-preview">
            <code>{{ suggestion }}</code>
          </div>
          
          <div v-if="isRisky" class="risk-warning">
            <span class="warning-icon">⚠️</span>
            <span>此命令可能有风险，请确认后执行</span>
          </div>
        </template>
        
        <!-- 无建议 -->
        <div v-else class="no-suggestion">
          <span>未能生成命令建议</span>
        </div>
      </div>
      
      <div class="suggest-actions">
        <span v-if="suggestion && !loading" class="action-hint">
          <kbd>Enter</kbd> 执行
          <kbd>Tab</kbd> 编辑
          <kbd>Esc</kbd> 取消
        </span>
        <span v-else class="action-hint">
          <kbd>Esc</kbd> 取消
        </span>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Props {
  visible: boolean
  query: string
  position: { x: number; y: number }
  sessionId: string
}

const props = defineProps<Props>()
// emit 用于父组件通信，虽然当前通过 defineExpose 暴露方法，但保留以备扩展
defineEmits<{
  execute: [command: string]
  edit: [command: string]
  close: []
}>()

const suggestion = ref('')
const loading = ref(false)
const isRisky = ref(false)
const errorMessage = ref('')

// 请求 ID，用于取消过期请求
let currentRequestId = 0

// 危险命令模式
const riskyPatterns = [
  /rm\s+-rf?\s+\/(?!tmp)/,
  /rm\s+-rf?\s+\*/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /chmod\s+777/,
  /:(){ :|:& };:/
]

// 弹窗尺寸估算
const POPUP_WIDTH = 500 // 估算宽度 (min-width: 400, max-width: 600)
const POPUP_HEIGHT = 250 // 估算高度（增加一些余量）
const CURSOR_OFFSET = 25 // 光标偏移量（增加到一行高度，避免遮挡输入）
const EDGE_MARGIN = 10 // 边缘安全距离

const positionStyle = computed(() => {
  const { x, y } = props.position
  
  // 如果位置无效，隐藏弹窗
  if (x <= 0 && y <= 0) {
    return {
      left: '-9999px',
      top: '-9999px',
      visibility: 'hidden'
    }
  }
  
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  
  let left = x
  let top = y + CURSOR_OFFSET // 默认显示在光标下方（留出一行空间）
  let showAbove = false
  let maxHeight: number | null = null
  
  // 检查是否超出右边界
  if (left + POPUP_WIDTH > viewportWidth - EDGE_MARGIN) {
    // 向左偏移，但不超出左边界
    left = Math.max(EDGE_MARGIN, viewportWidth - POPUP_WIDTH - EDGE_MARGIN)
  }
  
  // 计算下方可用空间
  const spaceBelow = viewportHeight - y - CURSOR_OFFSET - EDGE_MARGIN
  // 计算上方可用空间
  const spaceAbove = y - CURSOR_OFFSET - EDGE_MARGIN
  
  // 检查是否超出底部边界
  if (spaceBelow < POPUP_HEIGHT) {
    // 下方空间不足
    if (spaceAbove > spaceBelow) {
      // 上方空间更大，显示在上方
      showAbove = true
      if (spaceAbove >= POPUP_HEIGHT) {
        // 上方空间足够
        top = y - POPUP_HEIGHT - CURSOR_OFFSET
      } else {
        // 上方空间也不够，限制高度并靠近顶部
        top = EDGE_MARGIN
        maxHeight = spaceAbove
      }
    } else {
      // 下方空间更大或相等，限制高度显示在下方
      maxHeight = spaceBelow
    }
  }
  
  // 确保不超出左边界
  if (left < EDGE_MARGIN) {
    left = EDGE_MARGIN
  }
  
  const style: Record<string, string> = {
    left: `${left}px`,
    top: `${top}px`,
    // 根据显示位置调整动画方向
    '--slide-direction': showAbove ? '10px' : '-10px'
  }
  
  // 如果需要限制高度
  if (maxHeight !== null && maxHeight > 0) {
    style.maxHeight = `${maxHeight}px`
    style.overflowY = 'auto'
  }
  
  return style
})

// 检查命令是否有风险
function checkRisk(command: string): boolean {
  return riskyPatterns.some(pattern => pattern.test(command))
}

// 生成命令建议
async function generateSuggestion() {
  if (!props.query || !props.visible) {
    console.log('[AICommandSuggest] generateSuggestion skipped - query:', props.query, 'visible:', props.visible)
    return
  }
  
  // 增加请求 ID，取消之前的请求
  const requestId = ++currentRequestId
  
  console.log('[AICommandSuggest] generateSuggestion started for query:', props.query, 'requestId:', requestId)
  
  loading.value = true
  suggestion.value = ''
  isRisky.value = false
  errorMessage.value = ''
  
  try {
    // 检查 AI API 是否可用
    if (!window.electronAPI?.ai?.request) {
      console.log('[AICommandSuggest] AI API not available')
      errorMessage.value = 'AI 功能未配置'
      return
    }
    
    const prompt = `你是一个 Linux/Unix 命令行专家。用户想要：${props.query}

要求：
1. 只返回一行可执行的 shell 命令
2. 不要任何解释、注释或 markdown 格式
3. 不要代码块标记
4. 直接输出命令，例如：cat /proc/cpuinfo | grep "model name"

命令：`

    console.log('[AICommandSuggest] Sending AI request...')
    const result = await window.electronAPI.ai.request('write', prompt)
    
    // 检查请求是否过期
    if (requestId !== currentRequestId) {
      console.log('[AICommandSuggest] Request expired, ignoring response')
      return
    }
    
    console.log('[AICommandSuggest] AI response:', result)
    
    if (result?.success && result.data) {
      // 清理返回的命令
      let command = result.data.trim()
      
      // 移除可能的 markdown 代码块
      command = command.replace(/^```[\w]*\n?/gm, '')
      command = command.replace(/\n?```$/gm, '')
      command = command.replace(/^`|`$/g, '')
      
      // 移除 "命令：" 等前缀
      command = command.replace(/^(命令|Command|cmd)[:：]\s*/i, '')
      
      // 只取第一行有效命令（过滤掉解释文本）
      const lines = command.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        // 跳过空行和看起来像解释的行
        if (!trimmed) continue
        if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) continue // 注释
        if (trimmed.includes('解释') || trimmed.includes('说明')) continue
        if (trimmed.length > 200) continue // 太长的可能是解释
        // 检查是否像命令（包含常见命令字符）
        if (/^[a-zA-Z0-9_\-\.\/]/.test(trimmed)) {
          command = trimmed
          break
        }
      }
      
      // 最终清理
      command = command.trim()
      
      if (command) {
        suggestion.value = command
        isRisky.value = checkRisk(command)
        console.log('[AICommandSuggest] Generated suggestion:', command)
      } else {
        errorMessage.value = '无法解析命令'
      }
    } else {
      errorMessage.value = result?.error || '生成失败'
    }
  } catch (error: any) {
    console.error('AI suggestion failed:', error)
    errorMessage.value = error?.message || 'AI 请求失败'
    suggestion.value = ''
  } finally {
    loading.value = false
  }
}

// 只监听 query 变化来触发 AI 请求
watch(() => props.query, (newQuery, oldQuery) => {
  console.log('[AICommandSuggest] Query changed:', oldQuery, '->', newQuery, 'visible:', props.visible)
  if (props.visible && newQuery) {
    // 只要 query 有值且 visible，就生成建议
    // 即使 query 和之前相同，也重新生成（用户可能想重试）
    generateSuggestion()
  }
})

// 监听 visible 变化
watch(() => props.visible, (newVal) => {
  console.log('[AICommandSuggest] Visible changed:', newVal, 'query:', props.query)
  if (!newVal) {
    // 关闭时重置状态
    suggestion.value = ''
    errorMessage.value = ''
    loading.value = false
    currentRequestId++ // 取消进行中的请求
  }
  // 移除打开时自动生成的逻辑，避免与 query watch 竞争
  // 由 query watch 统一处理
})

// 暴露方法
defineExpose({
  getSuggestion: () => suggestion.value,
  isLoading: () => loading.value
})
</script>

<style scoped>
.ai-command-suggest {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(14, 165, 233, 0.2);
  min-width: 400px;
  max-width: 600px;
  z-index: 2000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.suggest-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(139, 92, 246, 0.1));
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.ai-icon {
  font-size: var(--text-lg);
}

.ai-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--primary-color);
}

.loading-dot {
  color: var(--primary-color);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.suggest-content {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.original-query {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.query-icon {
  color: var(--primary-color);
  font-weight: bold;
}

.command-preview {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.command-preview code {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: var(--text-sm);
  color: var(--success-color);
  word-break: break-all;
}

.loading-state,
.error-state,
.no-suggestion {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.loading-text {
  animation: pulse 1.5s infinite;
}

.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--error-color);
}

.error-icon {
  font-size: var(--text-base);
}

.risk-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  margin-top: 8px;
  font-size: var(--text-xs);
  color: #ef4444;
}

.suggest-actions {
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.action-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.action-hint kbd {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: inherit;
  font-size: var(--text-xs);
  margin: 0 2px;
}

/* 动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(var(--slide-direction, -10px));
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(var(--slide-direction, -10px));
}
</style>
