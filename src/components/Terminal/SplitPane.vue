<template>
  <div class="split-pane" :class="{ 'is-horizontal': direction === 'horizontal', 'is-vertical': direction === 'vertical' }">
    <!-- 第一个面板 -->
    <div
      class="pane pane-first"
      :style="firstPaneStyle"
    >
      <slot name="first"></slot>
    </div>

    <!-- 分隔条 -->
    <div
      class="split-divider"
      :class="{ dragging: isDragging }"
      @mousedown="startDrag"
    >
      <div class="divider-handle">
        <div class="divider-line"></div>
      </div>
    </div>

    <!-- 第二个面板 -->
    <div
      class="pane pane-second"
      :style="secondPaneStyle"
    >
      <slot name="second"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Props {
  direction: 'horizontal' | 'vertical'
  initialSize?: number // 第一个面板的初始大小（百分比）
  minSize?: number // 最小大小（百分比）
  maxSize?: number // 最大大小（百分比）
}

const props = withDefaults(defineProps<Props>(), {
  initialSize: 50,
  minSize: 10,
  maxSize: 90
})

const emit = defineEmits<{
  resize: [size: number]
}>()

const size = ref(props.initialSize)
const isDragging = ref(false)
const startPos = ref(0)
const startSize = ref(0)
const containerSize = ref(0)

// 第一个面板样式
const firstPaneStyle = computed(() => {
  if (props.direction === 'horizontal') {
    return { width: `${size.value}%` }
  } else {
    return { height: `${size.value}%` }
  }
})

// 第二个面板样式
const secondPaneStyle = computed(() => {
  if (props.direction === 'horizontal') {
    return { width: `${100 - size.value}%` }
  } else {
    return { height: `${100 - size.value}%` }
  }
})

// 开始拖拽
const startDrag = (event: MouseEvent) => {
  event.preventDefault()
  isDragging.value = true
  startPos.value = props.direction === 'horizontal' ? event.clientX : event.clientY
  startSize.value = size.value

  // 获取容器大小
  const container = (event.target as HTMLElement).parentElement
  if (container) {
    containerSize.value = props.direction === 'horizontal'
      ? container.clientWidth
      : container.clientHeight
  }

  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', stopDrag)
  document.body.style.cursor = props.direction === 'horizontal' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
}

// 处理拖拽
const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return

  const currentPos = props.direction === 'horizontal' ? event.clientX : event.clientY
  const delta = currentPos - startPos.value
  const deltaPercent = (delta / containerSize.value) * 100

  let newSize = startSize.value + deltaPercent
  newSize = Math.max(props.minSize, Math.min(props.maxSize, newSize))

  size.value = newSize
  emit('resize', newSize)
}

// 停止拖拽
const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.split-pane {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.split-pane.is-horizontal {
  flex-direction: row;
}

.split-pane.is-vertical {
  flex-direction: column;
}

.pane {
  overflow: hidden;
  position: relative;
}

.split-divider {
  position: relative;
  flex-shrink: 0;
  background: var(--border-color);
  transition: background 0.2s;
  z-index: 10;
}

.is-horizontal .split-divider {
  width: 4px;
  cursor: col-resize;
}

.is-vertical .split-divider {
  height: 4px;
  cursor: row-resize;
}

.split-divider:hover,
.split-divider.dragging {
  background: var(--primary-color);
}

.divider-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.is-horizontal .divider-handle {
  flex-direction: column;
}

.is-vertical .divider-handle {
  flex-direction: row;
}

.divider-line {
  background: var(--text-tertiary);
  border-radius: 2px;
  transition: background 0.2s;
}

.is-horizontal .divider-line {
  width: 2px;
  height: 24px;
}

.is-vertical .divider-line {
  width: 24px;
  height: 2px;
}

.split-divider:hover .divider-line,
.split-divider.dragging .divider-line {
  background: white;
}
</style>
