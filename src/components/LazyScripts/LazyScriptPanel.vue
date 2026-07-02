<template>
  <div class="lazy-script-shell">
    <div class="lazy-script-panel">
      <aside class="script-sidebar">
      <div class="sidebar-top">
        <div>
          <h2>懒人脚本</h2>
          <p>{{ scripts.length }} 个脚本</p>
        </div>
        <el-tooltip content="新增脚本" placement="bottom">
          <el-button type="primary" :icon="Plus" circle @click="openEditor()" />
        </el-tooltip>
      </div>

      <el-input
        v-model="searchQuery"
        class="script-search"
        :prefix-icon="Search"
        placeholder="搜索脚本、文件名、标签"
        clearable
      />

      <div class="category-list">
        <button
          v-for="category in categoryItems"
          :key="category.key"
          type="button"
          class="category-item"
          :class="{ active: selectedCategory === category.key }"
          @click="selectedCategory = category.key"
        >
          <span>{{ category.label }}</span>
          <strong>{{ category.count }}</strong>
        </button>
      </div>

      <div class="script-actions">
        <el-tooltip content="导入脚本库" placement="top">
          <el-button :icon="Upload" @click="importScripts" />
        </el-tooltip>
        <el-tooltip content="导出脚本库" placement="top">
          <el-button :icon="Download" @click="exportScripts" />
        </el-tooltip>
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" @click="loadScripts" />
        </el-tooltip>
      </div>
      </aside>

      <section class="script-list">
      <el-scrollbar>
        <button
          v-for="script in filteredScripts"
          :key="script.id"
          type="button"
          class="script-item"
          :class="{ active: selectedScript?.id === script.id }"
          @click="selectScript(script)"
        >
          <div class="script-item-main">
            <span class="script-name">{{ script.name }}</span>
            <span class="script-file-name">{{ script.fileName }}</span>
            <span class="script-desc">{{ script.description || script.content }}</span>
          </div>
          <div class="script-item-meta">
            <el-tag size="small" :type="riskTagType(script.riskLevel)" effect="plain">
              {{ riskLabel(script.riskLevel) }}
            </el-tag>
            <span>{{ script.usageCount }}</span>
          </div>
        </button>

        <el-empty
          v-if="!loading && filteredScripts.length === 0"
          description="暂无匹配脚本"
          :image-size="96"
        />
      </el-scrollbar>
      </section>

      <main class="script-detail">
      <div v-if="selectedScript" class="detail-shell">
        <header class="detail-header">
          <div class="detail-title">
            <div class="title-icon">
              <el-icon><MagicStick /></el-icon>
            </div>
            <div>
              <h3>{{ selectedScript.name }}</h3>
              <p>{{ selectedScript.description || '没有描述' }}</p>
            </div>
          </div>

          <div class="detail-actions">
            <el-tooltip content="编辑" placement="bottom">
              <el-button :icon="Edit" circle @click="openEditor(selectedScript)" />
            </el-tooltip>
            <el-tooltip content="删除" placement="bottom">
              <el-button :icon="Delete" circle type="danger" plain @click="deleteScript(selectedScript)" />
            </el-tooltip>
          </div>
        </header>

        <div class="detail-meta">
          <el-tag effect="plain">{{ selectedScript.category || '未分类' }}</el-tag>
          <el-tag effect="plain" type="info">{{ activeScriptFileName }}</el-tag>
          <el-tag effect="plain" :type="riskTagType(selectedScript.riskLevel)">
            {{ riskLabel(selectedScript.riskLevel) }}
          </el-tag>
          <el-tag effect="plain" type="info">{{ typeLabel(selectedScript.type) }}</el-tag>
          <el-tag
            v-for="tag in selectedScript.tags"
            :key="tag"
            effect="plain"
            type="info"
          >
            {{ tag }}
          </el-tag>
        </div>

        <section v-if="!isCommandScript" class="script-file-section">
          <div class="script-file-info">
            <span>远程路径</span>
            <code>{{ remoteScriptPath }}</code>
          </div>
          <div class="script-file-info">
            <span>运行命令</span>
            <code>{{ runCommand }}</code>
          </div>
        </section>

        <section v-if="showSshKeyHelper" class="ssh-key-helper-section">
          <div class="section-title">
            <span>SSH 密钥辅助</span>
            <small>生成或选择密钥后自动填入公钥变量</small>
          </div>
          <div class="ssh-key-helper-row">
            <el-select
              v-model="selectedSshKeyId"
              class="ssh-key-select"
              placeholder="选择已有 SSH 密钥"
              filterable
              clearable
              :loading="sshKeysLoading"
              @focus="loadSshKeys"
              @change="applySelectedPublicKey"
            >
              <el-option
                v-for="key in sshKeys"
                :key="key.id"
                :label="`${key.name} (${key.type.toUpperCase()})`"
                :value="key.id"
              >
                <div class="ssh-key-option">
                  <span>{{ key.name }}</span>
                  <small>{{ key.type.toUpperCase() }} · {{ key.fingerprint }}</small>
                </div>
              </el-option>
            </el-select>
            <el-tooltip content="刷新 SSH 密钥列表" placement="top">
              <el-button :icon="Refresh" :loading="sshKeysLoading" @click="loadSshKeys">
                <span class="ssh-key-action-text">刷新</span>
              </el-button>
            </el-tooltip>
            <el-tooltip content="手动添加 SSH 密钥并填入公钥" placement="top">
              <el-button :icon="Plus" @click="openManualKeyDialog">
                <span class="ssh-key-action-text">手动添加</span>
              </el-button>
            </el-tooltip>
            <el-tooltip content="生成 SSH 密钥并填入公钥" placement="top">
              <el-button type="primary" :icon="MagicStick" @click="openGenerateKeyDialog">
                <span class="ssh-key-action-text">生成并填入</span>
              </el-button>
            </el-tooltip>
          </div>
          <p v-if="selectedSshKey" class="ssh-key-helper-note">
            已选择：{{ selectedSshKey.name }}，公钥会写入脚本变量 public_key。
          </p>
        </section>

        <section v-if="selectedScript.variables.length" class="variables-section">
          <div class="section-title">
            <span>变量</span>
            <small>部署前替换到脚本文件内容</small>
          </div>
          <div class="variable-grid">
            <label
              v-for="variable in selectedScript.variables"
              :key="variable.name"
              class="variable-field"
            >
              <span>
                {{ variable.label || variable.name }}
                <em v-if="variable.required">*</em>
              </span>
              <el-select
                v-if="variable.type === 'select'"
                v-model="executionValues[variable.name]"
                placeholder="请选择"
              >
                <el-option
                  v-for="option in variable.options || []"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
              <el-input-number
                v-else-if="variable.type === 'number'"
                v-model="numberExecutionValues[variable.name]"
                controls-position="right"
                @change="syncNumberVariable(variable.name)"
              />
              <el-input
                v-else
                v-model="executionValues[variable.name]"
                :type="variable.type === 'password' ? 'password' : variable.type === 'textarea' ? 'textarea' : 'text'"
                :rows="variable.type === 'textarea' ? 4 : undefined"
                :show-password="variable.type === 'password'"
              />
            </label>
          </div>
        </section>

        <section class="preview-section">
          <div class="section-title">
            <span>{{ isCommandScript ? '命令预览' : '脚本文件预览' }}</span>
            <small>{{ isCommandScript ? '单条命令将直接发送到终端' : activeTerminalText }}</small>
          </div>
          <pre class="script-preview"><code>{{ renderedContent }}</code></pre>
        </section>

        <footer class="run-bar">
          <div class="run-hint">
            默认动作：{{ runModeLabel(selectedScript.runMode, selectedScript.type) }}
          </div>
          <div class="run-actions">
            <el-tooltip :content="isCommandScript ? '复制命令' : '复制运行命令'" placement="top">
              <el-button :icon="DocumentCopy" @click="copyRunCommand">
                <span class="run-action-text">{{ isCommandScript ? '复制命令' : '复制运行命令' }}</span>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="!isCommandScript" content="复制部署命令" placement="top">
              <el-button :icon="DocumentCopy" @click="copyDeployCommand">
                <span class="run-action-text">复制部署命令</span>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="!isCommandScript" content="部署到终端" placement="top">
              <el-button
                :icon="Promotion"
                :disabled="!hasActiveTerminal || executingScript"
                :loading="executingScript"
                @click="deployScript"
              >
                <span class="run-action-text">部署到终端</span>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="isCommandScript ? '运行命令' : '运行脚本'" placement="top">
              <el-button
                type="primary"
                :icon="VideoPlay"
                :disabled="!hasActiveTerminal || executingScript"
                :loading="executingScript"
                @click="runScript"
              >
                <span class="run-action-text">{{ isCommandScript ? '运行命令' : '运行脚本' }}</span>
              </el-button>
            </el-tooltip>
          </div>
        </footer>
      </div>

      <el-empty v-else description="请选择或新建一个脚本" :image-size="128">
        <el-button type="primary" :icon="Plus" @click="openEditor()">新增脚本</el-button>
      </el-empty>
      </main>
    </div>

    <el-dialog
      v-model="showEditor"
      :title="editingScriptId ? '编辑懒人脚本' : '新增懒人脚本'"
      width="760px"
      class="lazy-script-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <div class="form-grid three">
          <el-form-item label="脚本名称" required>
            <el-input v-model="scriptForm.name" placeholder="例如：修改 SSH 端口" />
          </el-form-item>
          <el-form-item label="脚本文件名" required>
            <el-input v-model="scriptForm.fileName" placeholder="例如：2.sh 或 init-ssh.sh" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="scriptForm.category" placeholder="例如：SSH 加固" />
          </el-form-item>
        </div>

        <el-form-item label="描述">
          <el-input v-model="scriptForm.description" placeholder="简短说明脚本用途" />
        </el-form-item>

        <div class="form-grid three">
          <el-form-item label="脚本类型">
            <el-select v-model="scriptForm.type">
              <el-option label="单条命令" value="command" />
              <el-option label="Shell 脚本" value="shell" />
              <el-option label="操作步骤" value="steps" />
            </el-select>
          </el-form-item>
          <el-form-item label="风险级别">
            <el-select v-model="scriptForm.riskLevel">
              <el-option label="低风险" value="low" />
              <el-option label="中风险" value="medium" />
              <el-option label="高风险" value="high" />
            </el-select>
          </el-form-item>
          <el-form-item label="默认动作">
            <el-select v-model="scriptForm.runMode">
              <el-option label="复制运行命令" value="copy" />
              <el-option label="部署到终端" value="paste" />
              <el-option label="运行脚本" value="execute" />
            </el-select>
          </el-form-item>
        </div>

        <el-form-item label="标签">
          <el-input v-model="scriptForm.tagsText" placeholder="多个标签用逗号分隔" />
        </el-form-item>

        <el-form-item label="脚本内容" required>
          <el-input
            v-model="scriptForm.content"
            type="textarea"
            :rows="12"
            placeholder="写入远程脚本文件的内容，支持 {{变量名}} 或 ${变量名}"
          />
        </el-form-item>

        <div class="variable-editor-head">
          <div>
            <h4>变量配置</h4>
            <p>变量名只能使用字母、数字和下划线，且不能以数字开头。</p>
          </div>
          <div>
            <el-button :icon="MagicStick" @click="detectVariables">识别变量</el-button>
            <el-button type="primary" plain :icon="Plus" @click="addVariable">添加变量</el-button>
          </div>
        </div>

        <div class="variable-editor">
          <div
            v-for="(variable, index) in scriptForm.variables"
            :key="`${variable.name}-${index}`"
            class="variable-row"
          >
            <el-input v-model="variable.name" placeholder="变量名" />
            <el-input v-model="variable.label" placeholder="显示名称" />
            <el-select v-model="variable.type">
              <el-option label="文本" value="text" />
              <el-option label="数字" value="number" />
              <el-option label="密码" value="password" />
              <el-option label="多行文本" value="textarea" />
              <el-option label="选项" value="select" />
            </el-select>
            <el-input v-model="variable.defaultValue" placeholder="默认值" />
            <el-input
              v-if="variable.type === 'select'"
              v-model="variable.optionsText"
              placeholder="选项，逗号分隔"
            />
            <el-checkbox v-model="variable.required">必填</el-checkbox>
            <el-button :icon="Delete" text type="danger" @click="removeVariable(index)" />
          </div>
          <el-empty
            v-if="scriptForm.variables.length === 0"
            description="暂无变量"
            :image-size="72"
          />
        </div>
      </el-form>

      <template #footer>
        <el-button @click="showEditor = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveScript">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showGenerateKeyDialog"
      title="生成 SSH 密钥并填入公钥"
      width="520px"
      class="lazy-script-key-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <el-form-item label="密钥名称" required>
          <el-input v-model="generateKeyForm.name" placeholder="例如：server-admin-key" />
        </el-form-item>
        <div class="form-grid two">
          <el-form-item label="密钥类型">
            <el-select v-model="generateKeyForm.type">
              <el-option label="RSA" value="rsa" />
              <el-option label="ED25519" value="ed25519" />
              <el-option label="ECDSA" value="ecdsa" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="generateKeyForm.type !== 'ed25519'" label="密钥长度">
            <el-select v-model="generateKeyForm.bits">
              <el-option
                v-for="bits in availableKeyBits"
                :key="bits"
                :label="`${bits} 位`"
                :value="bits"
              />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="私钥密码">
          <el-input
            v-model="generateKeyForm.passphrase"
            type="password"
            show-password
            placeholder="可选，留空则不加密私钥"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="generateKeyForm.comment" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateKeyDialog = false">取消</el-button>
        <el-button type="primary" :loading="generatingKey" @click="generateAndFillKey">
          生成并填入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showManualKeyDialog"
      title="手动添加 SSH 密钥并填入公钥"
      width="720px"
      class="lazy-script-key-dialog"
      destroy-on-close
    >
      <el-form label-position="top" class="script-form">
        <el-form-item label="密钥名称" required>
          <el-input v-model="manualKeyForm.name" placeholder="例如：existing-server-key" />
        </el-form-item>
        <el-form-item label="私钥内容" required>
          <el-input
            v-model="manualKeyForm.privateKey"
            type="textarea"
            :rows="8"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </el-form-item>
        <el-form-item label="公钥内容">
          <el-input
            v-model="manualKeyForm.publicKey"
            type="textarea"
            :rows="3"
            placeholder="ssh-rsa AAAA...，留空会尝试根据私钥生成"
          />
        </el-form-item>
        <div class="form-grid two">
          <el-form-item label="私钥密码">
            <el-input
              v-model="manualKeyForm.passphrase"
              type="password"
              show-password
              placeholder="私钥有密码时填写"
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="manualKeyForm.comment" placeholder="可选" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showManualKeyDialog = false">取消</el-button>
        <el-button type="primary" :loading="addingKey" @click="addManualKeyAndFill">
          添加并填入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete,
  DocumentCopy,
  Download,
  Edit,
  MagicStick,
  Plus,
  Promotion,
  Refresh,
  Search,
  Upload,
  VideoPlay
} from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { terminalManager } from '@/utils/terminal-manager'

type LazyScriptType = 'command' | 'shell' | 'steps'
type LazyScriptRunMode = 'copy' | 'paste' | 'execute'
type LazyScriptRiskLevel = 'low' | 'medium' | 'high'
type LazyScriptVariableType = 'text' | 'number' | 'password' | 'textarea' | 'select'
type SSHKeyType = 'rsa' | 'ed25519' | 'ecdsa'

interface LazyScriptVariable {
  name: string
  label: string
  type: LazyScriptVariableType
  defaultValue?: string
  required?: boolean
  options?: string[]
}

interface LazyScript {
  id: string
  name: string
  fileName: string
  description: string
  category: string
  tags: string[]
  type: LazyScriptType
  content: string
  variables: LazyScriptVariable[]
  riskLevel: LazyScriptRiskLevel
  runMode: LazyScriptRunMode
  usageCount: number
  createdAt: string
  updatedAt: string
}

interface EditableVariable extends LazyScriptVariable {
  optionsText?: string
}

interface SSHKey {
  id: string
  name: string
  type: SSHKeyType
  bits?: number
  publicKey: string
  fingerprint: string
  comment?: string
  protected?: boolean
  createdAt?: string
}

const appStore = useAppStore()
const scripts = ref<LazyScript[]>([])
const selectedScript = ref<LazyScript | null>(null)
const selectedCategory = ref('__all__')
const searchQuery = ref('')
const loading = ref(false)
const saving = ref(false)
const executingScript = ref(false)
const showEditor = ref(false)
const editingScriptId = ref('')
const sshKeys = ref<SSHKey[]>([])
const sshKeysLoading = ref(false)
const selectedSshKeyId = ref('')
const showGenerateKeyDialog = ref(false)
const showManualKeyDialog = ref(false)
const generatingKey = ref(false)
const addingKey = ref(false)
const executionValues = reactive<Record<string, string>>({})
const numberExecutionValues = reactive<Record<string, number | undefined>>({})

const scriptForm = reactive({
  name: '',
  fileName: '',
  description: '',
  category: '',
  tagsText: '',
  type: 'shell' as LazyScriptType,
  content: '',
  variables: [] as EditableVariable[],
  riskLevel: 'medium' as LazyScriptRiskLevel,
  runMode: 'paste' as LazyScriptRunMode
})

const generateKeyForm = reactive({
  name: '',
  type: 'rsa' as SSHKeyType,
  bits: 4096,
  passphrase: '',
  comment: ''
})

const manualKeyForm = reactive({
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: '',
  comment: ''
})

const hasActiveTerminal = computed(() => Boolean(appStore.activeTab))
const isCommandScript = computed(() => selectedScript.value?.type === 'command')
const activeTerminalText = computed(() => {
  const tab = appStore.tabs.find((item) => item.id === appStore.activeTab)
  if (!tab) return '未选择终端'
  return `当前终端：${tab.session.username}@${tab.session.host}`
})

const activeScriptFileName = computed(() =>
  normalizeScriptFileName(selectedScript.value?.fileName || selectedScript.value?.name || 'script.sh')
)
const remoteScriptsDir = '~/.mshell/scripts'
const scriptExecutionTimeoutMs = 10 * 60 * 1000
const remoteScriptPath = computed(() => `${remoteScriptsDir}/${activeScriptFileName.value}`)
const quotedRemoteScriptPath = computed(
  () => `${remoteScriptsDir}/${shellQuotePathSegment(activeScriptFileName.value)}`
)
const runCommand = computed(() => `bash ${quotedRemoteScriptPath.value}`)
const publicKeyVariable = computed(() =>
  selectedScript.value?.variables.find((variable) => variable.name === 'public_key') || null
)
const showSshKeyHelper = computed(() => Boolean(publicKeyVariable.value))
const selectedSshKey = computed(
  () => sshKeys.value.find((key) => key.id === selectedSshKeyId.value) || null
)
const availableKeyBits = computed(() =>
  generateKeyForm.type === 'ecdsa' ? [256, 384, 521] : [2048, 3072, 4096]
)

const categoryItems = computed(() => {
  const counts = new Map<string, number>()
  scripts.value.forEach((script) => {
    const category = script.category.trim() || '__uncategorized'
    counts.set(category, (counts.get(category) || 0) + 1)
  })

  const items = [
    { key: '__all__', label: '全部脚本', count: scripts.value.length },
    ...Array.from(counts.entries()).map(([key, count]) => ({
      key,
      label: key === '__uncategorized' ? '未分类' : key,
      count
    }))
  ]

  return items
})

const filteredScripts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return scripts.value.filter((script) => {
    const category = script.category.trim() || '__uncategorized'
    const matchesCategory = selectedCategory.value === '__all__' || selectedCategory.value === category
    const matchesQuery =
      !query ||
      [script.name, script.fileName, script.description, script.category, script.content, script.tags.join(' ')]
        .join('\n')
        .toLowerCase()
        .includes(query)

    return matchesCategory && matchesQuery
  })
})

const renderedContent = computed(() => {
  if (!selectedScript.value) return ''
  let result = selectedScript.value.content
  Object.entries(executionValues).forEach(([name, value]) => {
    const escaped = escapeRegExp(name)
    result = result.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), value || '')
    result = result.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), value || '')
  })
  return result
})

watch(selectedScript, (script) => {
  resetExecutionValues(script)
  selectedSshKeyId.value = ''
  if (script?.variables.some((variable) => variable.name === 'public_key')) {
    loadSshKeys(false)
  }
})

watch(
  () => generateKeyForm.type,
  (type) => {
    if (type === 'rsa' && ![2048, 3072, 4096].includes(generateKeyForm.bits)) {
      generateKeyForm.bits = 4096
    } else if (type === 'ecdsa' && ![256, 384, 521].includes(generateKeyForm.bits)) {
      generateKeyForm.bits = 256
    }
  }
)

watch(filteredScripts, (nextScripts) => {
  if (
    !selectedScript.value ||
    !nextScripts.some((script) => script.id === selectedScript.value?.id)
  ) {
    selectedScript.value = nextScripts[0] || null
  }
})

onMounted(() => {
  loadScripts()
})

const loadScripts = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.lazyScript.getAll()
    if (result.success) {
      scripts.value = (result.data || []).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      if (!selectedScript.value || !scripts.value.some((script) => script.id === selectedScript.value?.id)) {
        selectedScript.value = scripts.value[0] || null
      } else {
        selectedScript.value =
          scripts.value.find((script) => script.id === selectedScript.value?.id) || null
      }
    } else {
      ElMessage.error(result.error || '加载懒人脚本失败')
    }
  } catch (error: any) {
    ElMessage.error('加载懒人脚本失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const selectScript = (script: LazyScript) => {
  selectedScript.value = script
}

const resetExecutionValues = (script: LazyScript | null) => {
  Object.keys(executionValues).forEach((key) => delete executionValues[key])
  Object.keys(numberExecutionValues).forEach((key) => delete numberExecutionValues[key])

  script?.variables.forEach((variable) => {
    const value = variable.defaultValue || ''
    executionValues[variable.name] = value
    if (variable.type === 'number') {
      const numberValue = Number(value)
      numberExecutionValues[variable.name] = Number.isFinite(numberValue) ? numberValue : undefined
    }
  })
}

const syncNumberVariable = (name: string) => {
  const value = numberExecutionValues[name]
  executionValues[name] = value === undefined || value === null ? '' : String(value)
}

const loadSshKeys = async (showError: boolean | Event = true) => {
  const shouldShowError = typeof showError === 'boolean' ? showError : true
  if (!window.electronAPI.sshKey?.getAll) return

  sshKeysLoading.value = true
  try {
    const result = await window.electronAPI.sshKey.getAll()
    if (!result.success) {
      if (shouldShowError) ElMessage.error(result.error || '加载 SSH 密钥失败')
      return
    }

    sshKeys.value = (result.data || [])
      .map(normalizeSshKey)
      .filter((key) => Boolean(key.id && key.name))
      .sort((a, b) => {
        const nextTime = new Date(b.createdAt || '').getTime()
        const currentTime = new Date(a.createdAt || '').getTime()
        return (Number.isFinite(nextTime) ? nextTime : 0) - (Number.isFinite(currentTime) ? currentTime : 0)
      })

    if (selectedSshKeyId.value && !sshKeys.value.some((key) => key.id === selectedSshKeyId.value)) {
      selectedSshKeyId.value = ''
    }
  } catch (error: any) {
    if (shouldShowError) {
      ElMessage.error('加载 SSH 密钥失败: ' + error.message)
    }
  } finally {
    sshKeysLoading.value = false
  }
}

const applySelectedPublicKey = (keyId: string) => {
  if (!keyId) return
  const key = sshKeys.value.find((item) => item.id === keyId)
  if (!key) {
    ElMessage.warning('未找到选择的 SSH 密钥')
    return
  }
  fillPublicKeyFromKey(key, '已填入公钥')
}

const openGenerateKeyDialog = () => {
  const host = appStore.currentSession?.host || 'server'
  const safeHost = host.replace(/[^a-zA-Z0-9._-]/g, '-')
  generateKeyForm.name = `mshell-${safeHost}`
  generateKeyForm.type = 'rsa'
  generateKeyForm.bits = 4096
  generateKeyForm.passphrase = ''
  generateKeyForm.comment = `MShell ${host}`
  showGenerateKeyDialog.value = true
}

const openManualKeyDialog = () => {
  const host = appStore.currentSession?.host || 'server'
  const safeHost = host.replace(/[^a-zA-Z0-9._-]/g, '-')
  manualKeyForm.name = `manual-${safeHost}`
  manualKeyForm.privateKey = ''
  manualKeyForm.publicKey = executionValues.public_key || ''
  manualKeyForm.passphrase = ''
  manualKeyForm.comment = ''
  showManualKeyDialog.value = true
}

const generateAndFillKey = async () => {
  if (!generateKeyForm.name.trim()) {
    ElMessage.warning('请输入密钥名称')
    return
  }

  generatingKey.value = true
  try {
    const options = {
      name: generateKeyForm.name.trim(),
      type: generateKeyForm.type,
      bits: generateKeyForm.type === 'ed25519' ? undefined : generateKeyForm.bits,
      passphrase: generateKeyForm.passphrase || undefined,
      comment: generateKeyForm.comment.trim() || undefined
    }
    const result = await window.electronAPI.sshKey?.generate?.(options)
    if (!result?.success || !result.data) {
      ElMessage.error(result?.error || '生成 SSH 密钥失败')
      return
    }

    const key = normalizeSshKey(result.data)
    await loadSshKeys(false)
    selectedSshKeyId.value = key.id
    fillPublicKeyFromKey(key, '密钥已生成并填入公钥')
    showGenerateKeyDialog.value = false
  } catch (error: any) {
    ElMessage.error('生成 SSH 密钥失败: ' + error.message)
  } finally {
    generatingKey.value = false
  }
}

const addManualKeyAndFill = async () => {
  if (!manualKeyForm.name.trim() || !manualKeyForm.privateKey.trim()) {
    ElMessage.warning('请输入密钥名称和私钥内容')
    return
  }

  addingKey.value = true
  try {
    const result = await window.electronAPI.sshKey?.add?.({
      name: manualKeyForm.name.trim(),
      privateKey: manualKeyForm.privateKey,
      publicKey: manualKeyForm.publicKey.trim() || undefined,
      passphrase: manualKeyForm.passphrase || undefined,
      comment: manualKeyForm.comment.trim() || undefined
    })
    if (!result?.success || !result.data) {
      ElMessage.error(result?.error || '添加 SSH 密钥失败')
      return
    }

    const key = normalizeSshKey(result.data)
    await loadSshKeys(false)
    selectedSshKeyId.value = key.id
    fillPublicKeyFromKey(key, '密钥已添加并填入公钥')
    showManualKeyDialog.value = false
  } catch (error: any) {
    ElMessage.error('添加 SSH 密钥失败: ' + error.message)
  } finally {
    addingKey.value = false
  }
}

const fillPublicKeyFromKey = (key: SSHKey, message: string) => {
  if (!isUsablePublicKey(key.publicKey)) {
    ElMessage.warning('该密钥没有可用公钥')
    return
  }
  executionValues.public_key = key.publicKey.trim()
  ElMessage.success(message)
}

const openEditor = (script?: LazyScript) => {
  editingScriptId.value = script?.id || ''
  scriptForm.name = script?.name || ''
  scriptForm.fileName = script?.fileName || normalizeScriptFileName(script?.name || 'script.sh')
  scriptForm.description = script?.description || ''
  scriptForm.category = script?.category || ''
  scriptForm.tagsText = script?.tags.join(', ') || ''
  scriptForm.type = script?.type || 'shell'
  scriptForm.content = script?.content || ''
  scriptForm.variables = (script?.variables || []).map((variable) => ({
    ...variable,
    optionsText: variable.options?.join(', ') || ''
  }))
  scriptForm.riskLevel = script?.riskLevel || 'medium'
  scriptForm.runMode = script?.runMode || 'paste'
  showEditor.value = true
}

const addVariable = (name = '') => {
  scriptForm.variables.push({
    name,
    label: name,
    type: 'text',
    defaultValue: '',
    required: false,
    optionsText: ''
  })
}

const removeVariable = (index: number) => {
  scriptForm.variables.splice(index, 1)
}

const detectVariables = async () => {
  const result = await window.electronAPI.lazyScript.extractVariables(scriptForm.content)
  if (!result.success) {
    ElMessage.error(result.error || '识别变量失败')
    return
  }

  const existingNames = new Set(scriptForm.variables.map((variable) => variable.name))
  const names = result.data || []
  let added = 0
  names.forEach((name) => {
    if (!existingNames.has(name)) {
      addVariable(name)
      existingNames.add(name)
      added++
    }
  })

  ElMessage.success(added > 0 ? `已添加 ${added} 个变量` : '变量已是最新')
}

const saveScript = async () => {
  if (!scriptForm.name.trim()) {
    ElMessage.warning('请输入脚本名称')
    return
  }
  if (!scriptForm.fileName.trim()) {
    ElMessage.warning('请输入脚本文件名')
    return
  }
  if (!scriptForm.content.trim()) {
    ElMessage.warning('请输入脚本内容')
    return
  }

  const invalidVariable = scriptForm.variables.find((variable) => !isValidVariableName(variable.name))
  if (invalidVariable) {
    ElMessage.warning(`变量名不合法：${invalidVariable.name || '(空)'}`)
    return
  }

  const payload = {
    name: scriptForm.name.trim(),
    fileName: normalizeScriptFileName(scriptForm.fileName),
    description: scriptForm.description.trim(),
    category: scriptForm.category.trim(),
    tags: scriptForm.tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    type: scriptForm.type,
    content: scriptForm.content,
    variables: scriptForm.variables.map((variable) => ({
      name: variable.name.trim(),
      label: variable.label.trim() || variable.name.trim(),
      type: variable.type,
      defaultValue: variable.defaultValue || '',
      required: Boolean(variable.required),
      options:
        variable.type === 'select'
          ? (variable.optionsText || '')
              .split(/[,，]/)
              .map((option) => option.trim())
              .filter(Boolean)
          : undefined
    })),
    riskLevel: scriptForm.riskLevel,
    runMode: scriptForm.runMode
  }

  saving.value = true
  try {
    const result = editingScriptId.value
      ? await window.electronAPI.lazyScript.update(editingScriptId.value, payload)
      : await window.electronAPI.lazyScript.create(payload)

    if (!result.success) {
      ElMessage.error(result.error || '保存失败')
      return
    }

    const nextSelectedId = editingScriptId.value || result.data?.id
    showEditor.value = false
    await loadScripts()
    selectedScript.value = scripts.value.find((script) => script.id === nextSelectedId) || scripts.value[0] || null
    ElMessage.success('脚本已保存')
  } catch (error: any) {
    ElMessage.error('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

const deleteScript = async (script: LazyScript) => {
  try {
    await ElMessageBox.confirm(`确定要删除脚本 "${script.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.lazyScript.delete(script.id)
    if (!result.success) {
      ElMessage.error(result.error || '删除失败')
      return
    }

    selectedScript.value = null
    await loadScripts()
    ElMessage.success('脚本已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败: ' + error.message)
    }
  }
}

const copyDeployCommand = async () => {
  if (!selectedScript.value || !validateRequiredVariables()) return
  if (isCommandScript.value) {
    ElMessage.warning('单条命令无需部署，请复制命令或直接运行')
    return
  }
  await navigator.clipboard.writeText(buildDeployCommand())
  await markUsed()
  ElMessage.success('部署命令已复制')
}

const copyRunCommand = async () => {
  if (!selectedScript.value || !validateRequiredVariables()) return
  await navigator.clipboard.writeText(buildRunCommand())
  await markUsed()
  ElMessage.success(isCommandScript.value ? '命令已复制' : '同步并运行命令已复制')
}

const deployScript = async () => {
  if (!selectedScript.value || !validateTerminalReady() || !validateRequiredVariables() || executingScript.value) return
  if (isCommandScript.value) {
    ElMessage.warning('单条命令无需部署，请直接运行')
    return
  }

  executingScript.value = true
  try {
    const result = await window.electronAPI.ssh.executeCommand(
      appStore.activeTab,
      buildDeployCommand(),
      scriptExecutionTimeoutMs
    )

    writeScriptResultToTerminal('部署脚本', result)

    if (!result.success) {
      ElMessage.error(result.error || '部署失败')
      return
    }

    await markUsed()
    ElMessage.success('脚本已静默部署到远程主机')
  } finally {
    executingScript.value = false
  }
}

const runScript = async () => {
  if (!selectedScript.value || !validateTerminalReady() || !validateRequiredVariables() || executingScript.value) return

  if (selectedScript.value.riskLevel === 'high') {
    try {
      await ElMessageBox.confirm(
        `这是高风险${isCommandScript.value ? '命令' : '脚本'}，确认${isCommandScript.value ? '运行' : '同步最新脚本并运行'}吗？`,
        '高风险确认',
        {
          type: 'warning'
        }
      )
    } catch {
      return
    }
  }

  if (isCommandScript.value) {
    terminalManager.requestScrollToBottom(appStore.activeTab)
    window.electronAPI.ssh.write(appStore.activeTab, ensureTrailingNewline(buildRunCommand()))
    await markUsed()
    ElMessage.success('命令已发送到当前终端')
    return
  }

  executingScript.value = true
  try {
    const result = await window.electronAPI.ssh.executeCommand(
      appStore.activeTab,
      await buildSilentRunCommand(),
      scriptExecutionTimeoutMs
    )

    writeScriptResultToTerminal('运行脚本', result)

    if (!result.success) {
      ElMessage.error(result.error || '脚本运行失败')
      return
    }

    await markUsed()
    ElMessage.success('脚本已运行，结果已输出到当前终端')
  } finally {
    executingScript.value = false
  }
}

const markUsed = async () => {
  if (!selectedScript.value) return
  await window.electronAPI.lazyScript.incrementUsage(selectedScript.value.id)
  selectedScript.value.usageCount += 1
}

const buildSilentRunCommand = async () => {
  const command = buildCheckedRunCommand({ showSyncMessage: false })
  const currentDir = await resolveCurrentTerminalDirectory()
  return currentDir ? `cd ${shellQuote(currentDir)} && ${command}` : command
}

const resolveCurrentTerminalDirectory = async () => {
  try {
    const result = await window.electronAPI.ssh.getCurrentDirectory(appStore.activeTab)
    return result.success && result.data ? result.data.trim() : ''
  } catch {
    return ''
  }
}

const writeScriptResultToTerminal = (
  action: string,
  result: { success: boolean; data?: string; error?: string }
) => {
  const scriptName = selectedScript.value?.name || '未命名脚本'
  const scriptPath = isCommandScript.value ? '单条命令' : remoteScriptPath.value
  const output = result.success ? result.data || '' : formatCommandError(result.error)
  const statusText = result.success ? '成功' : '失败'
  const statusColor = result.success ? '\x1b[32m' : '\x1b[31m'
  const cyan = '\x1b[36m'
  const dim = '\x1b[90m'
  const reset = '\x1b[0m'
  const border = '============================================================'

  const block = [
    '',
    `${cyan}${border}${reset}`,
    `${cyan}MShell ${action}${reset}`,
    `${dim}脚本：${scriptName}${reset}`,
    `${dim}路径：${scriptPath}${reset}`,
    `${dim}时间：${new Date().toLocaleString()}${reset}`,
    `${statusColor}状态：${statusText}${reset}`,
    `${cyan}${border}${reset}`,
    output.trim() || '(无输出)',
    `${cyan}${border}${reset}`,
    ''
  ].join('\n')

  terminalManager.writeLocalOutput(appStore.activeTab, toTerminalLineEndings(block))
}

const formatCommandError = (error?: string) => {
  if (!error) return '执行失败'
  if (error.startsWith('Command execution timeout:')) {
    return `执行超时，已超过 ${Math.round(scriptExecutionTimeoutMs / 1000)} 秒。远程命令可能仍在执行，请检查服务器状态。`
  }
  return error
}

const validateTerminalReady = () => {
  if (hasActiveTerminal.value) return true
  ElMessage.warning('请先打开一个 SSH 终端')
  return false
}

const validateRequiredVariables = () => {
  const missing = selectedScript.value?.variables.filter(
    (variable) => variable.required && !String(executionValues[variable.name] || '').trim()
  )

  if (missing?.length) {
    ElMessage.warning(`请填写变量：${missing.map((item) => item.label || item.name).join('、')}`)
    return false
  }

  return true
}

const exportScripts = async () => {
  const filePath = await window.electronAPI.dialog.saveFile({
    title: '导出懒人脚本',
    defaultPath: 'lazy-scripts.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!filePath) return

  const result = await window.electronAPI.lazyScript.export(filePath)
  if (result.success) {
    ElMessage.success(`已导出 ${result.data?.count || 0} 个脚本`)
  } else {
    ElMessage.error(result.error || '导出失败')
  }
}

const importScripts = async () => {
  const filePath = await window.electronAPI.dialog.openFile({
    title: '导入懒人脚本',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!filePath) return

  const result = await window.electronAPI.lazyScript.import(filePath)
  if (result.success) {
    await loadScripts()
    ElMessage.success(`导入 ${result.data?.imported || 0} 个，更新 ${result.data?.updated || 0} 个`)
  } else {
    ElMessage.error(result.error || '导入失败')
  }
}

const riskLabel = (risk: LazyScriptRiskLevel) => {
  const labels = { low: '低风险', medium: '中风险', high: '高风险' }
  return labels[risk]
}

const riskTagType = (risk: LazyScriptRiskLevel) => {
  if (risk === 'low') return 'success'
  if (risk === 'high') return 'danger'
  return 'warning'
}

const typeLabel = (type: LazyScriptType) => {
  const labels = { command: '单条命令', shell: 'Shell 脚本', steps: '操作步骤' }
  return labels[type]
}

const runModeLabel = (mode: LazyScriptRunMode, type: LazyScriptType) => {
  const labels =
    type === 'command'
      ? { copy: '复制命令', paste: '发送到终端', execute: '运行命令' }
      : { copy: '复制运行命令', paste: '部署到终端', execute: '运行脚本' }
  return labels[mode]
}

const buildRunCommand = () => {
  if (selectedScript.value?.type === 'command') {
    return renderedContent.value.trim()
  }
  return buildCheckedRunCommand()
}

const buildDeployCommand = () => {
  const content = ensureTrailingNewline(renderedContent.value)
  const delimiter = buildHeredocDelimiter(content)
  return [
    `mkdir -p ${remoteScriptsDir}`,
    `cat > ${quotedRemoteScriptPath.value} <<'${delimiter}'`,
    content.endsWith('\n') ? content.slice(0, -1) : content,
    delimiter,
    `chmod +x ${quotedRemoteScriptPath.value}`,
    `echo "已部署/更新: ${remoteScriptPath.value}"`
  ].join('\n')
}

const buildCheckedRunCommand = (options: { showSyncMessage?: boolean } = {}) => {
  const content = ensureTrailingNewline(renderedContent.value)
  const delimiter = buildHeredocDelimiter(content)
  return [
    '(',
    '  set -e',
    ...(options.showSyncMessage === false
      ? []
      : [`  echo "正在同步最新脚本: ${remoteScriptPath.value}"`]),
    `  mkdir -p ${remoteScriptsDir}`,
    `  cat > ${quotedRemoteScriptPath.value} <<'${delimiter}'`,
    content.endsWith('\n') ? content.slice(0, -1) : content,
    delimiter,
    `  chmod +x ${quotedRemoteScriptPath.value}`,
    `  bash ${quotedRemoteScriptPath.value}`,
    ')'
  ].join('\n')
}

const ensureTrailingNewline = (value: string) => (value.endsWith('\n') ? value : `${value}\n`)
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isValidVariableName = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())
const buildHeredocDelimiter = (content: string) => {
  let delimiter = 'MSHELL_SCRIPT'
  let index = 1
  while (new RegExp(`^${delimiter}$`, 'm').test(content)) {
    delimiter = `MSHELL_SCRIPT_${index}`
    index++
  }
  return delimiter
}
const normalizeSshKey = (key: any): SSHKey => ({
  id: String(key.id || ''),
  name: String(key.name || ''),
  type: key.type === 'ed25519' || key.type === 'ecdsa' || key.type === 'rsa' ? key.type : 'rsa',
  bits: Number.isFinite(Number(key.bits)) ? Number(key.bits) : undefined,
  publicKey: String(key.publicKey || ''),
  fingerprint: String(key.fingerprint || ''),
  comment: key.comment ? String(key.comment) : undefined,
  protected: Boolean(key.protected),
  createdAt: key.createdAt ? String(key.createdAt) : undefined
})
const isUsablePublicKey = (value: string) => {
  const publicKey = String(value || '').trim()
  return Boolean(
    publicKey &&
      publicKey !== 'Public key not available' &&
      publicKey !== 'Public key not provided'
  )
}
const normalizeScriptFileName = (value: string) => {
  const baseName =
    String(value || 'script')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'script'
  const safeName = baseName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '-')
  return /\.[a-zA-Z0-9]{1,8}$/.test(safeName) ? safeName : `${safeName}.sh`
}
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const shellQuotePathSegment = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const toTerminalLineEndings = (value: string) =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
</script>

<style scoped>
.lazy-script-shell {
  container: lazy-panel / inline-size;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.lazy-script-panel {
  display: grid;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  grid-template-columns: 220px minmax(280px, 360px) minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.script-sidebar,
.script-list,
.script-detail {
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.script-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px;
  background: var(--bg-secondary);
}

.sidebar-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-top h2,
.detail-header h3,
.variable-editor-head h4 {
  margin: 0;
}

.sidebar-top h2 {
  font-size: 18px;
  font-weight: 700;
}

.sidebar-top p,
.detail-title p,
.section-title small,
.variable-editor-head p,
.script-desc,
.run-hint {
  margin: 0;
  color: var(--text-secondary);
}

.script-search {
  flex: 0 0 auto;
}

.category-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.category-item,
.script-item {
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.category-item:hover,
.category-item.active {
  border-color: var(--border-medium);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.category-item strong {
  font-size: 12px;
  color: var(--text-tertiary);
}

.script-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.script-list {
  background: var(--bg-primary);
}

.script-list :deep(.el-scrollbar__view) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.script-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  width: 100%;
  min-height: 82px;
  padding: 12px;
  border-color: var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.script-item:hover,
.script-item.active {
  border-color: var(--primary-color);
  background: var(--bg-hover);
}

.script-item-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.script-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-file-name {
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-desc {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.script-item-meta {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-size: 12px;
}

.script-detail {
  container: lazy-detail / inline-size;
  overflow: auto;
  scrollbar-gutter: stable;
  border-right: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-color) 8%, transparent), transparent 220px),
    var(--bg-primary);
}

.detail-shell {
  display: flex;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
}

.detail-header,
.run-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.detail-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.title-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--primary-color);
}

.detail-header h3 {
  overflow: hidden;
  font-size: 22px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-title p {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-actions,
.run-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.run-actions {
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.run-actions :deep(.el-button) {
  margin-left: 0;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.script-file-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.script-file-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.script-file-info span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.script-file-info code {
  overflow: auto;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.script-file-info code::-webkit-scrollbar {
  height: 4px;
}

.variables-section,
.preview-section,
.ssh-key-helper-section {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
}

.variables-section,
.ssh-key-helper-section {
  flex: 0 0 auto;
  padding: 14px;
}

.ssh-key-helper-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.ssh-key-select {
  min-width: 220px;
  flex: 1 1 260px;
}

.ssh-key-helper-row :deep(.el-button) {
  margin-left: 0;
}

.ssh-key-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.ssh-key-option span,
.ssh-key-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ssh-key-option small,
.ssh-key-helper-note {
  color: var(--text-secondary);
}

.ssh-key-helper-note {
  margin: 10px 0 0;
  font-size: 12px;
}

.section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-title span {
  font-size: 14px;
  font-weight: 700;
}

.variable-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.variable-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.variable-field > span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.variable-field em {
  color: var(--danger-color);
  font-style: normal;
}

.preview-section {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  overflow: visible;
  padding: 14px;
}

.script-preview {
  width: 100%;
  height: clamp(170px, 30vh, 340px);
  flex: 0 0 auto;
  box-sizing: border-box;
  min-height: 150px;
  margin: 0;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--terminal-bg, #101418);
  color: var(--terminal-foreground, #e7eef7);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.run-bar {
  min-width: 0;
  flex: 0 0 auto;
  padding-top: 2px;
}

@container lazy-detail (max-width: 620px) {
  .ssh-key-helper-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(3, 36px);
    align-items: center;
    gap: 8px;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .ssh-key-helper-row :deep(.el-button) {
    width: 36px;
    min-width: 0;
    padding: 0;
  }

  .ssh-key-action-text {
    display: none;
  }

  .run-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .run-hint {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-actions {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(4, 36px);
    gap: 8px;
    justify-content: end;
  }

  .run-actions :deep(.el-button) {
    width: 36px;
    min-width: 0;
    padding: 0;
  }

  .run-action-text {
    display: none;
  }

  .script-preview {
    height: clamp(140px, 28vh, 260px);
    min-height: 130px;
  }
}

.script-form {
  max-height: 68vh;
  overflow: auto;
  padding-right: 6px;
}

.form-grid {
  display: grid;
  gap: 14px;
}

.form-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.variable-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 4px 0 12px;
}

.variable-editor-head h4 {
  font-size: 14px;
}

.variable-editor-head p {
  margin-top: 4px;
  font-size: 12px;
}

.variable-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.variable-row {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(100px, 1fr) 110px minmax(100px, 1fr) minmax(120px, 1fr) 70px 36px;
  gap: 8px;
  align-items: center;
}

.variable-row > .el-input:nth-of-type(5) {
  grid-column: auto;
}

:global(:root.app-appearance-terminal .lazy-script-panel) {
  grid-template-columns: 190px minmax(240px, 330px) minmax(0, 1fr);
}

:global(:root.app-appearance-terminal .script-sidebar),
:global(:root.app-appearance-terminal .script-item),
:global(:root.app-appearance-terminal .script-file-section .script-file-info),
:global(:root.app-appearance-terminal .ssh-key-helper-section),
:global(:root.app-appearance-terminal .variables-section),
:global(:root.app-appearance-terminal .preview-section),
:global(:root.app-appearance-terminal .title-icon) {
  border-radius: var(--radius-sm);
  box-shadow: none;
}

:global(:root.app-appearance-terminal .script-item) {
  min-height: 72px;
}

:global(:root.app-appearance-terminal .run-actions) {
  gap: 6px;
}

:global(:root.app-appearance-terminal .detail-shell) {
  padding: 16px;
}

:global(:root.app-appearance-terminal .detail-header h3) {
  font-size: 19px;
}

:global(:root.app-appearance-minimal .lazy-script-panel) {
  grid-template-columns: 210px minmax(250px, 340px) minmax(0, 1fr);
  font-family: var(--font-mono);
}

:global(:root.app-appearance-minimal .category-item),
:global(:root.app-appearance-minimal .script-item),
:global(:root.app-appearance-minimal .script-file-section .script-file-info),
:global(:root.app-appearance-minimal .ssh-key-helper-section),
:global(:root.app-appearance-minimal .variables-section),
:global(:root.app-appearance-minimal .preview-section),
:global(:root.app-appearance-minimal .title-icon),
:global(:root.app-appearance-minimal .script-preview) {
  border-radius: 0;
}

@media (max-width: 1100px) {
  .lazy-script-panel {
    grid-template-columns: 180px minmax(250px, 330px) minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .lazy-script-panel {
    grid-template-columns: 1fr;
  }

  .script-list {
    display: block;
    max-height: 36vh;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .detail-header,
  .run-bar,
  .variable-editor-head {
    align-items: stretch;
    flex-direction: column;
  }

  .run-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .script-file-section {
    grid-template-columns: 1fr;
  }

  .ssh-key-helper-row {
    align-items: stretch;
    flex-direction: column;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .form-grid.two,
  .form-grid.three,
  .variable-row {
    grid-template-columns: 1fr;
  }
}

@container lazy-panel (max-width: 980px) {
  .lazy-script-panel {
    grid-template-columns: 170px minmax(240px, 310px) minmax(0, 1fr);
  }

  .script-sidebar {
    display: flex;
    padding: 16px 12px;
  }

  .sidebar-top {
    gap: 8px;
  }

  .sidebar-top h2 {
    font-size: 16px;
  }
}

@container lazy-panel (max-width: 860px) {
  .lazy-script-panel {
    grid-template-columns: 150px minmax(220px, 280px) minmax(0, 1fr);
  }

  .script-sidebar {
    padding: 14px 10px;
  }

  .category-item {
    padding: 0 8px;
  }
}

@container lazy-panel (max-width: 760px) {
  .lazy-script-panel {
    height: 100%;
    grid-auto-rows: auto;
    grid-template-columns: 1fr;
    align-content: start;
    overflow: auto;
  }

  .script-sidebar {
    display: flex;
    min-height: auto;
    padding: 16px 14px;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    overflow: visible;
  }

  .category-list {
    flex: 0 0 auto;
    max-height: 240px;
  }

  .script-list {
    display: block;
    max-height: min(360px, 38vh);
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    overflow: visible;
  }

  .script-detail {
    min-height: 520px;
    overflow: visible;
  }

  .detail-shell {
    min-height: auto;
  }

  .detail-header,
  .run-bar,
  .variable-editor-head {
    align-items: stretch;
    flex-direction: column;
  }

  .run-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .script-file-section {
    grid-template-columns: 1fr;
  }

  .ssh-key-helper-row {
    align-items: stretch;
    flex-direction: column;
  }

  .ssh-key-select {
    width: 100%;
    min-width: 0;
  }

  .form-grid.two,
  .form-grid.three,
  .variable-row {
    grid-template-columns: 1fr;
  }
}

@container lazy-panel (max-width: 420px) {
  .script-sidebar {
    padding: 14px 12px;
  }

  .sidebar-top h2 {
    font-size: 16px;
  }

  .category-list {
    max-height: 220px;
  }

  .script-list :deep(.el-scrollbar__view) {
    padding: 12px;
  }
}
</style>
