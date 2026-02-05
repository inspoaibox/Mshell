<template>
  <div class="template-panel">
    <div class="panel-header">
      <h3>端口转发模板</h3>
      <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
        新建模板
      </el-button>
    </div>

    <!-- 搜索和过�?-->
    <div class="filter-section">
      <el-input
        v-model="searchQuery"
        placeholder="搜索模板..."
        :prefix-icon="Search"
        clearable
        @input="handleSearch"
      />
      <el-select
        v-model="selectedTag"
        placeholder="按标签筛�?
        clearable
        @change="handleTagFilter"
      >
        <el-option
          v-for="tag in allTags"
          :key="tag"
          :label="tag"
          :value="tag"
        />
      </el-select>
    </div>

    <!-- 模板列表 -->
    <div class="template-list">
      <el-empty v-if="filteredTemplates.length === 0" description="暂无模板" />
      
      <div v-else class="template-grid">
        <div
          v-for="template in filteredTemplates"
          :key="template.id"
          class="template-card"
        >
          <div class="card-header">
            <h4>{{ template.name }}</h4>
            <el-dropdown @command="(cmd) => handleCommand(cmd, template)">
              <el-button text :icon="MoreFilled" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="edit">编辑</el-dropdown-item>
                  <el-dropdown-item command="duplicate">复制</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div class="card-body">
            <p class="description">{{ template.description || '无描�? }}</p>
            
            <div class="template-info">
              <div class="info-item">
                <el-tag :type="getTypeTagType(template.type)" size="small">
                  {{ getTypeLabel(template.type) }}
                </el-tag>
              </div>
              <div class="info-item">
                <span class="label">本地:</span>
                <span class="value">{{ template.localHost }}:{{ template.localPort }}</span>
              </div>
              <div v-if="template.type !== 'dynamic'" class="info-item">
                <span class="label">远程:</span>
                <span class="value">{{ template.remoteHost }}:{{ template.remotePort }}</span>
              </div>
              <div v-if="template.autoStart" class="info-item">
                <el-tag type="success" size="small">自动启动</el-tag>
              </div>
            </div>

            <div v-if="template.tags.length > 0" class="tags">
              <el-tag
                v-for="tag in template.tags"
                :key="tag"
                size="small"
                effect="plain"
              >
                {{ tag }}
              </el-tag>
            </div>
          </div>

          <div class="card-footer">
            <el-button
              type="primary"
              size="small"
              @click="handleUseTemplate(template)"
            >
              使用模板
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建/编辑模板对话�?-->
    <el-dialog
      v-model="showCreateDialog"
      :title="editingTemplate ? '编辑模板' : '新建模板'"
      width="600px"
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：MySQL转发" />
        </el-form-item>

        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="模板描述"
          />
        </el-form-item>

        <el-form-item label="转发类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio value="local">本地转发</el-radio>
            <el-radio value="remote">远程转发</el-radio>
            <el-radio value="dynamic">动态转�?/el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="本地主机" prop="localHost">
          <el-input v-model="form.localHost" placeholder="127.0.0.1" />
        </el-form-item>

        <el-form-item label="本地端口" prop="localPort">
          <el-input-number
            v-model="form.localPort"
            :min="1"
            :max="65535"
            placeholder="8080"
          />
        </el-form-item>

        <template v-if="form.type !== 'dynamic'">
          <el-form-item label="远程主机" prop="remoteHost">
            <el-input v-model="form.remoteHost" placeholder="localhost" />
          </el-form-item>

          <el-form-item label="远程端口" prop="remotePort">
            <el-input-number
              v-model="form.remotePort"
              :min="1"
              :max="65535"
              placeholder="3306"
            />
          </el-form-item>
        </template>

        <el-form-item label="自动启动">
          <el-switch v-model="form.autoStart" />
        </el-form-item>

        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="添加标签"
            style="width: 100%"
          >
            <el-option
              v-for="tag in allTags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 使用模板对话�?-->
    <el-dialog
      v-model="showUseDialog"
      title="使用模板创建转发"
      width="500px"
    >
      <el-form label-width="120px">
        <el-form-item label="选择连接">
          <el-select
            v-model="selectedConnectionId"
            placeholder="选择SSH连接"
            style="width: 100%"
          >
            <el-option
              v-for="session in sessions"
              :key="session.id"
              :label="session.name"
              :value="session.id"
            >
              <div style="display: flex; justify-content: space-between;">
                <span>{{ session.name }}</span>
                <span style="color: var(--text-tertiary); font-size: var(--text-sm);">
                  {{ session.username }}@{{ session.host }}
                </span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showUseDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmUseTemplate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, MoreFilled } from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

interface PortForwardTemplate {
  id: string
  name: string
  description: string
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  autoStart: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

const templates = ref<PortForwardTemplate[]>([])
const sessions = ref<SessionConfig[]>([])
const searchQuery = ref('')
const selectedTag = ref('')
const showCreateDialog = ref(false)
const showUseDialog = ref(false)
const editingTemplate = ref<PortForwardTemplate | null>(null)
const selectedTemplate = ref<PortForwardTemplate | null>(null)
const selectedConnectionId = ref('')
const formRef = ref()

const form = ref({
  name: '',
  description: '',
  type: 'local' as 'local' | 'remote' | 'dynamic',
  localHost: '127.0.0.1',
  localPort: 8080,
  remoteHost: 'localhost',
  remotePort: 3306,
  autoStart: false,
  tags: [] as string[]
})

const rules = {
  name: [{ required: true, message: '请输入模板名�?, trigger: 'blur' }],
  type: [{ required: true, message: '请选择转发类型', trigger: 'change' }],
  localHost: [{ required: true, message: '请输入本地主�?, trigger: 'blur' }],
  localPort: [{ required: true, message: '请输入本地端�?, trigger: 'blur' }]
}

const filteredTemplates = computed(() => {
  let result = templates.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(
      t =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
    )
  }

  if (selectedTag.value) {
    result = result.filter(t => t.tags.includes(selectedTag.value))
  }

  return result
})

const allTags = computed(() => {
  const tags = new Set<string>()
  templates.value.forEach(t => t.tags.forEach(tag => tags.add(tag)))
  return Array.from(tags).sort()
})

onMounted(() => {
  loadTemplates()
  loadSessions()
})

const loadTemplates = async () => {
  try {
    const result = await window.electronAPI.portForward.getAllTemplates()
    if (result.success) {
      templates.value = result.data || []
    }
  } catch (error: any) {
    ElMessage.error(`加载模板失败: ${error.message}`)
  }
}

const loadSessions = async () => {
  try {
    sessions.value = await window.electronAPI.session.getAll()
  } catch (error: any) {
    console.error('Failed to load sessions:', error)
  }
}

const handleSearch = () => {
  // 搜索已通过 computed 实现
}

const handleTagFilter = () => {
  // 过滤已通过 computed 实现
}

const handleCommand = async (command: string, template: PortForwardTemplate) => {
  if (command === 'edit') {
    editingTemplate.value = template
    form.value = {
      name: template.name,
      description: template.description,
      type: template.type,
      localHost: template.localHost,
      localPort: template.localPort,
      remoteHost: template.remoteHost,
      remotePort: template.remotePort,
      autoStart: template.autoStart,
      tags: [...template.tags]
    }
    showCreateDialog.value = true
  } else if (command === 'duplicate') {
    form.value = {
      name: `${template.name} (副本)`,
      description: template.description,
      type: template.type,
      localHost: template.localHost,
      localPort: template.localPort,
      remoteHost: template.remoteHost,
      remotePort: template.remotePort,
      autoStart: template.autoStart,
      tags: [...template.tags]
    }
    editingTemplate.value = null
    showCreateDialog.value = true
  } else if (command === 'delete') {
    try {
      await ElMessageBox.confirm(
        `确定要删除模�?"${template.name}" 吗？`,
        '确认删除',
        { type: 'warning' }
      )

      const result = await window.electronAPI.portForward.deleteTemplate(template.id)
      if (result.success) {
        ElMessage.success('删除成功')
        await loadTemplates()
      } else {
        ElMessage.error(`删除失败: ${result.error}`)
      }
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(`删除失败: ${error.message}`)
      }
    }
  }
}

const handleSave = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return

    try {
      const data = {
        name: form.value.name,
        description: form.value.description,
        type: form.value.type,
        localHost: form.value.localHost,
        localPort: form.value.localPort,
        remoteHost: form.value.remoteHost,
        remotePort: form.value.remotePort,
        autoStart: form.value.autoStart,
        tags: form.value.tags
      }

      let result
      if (editingTemplate.value) {
        result = await window.electronAPI.portForward.updateTemplate(
          editingTemplate.value.id,
          data
        )
      } else {
        result = await window.electronAPI.portForward.createTemplate(data)
      }

      if (result.success) {
        ElMessage.success(editingTemplate.value ? '更新成功' : '创建成功')
        showCreateDialog.value = false
        await loadTemplates()
      } else {
        ElMessage.error(`操作失败: ${result.error}`)
      }
    } catch (error: any) {
      ElMessage.error(`操作失败: ${error.message}`)
    }
  })
}

const handleUseTemplate = (template: PortForwardTemplate) => {
  selectedTemplate.value = template
  selectedConnectionId.value = ''
  showUseDialog.value = true
}

const confirmUseTemplate = async () => {
  if (!selectedTemplate.value || !selectedConnectionId.value) {
    ElMessage.warning('请选择连接')
    return
  }

  try {
    const result = await window.electronAPI.portForward.createFromTemplate(
      selectedTemplate.value.id,
      selectedConnectionId.value
    )

    if (result.success) {
      ElMessage.success('已从模板创建转发')
      showUseDialog.value = false
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`创建失败: ${error.message}`)
  }
}

const resetForm = () => {
  form.value = {
    name: '',
    description: '',
    type: 'local',
    localHost: '127.0.0.1',
    localPort: 8080,
    remoteHost: 'localhost',
    remotePort: 3306,
    autoStart: false,
    tags: []
  }
  editingTemplate.value = null
  formRef.value?.resetFields()
}

const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    local: '本地转发',
    remote: '远程转发',
    dynamic: '动态转�?
  }
  return labels[type] || type
}

const getTypeTagType = (type: string) => {
  const types: Record<string, any> = {
    local: 'primary',
    remote: 'success',
    dynamic: 'warning'
  }
  return types[type] || ''
}
</script>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
}

.panel-header {
  padding: 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}

.filter-section {
  padding: 16px;
  display: flex;
  gap: 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
}

.filter-section :deep(.el-input) {
  flex: 1;
}

.filter-section :deep(.el-select) {
  width: 200px;
}

.template-list {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.template-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.template-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-light);
}

.card-header h4 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.description {
  margin: 0;
  font-size: var(--text-md);
  color: var(--text-secondary);
  line-height: 1.5;
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-md);
}

.info-item .label {
  color: var(--text-tertiary);
  min-width: 40px;
}

.info-item .value {
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.card-footer {
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: flex-end;
}
</style>
