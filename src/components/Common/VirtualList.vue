<template>
  <div class="virtual-list">
    <VirtualScroll
      ref="virtualScrollRef"
      :items="filteredItems"
      :item-height="itemHeight"
      :buffer="buffer"
      :key-field="keyField"
    >
      <template #default="{ item, index }">
        <slot :item="item" :index="index"></slot>
      </template>
    </VirtualScroll>

    <!-- 空状�?-->
    <div v-if="filteredItems.length === 0" class="list-empty">
      <slot name="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-text">{{ emptyText }}</div>
      </slot>
    </div>

    <!-- 加载更多 -->
    <div v-if="hasMore && !loading" class="load-more">
      <button @click="$emit('loadMore')" class="btn-load-more">
        加载更多
      </button>
    </div>

    <!-- 加载�?-->
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <span>加载�?..</span>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { ref, computed } from 'vue'
import VirtualScroll from './VirtualScroll.vue'

interface Props {
  items: T[]
  itemHeight: number
  buffer?: number
  keyField?: string
  filterFn?: (item: T) => boolean
  emptyText?: string
  hasMore?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  buffer: 5,
  keyField: 'id',
  emptyText: '暂无数据',
  hasMore: false,
  loading: false
})

defineEmits<{
  loadMore: []
}>()

const virtualScrollRef = ref<InstanceType<typeof VirtualScroll>>()

// 过滤后的项目
const filteredItems = computed(() => {
  if (!props.filterFn) return props.items
  return props.items.filter(props.filterFn)
})

// 滚动到指定索�?
const scrollToIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
  virtualScrollRef.value?.scrollToIndex(index, behavior)
}

// 滚动到顶�?
const scrollToTop = (behavior: ScrollBehavior = 'smooth') => {
  virtualScrollRef.value?.scrollToTop(behavior)
}

// 滚动到底�?
const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
  virtualScrollRef.value?.scrollToBottom(behavior)
}

// 暴露方法
defineExpose({
  scrollToIndex,
  scrollToTop,
  scrollToBottom
})
</script>

<style scoped>
.virtual-list {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.list-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: var(--text-7xl);
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: var(--text-lg);
}

.load-more {
  padding: 16px;
  text-align: center;
  border-top: 1px solid var(--border-color);
}

.btn-load-more {
  padding: 8px 24px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-load-more:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
