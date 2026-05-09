<template>
  <div class="audit-log-panel">
    <div class="panel-header">
      <h2>审计日志</h2>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="loadLogs" :loading="loading">刷新</el-button>
        <el-button :icon="Delete" type="danger" @click="clearLogs">清空日志</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-select
        v-model="filterType"
        placeholder="事件类型"
        clearable
        style="width: 150px"
        @change="handleFilterChange"
      >
        <el-option label="全部" value="" />
        <el-option label="连接" value="connection" />
        <el-option label="命令" value="command" />
        <el-option label="文件传输" value="file_transfer" />
        <el-option label="认证" value="authentication" />
      </el-select>
      <el-select
        v-model="filterLevel"
        placeholder="级别"
        clearable
        style="width: 120px"
        @change="handleFilterChange"
      >
        <el-option label="全部" value="" />
        <el-option label="信息" value="info" />
        <el-option label="警告" value="warning" />
        <el-option label="错误" value="critical" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        @change="handleFilterChange"
      />
      <div class="log-count">共 {{ totalCount }} 条日志</div>
    </div>

    <div class="panel-content">
      <el-table
        :data="logs"
        style="width: 100%"
        v-loading="loading"
        height="100%"
        @sort-change="handleSortChange"
      >
        <el-table-column prop="timestamp" label="时间" width="180" sortable="custom">
          <template #default="{ row }">
            {{ formatDate(row.timestamp) }}
          </template>
        </el-table-column>
        <el-table-column prop="action" label="操作" width="180">
          <template #default="{ row }">
            <el-tag :type="getActionColor(row.action)" size="small">{{
              getActionLabel(row.action)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="level" label="级别" width="100">
          <template #default="{ row }">
            <el-tag :type="getLevelColor(row.level)" size="small">{{
              getLevelLabel(row.level)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="resource" label="资源" min-width="200" show-overflow-tooltip />
        <el-table-column prop="success" label="状态" width="80">
          <template #default="{ row }">
            <el-icon :color="row.success ? '#67c23a' : '#f56c6c'">
              <CircleCheck v-if="row.success" />
              <CircleClose v-else />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column
          prop="errorMessage"
          label="错误信息"
          min-width="200"
          show-overflow-tooltip
        />
      </el-table>
    </div>

    <div class="panel-footer">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[50, 100, 200, 500]"
        :total="totalCount"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="loadLogs"
        @current-change="loadLogs"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, CircleCheck, CircleClose } from '@element-plus/icons-vue'

const logs = ref<any[]>([])
const loading = ref(false)
const filterType = ref('')
const filterLevel = ref('')
const dateRange = ref<[string, string] | null>(null)
const currentPage = ref(1)
const pageSize = ref(100)
const totalCount = ref(0)
const sortOrder = ref<'ascending' | 'descending'>('descending')

onMounted(() => {
  loadLogs()
})

const handleFilterChange = () => {
  currentPage.value = 1
  loadLogs()
}

const handleSortChange = ({ order }: { order: 'ascending' | 'descending' | null }) => {
  sortOrder.value = order || 'descending'
  loadLogs()
}

const loadLogs = async () => {
  loading.value = true
  try {
    const filters: any = {}
    if (filterType.value) filters.type = filterType.value
    if (filterLevel.value) filters.level = filterLevel.value
    if (dateRange.value) {
      filters.startDate = dateRange.value[0] + 'T00:00:00.000Z'
      filters.endDate = dateRange.value[1] + 'T23:59:59.999Z'
    }

    const result = await window.electronAPI.auditLog?.query?.(filters)
    if (result?.success) {
      let allLogs = result.data || []
      totalCount.value = allLogs.length

      // 排序
      allLogs.sort((a: any, b: any) => {
        const cmp = a.timestamp.localeCompare(b.timestamp)
        return sortOrder.value === 'ascending' ? cmp : -cmp
      })

      // 分页
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      logs.value = allLogs.slice(start, end)
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

    const result = await window.electronAPI.auditLog?.clearAll?.()
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

const getActionColor = (action: string) => {
  if (action.startsWith('session.')) return 'primary'
  if (action.startsWith('file.')) return 'warning'
  if (action.startsWith('key.')) return 'danger'
  if (action.startsWith('auth.')) return 'info'
  if (action.startsWith('command.')) return 'success'
  return 'info'
}

const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    'session.create': '创建会话',
    'session.update': '更新会话',
    'session.delete': '删除会话',
    'session.connect': '连接',
    'session.disconnect': '断开',
    'file.upload': '上传文件',
    'file.download': '下载文件',
    'file.delete': '删除文件',
    'file.rename': '重命名',
    'file.edit': '编辑文件',
    'key.generate': '生成密钥',
    'key.import': '导入密钥',
    'key.export': '导出密钥',
    'key.delete': '删除密钥',
    'command.execute': '执行命令',
    'settings.update': '更新设置',
    'backup.create': '创建备份',
    'backup.restore': '恢复备份',
    'auth.success': '认证成功',
    'auth.failure': '认证失败',
    'app.start': '应用启动',
    'app.stop': '应用关闭',
    'portforward.create': '创建端口转发',
    'portforward.start': '启动端口转发',
    'portforward.stop': '停止端口转发',
    'portforward.delete': '删除端口转发'
  }
  return labels[action] || action
}

const getLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    info: 'info',
    warning: 'warning',
    critical: 'danger'
  }
  return colors[level] || 'info'
}

const getLevelLabel = (level: string) => {
  const labels: Record<string, string> = {
    info: '信息',
    warning: '警告',
    critical: '严重'
  }
  return labels[level] || level
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
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.log-count {
  margin-left: auto;
  font-size: var(--text-md);
  color: var(--text-secondary);
}

.panel-content {
  flex: 1;
  overflow: hidden;
  padding: 0 20px;
}

.panel-footer {
  display: flex;
  justify-content: center;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}
</style>
