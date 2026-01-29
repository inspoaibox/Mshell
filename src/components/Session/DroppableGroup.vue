<template>
  <div
    :class="['droppable-group', { 'drag-over': isDragOver, 'can-drop': canDrop }]"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <slot></slot>
    <div v-if="isDragOver && canDrop" class="drop-indicator">
      <div class="drop-icon">📁</div>
      <div class="drop-text">放置到此分组</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGlobalDragAndDrop } from '@/composables/useDragAndDrop'

interface Props {
  groupId: string
  groupName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  drop: [sessionId: string, groupId: string]
}>()

const dragDrop = useGlobalDragAndDrop()
const isDragOver = ref(false)

const canDrop = computed(() => {
  return dragDrop.draggedItem.value?.type === 'session'
})

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault()
  
  if (canDrop.value) {
    isDragOver.value = true
  }
}

const handleDragLeave = (event: DragEvent) => {
  // 只有当离开整个组件时才设置为 false
  const target = event.target as HTMLElement
  const currentTarget = event.currentTarget as HTMLElement
  
  if (!currentTarget.contains(event.relatedTarget as Node)) {
    isDragOver.value = false
  }
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  
  if (canDrop.value && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false
  
  const draggedItem = dragDrop.draggedItem.value
  if (!draggedItem || draggedItem.type !== 'session') return
  
  // 触发放置事件
  emit('drop', draggedItem.id, props.groupId)
  dragDrop.endDrag()
}
</script>

<style scoped>
.droppable-group {
  position: relative;
  transition: all 0.2s;
}

.droppable-group.drag-over.can-drop {
  background: rgba(var(--primary-color-rgb), 0.1);
  border: 2px dashed var(--primary-color);
  border-radius: 8px;
}

.drop-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 10;
}

.drop-icon {
  font-size: 48px;
  opacity: 0.8;
}

.drop-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
  background: var(--bg-primary);
  padding: 6px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
