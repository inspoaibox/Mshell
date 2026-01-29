<template>
  <div class="audit-log-panel">
    <div class="panel-header">
      <h2>审计日志</h2>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
        <el-button :icon="Delete" @click="clearLogs">清空日志</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-select v-model="filterType" placeholder="事件类型" clearable style="width: 150px" @change="loadLogs">
        <el-option label="全部" value="" />
        <el-option label="连接" value="connection" />
        <el-option label="命令" value="command" />
        <el-option label="文件传输" value="file_transfer" />
        <el-option label="认证" value="authentication" />
      </el-select>
      <el-select v-model="filterLevel" placeholder="级别" clearable style="width: 120px" @change="loadLogs">
        <el-option label="全部" value="" />
        <el-option label="信息" value="info" />
        <el-option label="警告" value="warning" />
        <el-option label="错误" value="error" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        @change="loadLogs"
      />
    </div>

    <div class="panel-content">
      <el-table :data="logs" style="width: 100%" v-loading="loading" height="100%">
        <el-table-column prop="timestamp" label="时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.timestamp) }}
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="120">
          <template #default="{ row }">
            <el-tag :type="getTypeColor(row.type)">{{ getTypeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="level" label="级别" width="100">
          <template #default="{ row }">
            <el-tag :type="getLevelColor(row.level)">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="user" label="用户" width="120" />
        <el-table-column prop="action" label="操作" min-width="200" show-overflow-tooltip />
        <el-table-column prop="details" label="详情" min-width="250" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete } from '@element-plus/icons-vue'

const logs = ref<any[]>([])
const loading = ref(false)
const filterType = ref('')
const filterLevel = ref('')
const dateRange = ref<[Date, Date] | null>(null)

onMounted(() => {
  loadLogs()
})

const loadLogs = async () => {
  loading.value = true
  try {
    const filters: any = {}
    if (filterType.value) filters.type = filterType.value
    if (filterLevel.value) filters.level = filterLevel.value
    if (dateRange.value) {
      filters.startDate = dateRange.value[0].toISOString()
      filters.endDate = dateRange.value[1].toISOString()
    }

    const result = await window.electronAPI.auditLog?.query?.(filters)
    if (result?.success) {
      logs.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载审计日志失败')
  } finally {
    loading.value = false
  }
}

const clearLogs = async () => {
  try {
    await ElMessageBox.confirm('确定要清空所有审计日志吗？此操作不可恢复。', '确认清空', {
      type: 'warning'
    })

    const result = await window.electronAPI.auditLog?.clear?.()
    if (result?.success) {
      ElMessage.success('审计日志已清空')
      loadLogs()
    } else {
      ElMessage.error(result?.error || '清空失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '清空失败')
    }
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

const getTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    connection: 'primary',
    command: 'success',
    file_transfer: 'warning',
    authentication: 'info'
  }
  return colors[type] || 'info'
}

const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    connection: '连接',
    command: '命令',
    file_transfer: '文件传输',
    authentication: '认证'
  }
  return labels[type] || type
}

const getLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    info: 'info',
    warning: 'warning',
    error: 'danger'
  }
  return colors[level] || 'info'
}
</script>

<style scoped>
.audit-log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-header h2 {
  margin: 0;
  font-size: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.filter-bar {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.panel-content {
  flex: 1;
  overflow: hidden;
  padding: 20px;
}
</style>
