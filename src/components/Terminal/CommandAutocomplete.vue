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
            <span class="rest-part">{{
              suggestion.displayText
                ? suggestion.displayText.substring((suggestion.matchPart || '').length)
                : suggestion.restPart
            }}</span>
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { getCompletions, type CompletionChoice } from '@/utils/autocomplete/suggestions'
import { completionHistory, retainCompletionHistory } from '@/utils/autocomplete/history'
const props = defineProps<{
  visible: boolean
  input: string
  cursorPosition: { x: number; y: number }
  sessionId: string
  cwd?: string
}>()
const emit = defineEmits<{
  select: [command: string, sourceInput: string, snippetId?: string]
  close: []
}>()
type PopupStyle = CSSProperties & { '--slide-direction'?: string }
const suggestions = ref<CompletionChoice[]>([])
const selectedIndex = ref(0)
const hasUserSelected = ref(false)
let version = 0
let timer: ReturnType<typeof setTimeout> | undefined
let releaseHistory: (() => void) | undefined
let disposed = false
const popupStyle = computed<PopupStyle>(() => {
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
const getSuggestionIcon = (type: string) =>
  (
    ({
      command: '⚡',
      subcommand: '🔧',
      option: '🚩',
      path: '📁',
      history: '🕐',
      snippet: '📝',
      shortcut: '🚀'
    }) as Record<string, string>
  )[type] || '💡'
const reset = () => {
  version++
  if (timer) clearTimeout(timer)
  timer = undefined
  suggestions.value = []
  selectedIndex.value = 0
  hasUserSelected.value = false
}
const schedule = () => {
  reset()
  if (!props.visible || !props.input || disposed) return
  const requestVersion = version,
    input = props.input,
    id = props.sessionId
  timer = setTimeout(
    async () => {
      try {
        const result = await getCompletions(input, id, props.cwd, window.electronAPI)
        if (
          !disposed &&
          props.visible &&
          requestVersion === version &&
          input === props.input &&
          id === props.sessionId
        )
          suggestions.value = result
      } catch {
        /* The next input retries. Do not resurrect an old list. */
      }
    },
    input.startsWith('/') ? 0 : 150
  )
}
const selectSuggestion = (item: CompletionChoice) => {
  if (!props.visible || item.sourceInput !== props.input || !suggestions.value.includes(item))
    return
  emit('select', item.command, item.sourceInput, item.snippetId)
  reset()
}
watch(
  () => [props.input, props.visible, props.sessionId, props.cwd, completionHistory.value],
  schedule,
  { immediate: true, flush: 'sync' }
)
onMounted(() => {
  releaseHistory = retainCompletionHistory()
})
onUnmounted(() => {
  disposed = true
  reset()
  releaseHistory?.()
})
defineExpose({
  selectNext: () => {
    if (suggestions.value.length) {
      selectedIndex.value = (selectedIndex.value + 1) % suggestions.value.length
      hasUserSelected.value = true
    }
  },
  selectPrevious: () => {
    if (suggestions.value.length) {
      selectedIndex.value =
        (selectedIndex.value + suggestions.value.length - 1) % suggestions.value.length
      hasUserSelected.value = true
    }
  },
  selectCurrent: () => {
    const item = suggestions.value[selectedIndex.value]
    if (item) selectSuggestion(item)
  },
  hasSuggestions: () => suggestions.value.length > 0,
  hasActiveSelection: () => hasUserSelected.value,
  forceReset: reset
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
