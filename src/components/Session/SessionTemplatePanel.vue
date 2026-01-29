<template>
  <div class="session-template-panel">
    <div class="panel-header">
      <div class="header-left">
        <h2>会话模板</h2>
        <el-tooltip placement="bottom" effect="light" :show-after="300">
          <template #content>
            <div class="feature-help">
              <h4>功能说明</h4>
              <p>会话模板用于快速创建具有相似配置的SSH会话，支持变量替换功能。</p>
              <h4>使用方法</h4>
              <ol>
                <li>创建模板：定义主机、端口、用户名等基础配置</li>
                <li>使用变量：在配置中使用 ${variable} 格式的变量占位符</li>
                <li>应用模板：点击"使用"按钮，系统会提示输入变量值</li>
                <li>快速创建：自动生成新的会话配置，无需重复输入</li>
              </ol>
              <h4>变量示例</h4>
              <ul>
                <li>主机：${server_ip} 或 server-${env}.example.com</li>
                <li>用户名：${username} 或 admin-${role}</li>
                <li>端口：${port} 或固定值 22</li>
              </ul>
            </div>
          </template>
          <el-icon class="help-icon" :size="18"><QuestionFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">创建模板</el-button>
    </div>

    <div class="panel-content">
      <el-table :data="templates" v-loading="loading">
        <el-table-column prop="name" label="模板名称" min-width="150" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="provider" label="提供商" width="100" />
        <el-table-column label="标签" width="200">
          <template #default="{ row }">
            <el-tag v-for="tag in row.tags" :key="tag" size="small" style="margin-right: 4px">
              {{ tag }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="createFromTemplate(row)">使用</el-button>
            <el-button size="small" :icon="Edit" @click="editTemplate(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteTemplate(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingTemplate ? '编辑模板' : '创建模板'" width="600px">
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模板名称">
          <el-input v-model="templateForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="templateForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="主机">
          <el-input v-model="templateForm.host" placeholder="支持变量 ${variable}" />
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="templateForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="templateForm.username" placeholder="支持变量 ${variable}" />
        </el-form-item>
        <el-form-item label="提供商">
          <el-input v-model="templateForm.provider" placeholder="如: AWS, Azure, Aliyun" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="templateForm.tags" multiple filterable allow-create style="width: 100%">
            <el-option v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, QuestionFilled } from '@element-plus/icons-vue'

const templates = ref<any[]>([])
const allTags = ref<string[]>([])
const loading = ref(false)
const saving = ref(false)
const showCreateDialog = ref(false)
const editingTemplate = ref<any>(null)

const templateForm = ref({
  name: '',
  description: '',
  host: '',
  port: 22,
  username: '',
  provider: '',
  tags: [] as string[]
})

onMounted(() => {
  loadTemplates()
  loadTags()
})

const loadTemplates = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.sessionTemplate?.getAll?.()
    if (result?.success) {
      templates.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载模板失败')
  } finally {
    loading.value = false
  }
}

const loadTags = async () => {
  try {
    const result = await window.electronAPI.sessionTemplate?.getAllTags?.()
    if (result?.success) {
      allTags.value = result.data || []
    }
  } catch (error) {
    console.error('Failed to load tags:', error)
  }
}

const saveTemplate = async () => {
  if (!templateForm.value.name) {
    ElMessage.warning('请输入模板名称')
    return
  }

  saving.value = true
  try {
    const result = editingTemplate.value
      ? await window.electronAPI.sessionTemplate?.update?.(editingTemplate.value.id, templateForm.value)
      : await window.electronAPI.sessionTemplate?.create?.(templateForm.value)

    if (result?.success) {
      ElMessage.success(editingTemplate.value ? '模板已更新' : '模板已创建')
      showCreateDialog.value = false
      resetForm()
      loadTemplates()
    }
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const editTemplate = (template: any) => {
  editingTemplate.value = template
  templateForm.value = { ...template }
  showCreateDialog.value = true
}

const deleteTemplate = async (template: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除模板 "${template.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.sessionTemplate?.delete?.(template.id)
    if (result?.success) {
      ElMessage.success('模板已删除')
      loadTemplates()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const createFromTemplate = async (template: any) => {
  try {
    const result = await window.electronAPI.sessionTemplate?.createSession?.(template.id)
    if (result?.success) {
      ElMessage.success('会话已创建')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '创建会话失败')
  }
}

const resetForm = () => {
  editingTemplate.value = null
  templateForm.value = {
    name: '',
    description: '',
    host: '',
    port: 22,
    username: '',
    provider: '',
    tags: []
  }
}
</script>

<style scoped>
.session-template-panel {
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
  font-size: 20px;
}

.help-icon {
  color: var(--text-secondary);
  cursor: help;
  transition: color 0.2s;
}

.help-icon:hover {
  color: var(--primary-color);
}

.feature-help {
  max-width: 400px;
  padding: 8px;
}

.feature-help h4 {
  margin: 12px 0 8px 0;
  font-size: 14px;
  color: var(--text-primary);
}

.feature-help h4:first-child {
  margin-top: 0;
}

.feature-help p {
  margin: 0 0 8px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.feature-help ol,
.feature-help ul {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.feature-help li {
  margin-bottom: 4px;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  min-height: 0;
}
</style>
