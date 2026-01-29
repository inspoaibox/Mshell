<template>
  <div class="workflow-panel">
    <div class="panel-header">
      <h2>工作流管理</h2>
      <div class="header-actions">
        <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
          创建工作流
        </el-button>
      </div>
    </div>

    <div class="panel-content">
      <el-table :data="workflows" style="width: 100%" v-loading="loading">
        <el-table-column prop="name" label="工作流名称" min-width="150" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="步骤数" width="100">
          <template #default="{ row }">
            {{ row.steps?.length || 0 }}
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastRun" label="上次运行" width="180">
          <template #default="{ row }">
            {{ row.lastRun ? formatDate(row.lastRun) : '未运行' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="VideoPlay" @click="executeWorkflow(row)" :disabled="!row.enabled">
              执行
            </el-button>
            <el-button size="small" :icon="Edit" @click="editWorkflow(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteWorkflow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑工作流对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingWorkflow ? '编辑工作流' : '创建工作流'" width="800px">
      <el-form :model="workflowForm" label-width="100px">
        <el-form-item label="工作流名称">
          <el-input v-model="workflowForm.name" placeholder="输入工作流名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="workflowForm.description" type="textarea" :rows="2" placeholder="输入描述" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="workflowForm.enabled" />
        </el-form-item>
        <el-form-item label="执行步骤">
          <div class="steps-editor">
            <div v-for="(step, index) in workflowForm.steps" :key="index" class="step-item">
              <div class="step-header">
                <span class="step-number">步骤 {{ index + 1 }}</span>
                <el-button size="small" type="danger" :icon="Delete" @click="removeStep(index)" circle />
              </div>
              <el-form label-width="80px" size="small">
                <el-form-item label="会话">
                  <el-select v-model="step.sessionId" placeholder="选择会话" style="width: 100%">
                    <el-option v-for="session in sessions" :key="session.id" :label="session.name" :value="session.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="命令">
                  <el-input v-model="step.command" type="textarea" :rows="2" placeholder="输入命令" />
                </el-form-item>
                <el-form-item label="等待时间">
                  <el-input-number v-model="step.waitAfter" :min="0" :max="60" />
                  <span style="margin-left: 8px">秒</span>
                </el-form-item>
              </el-form>
            </div>
            <el-button :icon="Plus" @click="addStep" style="width: 100%">添加步骤</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveWorkflow" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, VideoPlay } from '@element-plus/icons-vue'

const workflows = ref<any[]>([])
const sessions = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showCreateDialog = ref(false)
const editingWorkflow = ref<any>(null)

const workflowForm = ref({
  name: '',
  description: '',
  enabled: true,
  steps: [] as any[]
})

onMounted(() => {
  loadWorkflows()
  loadSessions()
})

const loadWorkflows = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.workflow?.getAll?.()
    if (result?.success) {
      workflows.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载工作流列表失败')
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

const addStep = () => {
  workflowForm.value.steps.push({
    sessionId: '',
    command: '',
    waitAfter: 0
  })
}

const removeStep = (index: number) => {
  workflowForm.value.steps.splice(index, 1)
}

const saveWorkflow = async () => {
  if (!workflowForm.value.name || workflowForm.value.steps.length === 0) {
    ElMessage.warning('请填写工作流名称并添加至少一个步骤')
    return
  }

  saving.value = true
  try {
    const result = editingWorkflow.value
      ? await window.electronAPI.workflow?.update?.(editingWorkflow.value.id, workflowForm.value)
      : await window.electronAPI.workflow?.create?.(workflowForm.value)

    if (result?.success) {
      ElMessage.success(editingWorkflow.value ? '工作流已更新' : '工作流已创建')
      showCreateDialog.value = false
      resetForm()
      loadWorkflows()
    } else {
      ElMessage.error(result?.error || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const editWorkflow = (workflow: any) => {
  editingWorkflow.value = workflow
  workflowForm.value = {
    name: workflow.name,
    description: workflow.description || '',
    enabled: workflow.enabled,
    steps: [...workflow.steps]
  }
  showCreateDialog.value = true
}

const executeWorkflow = async (workflow: any) => {
  try {
    const result = await window.electronAPI.workflow?.execute?.(workflow.id)
    if (result?.success) {
      ElMessage.success('工作流执行成功')
      loadWorkflows()
    } else {
      ElMessage.error(result?.error || '执行失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '执行失败')
  }
}

const deleteWorkflow = async (workflow: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除工作流 "${workflow.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.workflow?.delete?.(workflow.id)
    if (result?.success) {
      ElMessage.success('工作流已删除')
      loadWorkflows()
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
  editingWorkflow.value = null
  workflowForm.value = {
    name: '',
    description: '',
    enabled: true,
    steps: []
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}
</script>

<style scoped>
.workflow-panel {
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

.steps-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-secondary);
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.step-number {
  font-weight: 600;
  color: var(--text-primary);
}
</style>
