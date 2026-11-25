<template>
  <div class="task-scheduler-panel">
    <div class="panel-header">
      <div class="header-left">
        <h2>任务调度</h2>
        <el-button link type="primary" @click="showGuideDialog = true" class="guide-btn">
          <el-icon><Document /></el-icon>
          <span>使用指南</span>
        </el-button>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="loadTasks">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">创建任务</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{{ statistics.total }}</span>
        <span class="stat-label">总任务</span>
      </div>
      <div class="stat-item">
        <span class="stat-value success">{{ statistics.enabled }}</span>
        <span class="stat-label">已启用</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ statistics.totalExecutions }}</span>
        <span class="stat-label">总执行</span>
      </div>
      <div class="stat-item">
        <span class="stat-value success">{{ statistics.totalSuccesses }}</span>
        <span class="stat-label">成功</span>
      </div>
      <div class="stat-item">
        <span class="stat-value danger">{{ statistics.totalFailures }}</span>
        <span class="stat-label">失败</span>
      </div>
    </div>

    <div class="panel-content">
      <el-table :data="tasks" style="width: 100%" v-loading="loading">
        <el-table-column prop="name" label="任务名称" min-width="150" />
        <el-table-column prop="command" label="命令" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="command-text">{{ row.command }}</code>
          </template>
        </el-table-column>
        <el-table-column label="调度规则" width="180">
          <template #default="{ row }">
            <el-tooltip :content="describeCron(row.cronExpression || row.schedule)" placement="top">
              <code class="cron-text">{{ row.cronExpression || row.schedule }}</code>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="80">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" size="small" @change="toggleTask(row)" />
          </template>
        </el-table-column>
        <el-table-column label="上次运行" width="160">
          <template #default="{ row }">
            <span v-if="row.lastExecution" class="time-text">{{ formatDate(row.lastExecution) }}</span>
            <span v-else class="no-data">未运行</span>
          </template>
        </el-table-column>
        <el-table-column label="执行统计" width="120">
          <template #default="{ row }">
            <span class="exec-stats">
              <span class="success">{{ row.successCount || 0 }}</span>
              /
              <span class="danger">{{ row.failureCount || 0 }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="success" :icon="VideoPlay" @click="executeTask(row)" 
              :loading="executingTasks.has(row.id)" :disabled="!row.sessionId">
              执行
            </el-button>
            <el-button size="small" :icon="Clock" @click="showHistory(row)">历史</el-button>
            <el-button size="small" :icon="Edit" @click="editTask(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteTask(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑任务对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingTask ? '编辑任务' : '创建任务'" width="650px">
      <el-form :model="taskForm" label-width="100px">
        <el-form-item label="任务名称" required>
          <el-input v-model="taskForm.name" placeholder="输入任务名称" />
        </el-form-item>
        <el-form-item label="目标会话" required>
          <el-select v-model="taskForm.sessionId" placeholder="选择要执行命令的会话" style="width: 100%">
            <el-option v-for="session in sessions" :key="session.id" :label="`${session.name} (${session.host})`" :value="session.id" />
          </el-select>
          <div class="form-tip">任务将在选定的 SSH 会话上执行命令</div>
        </el-form-item>
        <el-form-item label="执行命令" required>
          <el-input v-model="taskForm.command" type="textarea" :rows="3" placeholder="输入要执行的 Shell 命令" />
        </el-form-item>
        
        <el-divider content-position="left">调度设置</el-divider>
        
        <el-form-item label="调度方式">
          <el-radio-group v-model="taskForm.scheduleType">
            <el-radio value="preset">常用规则</el-radio>
            <el-radio value="cron">Cron 表达式</el-radio>
            <el-radio value="interval">时间间隔</el-radio>
          </el-radio-group>
        </el-form-item>
        
        <el-form-item v-if="taskForm.scheduleType === 'preset'" label="选择规则">
          <el-select v-model="taskForm.presetSchedule" style="width: 100%" @change="applyPreset">
            <el-option-group v-for="group in cronPresets" :key="group.label" :label="group.label">
              <el-option v-for="preset in group.options" :key="preset.value" :label="preset.label" :value="preset.value">
                <span>{{ preset.label }}</span>
                <span class="preset-cron">{{ preset.value }}</span>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        
        <el-form-item v-if="taskForm.scheduleType === 'cron'" label="Cron 表达式">
          <el-input v-model="taskForm.cronExpression" placeholder="秒 分 时 日 月 周" />
          <div class="form-tip">
            格式：秒(0-59) 分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7)
            <br />示例：0 30 2 * * * = 每天凌晨 2:30
          </div>
        </el-form-item>
        
        <el-form-item v-if="taskForm.scheduleType === 'interval'" label="执行间隔">
          <div class="interval-input">
            <el-input-number v-model="taskForm.intervalValue" :min="1" :max="999" />
            <el-select v-model="taskForm.intervalUnit" style="width: 100px">
              <el-option label="分钟" value="minutes" />
              <el-option label="小时" value="hours" />
              <el-option label="天" value="days" />
            </el-select>
          </div>
        </el-form-item>
        
        <el-form-item label="超时时间">
          <el-input-number v-model="taskForm.timeout" :min="10" :max="3600" />
          <span style="margin-left: 8px">秒</span>
        </el-form-item>
        
        <el-form-item label="立即启用">
          <el-switch v-model="taskForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTask" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 执行历史对话框 -->
    <el-dialog v-model="showHistoryDialog" :title="`执行历史 - ${historyTask?.name || ''}`" width="800px">
      <div class="history-content">
        <el-table :data="taskExecutions" v-loading="loadingHistory" max-height="400">
          <el-table-column label="执行时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.startTime) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="100">
            <template #default="{ row }">
              {{ row.duration ? `${(row.duration / 1000).toFixed(1)}s` : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="输出/错误" min-width="300">
            <template #default="{ row }">
              <div v-if="row.output" class="output-text">{{ row.output.substring(0, 200) }}</div>
              <div v-if="row.error" class="error-text">{{ row.error }}</div>
              <span v-if="!row.output && !row.error" class="no-data">无输出</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="taskExecutions.length === 0 && !loadingHistory" class="empty-history">
          <el-icon :size="48"><Clock /></el-icon>
          <p>暂无执行记录</p>
        </div>
      </div>
      <template #footer>
        <el-button v-if="taskExecutions.length > 0" type="danger" @click="clearHistory">清空历史</el-button>
        <el-button @click="showHistoryDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 使用指南对话框 -->
    <el-dialog v-model="showGuideDialog" title="任务调度使用指南" width="700px">
      <div class="guide-content">
        <h3>📋 什么是任务调度？</h3>
        <p>任务调度允许你在指定的时间自动执行 SSH 命令，适用于定时备份、日志清理、系统监控等场景。</p>
        
        <h3>🎯 适用场景</h3>
        <ul>
          <li><strong>定时备份</strong> - 每天凌晨自动备份数据库</li>
          <li><strong>日志清理</strong> - 定期清理过期日志文件</li>
          <li><strong>系统监控</strong> - 每隔几分钟检查服务状态</li>
          <li><strong>定时重启</strong> - 每周重启服务释放内存</li>
        </ul>
        
        <h3>⏰ Cron 表达式说明</h3>
        <p>Cron 表达式由 6 个字段组成：</p>
        <div class="cron-explain">
          <code>秒 分 时 日 月 周</code>
          <div class="cron-fields">
            <span>0-59</span>
            <span>0-59</span>
            <span>0-23</span>
            <span>1-31</span>
            <span>1-12</span>
            <span>0-7</span>
          </div>
        </div>
        <p>特殊字符：<code>*</code> 任意值，<code>*/n</code> 每隔 n，<code>,</code> 列表，<code>-</code> 范围</p>
        
        <h3>💡 常用示例</h3>
        <div class="examples">
          <div class="example-row">
            <code>0 0 2 * * *</code>
            <span>每天凌晨 2:00</span>
          </div>
          <div class="example-row">
            <code>0 30 * * * *</code>
            <span>每小时的第 30 分钟</span>
          </div>
          <div class="example-row">
            <code>0 0 0 * * 0</code>
            <span>每周日午夜</span>
          </div>
          <div class="example-row">
            <code>0 */5 * * * *</code>
            <span>每 5 分钟</span>
          </div>
          <div class="example-row">
            <code>0 0 9-18 * * 1-5</code>
            <span>工作日 9:00-18:00 每小时</span>
          </div>
        </div>
        
        <h3>⚠️ 注意事项</h3>
        <ul>
          <li>任务执行需要对应的 SSH 会话处于<strong>已连接</strong>状态</li>
          <li>建议设置合理的超时时间，避免任务卡死</li>
          <li>敏感操作建议先手动测试命令</li>
        </ul>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, VideoPlay, Clock, Refresh, Document } from '@element-plus/icons-vue'

const tasks = ref<any[]>([])
const sessions = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showCreateDialog = ref(false)
const showHistoryDialog = ref(false)
const showGuideDialog = ref(false)
const editingTask = ref<any>(null)
const historyTask = ref<any>(null)
const taskExecutions = ref<any[]>([])
const loadingHistory = ref(false)
const executingTasks = reactive(new Set<string>())

const statistics = ref({
  total: 0,
  enabled: 0,
  disabled: 0,
  totalExecutions: 0,
  totalSuccesses: 0,
  totalFailures: 0
})

const taskForm = ref({
  name: '',
  sessionId: '',
  command: '',
  scheduleType: 'preset',
  presetSchedule: '0 0 2 * * *',
  cronExpression: '0 0 2 * * *',
  intervalValue: 30,
  intervalUnit: 'minutes',
  timeout: 60,
  enabled: true
})

// Cron 预设选项
const cronPresets = [
  {
    label: '每天',
    options: [
      { label: '每天凌晨 0:00', value: '0 0 0 * * *' },
      { label: '每天凌晨 2:00', value: '0 0 2 * * *' },
      { label: '每天凌晨 4:00', value: '0 0 4 * * *' },
      { label: '每天中午 12:00', value: '0 0 12 * * *' },
      { label: '每天晚上 22:00', value: '0 0 22 * * *' }
    ]
  },
  {
    label: '每周',
    options: [
      { label: '每周一凌晨 2:00', value: '0 0 2 * * 1' },
      { label: '每周日凌晨 2:00', value: '0 0 2 * * 0' },
      { label: '工作日凌晨 2:00', value: '0 0 2 * * 1-5' }
    ]
  },
  {
    label: '每月',
    options: [
      { label: '每月 1 号凌晨 2:00', value: '0 0 2 1 * *' },
      { label: '每月 15 号凌晨 2:00', value: '0 0 2 15 * *' },
      { label: '每月最后一天凌晨 2:00', value: '0 0 2 L * *' }
    ]
  },
  {
    label: '高频',
    options: [
      { label: '每 5 分钟', value: '0 */5 * * * *' },
      { label: '每 10 分钟', value: '0 */10 * * * *' },
      { label: '每 30 分钟', value: '0 */30 * * * *' },
      { label: '每小时', value: '0 0 * * * *' }
    ]
  }
]

onMounted(() => {
  loadTasks()
  loadSessions()
  loadStatistics()
})

const loadTasks = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.taskScheduler?.getAll?.()
    if (result?.success) {
      tasks.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载任务列表失败')
  } finally {
    loading.value = false
  }
}

const loadSessions = async () => {
  try {
    sessions.value = await window.electronAPI.session.getAll()
  } catch (error) {
    console.error('Failed to load sessions:', error)
  }
}

const loadStatistics = async () => {
  try {
    const result = await window.electronAPI.taskScheduler?.getStatistics?.()
    if (result?.success) {
      statistics.value = result.data
    }
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

const applyPreset = (value: string) => {
  taskForm.value.cronExpression = value
}

const getCronExpression = (): string => {
  if (taskForm.value.scheduleType === 'preset') {
    return taskForm.value.presetSchedule
  } else if (taskForm.value.scheduleType === 'cron') {
    return taskForm.value.cronExpression
  } else {
    // interval
    const { intervalValue, intervalUnit } = taskForm.value
    if (intervalUnit === 'minutes') {
      return `0 */${intervalValue} * * * *`
    } else if (intervalUnit === 'hours') {
      return `0 0 */${intervalValue} * * *`
    } else {
      return `0 0 0 */${intervalValue} * *`
    }
  }
}

const openCreateDialog = () => {
  editingTask.value = null
  taskForm.value = {
    name: '',
    sessionId: '',
    command: '',
    scheduleType: 'preset',
    presetSchedule: '0 0 2 * * *',
    cronExpression: '0 0 2 * * *',
    intervalValue: 30,
    intervalUnit: 'minutes',
    timeout: 60,
    enabled: true
  }
  showCreateDialog.value = true
}

const saveTask = async () => {
  if (!taskForm.value.name) {
    ElMessage.warning('请输入任务名称')
    return
  }
  if (!taskForm.value.sessionId) {
    ElMessage.warning('请选择目标会话')
    return
  }
  if (!taskForm.value.command) {
    ElMessage.warning('请输入执行命令')
    return
  }

  saving.value = true
  try {
    const cronExpression = getCronExpression()
    const taskData: Record<string, any> = {
      name: taskForm.value.name,
      sessionId: taskForm.value.sessionId,
      command: taskForm.value.command,
      cronExpression,
      timeout: taskForm.value.timeout,
      enabled: taskForm.value.enabled,
      type: 'command',
      retryOnFailure: false,
      maxRetries: 0,
      notifyOnSuccess: false,
      notifyOnFailure: true
    }

    const result = editingTask.value
      ? await window.electronAPI.taskScheduler?.update?.(editingTask.value.id, taskData)
      : await window.electronAPI.taskScheduler?.create?.(taskData)

    if (result?.success) {
      ElMessage.success(editingTask.value ? '任务已更新' : '任务已创建')
      showCreateDialog.value = false
      loadTasks()
      loadStatistics()
    } else {
      ElMessage.error(result?.error || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const editTask = (task: any) => {
  editingTask.value = task
  const cron = task.cronExpression || task.schedule || ''
  
  // 判断调度类型
  let scheduleType = 'cron'
  const presetMatch = cronPresets.flatMap(g => g.options).find(p => p.value === cron)
  if (presetMatch) {
    scheduleType = 'preset'
  } else if (cron.includes('*/')) {
    scheduleType = 'interval'
  }
  
  taskForm.value = {
    name: task.name,
    sessionId: task.sessionId,
    command: task.command,
    scheduleType,
    presetSchedule: presetMatch ? cron : '0 0 2 * * *',
    cronExpression: cron,
    intervalValue: 30,
    intervalUnit: 'minutes',
    timeout: task.timeout || 60,
    enabled: task.enabled
  }
  showCreateDialog.value = true
}

const toggleTask = async (task: any) => {
  try {
    const result = await window.electronAPI.taskScheduler?.update?.(task.id, { enabled: task.enabled })
    if (result?.success) {
      ElMessage.success(task.enabled ? '任务已启用' : '任务已禁用')
      loadStatistics()
    } else {
      task.enabled = !task.enabled
      ElMessage.error(result?.error || '操作失败')
    }
  } catch (error: any) {
    task.enabled = !task.enabled
    ElMessage.error(error.message || '操作失败')
  }
}

const executeTask = async (task: any) => {
  executingTasks.add(task.id)
  try {
    const result = await window.electronAPI.taskScheduler?.execute?.(task.id)
    if (result?.success) {
      const execution = result.data
      if (execution?.status === 'success') {
        ElMessage.success('任务执行成功')
      } else {
        ElMessage.warning(`任务执行完成，状态: ${execution?.status}`)
      }
      loadTasks()
      loadStatistics()
    } else {
      ElMessage.error(result?.error || '执行失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '执行失败')
  } finally {
    executingTasks.delete(task.id)
  }
}

const deleteTask = async (task: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除任务 "${task.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.taskScheduler?.delete?.(task.id)
    if (result?.success) {
      ElMessage.success('任务已删除')
      loadTasks()
      loadStatistics()
    } else {
      ElMessage.error(result?.error || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const showHistory = async (task: any) => {
  historyTask.value = task
  showHistoryDialog.value = true
  loadingHistory.value = true
  
  try {
    const result = await window.electronAPI.taskScheduler?.getExecutions?.(task.id, 50)
    if (result?.success) {
      taskExecutions.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载执行历史失败')
  } finally {
    loadingHistory.value = false
  }
}

const clearHistory = async () => {
  try {
    await ElMessageBox.confirm('确定要清空此任务的执行历史吗？', '确认清空', { type: 'warning' })
    await window.electronAPI.taskScheduler?.clearExecutions?.(historyTask.value.id)
    taskExecutions.value = []
    ElMessage.success('历史已清空')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('清空失败')
    }
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    success: 'success',
    failed: 'danger',
    running: 'warning',
    pending: 'info'
  }
  return map[status] || 'info'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    success: '成功',
    failed: '失败',
    running: '运行中',
    pending: '等待中'
  }
  return map[status] || status
}

const describeCron = (cron: string): string => {
  if (!cron) return ''
  
  // 简单的 cron 描述
  const parts = cron.split(' ')
  if (parts.length < 6) return cron
  
  const [, min, hour, day, month, week] = parts
  
  if (cron.includes('*/')) {
    if (min.startsWith('*/')) return `每 ${min.slice(2)} 分钟`
    if (hour.startsWith('*/')) return `每 ${hour.slice(2)} 小时`
    if (day.startsWith('*/')) return `每 ${day.slice(2)} 天`
  }
  
  if (day === '*' && month === '*') {
    if (week === '*') {
      return `每天 ${hour}:${min.padStart(2, '0')}`
    } else if (week === '0' || week === '7') {
      return `每周日 ${hour}:${min.padStart(2, '0')}`
    } else if (week === '1-5') {
      return `工作日 ${hour}:${min.padStart(2, '0')}`
    }
  }
  
  return cron
}
</script>

<style scoped>
.task-scheduler-panel {
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
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-2xl);
}

.guide-btn {
  font-size: var(--text-sm);
  padding: 4px 8px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.stats-bar {
  display: flex;
  gap: 24px;
  padding: 16px 20px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-value {
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.success { color: var(--success-color); }
.stat-value.danger { color: var(--error-color); }

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  min-height: 0;
}

.command-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.cron-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  color: var(--primary-color);
  cursor: help;
}

.time-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.no-data {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.exec-stats {
  font-size: var(--text-md);
}

.exec-stats .success { color: var(--success-color); }
.exec-stats .danger { color: var(--error-color); }

.form-tip {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.interval-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.preset-cron {
  float: right;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

/* 执行历史 */
.history-content {
  min-height: 200px;
}

.output-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60px;
  overflow: hidden;
}

.error-text {
  font-size: var(--text-sm);
  color: var(--error-color);
}

.empty-history {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-secondary);
}

.empty-history p {
  margin-top: 12px;
}

/* 使用指南 */
.guide-content {
  max-height: 60vh;
  overflow-y: auto;
  padding: 0 10px;
}

.guide-content h3 {
  margin: 24px 0 12px 0;
  font-size: var(--text-lg);
  color: var(--text-primary);
}

.guide-content h3:first-child {
  margin-top: 0;
}

.guide-content p {
  margin: 0 0 12px 0;
  font-size: var(--text-base);
  line-height: 1.7;
  color: var(--text-secondary);
}

.guide-content ul {
  margin: 0 0 16px 0;
  padding-left: 24px;
  font-size: var(--text-base);
  line-height: 1.8;
  color: var(--text-secondary);
}

.guide-content code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-md);
  color: var(--primary-color);
}

.cron-explain {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
  text-align: center;
}

.cron-explain code {
  font-size: var(--text-lg);
  display: block;
  margin-bottom: 8px;
}

.cron-fields {
  display: flex;
  justify-content: center;
  gap: 24px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.examples {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px 16px;
}

.example-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.example-row:last-child {
  border-bottom: none;
}

.example-row code {
  min-width: 140px;
}

.example-row span {
  color: var(--text-secondary);
  font-size: var(--text-md);
}

:global(:root.app-appearance-terminal .task-scheduler-panel) {
  background: var(--bg-main);
}

:global(:root.app-appearance-terminal .stats-bar) {
  gap: 18px;
  padding: 10px 12px;
}

:global(:root.app-appearance-terminal .stat-value) {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
}

:global(:root.app-appearance-terminal .stat-label) {
  font-size: var(--text-xs);
}

:global(:root.app-appearance-terminal .panel-content) {
  padding: 12px;
}

:global(:root.app-appearance-terminal .cron-explain),
:global(:root.app-appearance-terminal .examples) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}
</style>
