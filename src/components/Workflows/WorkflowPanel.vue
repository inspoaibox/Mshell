<template>
  <div class="workflow-panel">
    <div class="panel-header">
      <div class="header-left">
        <h2>工作流管理</h2>
        <el-button link type="primary" @click="showGuideDialog = true" class="guide-btn">
          <el-icon><Document /></el-icon>
          <span>使用指南</span>
        </el-button>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="loadWorkflows">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">创建工作流</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{{ statistics.total }}</span>
        <span class="stat-label">总工作流</span>
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
      <el-table :data="workflows" style="width: 100%" v-loading="loading">
        <el-table-column prop="name" label="工作流名称" min-width="150" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="步骤数" width="80">
          <template #default="{ row }">
            <el-tag size="small">{{ row.steps?.length || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="80">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" size="small" @change="toggleWorkflow(row)" />
          </template>
        </el-table-column>
        <el-table-column label="上次运行" width="160">
          <template #default="{ row }">
            <span v-if="row.lastExecution" class="time-text">{{ formatDate(row.lastExecution) }}</span>
            <span v-else class="no-data">未运行</span>
          </template>
        </el-table-column>
        <el-table-column label="执行统计" width="100">
          <template #default="{ row }">
            <span class="exec-stats">
              <span class="success">{{ row.successCount || 0 }}</span>
              /
              <span class="danger">{{ row.failureCount || 0 }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="success" :icon="VideoPlay" @click="executeWorkflow(row)" 
              :loading="executingWorkflows.has(row.id)" :disabled="!row.enabled || !row.steps?.length">
              执行
            </el-button>
            <el-button size="small" :icon="Clock" @click="showHistory(row)">历史</el-button>
            <el-button size="small" :icon="Edit" @click="editWorkflow(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteWorkflow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑工作流对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingWorkflow ? '编辑工作流' : '创建工作流'" width="850px" top="5vh">
      <el-form :model="workflowForm" label-width="100px">
        <el-form-item label="工作流名称" required>
          <el-input v-model="workflowForm.name" placeholder="输入工作流名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="workflowForm.description" type="textarea" :rows="2" placeholder="工作流用途说明" />
        </el-form-item>
        <el-form-item label="立即启用">
          <el-switch v-model="workflowForm.enabled" />
        </el-form-item>
        
        <el-divider content-position="left">
          <el-icon><List /></el-icon> 执行步骤
        </el-divider>
        
        <div class="steps-editor">
          <div v-for="(step, index) in workflowForm.steps" :key="step.id || index" class="step-item">
            <div class="step-header">
              <div class="step-info">
                <span class="step-number">{{ index + 1 }}</span>
                <el-select v-model="step.type" size="small" style="width: 100px">
                  <el-option label="命令" value="command" />
                  <el-option label="延迟" value="delay" />
                </el-select>
              </div>
              <div class="step-actions">
                <el-button size="small" :icon="Top" :disabled="index === 0" @click="moveStep(index, -1)" circle />
                <el-button size="small" :icon="Bottom" :disabled="index === workflowForm.steps.length - 1" @click="moveStep(index, 1)" circle />
                <el-button size="small" type="danger" :icon="Delete" @click="removeStep(index)" circle />
              </div>
            </div>
            
            <div class="step-content">
              <template v-if="step.type === 'command'">
                <el-form-item label="会话" label-width="60px" style="margin-bottom: 8px">
                  <el-select v-model="step.sessionId" placeholder="选择会话" size="small" style="width: 100%">
                    <el-option v-for="session in sessions" :key="session.id" 
                      :label="`${session.name} (${session.host})`" :value="session.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="命令" label-width="60px" style="margin-bottom: 8px">
                  <el-input v-model="step.command" type="textarea" :rows="2" size="small" 
                    placeholder="输入要执行的命令，支持 ${变量名} 格式的变量" />
                </el-form-item>
                <el-form-item label="超时" label-width="60px" style="margin-bottom: 0">
                  <el-input-number v-model="step.timeout" :min="5" :max="600" size="small" />
                  <span class="unit-text">秒</span>
                  <el-checkbox v-model="step.continueOnError" style="margin-left: 16px">失败时继续</el-checkbox>
                </el-form-item>
              </template>
              
              <template v-else-if="step.type === 'delay'">
                <el-form-item label="等待" label-width="60px" style="margin-bottom: 0">
                  <el-input-number v-model="step.delay" :min="1" :max="3600" size="small" />
                  <span class="unit-text">秒</span>
                  <span class="delay-hint">在执行下一步之前等待</span>
                </el-form-item>
              </template>
            </div>
          </div>
          
          <el-button :icon="Plus" @click="addStep" class="add-step-btn">添加步骤</el-button>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveWorkflow" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 执行历史对话框 -->
    <el-dialog v-model="showHistoryDialog" :title="`执行历史 - ${historyWorkflow?.name || ''}`" width="900px">
      <div class="history-content">
        <el-table :data="workflowExecutions" v-loading="loadingHistory" max-height="400">
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
              {{ row.endTime ? `${((new Date(row.endTime).getTime() - new Date(row.startTime).getTime()) / 1000).toFixed(1)}s` : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="步骤执行情况" min-width="300">
            <template #default="{ row }">
              <div class="step-results">
                <el-tooltip v-for="(step, idx) in row.steps" :key="idx" 
                  :content="`${step.output || step.error || '无输出'}`" placement="top">
                  <span :class="['step-dot', step.status]">{{ idx + 1 }}</span>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="workflowExecutions.length === 0 && !loadingHistory" class="empty-history">
          <el-icon :size="48"><Clock /></el-icon>
          <p>暂无执行记录</p>
        </div>
      </div>
      <template #footer>
        <el-button @click="showHistoryDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 使用指南对话框 -->
    <el-dialog v-model="showGuideDialog" title="工作流使用指南" width="700px">
      <div class="guide-content">
        <h3>📋 什么是工作流？</h3>
        <p>工作流是一系列按顺序执行的步骤，可以在多个服务器上自动执行命令。适用于部署、批量操作等需要多步骤协调的场景。</p>
        
        <h3>🎯 适用场景</h3>
        <ul>
          <li><strong>应用部署</strong> - 拉取代码 → 构建 → 重启服务</li>
          <li><strong>批量操作</strong> - 在多台服务器上执行相同命令</li>
          <li><strong>数据同步</strong> - 备份 → 传输 → 恢复</li>
          <li><strong>环境配置</strong> - 安装依赖 → 配置 → 启动</li>
        </ul>
        
        <h3>📝 步骤类型</h3>
        <div class="step-types">
          <div class="type-item">
            <span class="type-icon">⌨️</span>
            <div class="type-info">
              <strong>命令</strong>
              <p>在指定会话上执行 Shell 命令</p>
            </div>
          </div>
          <div class="type-item">
            <span class="type-icon">⏱️</span>
            <div class="type-info">
              <strong>延迟</strong>
              <p>等待指定时间后继续执行</p>
            </div>
          </div>
        </div>
        
        <h3>💡 实际案例</h3>
        <div class="case-study">
          <h4>案例：Web 应用部署</h4>
          <div class="case-steps">
            <div class="case-step">
              <span class="step-num">1</span>
              <div>
                <strong>拉取代码</strong>
                <code>cd /var/www/app && git pull origin main</code>
              </div>
            </div>
            <div class="case-step">
              <span class="step-num">2</span>
              <div>
                <strong>安装依赖</strong>
                <code>npm install --production</code>
              </div>
            </div>
            <div class="case-step">
              <span class="step-num">3</span>
              <div>
                <strong>重启服务</strong>
                <code>pm2 restart app</code>
              </div>
            </div>
          </div>
        </div>
        
        <h3>⚠️ 注意事项</h3>
        <ul>
          <li>执行工作流前确保相关会话已连接</li>
          <li>勾选"失败时继续"可以让工作流在某步骤失败后继续执行</li>
          <li>建议先单独测试每个命令，确认无误后再组合成工作流</li>
        </ul>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, VideoPlay, Clock, Refresh, Document, Top, Bottom, List } from '@element-plus/icons-vue'

const workflows = ref<any[]>([])
const sessions = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showCreateDialog = ref(false)
const showHistoryDialog = ref(false)
const showGuideDialog = ref(false)
const editingWorkflow = ref<any>(null)
const historyWorkflow = ref<any>(null)
const workflowExecutions = ref<any[]>([])
const loadingHistory = ref(false)
const executingWorkflows = reactive(new Set<string>())

const statistics = ref({
  total: 0,
  enabled: 0,
  disabled: 0,
  totalExecutions: 0,
  totalSuccesses: 0,
  totalFailures: 0
})

const workflowForm = ref({
  name: '',
  description: '',
  enabled: true,
  steps: [] as any[]
})

onMounted(() => {
  loadWorkflows()
  loadSessions()
  loadStatistics()
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

const loadStatistics = async () => {
  try {
    const result = await window.electronAPI.workflow?.getStatistics?.()
    if (result?.success) {
      statistics.value = result.data
    }
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

const generateStepId = () => `step_${Date.now()}_${Math.random().toString(36).substring(7)}`

const addStep = () => {
  workflowForm.value.steps.push({
    id: generateStepId(),
    name: `步骤 ${workflowForm.value.steps.length + 1}`,
    type: 'command',
    sessionId: '',
    command: '',
    timeout: 30,
    continueOnError: false,
    delay: 5
  })
}

const removeStep = (index: number) => {
  workflowForm.value.steps.splice(index, 1)
}

const moveStep = (index: number, direction: number) => {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= workflowForm.value.steps.length) return
  
  const steps = workflowForm.value.steps
  const temp = steps[index]
  steps[index] = steps[newIndex]
  steps[newIndex] = temp
}

const openCreateDialog = () => {
  editingWorkflow.value = null
  workflowForm.value = {
    name: '',
    description: '',
    enabled: true,
    steps: []
  }
  showCreateDialog.value = true
}

const saveWorkflow = async () => {
  if (!workflowForm.value.name) {
    ElMessage.warning('请输入工作流名称')
    return
  }
  if (workflowForm.value.steps.length === 0) {
    ElMessage.warning('请添加至少一个步骤')
    return
  }
  
  // 验证步骤
  for (let i = 0; i < workflowForm.value.steps.length; i++) {
    const step = workflowForm.value.steps[i]
    if (step.type === 'command' && (!step.sessionId || !step.command)) {
      ElMessage.warning(`步骤 ${i + 1} 请选择会话并输入命令`)
      return
    }
  }

  saving.value = true
  try {
    // 构建步骤数据，设置 nextStepId
    const steps = workflowForm.value.steps.map((step, index) => ({
      ...step,
      name: step.name || `步骤 ${index + 1}`,
      nextStepId: index < workflowForm.value.steps.length - 1 
        ? workflowForm.value.steps[index + 1].id 
        : undefined,
      delay: step.type === 'delay' ? (step.delay || 5) * 1000 : undefined
    }))
    
    const workflowData: Record<string, any> = {
      name: workflowForm.value.name,
      description: workflowForm.value.description,
      enabled: workflowForm.value.enabled,
      steps,
      startStepId: steps[0]?.id
    }

    const result = editingWorkflow.value
      ? await window.electronAPI.workflow?.update?.(editingWorkflow.value.id, workflowData)
      : await window.electronAPI.workflow?.create?.(workflowData)

    if (result?.success) {
      ElMessage.success(editingWorkflow.value ? '工作流已更新' : '工作流已创建')
      showCreateDialog.value = false
      loadWorkflows()
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

const editWorkflow = (workflow: any) => {
  editingWorkflow.value = workflow
  workflowForm.value = {
    name: workflow.name,
    description: workflow.description || '',
    enabled: workflow.enabled,
    steps: (workflow.steps || []).map((step: any) => ({
      ...step,
      delay: step.delay ? step.delay / 1000 : 5
    }))
  }
  showCreateDialog.value = true
}

const toggleWorkflow = async (workflow: any) => {
  try {
    const result = await window.electronAPI.workflow?.update?.(workflow.id, { enabled: workflow.enabled })
    if (result?.success) {
      ElMessage.success(workflow.enabled ? '工作流已启用' : '工作流已禁用')
      loadStatistics()
    } else {
      workflow.enabled = !workflow.enabled
      ElMessage.error(result?.error || '操作失败')
    }
  } catch (error: any) {
    workflow.enabled = !workflow.enabled
    ElMessage.error(error.message || '操作失败')
  }
}

const executeWorkflow = async (workflow: any) => {
  executingWorkflows.add(workflow.id)
  try {
    const result = await window.electronAPI.workflow?.execute?.(workflow.id)
    if (result?.success) {
      const execution = result.data
      if (execution?.status === 'completed') {
        ElMessage.success('工作流执行成功')
      } else {
        ElMessage.warning(`工作流执行完成，状态: ${execution?.status}`)
      }
      loadWorkflows()
      loadStatistics()
    } else {
      ElMessage.error(result?.error || '执行失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '执行失败')
  } finally {
    executingWorkflows.delete(workflow.id)
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

const showHistory = async (workflow: any) => {
  historyWorkflow.value = workflow
  showHistoryDialog.value = true
  loadingHistory.value = true
  
  try {
    const result = await window.electronAPI.workflow?.getExecutions?.(workflow.id, 50)
    if (result?.success) {
      workflowExecutions.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载执行历史失败')
  } finally {
    loadingHistory.value = false
  }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}

const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    completed: 'success',
    failed: 'danger',
    running: 'warning',
    idle: 'info',
    cancelled: 'info'
  }
  return map[status] || 'info'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    completed: '成功',
    failed: '失败',
    running: '运行中',
    idle: '空闲',
    cancelled: '已取消'
  }
  return map[status] || status
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

.time-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.no-data {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.exec-stats {
  font-size: var(--text-sm);
}

.exec-stats .success { color: var(--success-color); }
.exec-stats .danger { color: var(--error-color); }

/* 步骤编辑器 */
.steps-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 8px;
}

.step-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.step-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-number {
  width: 24px;
  height: 24px;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 600;
}

.step-actions {
  display: flex;
  gap: 4px;
}

.step-content {
  padding: 12px;
}

.unit-text {
  margin-left: 8px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.delay-hint {
  margin-left: 16px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.add-step-btn {
  width: 100%;
  border-style: dashed;
}

/* 执行历史 */
.history-content {
  min-height: 200px;
}

.step-results {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: help;
}

.step-dot.success {
  background: var(--success-color);
  color: white;
}

.step-dot.failed {
  background: var(--error-color);
  color: white;
}

.step-dot.skipped {
  background: var(--text-secondary);
  color: white;
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
  font-size: var(--text-sm);
  color: var(--primary-color);
}

.step-types {
  display: flex;
  gap: 16px;
  margin: 12px 0;
}

.type-item {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.type-icon {
  font-size: var(--text-2xl);
}

.type-info strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.type-info p {
  margin: 0;
  font-size: var(--text-sm);
}

.case-study {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.05), rgba(139, 92, 246, 0.05));
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
}

.case-study h4 {
  margin: 0 0 12px 0;
  font-size: var(--text-base);
  color: var(--primary-color);
}

.case-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.case-step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.case-step .step-num {
  width: 24px;
  height: 24px;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 600;
  flex-shrink: 0;
}

.case-step strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.case-step code {
  display: block;
  font-size: var(--text-xs);
}
</style>
