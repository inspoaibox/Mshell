<template>
  <div v-if="visible" class="terminal-search">
    <el-input
      v-model="searchTerm"
      placeholder="搜索..."
      size="small"
      clearable
      @keyup.enter="findNext"
      @keyup.shift.enter="findPrevious"
      class="search-input"
    >
      <template #prepend>
        <el-icon><Search /></el-icon>
      </template>
    </el-input>
    <el-button size="small" text @click="findPrevious" title="上一个 (Shift+Enter)">
      <el-icon><ArrowUp /></el-icon>
    </el-button>
    <el-button size="small" text @click="findNext" title="下一个 (Enter)">
      <el-icon><ArrowDown /></el-icon>
    </el-button>
    <el-checkbox v-model="caseSensitive" size="small">Aa</el-checkbox>
    <el-checkbox v-model="useRegex" size="small">.*</el-checkbox>
    <span v-if="matchCount !== null" class="match-count">
      {{ currentMatch }}/{{ matchCount }}
    </span>
    <el-button size="small" text @click="close">
      <el-icon><Close /></el-icon>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Search, ArrowUp, ArrowDown, Close } from '@element-plus/icons-vue'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  search: [term: string, options: { caseSensitive: boolean; regex: boolean }]
  findNext: []
  findPrevious: []
}>()

const searchTerm = ref('')
const caseSensitive = ref(false)
const useRegex = ref(false)
const matchCount = ref<number | null>(null)
const currentMatch = ref(0)

watch(searchTerm, (newTerm) => {
  if (newTerm) {
    emit('search', newTerm, {
      caseSensitive: caseSensitive.value,
      regex: useRegex.value
    })
  }
})

watch([caseSensitive, useRegex], () => {
  if (searchTerm.value) {
    emit('search', searchTerm.value, {
      caseSensitive: caseSensitive.value,
      regex: useRegex.value
    })
  }
})

const findNext = () => {
  emit('findNext')
  if (matchCount.value && currentMatch.value < matchCount.value) {
    currentMatch.value++
  }
}

const findPrevious = () => {
  emit('findPrevious')
  if (currentMatch.value > 1) {
    currentMatch.value--
  }
}

const close = () => {
  emit('update:visible', false)
  searchTerm.value = ''
  matchCount.value = null
  currentMatch.value = 0
}

defineExpose({
  focus: () => {
    // Focus on input when search is opened
  }
})
</script>

<style scoped>
.terminal-search {
  position: absolute;
  top: 52px;
  right: 8px;
  z-index: 100;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.search-input {
  width: 180px;
  flex-shrink: 0;
}

/* 按钮样式优化 */
.terminal-search :deep(.el-button) {
  padding: 4px;
  margin: 0;
}

.match-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  padding: 0 4px;
  min-width: 40px;
  text-align: center;
}

/* 复选框样式优化 */
.terminal-search :deep(.el-checkbox) {
  margin-right: 0;
}

.terminal-search :deep(.el-checkbox__label) {
  padding-left: 4px;
  font-size: var(--text-sm);
  font-family: monospace;
  font-weight: 600;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .terminal-search {
    top: 48px;
    right: 4px;
    flex-wrap: wrap;
  }

  .search-input {
    width: 150px;
  }
}
</style>
