<template>
  <div
    v-if="visible"
    class="terminal-search"
    role="search"
    aria-label="终端搜索"
    @keydown.stop="handleKeydown"
  >
    <div class="search-controls">
      <el-input
        ref="searchInput"
        v-model="searchTerm"
        :placeholder="result.scope === 'screen' ? '搜索当前画面…' : '搜索终端历史…'"
        aria-label="搜索终端内容"
        size="small"
        clearable
        class="search-input"
      >
        <template #prefix
          ><el-icon><Search /></el-icon
        ></template>
      </el-input>
      <el-button
        size="small"
        text
        @click="findPrevious"
        :disabled="!searchTerm || !!result.error"
        title="上一个 (Shift+Enter)"
        aria-label="上一个匹配"
      >
        <el-icon><ArrowUp /></el-icon>
      </el-button>
      <el-button
        size="small"
        text
        @click="findNext"
        :disabled="!searchTerm || !!result.error"
        title="下一个 (Enter)"
        aria-label="下一个匹配"
      >
        <el-icon><ArrowDown /></el-icon>
      </el-button>
      <el-checkbox v-model="caseSensitive" size="small" title="区分大小写" aria-label="区分大小写"
        >Aa</el-checkbox
      >
      <el-checkbox v-model="useRegex" size="small" title="正则表达式" aria-label="正则表达式"
        >.*</el-checkbox
      >
      <span class="match-count" role="status" aria-live="polite">{{ matchLabel }}</span>
      <el-button
        size="small"
        text
        @click="close"
        title="关闭搜索并返回终端 (Esc)"
        aria-label="关闭搜索"
      >
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <div class="search-info">
      <span>{{
        result.scope === 'screen'
          ? '范围：全屏程序当前画面'
          : '范围：当前终端已保留的输出与滚动历史'
      }}</span>
      <span v-if="result.row !== null">
        {{ result.scope === 'screen' ? '画面' : '终端' }}第 {{ result.row }} 行，第
        {{ result.column }} 列
      </span>
      <span v-if="result.error" class="search-error" role="alert">{{ result.error }}</span>
    </div>
    <div v-if="result.scope === 'screen'" class="editor-search-hint">
      搜索整个文件请返回编辑器：Vim 按 <kbd>Esc</kbd> 后输入 <kbd>/关键词</kbd> 并回车，<kbd>n</kbd>
      / <kbd>N</kbd> 切换； Nano 按 <kbd>Ctrl+W</kbd>。此处高亮不会移动编辑器光标。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search, ArrowUp, ArrowDown, Close } from '@element-plus/icons-vue'
import { emptySearchResult, type TerminalSearchResult } from '@/utils/terminal-search'

const props = withDefaults(
  defineProps<{
    visible: boolean
    result?: TerminalSearchResult
  }>(),
  { result: () => emptySearchResult() }
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  search: [term: string, options: { caseSensitive: boolean; regex: boolean }]
  findNext: []
  findPrevious: []
  close: []
}>()

const searchInput = ref<{ focus: () => void }>()
const searchTerm = ref('')
const caseSensitive = ref(false)
const useRegex = ref(false)
const matchLabel = computed(() => {
  if (!searchTerm.value) return '输入关键词'
  if (props.result.error) return '搜索无效'
  if (!props.result.found) return props.result.scope === 'screen' ? '当前画面无匹配' : '无匹配'
  if (props.result.matchCount === null) return '已定位'
  const total = props.result.limited ? `≥${props.result.matchCount}` : props.result.matchCount
  return props.result.currentMatch === null
    ? `已定位 · ${total} 处`
    : `${props.result.currentMatch} / ${total}`
})

watch([searchTerm, caseSensitive, useRegex], () => {
  if (props.visible) {
    emit('search', searchTerm.value, { caseSensitive: caseSensitive.value, regex: useRegex.value })
  }
})

const focus = async () => {
  await nextTick()
  if (props.visible) searchInput.value?.focus()
}
watch(
  () => props.visible,
  (visible) => {
    if (visible) void focus()
    else searchTerm.value = ''
  },
  { immediate: true }
)

const findNext = () => {
  if (searchTerm.value && !props.result.error) emit('findNext')
}
const findPrevious = () => {
  if (searchTerm.value && !props.result.error) emit('findPrevious')
}
const close = () => {
  emit('update:visible', false)
  emit('close')
}
const handleKeydown = (event: KeyboardEvent) => {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (
    event.key === 'Enter' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.target as HTMLElement)?.closest('.search-input')
  ) {
    event.preventDefault()
    if (event.shiftKey) findPrevious()
    else findNext()
  }
}
defineExpose({ focus })
</script>

<style scoped>
.terminal-search {
  flex: 0 0 auto;
  min-width: 0;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.search-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.search-input {
  flex: 1 1 180px;
  min-width: 120px;
  max-width: 340px;
}
.terminal-search :deep(.el-button) {
  padding: 4px;
  margin: 0;
}
.match-count {
  font-size: var(--text-sm);
  padding: 0 8px;
  font-variant-numeric: tabular-nums;
}
.terminal-search :deep(.el-checkbox) {
  margin-right: 6px;
}
.terminal-search :deep(.el-checkbox__label) {
  padding-left: 4px;
  font-family: monospace;
}
.search-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 5px;
  font-size: 12px;
}
.editor-search-hint {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.6;
}
kbd {
  font-family: var(--font-mono);
  color: var(--text-primary);
}
.search-error {
  color: var(--error-color);
}
</style>
