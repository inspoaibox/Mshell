<template>
  <div class="virtual-table">
    <!-- 表头 -->
    <div class="table-header" :style="{ paddingRight: scrollbarWidth + 'px' }">
      <div
        v-for="column in columns"
        :key="column.key"
        :class="['table-header-cell', { sortable: column.sortable }]"
        :style="{ width: column.width || 'auto', minWidth: column.minWidth }"
        @click="column.sortable && handleSort(column.key)"
      >
        <span>{{ column.label }}</span>
        <span v-if="column.sortable && sortKey === column.key" class="sort-icon">
          {{ sortOrder === 'asc' ? '↑' : '↓' }}
        </span>
      </div>
    </div>

    <!-- 虚拟滚动内容 -->
    <VirtualScroll
      ref="virtualScrollRef"
      :items="sortedData"
      :item-height="rowHeight"
      :buffer="buffer"
      class="table-body"
    >
      <template #default="{ item, index }">
        <div
          :class="['table-row', { selected: isSelected(item), hover: hoverIndex === index }]"
          @click="handleRowClick(item)"
          @dblclick="handleRowDblclick(item)"
          @contextmenu="(e) => handleRowContextmenu(item, null, e)"
          @mouseenter="hoverIndex = index"
          @mouseleave="hoverIndex = -1"
        >
          <div
            v-for="column in columns"
            :key="column.key"
            class="table-cell"
            :style="{ width: column.width || 'auto', minWidth: column.minWidth }"
          >
            <slot
              v-if="column.slot"
              :name="column.slot"
              :row="item"
              :column="column"
              :index="index"
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
import { ref, computed } from 'vue'
import VirtualScroll from './VirtualScroll.vue'

export interface Column {
  key: string
  label: string
  width?: string
  minWidth?: string
  sortable?: boolean
  slot?: string
}

interface Props {
  data: T[]
  columns: Column[]
  rowHeight?: number
  buffer?: number
  selectable?: boolean
  selectedKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  rowHeight: 48,
  buffer: 5,
  selectable: false,
  selectedKey: 'id'
})

const emit = defineEmits<{
  rowClick: [row: T]
  rowDblclick: [row: T]
  rowContextmenu: [row: T, column: any, event: MouseEvent]
  selectionChange: [selected: T[]]
}>()

const virtualScrollRef = ref<InstanceType<typeof VirtualScroll>>()
const sortKey = ref<string>('')
const sortOrder = ref<'asc' | 'desc'>('asc')
const selectedRows = ref<Set<any>>(new Set())
const hoverIndex = ref(-1)
const scrollbarWidth = ref(8) // 滚动条宽度

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

// 处理排序
const handleSort = (key: string) => {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

// 处理行点击
const handleRowClick = (row: T) => {
  emit('rowClick', row)

  if (props.selectable) {
    const key = getCellValue(row, props.selectedKey)
    if (selectedRows.value.has(key)) {
      selectedRows.value.delete(key)
    } else {
      selectedRows.value.add(key)
    }
    
    const selected = props.data.filter(item => 
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

// 暴露方法
defineExpose({
  clearSelection,
  selectAll,
  scrollToRow,
  scrollToTop: () => virtualScrollRef.value?.scrollToTop(),
  scrollToBottom: () => virtualScrollRef.value?.scrollToBottom()
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
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: left;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.table-header-cell.sortable {
  cursor: pointer;
  transition: background 0.2s;
}

.table-header-cell.sortable:hover {
  background: var(--bg-hover);
}

.sort-icon {
  font-size: 12px;
  color: var(--primary-color);
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
  background: rgba(var(--primary-color-rgb), 0.1);
}

.table-cell {
  padding: 12px 16px;
  font-size: 14px;
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
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
}
</style>
