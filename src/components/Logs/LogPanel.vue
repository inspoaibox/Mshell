<template>
  <div class="log-panel">
    <div class="panel-header">
      <h2>日志记录</h2>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="refreshCurrentLog" :loading="isLoading">刷新</el-button>
        <el-button :icon="Delete" type="danger" @click="clearCurrentLog">清空</el-button>
      </div>
    </div>

    <div class="panel-content">
      <el-tabs v-model="activeTab" class="log-tabs" @tab-change="handleTabChange">
        <!-- 审计日志 -->
        <el-tab-pane label="审计日志" name="audit">
          <div class="tab-content">
            <div class="filter-bar">
              <el-select v-model="auditFilter.type" placeholder="事件类型" clearable style="width: 150px" @change="handleAuditFilterChange">
                <el-option label="全部" value="" />
                <el-option label="会话连接" value="session.connect" />
                <el-option label="会话断开" value="session.disconnect" />
                <el-option label="命令执行" value="command.execute" />
                <el-option label="文件上传" value="file.upload" />
                <el-option label="文件下载" value="file.download" />
                <el-option label="文件删除" value="file.delete" />
                <el-option label="认证成功" value="auth.success" />
                <el-option label="认证失败" value="auth.failure" />
              </el-select>
              <el-select v-model="auditFilter.level" placeholder="级别" clearable style="width: 120px" @change="handleAuditFilterChange">
                <el-option label="全部" value="" />
                <el-option label="信息" value="info" />
                <el-option label="警告" value="warning" />
                <el-option label="严重" value="critical" />
              </el-select>
              <el-date-picker
                v-model="auditDateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                @change="handleAuditFilterChange"
              />
              <span class="log-count">共 {{ auditTotalCount }} 条</span>
            </div>

            <div class="table-container">
              <el-table :data="auditLogs" style="width: 100%" v-loading="auditLoading" height="100%">
                <el-table-column prop="timestamp" label="时间" width="170">
                  <template #default="{ row }">
                    {{ formatDate(row.timestamp) }}
                  </template>
                </el-table-column>
                <el-table-column prop="action" label="操作类型" width="130">
                  <template #default="{ row }">
                    <el-tag :type="getAuditTypeColor(row.action)" size="small">{{ getAuditTypeLabel(row.action) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="level" label="级别" width="80">
                  <template #default="{ row }">
                    <el-tag :type="getLevelColor(row.level)" size="small">{{ getLevelLabel(row.level) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="resource" label="资源" min-width="150" show-overflow-tooltip />
                <el-table-column prop="success" label="状态" width="70">
                  <template #default="{ row }">
                    <el-icon :color="row.success ? '#67c23a' : '#f56c6c'">
                      <CircleCheck v-if="row.success" />
                      <CircleClose v-else />
                    </el-icon>
                  </template>
                </el-table-column>
                <el-table-column prop="errorMessage" label="错误信息" min-width="180" show-overflow-tooltip />
                <el-table-column label="操作" width="70" fixed="right">
                  <template #default="{ row }">
                    <el-button size="small" link @click="showLogDetails(row)">详情</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div class="pagination-bar">
              <el-pagination
                v-model:current-page="auditPage"
                v-model:page-size="auditPageSize"
                :page-sizes="[50, 100, 200]"
                :total="auditTotalCount"
                layout="sizes, prev, pager, next"
                size="small"
                @size-change="loadAuditLogs"
                @current-change="loadAuditLogs"
              />
            </div>
          </div>
        </el-tab-pane>

        <!-- 系统日志 -->
        <el-tab-pane label="系统日志" name="system">
          <div class="tab-content">
            <div class="filter-bar">
              <el-input
                v-model="systemFilter.host"
                placeholder="过滤主机"
                clearable
                style="width: 180px"
                @change="handleSystemFilterChange"
              />
              <el-select 
                v-model="systemFilter.level" 
                placeholder="选择级别" 
                clearable 
                style="width: 120px"
                @change="handleSystemFilterChange"
              >
                <el-option label="Info" value="info" />
                <el-option label="Warning" value="warn" />
                <el-option label="Error" value="error" />
              </el-select>
              <span class="log-count">共 {{ systemTotalCount }} 条</span>
            </div>

            <div class="table-container">
              <el-table :data="systemLogs" style="width: 100%" v-loading="systemLoading" height="100%">
                <el-table-column prop="timestamp" label="时间" width="170">
                  <template #default="{ row }">
                    {{ formatDate(row.timestamp) }}
                  </template>
                </el-table-column>
                <el-table-column prop="level" label="级别" width="80">
                  <template #default="{ row }">
                    <el-tag :type="getLevelColor(row.level)" size="small">
                      {{ row.level?.toUpperCase() }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="category" label="分类" width="100" show-overflow-tooltip />
                <el-table-column prop="host" label="主机" width="140" show-overflow-tooltip />
                <el-table-column prop="message" label="消息" min-width="250" show-overflow-tooltip />
                <el-table-column label="操作" width="70" fixed="right">
                  <template #default="{ row }">
                    <el-button size="small" link @click="showLogDetails(row)">详情</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div class="pagination-bar">
              <el-pagination
                v-model:current-page="systemPage"
                v-model:page-size="systemPageSize"
                :page-sizes="[50, 100, 200]"
                :total="systemTotalCount"
                layout="sizes, prev, pager, next"
                size="small"
                @size-change="loadSystemLogs"
                @current-change="loadSystemLogs"
              />
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 日志详情对话框 -->
    <el-dialog v-model="detailsVisible" title="日志详情" width="720px">
      <div v-if="selectedLog" class="log-details">
        <div class="detail-item">
          <label>时间：</label>
          <span>{{ formatDate(selectedLog.timestamp) }}</span>
        </div>
        <div class="detail-item">
          <label>级别：</label>
          <el-tag :type="getLevelColor(selectedLog.level)" size="small">
            {{ getLevelLabel(selectedLog.level) }}
          </el-tag>
        </div>
        <div v-if="selectedLog.action" class="detail-item">
          <label>操作：</label>
          <span>{{ getAuditTypeLabel(selectedLog.action) }}</span>
        </div>
        <div v-if="selectedLog.category" class="detail-item">
          <label>分类：</label>
          <span>{{ selectedLog.category }}</span>
        </div>
        <div v-if="selectedLog.sessionId" class="detail-item">
          <label>会话：</label>
          <span>{{ selectedLog.sessionId }}</span>
        </div>
        <div v-if="selectedLog.host" class="detail-item">
          <label>主机：</label>
          <span>{{ selectedLog.host }}</span>
        </div>
        <div v-if="selectedLog.resource" class="detail-item">
          <label>资源：</label>
          <span>{{ selectedLog.resource }}</span>
        </div>
        <div v-if="selectedLog.success !== undefined" class="detail-item">
          <label>状态：</label>
          <el-tag :type="selectedLog.success ? 'success' : 'danger'" size="small">
            {{ selectedLog.success ? '成功' : '失败' }}
          </el-tag>
        </div>
        <div v-if="selectedLog.message" class="detail-item">
          <label>消息：</label>
          <span>{{ selectedLog.message }}</span>
        </div>
        <div v-if="selectedLog.details" class="detail-item error-section">
          <label>详情：</label>
          <pre class="error-stack">{{ formatDetails(selectedLog.details) }}</pre>
        </div>
        <div v-if="selectedLog.error || selectedLog.errorMessage" class="detail-item error-section">
          <label>错误详情：</label>
          <pre class="error-stack">{{ selectedLog.error || selectedLog.errorMessage }}</pre>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete, CircleCheck, CircleClose } from '@element-plus/icons-vue'

const activeTab = ref('audit')

// 审计日志
const auditLogs = ref<any[]>([])
const auditAllData = ref<any[]>([])
const auditLoading = ref(false)
const auditFilter = ref({ type: '', level: '' })
const auditDateRange = ref<[string, string] | null>(null)
const auditPage = ref(1)
const auditPageSize = ref(100)
const auditTotalCount = computed(() => auditAllData.value.length)

// 系统日志
const systemLogs = ref<any[]>([])
const systemAllData = ref<any[]>([])
const systemLoading = ref(false)
const systemFilter = ref({ host: '', level: '' })
const systemPage = ref(1)
const systemPageSize = ref(100)
const systemTotalCount = computed(() => systemAllData.value.length)

// 详情对话框
const detailsVisible = ref(false)
const selectedLog = ref<any>(null)

// 标记哪些标签已经加载过数据
const loadedTabs = ref<Set<string>>(new Set())

// 计算当前是否在加载
const isLoading = computed(() => auditLoading.value || systemLoading.value)

onMounted(() => {
  // 延迟加载，避免阻塞页面渲染
  setTimeout(() => {
    loadCurrentTab()
  }, 100)
})

const loadCurrentTab = () => {
  if (activeTab.value === 'audit' && !loadedTabs.value.has('audit')) {
    loadAuditLogs()
    loadedTabs.value.add('audit')
  } else if (activeTab.value === 'system' && !loadedTabs.value.has('system')) {
    loadSystemLogs()
    loadedTabs.value.add('system')
  }
}

const handleTabChange = (tabName: string) => {
  if (!loadedTabs.value.has(tabName)) {
    if (tabName === 'audit') {
      loadAuditLogs()
    } else if (tabName === 'system') {
      loadSystemLogs()
    }
    loadedTabs.value.add(tabName)
  }
}

const handleAuditFilterChange = () => {
  auditPage.value = 1
  loadAuditLogs()
}

const handleSystemFilterChange = () => {
  systemPage.value = 1
  loadSystemLogs()
}

const loadAuditLogs = async () => {
  auditLoading.value = true
  try {
    const filters: any = {}
    if (auditFilter.value.type) filters.action = auditFilter.value.type
    if (auditFilter.value.level) filters.level = auditFilter.value.level
    if (auditDateRange.value) {
      filters.startDate = auditDateRange.value[0] + 'T00:00:00.000Z'
      filters.endDate = auditDateRange.value[1] + 'T23:59:59.999Z'
    }

    const result = await window.electronAPI.auditLog?.filter?.(filters)
    if (result?.success) {
      // 按时间倒序排列
      auditAllData.value = (result.data || []).sort((a: any, b: any) => 
        b.timestamp.localeCompare(a.timestamp)
      )
      // 分页
      const start = (auditPage.value - 1) * auditPageSize.value
      auditLogs.value = auditAllData.value.slice(start, start + auditPageSize.value)
    }
  } catch (error) {
    ElMessage.error('加载审计日志失败')
  } finally {
    auditLoading.value = false
  }
}

const loadSystemLogs = async () => {
  systemLoading.value = true
  try {
    const filterParam = (systemFilter.value.host || systemFilter.value.level) ? {
      host: systemFilter.value.host || undefined,
      level: systemFilter.value.level || undefined
    } : undefined
    
    const getLogs = window.electronAPI.log?.getLogs ?? window.electronAPI.logs?.get
    if (!getLogs) {
      throw new Error('System log API is unavailable')
    }

    const result = await getLogs(filterParam)
    if (!Array.isArray(result)) {
      throw new Error('Invalid system log response')
    }

    // 按时间倒序排列
    systemAllData.value = result.sort((a: any, b: any) => 
      (b.timestamp || '').localeCompare(a.timestamp || '')
    )
    // 分页
    const start = (systemPage.value - 1) * systemPageSize.value
    systemLogs.value = systemAllData.value.slice(start, start + systemPageSize.value)
  } catch (error) {
    ElMessage.error('加载系统日志失败')
  } finally {
    systemLoading.value = false
  }
}

const refreshCurrentLog = () => {
  if (activeTab.value === 'audit') {
    loadAuditLogs()
  } else {
    loadSystemLogs()
  }
}

const clearCurrentLog = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要清空所有 ${activeTab.value === 'audit' ? '审计' : '系统'}日志吗？此操作不可恢复。`,
      '确认清空',
      { type: 'warning' }
    )

    if (activeTab.value === 'audit') {
      const result = await window.electronAPI.auditLog?.clearAll?.()
      if (result?.success) {
        ElMessage.success('审计日志已清空')
        auditAllData.value = []
        auditLogs.value = []
      } else {
        throw new Error(result?.error || 'Failed to clear audit logs')
      }
    } else {
      const result = await (window.electronAPI.log?.clearLogs?.() ?? window.electronAPI.logs?.clear?.())
      if (result?.success) {
        ElMessage.success('系统日志已清空')
        systemAllData.value = []
        systemLogs.value = []
      } else {
        throw new Error(result?.error || 'Failed to clear system logs')
      }
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('清空失败')
    }
  }
}

const showLogDetails = (log: any) => {
  selectedLog.value = log
  detailsVisible.value = true
}

const formatDate = (date: string) => {
  if (!date) return '-'
  return new Date(date).toLocaleString('zh-CN')
}

const formatDetails = (details: unknown) => {
  if (!details) return ''
  if (typeof details === 'string') return details

  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

const getAuditTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    'session.connect': 'success',
    'session.disconnect': 'info',
    'command.execute': 'primary',
    'file.upload': 'warning',
    'file.download': 'warning',
    'file.delete': 'danger',
    'auth.success': 'success',
    'auth.failure': 'danger'
  }
  return colors[type] || 'info'
}

const getAuditTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    'session.connect': '连接',
    'session.disconnect': '断开',
    'session.create': '创建会话',
    'session.update': '更新会话',
    'session.delete': '删除会话',
    'command.execute': '命令',
    'file.upload': '上传',
    'file.download': '下载',
    'file.delete': '删除文件',
    'file.rename': '重命名',
    'file.edit': '编辑',
    'auth.success': '认证成功',
    'auth.failure': '认证失败',
    'key.generate': '生成密钥',
    'key.import': '导入密钥',
    'key.export': '导出密钥',
    'key.delete': '删除密钥',
    'settings.update': '更新设置',
    'backup.create': '创建备份',
    'backup.restore': '恢复备份',
    'portforward.create': '创建转发',
    'portforward.start': '启动转发',
    'portforward.stop': '停止转发',
    'portforward.delete': '删除转发'
  }
  return labels[type] || type
}

const getLevelColor = (level: string) => {
  if (!level) return 'info'
  const colors: Record<string, string> = {
    info: 'info',
    warning: 'warning',
    warn: 'warning',
    error: 'danger',
    critical: 'danger'
  }
  return colors[level.toLowerCase()] || 'info'
}

const getLevelLabel = (level: string) => {
  if (!level) return '-'
  const labels: Record<string, string> = {
    info: '信息',
    warning: '警告',
    warn: '警告',
    error: '错误',
    critical: '严重'
  }
  return labels[level.toLowerCase()] || level
}
</script>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--bg-primary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.panel-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 20px;
  min-height: 0;
}

.log-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-tabs :deep(.el-tabs__header) {
  margin: 0 0 12px 0;
  flex-shrink: 0;
}

.log-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.log-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.tab-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.log-count {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.table-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 0;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
}

.log-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.detail-item label {
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 70px;
  flex-shrink: 0;
}

.detail-item span {
  color: var(--text-primary);
  word-break: break-all;
}

.error-section {
  flex-direction: column;
}

.error-stack {
  margin: 8px 0 0 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-family: 'Consolas', monospace;
  font-size: var(--text-sm);
  color: var(--danger-color);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  width: 100%;
}

:global(:root.app-appearance-terminal .log-panel) {
  background: var(--bg-main);
}

:global(:root.app-appearance-terminal .panel-content) {
  padding: 0 12px;
}

:global(:root.app-appearance-terminal .log-tabs .el-tabs__header) {
  margin: 0 0 8px 0;
}

:global(:root.app-appearance-terminal .filter-bar) {
  gap: 8px;
  padding: 8px 0;
}

:global(:root.app-appearance-terminal .log-count) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

:global(:root.app-appearance-terminal .pagination-bar) {
  padding: 8px 0;
}

:global(:root.app-appearance-terminal .error-stack) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  font-family: var(--font-mono);
}
</style>
