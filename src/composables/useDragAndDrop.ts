import { ref } from 'vue'

export interface DragItem {
  id: string
  type: string
  data: any
}

export interface DropZone {
  id: string
  accepts: string[]
  onDrop: (item: DragItem) => void
}

/**
 * 拖拽功能 Composable
 */
export function useDragAndDrop() {
  const draggedItem = ref<DragItem | null>(null)
  const isDragging = ref(false)
  const dropZones = ref<Map<string, DropZone>>(new Map())

  /**
   * 开始拖拽
   */
  const startDrag = (item: DragItem, event?: DragEvent) => {
    draggedItem.value = item
    isDragging.value = true

    if (event && event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/json', JSON.stringify(item))
    }
  }

  /**
   * 结束拖拽
   */
  const endDrag = () => {
    draggedItem.value = null
    isDragging.value = false
  }

  /**
   * 注册放置区域
   */
  const registerDropZone = (zone: DropZone) => {
    dropZones.value.set(zone.id, zone)
  }

  /**
   * 注销放置区域
   */
  const unregisterDropZone = (zoneId: string) => {
    dropZones.value.delete(zoneId)
  }

  /**
   * 处理放置
   */
  const handleDrop = (zoneId: string, event?: DragEvent) => {
    const zone = dropZones.value.get(zoneId)
    if (!zone || !draggedItem.value) return

    // 检查是否接受该类型
    if (!zone.accepts.includes(draggedItem.value.type)) {
      endDrag()
      return
    }

    // 执行放置回调
    zone.onDrop(draggedItem.value)
    endDrag()

    if (event) {
      event.preventDefault()
    }
  }

  /**
   * 处理拖拽进入
   */
  const handleDragEnter = (zoneId: string, event?: DragEvent) => {
    const zone = dropZones.value.get(zoneId)
    if (!zone || !draggedItem.value) return

    if (zone.accepts.includes(draggedItem.value.type)) {
      if (event) {
        event.preventDefault()
      }
    }
  }

  /**
   * 处理拖拽悬停
   */
  const handleDragOver = (zoneId: string, event?: DragEvent) => {
    const zone = dropZones.value.get(zoneId)
    if (!zone || !draggedItem.value) return

    if (zone.accepts.includes(draggedItem.value.type)) {
      if (event) {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'move'
      }
    }
  }

  /**
   * 检查是否可以放置
   */
  const canDrop = (zoneId: string): boolean => {
    const zone = dropZones.value.get(zoneId)
    if (!zone || !draggedItem.value) return false
    return zone.accepts.includes(draggedItem.value.type)
  }

  return {
    draggedItem,
    isDragging,
    startDrag,
    endDrag,
    registerDropZone,
    unregisterDropZone,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    canDrop
  }
}

// 全局拖拽状态（用于跨组件共享）
let globalDragState: ReturnType<typeof useDragAndDrop> | null = null

export function useGlobalDragAndDrop() {
  if (!globalDragState) {
    globalDragState = useDragAndDrop()
  }
  return globalDragState
}
