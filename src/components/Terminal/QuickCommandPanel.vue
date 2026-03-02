<template>
  <div class="quick-command-panel">
    <div class="panel-header">
      <h3>快捷命令</h3>
      <div class="header-actions">
        <el-tooltip content="新建命令" placement="bottom">
          <el-button :icon="Plus" link @click="showCreateDialog = true" />
        </el-tooltip>
        <el-button :icon="Close" link @click="$emit('close')" />
      </div>
    </div>

    <!-- 命令输入区域 -->
    <div class="command-input-section">
      <el-input
        ref="commandInputRef"
        v-model="commandText"
        type="textarea"
        :rows="4"
        placeholder="输入命令，支持多行... (Ctrl+Enter 发送)"
        resize="none"
        @keydown.ctrl.enter="sendCommand(true)"
        @keydown.meta.enter="sendCommand(true)"
        @keydown.ctrl.shift.enter="sendCommand(false)"
        @keydown.meta.shift.enter="sendCommand(false)"
      />
      <div class="input-actions">
        <el-dropdown split-button type="primary" @click="sendCommand(autoExecute)" @command="handleSendCommand" :disabled="!commandText.trim()">
          <el-icon><Position /></el-icon>
          {{ autoExecute ? '执行' : '插入' }}
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="execute" :icon="VideoPlay">
                执行命令 (自动回车)
              </el-dropdown-item>
              <el-dropdown-item command="insert" :icon="Edit">
                仅插入 (不执行)
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-checkbox v-model="autoExecute" size="small">自动执行</el-checkbox>
        <el-button :icon="DocumentAdd" @click="saveAsQuickCommand" :disabled="!commandText.trim()">
          保存
        </el-button>
      </div>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-section">
      <el-input
        v-model="searchQuery"
        placeholder="搜索命令..."
        :prefix-icon="Search"
        clearable
        size="small"
      />
      <el-select v-model="filterCategory" placeholder="分类" clearable size="small" style="width: 120px;">
        <el-option label="全部" value="" />
        <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
      </el-select>
    </div>

    <!-- 快捷命令列表 -->
    <div class="command-list">
      <div v-if="filteredCommands.length === 0" class="empty-state">
        <el-icon :size="32"><Document /></el-icon>
        <p>暂无快捷命令</p>
        <p class="hint">点击上方"+"创建快捷命令</p>
      </div>
      <div
        v-for="cmd in filteredCommands"
        :key="cmd.id"
        class="command-item"
        @click="selectCommand(cmd)"
        @dblclick="executeCommand(cmd, true)"
      >
        <div class="command-info">
          <div class="command-name">{{ cmd.name }}</div>
          <div class="command-preview">{{ truncateCommand(cmd.command) }}</div>
        </div>
        <div class="command-meta">
          <el-tag v-if="cmd.category" size="small" type="info">{{ cmd.category }}</el-tag>
          <span class="usage-count">{{ cmd.usageCount }}次</span>
        </div>
        <div class="command-actions">
          <el-tooltip content="执行 (自动回车)" placement="top">
            <el-button :icon="VideoPlay" link size="small" @click.stop="executeCommand(cmd, true)" />
          </el-tooltip>
          <el-tooltip content="插入 (不执行)" placement="top">
            <el-button :icon="Position" link size="small" @click.stop="executeCommand(cmd, false)" />
          </el-tooltip>
          <el-tooltip content="编辑" placement="top">
            <el-button :icon="Edit" link size="small" @click.stop="editCommand(cmd)" />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button :icon="Delete" link size="small" type="danger" @click.stop="deleteCommand(cmd)" />
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingCommand ? '编辑快捷命令' : '新建快捷命令'"
      width="500px"
      :close-on-click-modal="false"
      append-to-body
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="命令名称" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="命令" prop="command">
          <el-input
            v-model="form.command"
            type="textarea"
            :rows="5"
            placeholder="输入命令内容，支持多行"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="可选描述" maxlength="200" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="form.category"
            placeholder="选择或输入分类"
            allow-create
            filterable
            style="width: 100%"
          >
            <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            placeholder="添加标签"
            allow-create
            filterable
            style="width: 100%"
          >
            <el-option v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">
          {{ editingCommand ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Plus, Close, Search, Position, Edit, Delete, Document, DocumentAdd, VideoPlay
} from '@element-plus/icons-vue'

interface QuickCommand {
  id: string
  name: string
  command: string
  description?: string
  category?: string
  tags?: string[]
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface Props {
  connectionId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const commands = ref<QuickCommand[]>([])
const commandText = ref('')
const searchQuery = ref('')
const filterCategory = ref('')
const showCreateDialog = ref(false)
const editingCommand = ref<QuickCommand | null>(null)
const saving = ref(false)
const formRef = ref()
const commandInputRef = ref()
const autoExecute = ref(true) // 默认自动执行

const form = ref({
  name: '',
  command: '',
  description: '',
  category: '',
  tags: [] as string[]
})

const rules = {
  name: [{ required: true, message: '请输入命令名称', trigger: 'blur' }],
  command: [{ required: true, message: '请输入命令内容', trigger: 'blur' }]
}

onMounted(() => {
  loadCommands()
  nextTick(() => {
    commandInputRef.value?.focus()
  })
})

const loadCommands = async () => {
  try {
    const result = await window.electronAPI.quickCommand.getAll()
    if (result.success) {
      commands.value = result.data || []
    }
  } catch (error: any) {
    console.error('Failed to load quick commands:', error)
  }
}

const categories = computed(() => {
  const cats = new Set<string>()
  commands.value.forEach(cmd => {
    if (cmd.category) cats.add(cmd.category)
  })
  return Array.from(cats)
})

const allTags = computed(() => {
  const tags = new Set<string>()
  commands.value.forEach(cmd => {
    cmd.tags?.forEach(tag => tags.add(tag))
  })
  return Array.from(tags)
})

const filteredCommands = computed(() => {
  return commands.value.filter(cmd => {
    const matchesSearch = !searchQuery.value ||
      cmd.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      cmd.command.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchesCategory = !filterCategory.value || cmd.category === filterCategory.value
    return matchesSearch && matchesCategory
  }).sort((a, b) => b.usageCount - a.usageCount)
})

const truncateCommand = (command: string) => {
  const firstLine = command.split('\n')[0]
  return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine
}

const selectCommand = (cmd: QuickCommand) => {
  commandText.value = cmd.command
}

// 处理下拉菜单命令
const handleSendCommand = (command: string) => {
  if (command === 'execute') {
    sendCommand(true)
  } else if (command === 'insert') {
    sendCommand(false)
  }
}

// 发送命令到终端
const sendCommand = (execute: boolean) => {
  if (!commandText.value.trim()) return
  
  // 发送命令到终端
  const cmd = execute ? commandText.value + '\n' : commandText.value
  window.electronAPI.ssh.write(props.connectionId, cmd)
  
  ElMessage.success(execute ? '命令已执行' : '命令已插入')
}

// 执行保存的快捷命令
const executeCommand = async (cmd: QuickCommand, execute: boolean) => {
  // 发送命令到终端
  const command = execute ? cmd.command + '\n' : cmd.command
  window.electronAPI.ssh.write(props.connectionId, command)
  
  // 增加使用次数
  try {
    await window.electronAPI.quickCommand.incrementUsage(cmd.id)
    await loadCommands()
  } catch (error) {
    console.error('Failed to increment usage:', error)
  }
  
  ElMessage.success(execute ? '命令已执行' : '命令已插入')
}

const saveAsQuickCommand = () => {
  form.value = {
    name: '',
    command: commandText.value,
    description: '',
    category: '',
    tags: []
  }
  editingCommand.value = null
  showCreateDialog.value = true
}

const editCommand = (cmd: QuickCommand) => {
  editingCommand.value = cmd
  form.value = {
    name: cmd.name,
    command: cmd.command,
    description: cmd.description || '',
    category: cmd.category || '',
    tags: cmd.tags || []
  }
  showCreateDialog.value = true
}

const deleteCommand = async (cmd: QuickCommand) => {
  try {
    await ElMessageBox.confirm(`确定要删除 "${cmd.name}" 吗？`, '确认删除', {
      type: 'warning'
    })
    
    const result = await window.electronAPI.quickCommand.delete(cmd.id)
    if (result.success) {
      ElMessage.success('删除成功')
      await loadCommands()
    } else {
      ElMessage.error(result.error || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const handleSave = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return
    
    saving.value = true
    try {
      const data = {
        name: form.value.name,
        command: form.value.command,
        description: form.value.description,
        category: form.value.category,
        tags: form.value.tags
      }
      
      let result
      if (editingCommand.value) {
        result = await window.electronAPI.quickCommand.update(editingCommand.value.id, data)
      } else {
        result = await window.electronAPI.quickCommand.create(data)
      }
      
      if (result.success) {
        ElMessage.success(editingCommand.value ? '更新成功' : '创建成功')
        showCreateDialog.value = false
        await loadCommands()
      } else {
        ElMessage.error(result.error || '保存失败')
      }
    } catch (error: any) {
      ElMessage.error(error.message || '保存失败')
    } finally {
      saving.value = false
    }
  })
}

const resetForm = () => {
  form.value = {
    name: '',
    command: '',
    description: '',
    category: '',
    tags: []
  }
  editingCommand.value = null
  formRef.value?.resetFields()
}
</script>

<style scoped>
.quick-command-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

.panel-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.command-input-section {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

.command-input-section :deep(.el-textarea__inner) {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.input-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.input-actions :deep(.el-checkbox) {
  margin-left: var(--spacing-xs);
}

.input-actions :deep(.el-checkbox__label) {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.filter-section {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

.command-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  color: var(--text-tertiary);
}

.empty-state p {
  margin-top: var(--spacing-sm);
  font-size: var(--text-sm);
}

.empty-state .hint {
  margin-top: var(--spacing-xs);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.command-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-xs);
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.command-item:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.command-info {
  flex: 1;
  min-width: 0;
}

.command-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.command-preview {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.command-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

.usage-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.command-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.command-item:hover .command-actions {
  opacity: 1;
}
</style>
