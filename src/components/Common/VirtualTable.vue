<template>
  <div :class="['virtual-table', { resizing: Boolean(resizingState) }]">
    <!-- 表头 -->
    <div class="table-header" :style="{ paddingRight: scrollbarWidth + 'px' }">
      <div
        v-for="(column, columnIndex) in columns"
        :key="column.key"
        :class="['table-header-cell', { sortable: column.sortable }]"
        :style="getColumnStyle(column)"
        @click="column.sortable && handleSort(column.key)"
      >
        <span class="header-label">{{ column.label }}</span>
        <span v-if="column.sortable && sortKey === column.key" class="sort-icon">
          {{ sortOrder === 'asc' ? '↑' : '↓' }}
        </span>
        <button
          v-if="resizable && columnIndex < columns.length - 1"
          class="column-resize-handle"
          type="button"
          aria-label="调整列宽"
          @click.stop
          @dblclick.stop
          @mousedown.stop.prevent="startColumnResize(columnIndex, $event)"
        />
      </div>
    </div>

    <!-- 虚拟滚动内容 -->
    <VirtualScroll
      ref="virtualScrollRef"
      :items="sortedData"
      :item-height="rowHeight"
      :buffer="buffer"
      class="table-body"
      :key="dataKey"
    >
      <template #default="{ item, index: globalIndex }">
        <div
          :class="['table-row', { selected: isSelected(item), hover: hoverIndex === globalIndex }]"
          @click="(e) => handleRowClick(item, globalIndex, e)"
          @dblclick="handleRowDblclick(item)"
          @contextmenu="(e) => handleRowContextmenu(item, null, e)"
          @mouseenter="hoverIndex = globalIndex"
          @mouseleave="hoverIndex = -1"
        >
          <div
            v-for="column in columns"
            :key="column.key"
            class="table-cell"
            :style="getColumnStyle(column)"
          >
            <slot
              v-if="column.slot"
              :name="column.slot"
              :row="item"
              :column="column"
              :index="globalIndex"
            ></slot>
            <span v-else>{{ getCellValue(item, column.key) }}</span>
          </div>
        </div>
      </template>
    </VirtualScroll>

    <!-- 空状态 -->
    <div v-if="sortedData.length === 0" class="table-empty">
      <slot name="empty">
        <div class="empty-icon">📭</div>
        <div class="empty-text">暂无数据</div>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends Record<string, any>">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import VirtualScroll from './VirtualScroll.vue'
import type { Column } from './virtual-table.types'

type VirtualScrollExpose = {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

interface Props {
  data: T[]
  columns: Column[]
  rowHeight?: number
  buffer?: number
  selectable?: boolean
  selectedKey?: string
  resizable?: boolean
  storageKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  rowHeight: 48,
  buffer: 5,
  selectable: false,
  selectedKey: 'id',
  resizable: false,
  storageKey: ''
})

const emit = defineEmits<{
  rowClick: [row: T]
  rowDblclick: [row: T]
  rowContextmenu: [row: T, column: any, event: MouseEvent]
  selectionChange: [selected: T[]]
}>()

const virtualScrollRef = ref<VirtualScrollExpose>()
const sortKey = ref<string>('')
const sortOrder = ref<'asc' | 'desc'>('asc')
const selectedRows = ref<Set<any>>(new Set())
const hoverIndex = ref(-1)
const scrollbarWidth = ref(8) // 滚动条宽度
const lastSelectedIndex = ref<number>(-1) // 记录上次选中的索引，用于 Shift 多选
const dataKey = ref(0) // 用于强制刷新虚拟滚动
const columnWidths = ref<Record<string, number>>({})
const suppressNextHeaderClick = ref(false)
const resizingState = ref<{
  startX: number
  currentIndex: number
  nextIndex: number
  currentKey: string
  nextKey: string
  currentWidth: number
  nextWidth: number
} | null>(null)
let previousBodyCursor = ''
let previousBodyUserSelect = ''

// 监听数据变化，清空选择并刷新
watch(() => props.data, () => {
  // 数据变化时清空选择
  selectedRows.value.clear()
  lastSelectedIndex.value = -1
  // 强制刷新虚拟滚动
  dataKey.value++
}, { deep: false })

// 排序后的数据
const sortedData = computed(() => {
  if (!sortKey.value) return props.data

  return [...props.data].sort((a, b) => {
    const aVal = getCellValue(a, sortKey.value)
    const bVal = getCellValue(b, sortKey.value)

    if (aVal === bVal) return 0

    const comparison = aVal > bVal ? 1 : -1
    return sortOrder.value === 'asc' ? comparison : -comparison
  })
})

// 获取单元格值
const getCellValue = (row: T, key: string): any => {
  return key.split('.').reduce((obj, k) => obj?.[k], row)
}

const parsePixelValue = (value?: string) => {
  if (!value) return undefined
  const match = value.trim().match(/^(\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : undefined
}

const getColumnMinWidth = (column: Column) => {
  return parsePixelValue(column.minWidth) || 72
}

const getStoredColumnWidthsKey = () =>
  props.storageKey ? `virtual-table:${props.storageKey}:column-widths` : ''

const loadPersistedColumnWidths = () => {
  const storageKey = getStoredColumnWidthsKey()
  if (!storageKey) {
    columnWidths.value = {}
    return
  }

  try {
    const stored = window.localStorage.getItem(storageKey)
    const parsed = stored ? JSON.parse(stored) : {}
    const nextWidths: Record<string, number> = {}

    props.columns.forEach((column) => {
      const width = Number(parsed[column.key])
      if (Number.isFinite(width) && width >= getColumnMinWidth(column)) {
        nextWidths[column.key] = Math.round(width)
      }
    })

    columnWidths.value = nextWidths
  } catch (error) {
    console.warn('[VirtualTable] Failed to load persisted column widths:', error)
    columnWidths.value = {}
  }
}

const persistColumnWidths = () => {
  const storageKey = getStoredColumnWidthsKey()
  if (!storageKey) return

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(columnWidths.value))
  } catch (error) {
    console.warn('[VirtualTable] Failed to persist column widths:', error)
  }
}

const getColumnStyle = (column: Column): CSSProperties => {
  const savedWidth = columnWidths.value[column.key]
  const width = Number.isFinite(savedWidth) ? savedWidth : parsePixelValue(column.width)

  if (width) {
    const widthValue = `${width}px`
    return {
      width: widthValue,
      minWidth: widthValue,
      flex: `0 0 ${widthValue}`
    }
  }

  return {
    width: '0',
    minWidth: column.minWidth || '0',
    flex: '1 1 0'
  }
}

const startColumnResize = (columnIndex: number, event: MouseEvent) => {
  const currentColumn = props.columns[columnIndex]
  const nextColumn = props.columns[columnIndex + 1]
  const currentCell = (event.currentTarget as HTMLElement).parentElement as HTMLElement | null
  const nextCell = currentCell?.nextElementSibling as HTMLElement | null
  if (!currentColumn || !nextColumn || !currentCell || !nextCell) return

  resizingState.value = {
    startX: event.clientX,
    currentIndex: columnIndex,
    nextIndex: columnIndex + 1,
    currentKey: currentColumn.key,
    nextKey: nextColumn.key,
    currentWidth: currentCell.getBoundingClientRect().width,
    nextWidth: nextCell.getBoundingClientRect().width
  }

  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', handleColumnResize)
  window.addEventListener('mouseup', stopColumnResize)
}

const handleColumnResize = (event: MouseEvent) => {
  const state = resizingState.value
  if (!state) return

  const currentColumn = props.columns[state.currentIndex]
  const nextColumn = props.columns[state.nextIndex]
  if (!currentColumn || !nextColumn) return

  const minCurrentWidth = getColumnMinWidth(currentColumn)
  const minNextWidth = getColumnMinWidth(nextColumn)
  const rawDelta = event.clientX - state.startX
  const minDelta = minCurrentWidth - state.currentWidth
  const maxDelta = state.nextWidth - minNextWidth
  const delta = Math.max(minDelta, Math.min(rawDelta, maxDelta))

  columnWidths.value = {
    ...columnWidths.value,
    [state.currentKey]: Math.round(state.currentWidth + delta),
    [state.nextKey]: Math.round(state.nextWidth - delta)
  }
}

const stopColumnResize = () => {
  if (resizingState.value) {
    persistColumnWidths()
    suppressNextHeaderClick.value = true
  }

  resizingState.value = null
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  window.removeEventListener('mousemove', handleColumnResize)
  window.removeEventListener('mouseup', stopColumnResize)
}

onMounted(() => {
  loadPersistedColumnWidths()
})

onUnmounted(() => {
  stopColumnResize()
})

watch(
  () => [props.storageKey, props.columns.map((column) => column.key).join('|')],
  () => loadPersistedColumnWidths()
)

// 处理排序
const handleSort = (key: string) => {
  if (suppressNextHeaderClick.value) {
    suppressNextHeaderClick.value = false
    return
  }

  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

// 处理行点击
const handleRowClick = (row: T, index: number, event?: MouseEvent) => {
  emit('rowClick', row)

  if (props.selectable) {
    const key = getCellValue(row, props.selectedKey)
    const isCtrlSelect = event?.ctrlKey || event?.metaKey
    const isShiftSelect = event?.shiftKey
    
    if (isShiftSelect && lastSelectedIndex.value !== -1) {
      // Shift + 点击：范围选择
      const start = Math.min(lastSelectedIndex.value, index)
      const end = Math.max(lastSelectedIndex.value, index)
      
      // 如果没有按 Ctrl，先清空之前的选择
      if (!isCtrlSelect) {
        selectedRows.value.clear()
      }
      
      // 选择范围内的所有行
      for (let i = start; i <= end; i++) {
        const item = sortedData.value[i]
        if (item) {
          const itemKey = getCellValue(item, props.selectedKey)
          selectedRows.value.add(itemKey)
        }
      }
      // Shift 选择后不更新 lastSelectedIndex，保持锚点不变
    } else if (isCtrlSelect) {
      // Ctrl/Cmd + 点击：切换单个选择
      if (selectedRows.value.has(key)) {
        selectedRows.value.delete(key)
      } else {
        selectedRows.value.add(key)
      }
      lastSelectedIndex.value = index
    } else {
      // 普通点击：单选模式
      selectedRows.value.clear()
      selectedRows.value.add(key)
      lastSelectedIndex.value = index
    }
    
    // 触发一次响应式更新
    selectedRows.value = new Set(selectedRows.value)
    
    const selected = sortedData.value.filter(item => 
      selectedRows.value.has(getCellValue(item, props.selectedKey))
    )
    emit('selectionChange', selected)
  }
}

// 处理行双击
const handleRowDblclick = (row: T) => {
  emit('rowDblclick', row)
}

// 处理行右键
const handleRowContextmenu = (row: T, column: any, event: MouseEvent) => {
  emit('rowContextmenu', row, column, event)
}

// 检查是否选中
const isSelected = (row: T): boolean => {
  if (!props.selectable) return false
  const key = getCellValue(row, props.selectedKey)
  return selectedRows.value.has(key)
}

// 清空选择
const clearSelection = () => {
  selectedRows.value.clear()
  lastSelectedIndex.value = -1
  emit('selectionChange', [])
}

// 全选
const selectAll = () => {
  selectedRows.value.clear()
  props.data.forEach(row => {
    const key = getCellValue(row, props.selectedKey)
    selectedRows.value.add(key)
  })
  emit('selectionChange', [...props.data])
}

// 滚动到指定行
const scrollToRow = (index: number, behavior: ScrollBehavior = 'smooth') => {
  virtualScrollRef.value?.scrollToIndex(index, behavior)
}

// 刷新视图
const refresh = () => {
  dataKey.value++
}

// 暴露方法
defineExpose({
  clearSelection,
  selectAll,
  scrollToRow,
  scrollToTop: () => virtualScrollRef.value?.scrollToTop(),
  scrollToBottom: () => virtualScrollRef.value?.scrollToBottom(),
  refresh
})
</script>

<style scoped>
.virtual-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  user-select: none; /* 禁用文本选择 */
}

.table-header {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 2px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.table-header-cell {
  position: relative;
  padding: 12px 16px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-secondary);
  text-align: left;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.table-header-cell.sortable {
  cursor: pointer;
  transition: background 0.2s;
}

.table-header-cell.sortable:hover {
  background: var(--bg-hover);
}

.sort-icon {
  font-size: var(--text-sm);
  color: var(--primary-color);
  flex-shrink: 0;
}

.header-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  z-index: 20;
  width: 8px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
}

.column-resize-handle::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 3px;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background 0.15s ease;
}

.column-resize-handle:hover::after,
.virtual-table.resizing .column-resize-handle::after {
  background: var(--primary-color);
}

.table-body {
  flex: 1;
  overflow-y: auto;
}

.table-row {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  transition: background 0.15s;
  cursor: pointer;
}

.table-row:hover,
.table-row.hover {
  background: var(--bg-hover);
}

.table-row.selected {
  background: rgba(14, 165, 233, 0.15);
  border-left: 3px solid var(--primary-color);
}

.table-cell {
  padding: 12px 16px;
  font-size: var(--text-base);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.table-empty {
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
</style>
