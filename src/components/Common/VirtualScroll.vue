<template>
  <div ref="containerRef" class="virtual-scroll" @scroll="handleScroll">
    <div class="virtual-scroll-spacer" :style="{ height: `${totalHeight}px` }">
      <div class="virtual-scroll-content" :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="item in visibleItems"
          :key="getItemKey(item)"
          class="virtual-scroll-item"
          :style="{ height: `${itemHeight}px` }"
        >
          <slot :item="item" :index="item.__index"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  items: T[]
  itemHeight: number
  buffer?: number // 缓冲区项目数
  keyField?: string // 用于 key 的字段名
}

const props = withDefaults(defineProps<Props>(), {
  buffer: 5,
  keyField: 'id'
})

const containerRef = ref<HTMLElement>()
const scrollTop = ref(0)
const containerHeight = ref(0)

// 总高度
const totalHeight = computed(() => props.items.length * props.itemHeight)

// 可见区域的起始和结束索引
const startIndex = computed(() => {
  const index = Math.floor(scrollTop.value / props.itemHeight)
  return Math.max(0, index - props.buffer)
})

const endIndex = computed(() => {
  const visibleCount = Math.ceil(containerHeight.value / props.itemHeight)
  const index = startIndex.value + visibleCount
  return Math.min(props.items.length, index + props.buffer)
})

// 可见项目
const visibleItems = computed(() => {
  return props.items.slice(startIndex.value, endIndex.value).map((item, i) => ({
    ...item,
    __index: startIndex.value + i
  }))
})

// 偏移量
const offsetY = computed(() => startIndex.value * props.itemHeight)

// 获取项目的 key
const getItemKey = (item: any): string | number => {
  if (props.keyField && item[props.keyField] !== undefined) {
    return item[props.keyField]
  }
  return item.__index
}

// 处理滚动
const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement
  scrollTop.value = target.scrollTop
}

// 更新容器高度
const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
  }
}

// 滚动到指定索引
const scrollToIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
  if (!containerRef.value) return
  
  const targetScrollTop = index * props.itemHeight
  containerRef.value.scrollTo({
    top: targetScrollTop,
    behavior
  })
}

// 滚动到顶部
const scrollToTop = (behavior: ScrollBehavior = 'smooth') => {
  scrollToIndex(0, behavior)
}

// 滚动到底部
const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
  scrollToIndex(props.items.length - 1, behavior)
}

// ResizeObserver
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateContainerHeight()
  
  // 监听容器大小变化
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerHeight()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value)
    resizeObserver.disconnect()
  }
})

// 监听 items 变化，重置滚动位置
watch(() => props.items.length, () => {
  // 如果列表变短，确保滚动位置不超出范围
  if (scrollTop.value > totalHeight.value) {
    scrollTop.value = Math.max(0, totalHeight.value - containerHeight.value)
    if (containerRef.value) {
      containerRef.value.scrollTop = scrollTop.value
    }
  }
})

// 暴露方法
defineExpose({
  scrollToIndex,
  scrollToTop,
  scrollToBottom
})
</script>

<style scoped>
.virtual-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

.virtual-scroll-spacer {
  position: relative;
  width: 100%;
}

.virtual-scroll-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.virtual-scroll-item {
  width: 100%;
  overflow: hidden;
}

/* 滚动条样式 */
.virtual-scroll::-webkit-scrollbar {
  width: 8px;
}

.virtual-scroll::-webkit-scrollbar-track {
  background: var(--bg-tertiary);
}

.virtual-scroll::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.virtual-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
