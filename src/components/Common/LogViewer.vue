<template>
  <div class="log-viewer-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h2>系统日志</h2>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
        <el-button :icon="Delete" @click="clearFilter">清除过滤</el-button>
      </div>
    </div>

    <!-- 过滤器 -->
    <div class="filter-section">
      <el-form :inline="true" class="filter-form">
        <el-form-item label="开始日期">
          <el-date-picker
            v-model="filter.startDate"
            type="datetime"
            placeholder="选择开始日期"
            size="small"
            @change="loadLogs"
          />
        </el-form-item>
        <el-form-item label="结束日期">
          <el-date-picker
            v-model="filter.endDate"
            type="datetime"
            placeholder="选择结束日期"
            size="small"
            @change="loadLogs"
          />
        </el-form-item>
        <el-form-item label="主机">
          <el-input
            v-model="filter.host"
            placeholder="过滤主机"
            size="small"
            clearable
            @change="loadLogs"
          />
        </el-form-item>
        <el-form-item label="级别">
          <el-select 
            v-model="filter.level" 
            placeholder="选择级别" 
            size="small"
            clearable 
            @change="loadLogs"
          >
            <el-option label="Info" value="info" />
            <el-option label="Warning" value="warn" />
            <el-option label="Error" value="error" />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <!-- 日志表格 -->
    <div class="log-table-container">
      <VirtualTable
        :data="logs"
        :columns="logColumns"
        :row-height="48"
        :buffer="10"
      >
        <template #timestamp="{ row }">
          {{ formatDate(row.timestamp) }}
        </template>
        <template #level="{ row }">
          <el-tag 
            :type="getLevelType(row.level)" 
            size="small"
          >
            {{ row.level.toUpperCase() }}
          </el-tag>
        </template>
        <template #actions="{ row }">
          <el-button 
            size="small" 
            text
            @click="showDetails(row)"
          >
            详情
          </el-button>
        </template>
      </VirtualTable>
    </div>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailsVisible"
      title="日志详情"
      width="700px"
    >
      <div v-if="selectedLog" class="log-details">
        <div class="detail-item">
          <label>时间：</label>
          <span>{{ formatDate(selectedLog.timestamp) }}</span>
        </div>
        <div class="detail-item">
          <label>级别：</label>
          <el-tag :type="getLevelType(selectedLog.level)" size="small">
            {{ selectedLog.level.toUpperCase() }}
          </el-tag>
        </div>
        <div class="detail-item">
          <label>主机：</label>
          <span>{{ selectedLog.host }}</span>
        </div>
        <div class="detail-item">
          <label>消息：</label>
          <span>{{ selectedLog.message }}</span>
        </div>
        <div v-if="selectedLog.error" class="detail-item">
          <label>错误详情：</label>
          <pre class="error-stack">{{ selectedLog.error }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Refresh, Delete } from '@element-plus/icons-vue'
import VirtualTable from './VirtualTable.vue'
import type { Column } from './VirtualTable.vue'

interface LogEntry {
  timestamp: string
  level: string
  host: string
  message: string
  error?: string
}

const logs = ref<LogEntry[]>([])
const filter = ref({
  startDate: null as Date | null,
  endDate: null as Date | null,
  host: '',
  level: ''
})
const detailsVisible = ref(false)
const selectedLog = ref<LogEntry | null>(null)

const logColumns: Column[] = [
  { key: 'timestamp', label: '时间', width: '180px', sortable: true, slot: 'timestamp' },
  { key: 'level', label: '级别', width: '100px', sortable: true, slot: 'level' },
  { key: 'host', label: '主机', width: '150px', sortable: true },
  { key: 'message', label: '消息', minWidth: '300px' },
  { key: 'actions', label: '操作', width: '100px', slot: 'actions' }
]

onMounted(() => {
  loadLogs()
})

const loadLogs = async () => {
  try {
    const hasFilter = filter.value.startDate || filter.value.endDate || filter.value.host || filter.value.level
    
    const filterParam = hasFilter ? {
      startDate: filter.value.startDate ? filter.value.startDate.toISOString() : undefined,
      endDate: filter.value.endDate ? filter.value.endDate.toISOString() : undefined,
      host: filter.value.host || undefined,
      level: filter.value.level || undefined
    } : undefined
    
    const result = await window.electronAPI.log.getLogs(filterParam)
    logs.value = result
  } catch (error) {
    console.error('Failed to load logs:', error)
  }
}

const clearFilter = () => {
  filter.value = {
    startDate: null,
    endDate: null,
    host: '',
    level: ''
  }
  loadLogs()
}

const formatDate = (timestamp: string) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const getLevelType = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'danger'
    case 'warn':
      return 'warning'
    default:
      return 'info'
  }
}

const showDetails = (log: LogEntry) => {
  selectedLog.value = log
  detailsVisible.value = true
}
</script>

<style scoped>
.log-viewer-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
}

/* 头部 */
.panel-header {
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* 过滤器 */
.filter-section {
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
}

.filter-form {
  margin: 0;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 0;
}

/* 表格容器 */
.log-table-container {
  flex: 1;
  overflow: hidden;
  padding: var(--spacing-lg) var(--spacing-xl);
}

.log-table-container :deep(.el-table) {
  width: 100%;
}

.log-table-container :deep(.el-table__inner-wrapper) {
  width: 100%;
}

/* 详情 */
.log-details {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.detail-item {
  display: flex;
  gap: var(--spacing-sm);
}

.detail-item label {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 80px;
}

.detail-item span {
  color: var(--text-primary);
}

.error-stack {
  margin: var(--spacing-sm) 0 0 0;
  padding: var(--spacing-md);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--error-color);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
