<template>
  <div
    :class="['draggable-tab', { dragging: isDragging, 'drag-over': isDragOver, active: isActive }]"
    draggable="true"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
    @click="$emit('click')"
  >
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGlobalDragAndDrop } from '@/composables/useDragAndDrop'

interface Props {
  tabId: string
  tabData: any
  index: number
  isActive?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  reorder: [fromIndex: number, toIndex: number]
  click: []
}>()

const dragDrop = useGlobalDragAndDrop()
const isDragging = ref(false)
const isDragOver = ref(false)

const handleDragStart = (event: DragEvent) => {
  isDragging.value = true
  
  dragDrop.startDrag({
    id: props.tabId,
    type: 'tab',
    data: {
      ...props.tabData,
      index: props.index
    }
  }, event)

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
  
  if (dragDrop.draggedItem.value?.type === 'tab' && 
      dragDrop.draggedItem.value.id !== props.tabId) {
    isDragOver.value = true
  }
}

const handleDragLeave = () => {
  isDragOver.value = false
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  
  if (dragDrop.draggedItem.value?.type === 'tab' && 
      dragDrop.draggedItem.value.id !== props.tabId) {
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false
  
  const draggedItem = dragDrop.draggedItem.value
  if (!draggedItem || draggedItem.type !== 'tab') return
  
  if (draggedItem.id === props.tabId) return
  
  // 触发重新排序
  const fromIndex = draggedItem.data.index
  const toIndex = props.index
  
  emit('reorder', fromIndex, toIndex)
  dragDrop.endDrag()
}
</script>

<style scoped>
.draggable-tab {
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.draggable-tab.dragging {
  opacity: 0.5;
  cursor: grabbing;
}

.draggable-tab.drag-over::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary-color);
  border-radius: 2px;
}

.draggable-tab:not(.dragging):hover {
  background: var(--bg-hover);
}

.draggable-tab.active {
  background: var(--bg-primary);
  border-bottom: 2px solid var(--primary-color);
}
</style>
