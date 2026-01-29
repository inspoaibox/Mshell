<template>
  <div
    :class="['draggable-session-item', { dragging: isDragging, 'drag-over': isDragOver }]"
    draggable="true"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div class="drag-handle" title="拖拽排序">
      ⋮⋮
    </div>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGlobalDragAndDrop } from '@/composables/useDragAndDrop'

interface Props {
  sessionId: string
  sessionData: any
  index: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  reorder: [fromIndex: number, toIndex: number]
  moveToGroup: [sessionId: string, groupId: string]
}>()

const dragDrop = useGlobalDragAndDrop()
const isDragging = ref(false)
const isDragOver = ref(false)

const handleDragStart = (event: DragEvent) => {
  isDragging.value = true
  
  dragDrop.startDrag({
    id: props.sessionId,
    type: 'session',
    data: {
      ...props.sessionData,
      index: props.index
    }
  }, event)

  // 设置拖拽效果
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

const handleDragEnd = () => {
  isDragging.value = false
  dragDrop.endDrag()
}

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault()
  
  if (dragDrop.draggedItem.value?.type === 'session' && 
      dragDrop.draggedItem.value.id !== props.sessionId) {
    isDragOver.value = true
  }
}

const handleDragLeave = () => {
  isDragOver.value = false
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  
  if (dragDrop.draggedItem.value?.type === 'session' && 
      dragDrop.draggedItem.value.id !== props.sessionId) {
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false
  
  const draggedItem = dragDrop.draggedItem.value
  if (!draggedItem || draggedItem.type !== 'session') return
  
  if (draggedItem.id === props.sessionId) return
  
  // 触发重新排序
  const fromIndex = draggedItem.data.index
  const toIndex = props.index
  
  emit('reorder', fromIndex, toIndex)
  dragDrop.endDrag()
}
</script>

<style scoped>
.draggable-session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0; /* 移除间距 */
  transition: all 0.2s;
  cursor: grab; /* 整个区域都可以拖拽 */
  width: 100%; /* 确保宽度100% */
}

.draggable-session-item:active {
  cursor: grabbing;
}

.draggable-session-item.dragging {
  opacity: 0.5;
  cursor: grabbing;
}

.draggable-session-item.drag-over {
  border-top: 2px solid var(--primary-color);
}

.drag-handle {
  display: none; /* 隐藏拖拽图标，节省空间 */
  cursor: grab;
  color: var(--text-tertiary);
  font-size: 16px;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  user-select: none;
}

.draggable-session-item:hover .drag-handle {
  opacity: 1;
}

.drag-handle:active {
  cursor: grabbing;
}
</style>
