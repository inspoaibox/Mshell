<template>
  <div
    :class="['file-drop-zone', { 'drag-over': isDragOver, disabled }]"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <!-- 拖拽时内容保持挂载（保留排序、滚动和选中状态），遮罩覆盖在上面 -->
    <slot></slot>

    <div v-if="isDragOver" class="drop-overlay">
      <div class="drop-content">
        <div class="drop-icon">📤</div>
        <div class="drop-title">释放以上传文件</div>
        <div class="drop-subtitle">{{ dropMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  disabled?: boolean
  accept?: string[] // 接受的文件类型
  maxSize?: number // 最大文件大小（字节）
  multiple?: boolean // 是否允许多文件
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  multiple: true
})

const emit = defineEmits<{
  /** skippedDirectories：拖入的文件夹名称（暂不支持上传文件夹，已从 files 中剔除） */
  upload: [files: File[], remotePath: string, skippedDirectories: string[]]
}>()

const isDragOver = ref(false)
const dragCounter = ref(0) // 用于处理嵌套元素的拖拽事件

const dropMessage = computed(() => {
  if (props.multiple) {
    return '支持多文件上传（暂不支持文件夹）'
  }
  return '单文件上传'
})

const resetDragState = () => {
  dragCounter.value = 0
  isDragOver.value = false
}

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types || []).includes('Files')

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault()

  if (props.disabled || !hasFiles(event)) return

  dragCounter.value++
  isDragOver.value = true
}

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault()

  if (props.disabled || dragCounter.value === 0) return

  dragCounter.value = Math.max(0, dragCounter.value - 1)

  if (dragCounter.value === 0) {
    isDragOver.value = false
  }
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()

  if (props.disabled) return

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

// 拖拽被取消（Esc、拖出窗口、窗口失焦）时不会触发 dragleave/drop，需要兜底复位
onMounted(() => {
  window.addEventListener('blur', resetDragState)
  window.addEventListener('dragend', resetDragState)
  window.addEventListener('drop', resetDragState)
})

onUnmounted(() => {
  window.removeEventListener('blur', resetDragState)
  window.removeEventListener('dragend', resetDragState)
  window.removeEventListener('drop', resetDragState)
})

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) resetDragState()
  }
)

/** 识别拖入的文件夹：必须在 drop 事件同步阶段读取 DataTransferItem */
const collectDirectoryFlags = (dataTransfer: DataTransfer | null, count: number): boolean[] => {
  const flags = new Array<boolean>(count).fill(false)
  const items = Array.from(dataTransfer?.items || []).filter((item) => item.kind === 'file')
  if (items.length !== count) return flags

  items.forEach((item, index) => {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    flags[index] = Boolean(entry?.isDirectory)
  })
  return flags
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()

  resetDragState()

  if (props.disabled) return

  const droppedFiles = Array.from(event.dataTransfer?.files || [])

  if (droppedFiles.length === 0) return

  const directoryFlags = collectDirectoryFlags(event.dataTransfer, droppedFiles.length)
  const skippedDirectories = droppedFiles
    .filter((_file, index) => directoryFlags[index])
    .map((file) => file.name)
  const files = droppedFiles.filter((_file, index) => !directoryFlags[index])

  if (files.length === 0) {
    emit('upload', [], '.', skippedDirectories)
    return
  }

  // 过滤文件
  let validFiles = files
  
  // 检查文件类型
  if (props.accept && props.accept.length > 0) {
    validFiles = validFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      return props.accept!.some(accept => {
        if (accept.startsWith('.')) {
          return ext === accept.toLowerCase()
        }
        // MIME type
        return file.type.match(new RegExp(accept.replace('*', '.*')))
      })
    })
  }
  
  // 检查文件大小
  if (props.maxSize) {
    validFiles = validFiles.filter(file => file.size <= props.maxSize!)
    
    const oversized = files.length - validFiles.length
    if (oversized > 0) {
      console.warn(`${oversized} 个文件超过大小限制`)
    }
  }
  
  // 检查多文件
  if (!props.multiple && validFiles.length > 1) {
    validFiles = [validFiles[0]]
  }
  
  if (validFiles.length > 0 || skippedDirectories.length > 0) {
    // 获取当前远程路径（从父组件传入或使用默认值）
    const remotePath = '.' // 默认当前目录
    emit('upload', validFiles, remotePath, skippedDirectories)
  }
}
</script>

<style scoped>
.file-drop-zone {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
}

.file-drop-zone.disabled {
  pointer-events: none;
  opacity: 0.6;
}

.drop-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--primary-color-rgb), 0.1);
  border: 3px dashed var(--primary-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

.drop-content {
  text-align: center;
  pointer-events: none;
}

.drop-icon {
  font-size: var(--text-6xl);
  margin-bottom: 16px;
  animation: bounce 1s ease-in-out infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.drop-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--primary-color);
  margin-bottom: 8px;
}

.drop-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
