<template>
  <div class="task-scheduler-panel">
    <div class="panel-header">
      <h2>任务调度</h2>
      <div class="header-actions">
        <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
          创建任务
        </el-button>
      </div>
    </div>

    <div class="panel-content">
      <el-table :data="tasks" style="width: 100%" v-loading="loading">
        <el-table-column prop="name" label="任务名称" min-width="150" />
        <el-table-column prop="command" label="命令" min-width="200" show-overflow-tooltip />
        <el-table-column prop="schedule" label="调度规则" width="150" />
        <el-table-column prop="enabled" label="状态" width="100">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="toggleTask(row)" />
          </template>
        </el-table-column>
        <el-table-column prop="lastRun" label="上次运行" width="180">
          <template #default="{ row }">
            {{ row.lastRun ? formatDate(row.lastRun) : '未运行' }}
          </template>
        </el-table-column>
        <el-table-column prop="nextRun" label="下次运行" width="180">
          <template #default="{ row }">
            {{ row.nextRun ? formatDate(row.nextRun) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="editTask(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteTask(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑任务对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingTask ? '编辑任务' : '创建任务'" width="600px">
      <el-form :model="taskForm" label-width="100px">
        <el-form-item label="任务名称">
          <el-input v-model="taskForm.name" placeholder="输入任务名称" />
        </el-form-item>
        <el-form-item label="会话">
          <el-select v-model="taskForm.sessionId" placeholder="选择会话" style="width: 100%">
            <el-option v-for="session in sessions" :key="session.id" :label="session.name" :value="session.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="命令">
          <el-input v-model="taskForm.command" type="textarea" :rows="3" placeholder="输入要执行的命令" />
        </el-form-item>
        <el-form-item label="调度类型">
          <el-radio-group v-model="taskForm.scheduleType">
            <el-radio value="cron">Cron 表达式</el-radio>
            <el-radio value="interval">时间间隔</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="调度规则" v-if="taskForm.scheduleType === 'cron'">
          <el-input v-model="taskForm.schedule" placeholder="例如: 0 0 * * * (每天午夜)" />
          <div class="form-hint">Cron 格式: 秒 分 时 日 月 周</div>
        </el-form-item>
        <el-form-item label="间隔时间" v-if="taskForm.scheduleType === 'interval'">
          <el-input-number v-model="taskForm.intervalMinutes" :min="1" :max="1440" />
          <span style="margin-left: 8px">分钟</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="taskForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTask" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'

const tasks = ref<any[]>([])
const sessions = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showCreateDialog = ref(false)
const editingTask = ref<any>(null)

const taskForm = ref({
  name: '',
  sessionId: '',
  command: '',
  scheduleType: 'cron',
  schedule: '0 0 * * *',
  intervalMinutes: 60,
  enabled: true
})

onMounted(() => {
  loadTasks()
  loadSessions()
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

const saveTask = async () => {
  if (!taskForm.value.name || !taskForm.value.sessionId || !taskForm.value.command) {
    ElMessage.warning('请填写所有必填字段')
    return
  }

  saving.value = true
  try {
    const taskData = {
      ...taskForm.value,
      schedule: taskForm.value.scheduleType === 'interval' 
        ? `*/${taskForm.value.intervalMinutes} * * * *`
        : taskForm.value.schedule
    }

    const result = editingTask.value
      ? await window.electronAPI.taskScheduler?.update?.(editingTask.value.id, taskData)
      : await window.electronAPI.taskScheduler?.create?.(taskData)

    if (result?.success) {
      ElMessage.success(editingTask.value ? '任务已更新' : '任务已创建')
      showCreateDialog.value = false
      resetForm()
      loadTasks()
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
  taskForm.value = {
    name: task.name,
    sessionId: task.sessionId,
    command: task.command,
    scheduleType: task.schedule.includes('/') ? 'interval' : 'cron',
    schedule: task.schedule,
    intervalMinutes: 60,
    enabled: task.enabled
  }
  showCreateDialog.value = true
}

const toggleTask = async (task: any) => {
  try {
    const result = await window.electronAPI.taskScheduler?.update?.(task.id, { enabled: task.enabled })
    if (result?.success) {
      ElMessage.success(task.enabled ? '任务已启用' : '任务已禁用')
    } else {
      task.enabled = !task.enabled
      ElMessage.error(result?.error || '操作失败')
    }
  } catch (error: any) {
    task.enabled = !task.enabled
    ElMessage.error(error.message || '操作失败')
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
    } else {
      ElMessage.error(result?.error || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const resetForm = () => {
  editingTask.value = null
  taskForm.value = {
    name: '',
    sessionId: '',
    command: '',
    scheduleType: 'cron',
    schedule: '0 0 * * *',
    intervalMinutes: 60,
    enabled: true
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
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

.panel-header h2 {
  margin: 0;
  font-size: 20px;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  min-height: 0;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}
</style>
