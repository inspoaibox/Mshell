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
        <el-button link type="primary" @click="showGuideDialog = true" class="guide-btn">
          <el-icon><Document /></el-icon>
          <span>使用指南</span>
        </el-button>
      </div>
      <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">创建模板</el-button>
    </div>

    <div class="panel-content">
      <el-table :data="templates" v-loading="loading">
        <el-table-column prop="name" label="模板名称" min-width="150" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="连接信息" min-width="200">
          <template #default="{ row }">
            <span class="connection-info">{{ row.username }}@{{ row.host }}:{{ row.port }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="provider" label="提供商" width="100" />
        <el-table-column label="标签" width="200">
          <template #default="{ row }">
            <el-tag v-for="tag in row.tags" :key="tag" size="small" style="margin-right: 4px">
              {{ tag }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="createFromTemplate(row)">使用</el-button>
            <el-button size="small" :icon="Edit" @click="editTemplate(row)">编辑</el-button>
            <el-button size="small" :icon="CopyDocument" @click="duplicateTemplate(row)">复制</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="deleteTemplate(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建/编辑对话框 -->
    <el-dialog v-model="showCreateDialog" :title="editingTemplate ? '编辑模板' : '创建模板'" width="600px">
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模板名称" required>
          <el-input v-model="templateForm.name" placeholder="如：阿里云生产服务器" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="templateForm.description" type="textarea" :rows="2" placeholder="模板用途说明" />
        </el-form-item>
        <el-divider content-position="left">连接配置</el-divider>
        <el-form-item label="主机">
          <el-input v-model="templateForm.host" placeholder="支持变量，如 ${ip} 或 server-${env}.example.com" />
          <div class="form-tip">使用 ${变量名} 格式定义变量，使用模板时会提示输入</div>
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="templateForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="templateForm.username" placeholder="支持变量，如 ${user} 或 admin" />
        </el-form-item>
        <el-form-item label="认证方式">
          <el-radio-group v-model="templateForm.authType">
            <el-radio value="password">密码</el-radio>
            <el-radio value="privateKey">私钥</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="templateForm.authType === 'privateKey'" label="私钥路径">
          <el-input v-model="templateForm.privateKeyPath" placeholder="私钥文件路径" />
        </el-form-item>
        <el-divider content-position="left">分类信息</el-divider>
        <el-form-item label="提供商">
          <el-input v-model="templateForm.provider" placeholder="如 AWS, Azure, 阿里云" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="templateForm.tags" multiple filterable allow-create style="width: 100%"
            placeholder="添加标签便于分类">
            <el-option v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 使用模板对话框 - 变量输入 -->
    <el-dialog v-model="showUseDialog" title="使用模板创建会话" width="550px">
      <div class="use-template-dialog">
        <div class="template-info">
          <div class="info-row">
            <span class="label">模板：</span>
            <span class="value">{{ usingTemplate?.name }}</span>
          </div>
          <div class="info-row">
            <span class="label">连接：</span>
            <span class="value preview-connection">{{ previewConnection }}</span>
          </div>
        </div>
        
        <el-divider v-if="templateVariables.length > 0" content-position="left">
          <el-icon><Edit /></el-icon> 填写变量值
        </el-divider>
        
        <el-form v-if="templateVariables.length > 0" :model="variableValues" label-width="120px">
          <el-form-item v-for="variable in templateVariables" :key="variable" :label="variable">
            <el-input v-model="variableValues[variable]" :placeholder="`请输入 ${variable} 的值`" />
          </el-form-item>
        </el-form>
        
        <div v-else class="no-variables">
          <el-icon><InfoFilled /></el-icon>
          <span>此模板没有变量，将直接使用模板配置创建会话</span>
        </div>
        
        <el-divider content-position="left">会话设置</el-divider>
        
        <el-form :model="sessionOptions" label-width="120px">
          <el-form-item label="会话名称">
            <el-input v-model="sessionOptions.name" placeholder="留空则使用模板名称" />
          </el-form-item>
          <el-form-item label="分组">
            <el-select v-model="sessionOptions.group" clearable placeholder="选择分组" style="width: 100%">
              <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="usingTemplate?.authType === 'password'" label="密码">
            <el-input v-model="sessionOptions.password" type="password" show-password placeholder="SSH 登录密码" />
          </el-form-item>
          <el-form-item label="创建后连接">
            <el-switch v-model="sessionOptions.autoConnect" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="showUseDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCreateSession" :loading="creating">创建会话</el-button>
      </template>
    </el-dialog>

    <!-- 使用指南对话框 -->
    <el-dialog v-model="showGuideDialog" title="会话模板使用指南" width="700px" class="guide-dialog">
      <div class="guide-content">
        <h3>📋 什么是会话模板？</h3>
        <p>会话模板是一种快速创建 SSH 会话的方式。当你有多台配置相似的服务器时，可以创建一个模板，然后通过变量替换快速生成多个会话，避免重复输入相同的配置。</p>
        
        <h3>🎯 适用场景</h3>
        <ul>
          <li><strong>批量服务器管理</strong> - 管理同一云厂商的多台服务器</li>
          <li><strong>多环境部署</strong> - 开发、测试、生产环境使用相似配置</li>
          <li><strong>团队协作</strong> - 导出模板分享给团队成员</li>
        </ul>
        
        <h3>📝 变量语法</h3>
        <p>在模板的主机名、用户名等字段中使用 <code>${变量名}</code> 格式定义变量。</p>
        <div class="code-example">
          <div class="example-item">
            <span class="field">主机：</span>
            <code>192.168.1.${num}</code>
            <span class="arrow">→</span>
            <span class="result">输入 num=10 → 192.168.1.10</span>
          </div>
          <div class="example-item">
            <span class="field">主机：</span>
            <code>server-${env}.example.com</code>
            <span class="arrow">→</span>
            <span class="result">输入 env=prod → server-prod.example.com</span>
          </div>
          <div class="example-item">
            <span class="field">用户名：</span>
            <code>admin-${role}</code>
            <span class="arrow">→</span>
            <span class="result">输入 role=web → admin-web</span>
          </div>
        </div>
        
        <h3>🚀 使用步骤</h3>
        <ol>
          <li><strong>创建模板</strong> - 点击"创建模板"，填写基础配置和变量</li>
          <li><strong>使用模板</strong> - 点击模板的"使用"按钮</li>
          <li><strong>填写变量</strong> - 在弹出的对话框中输入变量值</li>
          <li><strong>创建会话</strong> - 确认后自动创建会话，可选择立即连接</li>
        </ol>
        
        <h3>💡 实际案例</h3>
        <div class="case-study">
          <h4>案例：管理 10 台阿里云 ECS 服务器</h4>
          <p>假设你有 10 台服务器，IP 分别是 192.168.1.1 ~ 192.168.1.10，都使用 root 用户和 22 端口。</p>
          <div class="case-steps">
            <div class="step">
              <span class="step-num">1</span>
              <div class="step-content">
                <strong>创建模板</strong>
                <p>主机：<code>192.168.1.${ip}</code>，用户名：root，端口：22</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">2</span>
              <div class="step-content">
                <strong>使用模板</strong>
                <p>点击"使用"，输入 ip=1，创建第一个会话</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">3</span>
              <div class="step-content">
                <strong>重复创建</strong>
                <p>重复步骤 2，分别输入 ip=2, 3, 4... 快速创建所有会话</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, QuestionFilled, Document, CopyDocument, InfoFilled } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

const templates = ref<any[]>([])
const allTags = ref<string[]>([])
const groups = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const creating = ref(false)
const showCreateDialog = ref(false)
const showUseDialog = ref(false)
const showGuideDialog = ref(false)
const editingTemplate = ref<any>(null)
const usingTemplate = ref<any>(null)

const templateForm = ref({
  name: '',
  description: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password' as 'password' | 'privateKey',
  privateKeyPath: '',
  provider: '',
  tags: [] as string[]
})

// 变量值
const variableValues = ref<Record<string, string>>({})

// 会话选项
const sessionOptions = ref({
  name: '',
  group: '',
  password: '',
  autoConnect: true
})

// 从模板中提取变量
const templateVariables = computed(() => {
  if (!usingTemplate.value) return []
  const vars = new Set<string>()
  const regex = /\$\{(\w+)\}/g
  const fields = ['host', 'username', 'privateKeyPath']
  
  for (const field of fields) {
    const value = usingTemplate.value[field] || ''
    let match
    while ((match = regex.exec(value)) !== null) {
      vars.add(match[1])
    }
  }
  return Array.from(vars)
})

// 预览连接信息
const previewConnection = computed(() => {
  if (!usingTemplate.value) return ''
  let host = usingTemplate.value.host || ''
  let username = usingTemplate.value.username || ''
  
  // 替换变量
  for (const [key, value] of Object.entries(variableValues.value)) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g')
    host = host.replace(regex, value || `\${${key}}`)
    username = username.replace(regex, value || `\${${key}}`)
  }
  
  return `${username}@${host}:${usingTemplate.value.port}`
})

onMounted(() => {
  loadTemplates()
  loadTags()
  loadGroups()
})

const loadTemplates = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.sessionTemplate?.getAll?.()
    if (result?.success) {
      templates.value = result.data || []
      
      // 如果没有模板，添加内置示例模板
      if (templates.value.length === 0) {
        await createBuiltinTemplates()
        // 重新加载
        const reloadResult = await window.electronAPI.sessionTemplate?.getAll?.()
        if (reloadResult?.success) {
          templates.value = reloadResult.data || []
        }
      }
    }
  } catch (error) {
    ElMessage.error('加载模板失败')
  } finally {
    loading.value = false
  }
}

// 创建内置示例模板
const createBuiltinTemplates = async () => {
  const builtinTemplates = [
    {
      name: '云服务器模板',
      description: '适用于阿里云、腾讯云等云服务器，使用 ${ip} 变量快速创建多台服务器会话',
      host: '${ip}',
      port: 22,
      username: 'root',
      authType: 'password' as const,
      provider: '云服务器',
      tags: ['示例', '云服务器']
    },
    {
      name: '开发环境模板',
      description: '适用于开发、测试、生产多环境部署，使用 ${env} 变量区分环境',
      host: 'server-${env}.example.com',
      port: 22,
      username: 'deploy',
      authType: 'privateKey' as const,
      privateKeyPath: '~/.ssh/id_rsa',
      provider: '内部服务器',
      tags: ['示例', '多环境']
    },
    {
      name: 'AWS EC2 模板',
      description: 'AWS EC2 实例模板，使用 ${instance_ip} 变量和 ec2-user 用户',
      host: '${instance_ip}',
      port: 22,
      username: 'ec2-user',
      authType: 'privateKey' as const,
      privateKeyPath: '~/.ssh/aws-key.pem',
      provider: 'AWS',
      tags: ['示例', 'AWS', 'EC2']
    }
  ]
  
  for (const template of builtinTemplates) {
    try {
      await window.electronAPI.sessionTemplate?.create?.(template)
    } catch (error) {
      console.error('Failed to create builtin template:', error)
    }
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

const loadGroups = async () => {
  try {
    const result = await window.electronAPI.session?.getAllGroups?.()
    if (result) {
      groups.value = result
    }
  } catch (error) {
    console.error('Failed to load groups:', error)
  }
}

const saveTemplate = async () => {
  if (!templateForm.value.name) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (!templateForm.value.host) {
    ElMessage.warning('请输入主机地址')
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
  templateForm.value = { 
    ...template,
    authType: template.authType || 'password'
  }
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

const duplicateTemplate = async (template: any) => {
  try {
    const result = await window.electronAPI.sessionTemplate?.duplicate?.(template.id)
    if (result?.success) {
      ElMessage.success('模板已复制')
      loadTemplates()
    }
  } catch (error: any) {
    ElMessage.error(error.message || '复制失败')
  }
}

// 打开使用模板对话框
const createFromTemplate = (template: any) => {
  usingTemplate.value = template
  variableValues.value = {}
  sessionOptions.value = {
    name: '',
    group: '',
    password: '',
    autoConnect: true
  }
  showUseDialog.value = true
}

// 替换字符串中的变量
const replaceVariables = (str: string): string => {
  if (!str) return str
  let result = str
  for (const [key, value] of Object.entries(variableValues.value)) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g')
    result = result.replace(regex, value)
  }
  return result
}

// 确认创建会话
const confirmCreateSession = async () => {
  // 检查所有变量是否已填写
  for (const variable of templateVariables.value) {
    if (!variableValues.value[variable]) {
      ElMessage.warning(`请填写变量 ${variable} 的值`)
      return
    }
  }

  creating.value = true
  try {
    const template = usingTemplate.value
    
    // 构建会话配置 - 注意：IPC 不能传递 undefined，需要过滤掉
    const sessionConfig: Record<string, any> = {
      name: sessionOptions.value.name || replaceVariables(template.name) || `${template.name} - ${Date.now()}`,
      host: replaceVariables(template.host),
      port: template.port,
      username: replaceVariables(template.username),
      authType: template.authType || 'password',
      description: `从模板 "${template.name}" 创建`
    }
    
    // 只添加有值的可选字段（避免 undefined 导致 IPC 序列化错误）
    if (template.authType === 'privateKey' && template.privateKeyPath) {
      sessionConfig.privateKeyPath = replaceVariables(template.privateKeyPath)
    }
    if (sessionOptions.value.password) {
      sessionConfig.password = sessionOptions.value.password
    }
    if (sessionOptions.value.group) {
      sessionConfig.group = sessionOptions.value.group
    }
    if (template.provider) {
      sessionConfig.provider = template.provider
    }

    // 创建会话
    const result = await window.electronAPI.session?.create?.(sessionConfig)
    
    if (result) {
      ElMessage.success('会话已创建')
      showUseDialog.value = false
      
      // 刷新会话列表
      await appStore.loadSessions()
      
      // 如果选择了自动连接
      if (sessionOptions.value.autoConnect) {
        // 切换到会话视图并连接
        appStore.setActiveView('sessions')
        // 触发连接 - 通过创建新标签页
        setTimeout(() => {
          appStore.addTab({
            id: `tab-${Date.now()}`,
            name: sessionConfig.name,
            sessionId: result.id
          })
        }, 100)
      }
    }
  } catch (error: any) {
    ElMessage.error(error.message || '创建会话失败')
  } finally {
    creating.value = false
  }
}

const resetForm = () => {
  editingTemplate.value = null
  templateForm.value = {
    name: '',
    description: '',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    privateKeyPath: '',
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
  font-size: var(--text-2xl);
}

.help-icon {
  color: var(--text-secondary);
  cursor: help;
  transition: color 0.2s;
}

.help-icon:hover {
  color: var(--primary-color);
}

.guide-btn {
  font-size: var(--text-md);
  padding: 4px 8px;
}

.guide-btn .el-icon {
  margin-right: 4px;
}

.feature-help {
  max-width: 400px;
  padding: 8px;
}

.feature-help h4 {
  margin: 12px 0 8px 0;
  font-size: var(--text-base);
  color: var(--text-primary);
}

.feature-help h4:first-child {
  margin-top: 0;
}

.feature-help p {
  margin: 0 0 8px 0;
  font-size: var(--text-md);
  line-height: 1.6;
  color: var(--text-secondary);
}

.feature-help ol,
.feature-help ul {
  margin: 0;
  padding-left: 20px;
  font-size: var(--text-md);
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

.connection-info {
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  color: var(--primary-color);
}

.form-tip {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 4px;
}

/* 使用模板对话框 */
.use-template-dialog {
  padding: 0 10px;
}

.template-info {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-row .label {
  color: var(--text-secondary);
  width: 60px;
  flex-shrink: 0;
}

.info-row .value {
  color: var(--text-primary);
  font-weight: 500;
}

.preview-connection {
  font-family: 'JetBrains Mono', monospace;
  color: var(--primary-color) !important;
}

.no-variables {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: var(--text-md);
}

/* 使用指南对话框 */
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

.guide-content ul,
.guide-content ol {
  margin: 0 0 16px 0;
  padding-left: 24px;
  font-size: var(--text-base);
  line-height: 1.8;
  color: var(--text-secondary);
}

.guide-content li {
  margin-bottom: 8px;
}

.guide-content code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-md);
  color: var(--primary-color);
}

.code-example {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}

.example-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: var(--text-md);
  flex-wrap: wrap;
}

.example-item:last-child {
  margin-bottom: 0;
}

.example-item .field {
  color: var(--text-secondary);
  width: 60px;
  flex-shrink: 0;
}

.example-item .arrow {
  color: var(--text-secondary);
  margin: 0 4px;
}

.example-item .result {
  color: var(--success-color);
  font-size: var(--text-sm);
}

.case-study {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.05), rgba(139, 92, 246, 0.05));
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
  margin-top: 12px;
}

.case-study h4 {
  margin: 0 0 8px 0;
  font-size: var(--text-base);
  color: var(--primary-color);
}

.case-study > p {
  margin-bottom: 16px;
}

.case-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.step-num {
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

.step-content {
  flex: 1;
}

.step-content strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.step-content p {
  margin: 0;
  font-size: var(--text-md);
}

:deep(.el-divider__text) {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--text-md);
}
</style>
