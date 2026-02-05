<template>
  <div class="terminal-ai-panel">
    <div class="chat-header">
      <span class="title">AI 助手</span>
      <el-tag 
        class="model-tag-display" 
        :type="selectedModel ? 'primary' : 'info'" 
        size="small"
        effect="plain"
        @click="showModelDialog = true"
      >
        {{ selectedModelName }}
      </el-tag>
      <div class="header-actions">
        <el-tooltip content="停止生成" placement="bottom" v-if="isLoading">
          <el-button link type="danger" :icon="VideoPause" @click="handleStop" />
        </el-tooltip>
        <el-tooltip content="重新生成" placement="bottom" v-if="canRegenerate">
          <el-button link :icon="RefreshRight" @click="handleRegenerate" />
        </el-tooltip>
        <el-tooltip content="清空对话" placement="bottom">
          <el-button link :icon="Delete" @click="handleClear" />
        </el-tooltip>
        <el-button link :icon="Close" @click="$emit('close')" />
      </div>
    </div>

    <!-- 模型选择弹窗 -->
    <el-dialog
      v-model="showModelDialog"
      title="选择 AI 模型"
      width="360px"
      :close-on-click-modal="true"
      append-to-body
    >
      <div class="model-dialog-content">
        <!-- 渠道选择 -->
        <div class="channel-section">
          <div class="section-label">选择渠道</div>
          <div class="channel-list">
            <div 
              v-for="channel in enabledChannels" 
              :key="channel.id"
              class="channel-item"
              :class="{ active: dialogSelectedChannelId === channel.id }"
              @click="dialogSelectedChannelId = channel.id"
            >
              {{ channel.name }}
            </div>
            <div v-if="enabledChannels.length === 0" class="empty-hint">
              暂无可用渠道
            </div>
          </div>
        </div>
        
        <!-- 模型选择 -->
        <div class="model-section" v-if="dialogSelectedChannelId">
          <div class="section-label">选择模型</div>
          <div class="model-list">
            <div 
              v-for="model in channelModels" 
              :key="model.id"
              class="model-item"
              :class="{ active: dialogSelectedModelId === model.id }"
              @click="dialogSelectedModelId = model.id"
            >
              <span class="model-name">{{ model.displayName }}</span>
              <el-icon v-if="dialogSelectedModelId === model.id" class="check-icon"><Check /></el-icon>
            </div>
            <div v-if="channelModels.length === 0" class="empty-hint">
              该渠道暂无模型
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <el-button @click="showModelDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmModelSelection" :disabled="!dialogSelectedModelId">
          确定
        </el-button>
      </template>
    </el-dialog>

    <div class="chat-messages" ref="scrollContainer">
      <template v-if="messages.length > 0">
        <div 
          v-for="(msg, index) in messages" 
          :key="msg.id" 
          class="message-item"
          :class="msg.role"
        >
          <div class="message-avatar">
            <el-icon v-if="msg.role === 'user'"><User /></el-icon>
            <el-icon v-else><ChatDotRound /></el-icon>
          </div>
          <div class="message-content-wrapper">
            <div class="message-meta">
              <span class="time">{{ formatTime(msg.timestamp) }}</span>
              <span v-if="msg.role === 'assistant' && msg.modelId" class="model-tag">{{ msg.modelId }}</span>
            </div>
            <div class="message-bubble">
              <div 
                class="markdown-body" 
                v-html="renderMarkdown(msg.content)"
              ></div>
              <div v-if="msg.status === 'error'" class="error-hint">
                <el-icon><Warning /></el-icon>
                <span>{{ msg.error }}</span>
                <el-button link size="small" @click="retryMessage(index)">重试</el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
      
      <div v-if="isLoading" class="message-item assistant loading">
        <div class="message-avatar">
          <el-icon><ChatDotRound /></el-icon>
        </div>
        <div class="message-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
      
      <div v-if="messages.length === 0" class="empty-state">
        <el-icon :size="48"><ChatDotRound /></el-icon>
        <p>终端专属 AI 助手</p>
        <p class="hint">针对当前终端会话的智能助手</p>
        <div class="quick-actions">
          <el-button size="small" @click="setInput('帮我检查系统状态')">检查系统</el-button>
          <el-button size="small" @click="setInput('帮我写一个部署脚本')">编写脚本</el-button>
          <el-button size="small" @click="setInput('解释上一条命令的输出')">解释输出</el-button>
          <el-button size="small" @click="setInput('帮我排查错误')">排查错误</el-button>
        </div>
      </div>
    </div>

    <div class="chat-footer">
      <!-- 已附加的文件列表 -->
      <div v-if="attachedFiles.length > 0" class="attached-files">
        <div v-for="(file, index) in attachedFiles" :key="file.path" class="attached-file">
          <el-icon><Document /></el-icon>
          <span class="file-name">{{ file.name }}</span>
          <el-icon class="remove-btn" @click="removeAttachedFile(index)"><Close /></el-icon>
        </div>
      </div>
      
      <div class="input-wrapper">
        <div class="input-container">
          <el-input
            ref="inputRef"
            v-model="inputValue"
            type="textarea"
            :rows="3"
            placeholder="输入问题... @ 引用文件，Shift+Enter 换行"
            @keydown.enter.exact.prevent="sendMessage"
            @input="handleInputChange"
            resize="none"
          />
          <!-- @ 文件选择弹出框 -->
          <div v-if="showFileSelector" class="file-selector-popup">
            <div class="file-selector-header">
              <span>选择文件</span>
              <div class="header-right">
                <el-tooltip content="刷新" placement="top">
                  <el-icon class="sync-btn" @click="loadFileList(currentDir)"><Refresh /></el-icon>
                </el-tooltip>
                <el-icon class="close-btn" @click="showFileSelector = false"><Close /></el-icon>
              </div>
            </div>
            <div class="path-input-row">
              <el-input 
                v-model="pathInput" 
                size="small" 
                placeholder="输入路径，回车跳转"
                @keydown.enter="goToPath"
              >
                <template #prefix>
                  <el-icon><FolderOpened /></el-icon>
                </template>
              </el-input>
              <el-button size="small" @click="goToPath">跳转</el-button>
            </div>
            <div class="quick-paths">
              <el-tag size="small" @click="goToQuickPath('/')" effect="plain">/ 根目录</el-tag>
              <el-tag size="small" @click="goToQuickPath('~')" effect="plain">~ 主目录</el-tag>
              <el-tag size="small" @click="goToQuickPath('/tmp')" effect="plain">/tmp</el-tag>
              <el-tag size="small" @click="goToQuickPath('/var/log')" effect="plain">/var/log</el-tag>
            </div>
            <div v-if="loadingFiles" class="file-loading">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>加载中...</span>
            </div>
            <div v-else class="file-list">
              <div 
                v-if="currentDir !== '/'" 
                class="file-item dir"
                @click="navigateToParent"
              >
                <el-icon><Back /></el-icon>
                <span>..</span>
              </div>
              <div 
                v-for="file in remoteFiles" 
                :key="file.path"
                class="file-item"
                :class="{ dir: file.isDir }"
                @click="handleFileClick(file)"
              >
                <el-icon>
                  <Folder v-if="file.isDir" />
                  <Document v-else />
                </el-icon>
                <span>{{ file.name }}</span>
                <span v-if="!file.isDir" class="file-size">{{ formatFileSize(file.size) }}</span>
              </div>
              <div v-if="remoteFiles.length === 0" class="empty-hint">
                目录为空
              </div>
            </div>
          </div>
        </div>
        <div class="footer-actions">
          <el-tooltip content="附加文件 (@)" placement="top">
            <el-button link :icon="FolderOpened" @click="triggerFileSelector" />
          </el-tooltip>
          <el-button type="primary" size="small" :loading="isLoading" @click="sendMessage">
            发送
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useAIStore } from '@/stores/ai'
import { terminalManager } from '@/utils/terminal-manager'
import { marked } from 'marked'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Delete, Close, User, Warning, 
  ChatDotRound, RefreshRight, VideoPause, Check,
  Document, Folder, FolderOpened, Back, Loading, Refresh
} from '@element-plus/icons-vue'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  connectionId: string
  sessionName?: string
  storageId?: string // 用于存储历史记录的 ID (通常是 session.id)
  currentDir?: string // 从终端提示符解析的当前目录
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  modelId?: string
  status: 'success' | 'error'
  error?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const aiStore = useAIStore()

const messages = ref<ChatMessage[]>([])
const inputValue = ref('')
const isLoading = ref(false)
const isHistoryReady = ref(false)
const scrollContainer = ref<HTMLElement>()
const inputRef = ref<any>()
const currentRequestId = ref<string>('')
const selectedModelId = ref<string>('') // 当前终端选择的模型 ID

// 可用模型列表
const availableModels = computed(() => aiStore.models)

// 当前选择的模型
const selectedModel = computed(() => {
  if (selectedModelId.value) {
    return aiStore.models.find(m => m.id === selectedModelId.value)
  }
  return aiStore.defaultModel
})

// 显示的模型名称
const selectedModelName = computed(() => {
  if (selectedModel.value) {
    return selectedModel.value.displayName
  }
  return '选择模型'
})

// 弹窗相关
const showModelDialog = ref(false)
const dialogSelectedChannelId = ref<string>('')
const dialogSelectedModelId = ref<string>('')

// 启用的渠道列表
const enabledChannels = computed(() => aiStore.channels.filter(c => c.enabled))

// 当前选中渠道的模型列表
const channelModels = computed(() => {
  if (!dialogSelectedChannelId.value) return []
  return aiStore.models.filter(m => m.channelId === dialogSelectedChannelId.value)
})

// ==================== 文件引用功能 ====================
interface RemoteFile {
  name: string
  path: string
  isDir: boolean
  size: number
}

interface AttachedFile {
  name: string
  path: string
  content: string
}

const showFileSelector = ref(false)
const loadingFiles = ref(false)
const remoteFiles = ref<RemoteFile[]>([])
const currentDir = ref('')
const attachedFiles = ref<AttachedFile[]>([])
const pathInput = ref('')

// 监听输入变化，检测 @ 符号
const handleInputChange = (value: string) => {
  // 检测是否刚输入了 @
  if (value.endsWith('@')) {
    triggerFileSelector()
  }
}

// 触发文件选择器
const triggerFileSelector = async () => {
  showFileSelector.value = true
  await loadCurrentDirectory()
}

// 跳转到指定路径
const goToPath = async () => {
  const path = pathInput.value.trim()
  if (!path) return
  
  loadingFiles.value = true
  try {
    // 检查路径是否存在
    const checkResult = await window.electronAPI.ssh?.executeCommand(
      props.connectionId,
      `test -d "${path}" && echo "dir" || (test -f "${path}" && echo "file" || echo "none")`,
      3000
    )
    
    if (checkResult?.success) {
      const type = checkResult.data?.trim()
      if (type === 'dir') {
        currentDir.value = path
        pathInput.value = path
        await loadFileList(path)
      } else if (type === 'file') {
        // 如果是文件，跳转到其所在目录
        const dir = path.split('/').slice(0, -1).join('/') || '/'
        currentDir.value = dir
        pathInput.value = dir
        await loadFileList(dir)
      } else {
        ElMessage.warning('路径不存在')
      }
    }
  } catch (error) {
    console.error('Failed to go to path:', error)
    ElMessage.error('跳转失败')
  } finally {
    loadingFiles.value = false
  }
}

// 快速跳转到常用路径
const goToQuickPath = async (path: string) => {
  loadingFiles.value = true
  try {
    let targetPath = path
    
    // 处理 ~ 为用户主目录
    if (path === '~') {
      const homeResult = await window.electronAPI.ssh?.executeCommand(
        props.connectionId,
        'echo $HOME',
        3000
      )
      if (homeResult?.success && homeResult.data) {
        targetPath = homeResult.data.trim()
      } else {
        targetPath = '/root' // 降级默认
      }
    }
    
    currentDir.value = targetPath
    pathInput.value = targetPath
    await loadFileList(targetPath)
  } catch (error) {
    console.error('Failed to go to quick path:', error)
    ElMessage.error('跳转失败')
  } finally {
    loadingFiles.value = false
  }
}

// 获取当前工作目录
const loadCurrentDirectory = async () => {
  loadingFiles.value = true
  try {
    let targetDir = ''
    
    // 方案1: 从 xterm buffer 解析提示符获取当前目录（最可靠）
    const cwdFromBuffer = terminalManager.getCurrentWorkingDirectory(props.connectionId)
    if (cwdFromBuffer) {
      targetDir = cwdFromBuffer
      console.log(`[TerminalAI] Got cwd from xterm buffer: ${targetDir}`)
    }
    
    // 方案2: 使用从 props 传入的目录（备用）
    if (!targetDir && props.currentDir) {
      targetDir = props.currentDir
      console.log(`[TerminalAI] Got cwd from props: ${targetDir}`)
    }
    
    // 如果获取到了目录
    if (targetDir) {
      // 如果以 ~ 开头，需要展开为完整路径
      if (targetDir.startsWith('~')) {
        const homeResult = await window.electronAPI.ssh?.executeCommand(
          props.connectionId,
          'echo $HOME',
          3000
        )
        if (homeResult?.success && homeResult.data) {
          const home = homeResult.data.trim()
          targetDir = targetDir.replace(/^~/, home)
        }
      }
      
      currentDir.value = targetDir
      pathInput.value = targetDir
      await loadFileList(targetDir)
      return
    }
    
    // 方案3: 降级使用 API 获取
    const result = await window.electronAPI.ssh?.getCurrentDirectory(props.connectionId)
    if (result?.success && result.data) {
      currentDir.value = result.data
      pathInput.value = result.data
    } else {
      // 最后降级：使用 pwd 命令（会返回 home 目录）
      const pwdResult = await window.electronAPI.ssh?.executeCommand(props.connectionId, 'pwd', 3000)
      if (pwdResult?.success && pwdResult.data) {
        currentDir.value = pwdResult.data.trim()
        pathInput.value = currentDir.value
      } else {
        currentDir.value = '/'
        pathInput.value = '/'
      }
    }
    await loadFileList(currentDir.value)
  } catch (error) {
    console.error('Failed to get current directory:', error)
    currentDir.value = '/'
    pathInput.value = '/'
  } finally {
    loadingFiles.value = false
  }
}

// 加载文件列表
const loadFileList = async (dir: string) => {
  loadingFiles.value = true
  try {
    // 使用更可靠的方式获取文件列表
    // 输出格式: type|size|name (type: d=目录, f=文件, l=链接)
    const cmd = `cd "${dir}" 2>/dev/null && for f in * .[!.]* ..?*; do [ -e "$f" ] && { [ -d "$f" ] && echo "d|0|$f" || stat -c "f|%s|%n" "$f" 2>/dev/null || echo "f|0|$f"; }; done 2>/dev/null | head -100`
    const result = await window.electronAPI.ssh?.executeCommand(props.connectionId, cmd, 5000)
    
    if (result?.success && result.data) {
      const files: RemoteFile[] = []
      const lines = result.data.trim().split('\n').filter(Boolean)
      
      for (const line of lines) {
        const parts = line.split('|')
        if (parts.length >= 3) {
          const type = parts[0]
          const size = parseInt(parts[1]) || 0
          const name = parts.slice(2).join('|') // 文件名可能包含 |
          
          if (name === '.' || name === '..' || !name) continue
          
          files.push({
            name,
            path: dir === '/' ? `/${name}` : `${dir}/${name}`,
            isDir: type === 'd',
            size
          })
        }
      }
      
      // 排序：目录在前，文件在后
      files.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1
        if (!a.isDir && b.isDir) return 1
        return a.name.localeCompare(b.name)
      })
      
      remoteFiles.value = files
    } else {
      remoteFiles.value = []
    }
  } catch (error) {
    console.error('Failed to load file list:', error)
    remoteFiles.value = []
  } finally {
    loadingFiles.value = false
  }
}

// 处理文件点击
const handleFileClick = async (file: RemoteFile) => {
  if (file.isDir) {
    // 进入目录
    currentDir.value = file.path
    pathInput.value = file.path
    await loadFileList(file.path)
  } else {
    // 选择文件，读取内容
    await attachFile(file)
  }
}

// 返回上级目录
const navigateToParent = async () => {
  const parentDir = currentDir.value.split('/').slice(0, -1).join('/') || '/'
  currentDir.value = parentDir
  pathInput.value = parentDir
  await loadFileList(parentDir)
}

// 附加文件
const attachFile = async (file: RemoteFile) => {
  // 检查文件大小限制 (100KB)
  if (file.size > 100 * 1024) {
    ElMessage.warning('文件过大，最大支持 100KB')
    return
  }
  
  // 检查是否已附加
  if (attachedFiles.value.some(f => f.path === file.path)) {
    ElMessage.info('该文件已附加')
    return
  }
  
  try {
    // 使用 SSH 命令读取文件内容（比 SFTP 更简单，不需要初始化）
    const result = await window.electronAPI.ssh?.executeCommand(
      props.connectionId, 
      `cat "${file.path}" 2>/dev/null`,
      10000
    )
    if (result?.success && result.data !== undefined) {
      attachedFiles.value.push({
        name: file.name,
        path: file.path,
        content: result.data
      })
      
      // 移除输入框末尾的 @
      if (inputValue.value.endsWith('@')) {
        inputValue.value = inputValue.value.slice(0, -1)
      }
      
      showFileSelector.value = false
      ElMessage.success(`已附加 ${file.name}`)
    } else {
      ElMessage.error(result?.error || '读取文件失败，可能是二进制文件或权限不足')
    }
  } catch (error: any) {
    console.error('Failed to read file:', error)
    ElMessage.error(error?.message || '读取文件失败')
  }
}

// 移除附加的文件
const removeAttachedFile = (index: number) => {
  attachedFiles.value.splice(index, 1)
}

// 格式化文件大小
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

// 打开弹窗时初始化选中状态
watch(showModelDialog, (visible) => {
  if (visible) {
    // 如果已有选中的模型，定位到对应渠道
    if (selectedModelId.value) {
      const model = aiStore.models.find(m => m.id === selectedModelId.value)
      if (model) {
        dialogSelectedChannelId.value = model.channelId
        dialogSelectedModelId.value = model.id
        return
      }
    }
    // 否则选中第一个渠道
    if (enabledChannels.value.length > 0) {
      dialogSelectedChannelId.value = enabledChannels.value[0].id
    }
    dialogSelectedModelId.value = ''
  }
})

// 确认模型选择
const confirmModelSelection = () => {
  if (dialogSelectedModelId.value) {
    selectedModelId.value = dialogSelectedModelId.value
    // 保存到本地存储
    const storageKey = `terminal-ai-model-${getStorageId()}`
    localStorage.setItem(storageKey, dialogSelectedModelId.value)
  }
  showModelDialog.value = false
}

// 获取渠道名称
const getChannelName = (channelId: string) => {
  const channel = aiStore.channels.find(c => c.id === channelId)
  return channel?.name || ''
}

// 是否可以重新生成（最后一条是 AI 消息且不在加载中）
const canRegenerate = computed(() => {
  if (messages.value.length < 2 || isLoading.value) return false
  const lastMsg = messages.value[messages.value.length - 1]
  return lastMsg.role === 'assistant'
})

// 格式化时间
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 渲染 Markdown
const renderMarkdown = (content: string) => {
  try {
    let html = marked.parse(content) as string
    // 为代码块添加按钮
    html = html.replace(
      /<pre><code(.*?)>([\s\S]*?)<\/code><\/pre>/g,
      (_match, attrs, code) => {
        const escapedCode = code.replace(/"/g, '&quot;')
        return `<div class="code-block-wrapper">
          <div class="code-toolbar">
            <button class="code-btn copy-btn" data-code="${escapedCode}">复制</button>
            <button class="code-btn insert-btn" data-code="${escapedCode}">插入终端</button>
            <button class="code-btn run-btn" data-code="${escapedCode}">执行</button>
          </div>
          <pre><code${attrs}>${code}</code></pre>
        </div>`
      }
    )
    return html
  } catch (e) {
    return content
  }
}

// 解码 HTML 实体
const decodeHtmlEntities = (text: string) => {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
}

// 处理代码块按钮点击
const handleCodeBlockClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.classList.contains('copy-btn')) {
    const code = target.getAttribute('data-code') || ''
    const decodedCode = decodeHtmlEntities(code)
    navigator.clipboard.writeText(decodedCode)
    ElMessage.success('已复制到剪贴板')
  } else if (target.classList.contains('insert-btn')) {
    const code = target.getAttribute('data-code') || ''
    const decodedCode = decodeHtmlEntities(code)
    // 插入到当前终端（不执行）
    window.electronAPI?.ssh?.write(props.connectionId, decodedCode)
    ElMessage.success('已插入到终端')
  } else if (target.classList.contains('run-btn')) {
    const code = target.getAttribute('data-code') || ''
    const decodedCode = decodeHtmlEntities(code)
    // 插入并执行（添加换行符）
    window.electronAPI?.ssh?.write(props.connectionId, decodedCode + '\n')
    ElMessage.success('已执行命令')
  }
}

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}

// 设置输入
const setInput = (text: string) => {
  inputValue.value = text
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// 停止生成
const handleStop = async () => {
  if (currentRequestId.value) {
    try {
      await window.electronAPI.ai?.cancelRequest(currentRequestId.value)
      ElMessage.info('已停止生成')
    } catch (error) {
      console.error('Failed to cancel request:', error)
    }
  }
  isLoading.value = false
}

// 重新生成最后一条回复
const handleRegenerate = async () => {
  if (messages.value.length < 2 || isLoading.value) return
  
  // 找到最后一条用户消息
  let lastUserMsgIndex = -1
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      lastUserMsgIndex = i
      break
    }
  }
  
  if (lastUserMsgIndex === -1) return
  
  const userContent = messages.value[lastUserMsgIndex].content
  
  // 删除最后一条 AI 回复
  messages.value.pop()
  saveChatHistory()
  
  // 直接发送请求，不重新添加用户消息
  isLoading.value = true
  currentRequestId.value = uuidv4()
  scrollToBottom()

  let aiMsgIndex: number = -1
  let cleanupStream: (() => void) | undefined

  try {
    const contextPrompt = props.sessionName 
      ? `[当前终端会话: ${props.sessionName}]\n\n用户问题: ${userContent}`
      : userContent

    if (window.electronAPI.ai?.onStreamChunk) {
      cleanupStream = window.electronAPI.ai.onStreamChunk((_requestId, chunk) => {
        if (aiMsgIndex === -1) {
          const aiMsg: ChatMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
            modelId: selectedModel.value?.displayName,
            status: 'success'
          }
          messages.value.push(aiMsg)
          aiMsgIndex = messages.value.length - 1
          isLoading.value = false
        } else {
          messages.value[aiMsgIndex].content += chunk
        }
        scrollToBottom()
      })
    }

    let response: string
    if (selectedModelId.value) {
      response = await aiStore.sendRequestWithModel('chat', contextPrompt, selectedModelId.value)
    } else {
      response = await aiStore.sendRequest('chat', contextPrompt)
    }
    
    if (aiMsgIndex === -1) {
      const aiMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        modelId: selectedModel.value?.displayName,
        status: 'success'
      }
      messages.value.push(aiMsg)
    }
  } catch (error: any) {
    const errorMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `错误: ${error.message}`,
      timestamp: Date.now(),
      status: 'error',
      error: error.message
    }
    messages.value.push(errorMsg)
  } finally {
    cleanupStream?.()
    isLoading.value = false
    currentRequestId.value = ''
    saveChatHistory()
    scrollToBottom()
  }
}

// 重试失败的消息
const retryMessage = async (errorMsgIndex: number) => {
  if (isLoading.value) return
  
  // 找到这条错误消息之前的用户消息
  let userMsgIndex = -1
  for (let i = errorMsgIndex - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      userMsgIndex = i
      break
    }
  }
  
  if (userMsgIndex === -1) return
  
  const userContent = messages.value[userMsgIndex].content
  
  // 删除错误消息
  messages.value.splice(errorMsgIndex, 1)
  saveChatHistory()
  
  // 直接发送请求，不重新添加用户消息
  isLoading.value = true
  currentRequestId.value = uuidv4()
  scrollToBottom()

  let aiMsgIndex: number = -1
  let cleanupStream: (() => void) | undefined

  try {
    const contextPrompt = props.sessionName 
      ? `[当前终端会话: ${props.sessionName}]\n\n用户问题: ${userContent}`
      : userContent

    if (window.electronAPI.ai?.onStreamChunk) {
      cleanupStream = window.electronAPI.ai.onStreamChunk((_requestId, chunk) => {
        if (aiMsgIndex === -1) {
          const aiMsg: ChatMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
            modelId: selectedModel.value?.displayName,
            status: 'success'
          }
          messages.value.push(aiMsg)
          aiMsgIndex = messages.value.length - 1
          isLoading.value = false
        } else {
          messages.value[aiMsgIndex].content += chunk
        }
        scrollToBottom()
      })
    }

    let response: string
    if (selectedModelId.value) {
      response = await aiStore.sendRequestWithModel('chat', contextPrompt, selectedModelId.value)
    } else {
      response = await aiStore.sendRequest('chat', contextPrompt)
    }
    
    if (aiMsgIndex === -1) {
      const aiMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        modelId: selectedModel.value?.displayName,
        status: 'success'
      }
      messages.value.push(aiMsg)
    }
  } catch (error: any) {
    const errorMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `错误: ${error.message}`,
      timestamp: Date.now(),
      status: 'error',
      error: error.message
    }
    messages.value.push(errorMsg)
  } finally {
    cleanupStream?.()
    isLoading.value = false
    currentRequestId.value = ''
    saveChatHistory()
    scrollToBottom()
  }
}

// 加载聊天历史
// 获取有效的存储 ID
const getStorageId = () => props.storageId || props.connectionId

// 加载聊天历史
const loadChatHistory = async () => {
  try {
    const id = getStorageId()
    console.log(`[TerminalAI] Loading history for ID: ${id}`)
    const result = await window.electronAPI.ai?.getTerminalChatHistory(id)
    if (result?.success && result?.data) {
      console.log(`[TerminalAI] Loaded ${result.data.length} messages`)
      messages.value = result.data
      await nextTick()
      scrollToBottom()
    } else {
      console.log('[TerminalAI] No history found or failed to load')
    }
    
    // 加载保存的模型选择
    const storageKey = `terminal-ai-model-${id}`
    const savedModelId = localStorage.getItem(storageKey)
    if (savedModelId && aiStore.models.find(m => m.id === savedModelId)) {
      selectedModelId.value = savedModelId
    }
  } catch (error) {
    console.error('Failed to load terminal chat history:', error)
  } finally {
    isHistoryReady.value = true
  }
}

watch(() => props.storageId, (newId) => {
  if (newId) {
    console.log(`[TerminalAI] Storage ID changed to: ${newId}`)
    isHistoryReady.value = false
    loadChatHistory()
  }
})

// 保存聊天历史
// 保存聊天历史
const saveChatHistory = async () => {
  try {
    const id = getStorageId()
    // 必须转为普通对象，通过 IPC 发送 Vue Proxy 对象会导致 "An object could not be cloned" 错误
    const plainMessages = JSON.parse(JSON.stringify(messages.value))
    await window.electronAPI.ai?.saveTerminalChatHistory(id, plainMessages)
  } catch (error) {
    console.error('Failed to save terminal chat history:', error)
  }
}

// 发送消息
const sendMessage = async () => {
  const content = inputValue.value.trim()
  if (!content || isLoading.value) return

  if (!aiStore.hasDefaultModel) {
    ElMessage.warning('请先在设置中配置 AI 模型')
    return
  }

  // 构建包含附加文件的完整消息
  let fullContent = content
  const fileRefs: string[] = []
  
  if (attachedFiles.value.length > 0) {
    const fileContents = attachedFiles.value.map(f => {
      fileRefs.push(f.name)
      return `\n\n--- 文件: ${f.path} ---\n${f.content}\n--- 文件结束 ---`
    }).join('')
    fullContent = content + fileContents
  }

  // 显示给用户的消息（包含文件引用标记）
  const displayContent = fileRefs.length > 0 
    ? `${content}\n\n📎 附加文件: ${fileRefs.join(', ')}`
    : content

  inputValue.value = ''
  attachedFiles.value = [] // 清空附加文件
  isLoading.value = true
  currentRequestId.value = uuidv4()

  // 添加用户消息
  const userMsg: ChatMessage = {
    id: uuidv4(),
    role: 'user',
    content: displayContent,
    timestamp: Date.now(),
    status: 'success'
  }
  messages.value.push(userMsg)
  saveChatHistory()
  scrollToBottom()

  // AI 回复消息（延迟添加，避免与加载指示器重复显示）
  let aiMsgIndex: number = -1
  let cleanupStream: (() => void) | undefined

  try {
    // 构建上下文：包含终端会话信息
    const contextPrompt = props.sessionName 
      ? `[当前终端会话: ${props.sessionName}]\n\n用户问题: ${fullContent}`
      : fullContent

    // 监听流式输出
    if (window.electronAPI.ai?.onStreamChunk) {
      cleanupStream = window.electronAPI.ai.onStreamChunk((_requestId, chunk) => {
        // 收到第一个 chunk 时才添加 AI 消息，并隐藏加载指示器
        if (aiMsgIndex === -1) {
          const aiMsg: ChatMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
            modelId: selectedModel.value?.displayName,
            status: 'success'
          }
          messages.value.push(aiMsg)
          aiMsgIndex = messages.value.length - 1
          isLoading.value = false // 隐藏加载指示器
        } else {
          // 通过索引直接修改数组元素，确保 Vue 能检测到变化
          messages.value[aiMsgIndex].content += chunk
        }
        scrollToBottom()
      })
    }

    // 调用 AI 接口（使用选择的模型或默认模型）
    let response: string
    if (selectedModelId.value) {
      response = await aiStore.sendRequestWithModel('chat', contextPrompt, selectedModelId.value)
    } else {
      response = await aiStore.sendRequest('chat', contextPrompt)
    }
    
    // 非流式模式：直接使用完整响应
    if (aiMsgIndex === -1) {
      const aiMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        modelId: selectedModel.value?.displayName,
        status: 'success'
      }
      messages.value.push(aiMsg)
    }
  } catch (error: any) {
    const errorMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `错误: ${error.message}`,
      timestamp: Date.now(),
      status: 'error',
      error: error.message
    }
    messages.value.push(errorMsg)
  } finally {
    cleanupStream?.()
    isLoading.value = false
    currentRequestId.value = ''
    saveChatHistory()
    scrollToBottom()
  }
}

// 清空对话
const handleClear = async () => {
  try {
    await ElMessageBox.confirm('确定要清空当前终端的对话记录吗？', '确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    messages.value = []
    const id = getStorageId()
    await window.electronAPI.ai?.clearTerminalChatHistory(id)
    ElMessage.success('对话已清空')
  } catch {
    // 用户取消
  }
}

// 监听消息变化滚动到底部
watch(() => messages.value.length, () => {
  scrollToBottom()
})

// 执行特定操作（从外部调用）
const performAction = async (text: string) => {
  // 等待历史记录加载完成，防止覆盖或丢失
  if (!isHistoryReady.value) {
    console.log('[TerminalAI] Waiting for history to load...')
    let checks = 0
    while (!isHistoryReady.value && checks < 50) { // 最多等待 5 秒
      await new Promise(r => setTimeout(r, 100))
      checks++
    }
  }
  
  inputValue.value = text
  await sendMessage()
}

// 点击外部关闭文件选择器
const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (showFileSelector.value && !target.closest('.file-selector-popup') && !target.closest('.input-container')) {
    showFileSelector.value = false
  }
}

onMounted(() => {
  loadChatHistory()
  document.addEventListener('click', handleCodeBlockClick)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleCodeBlockClick)
  document.removeEventListener('click', handleClickOutside)
})

defineExpose({
  performAction,
  setInput
})
</script>

<style scoped>
.terminal-ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.title {
  font-weight: 600;
  font-size: var(--text-md);
  flex-shrink: 0;
}

.model-tag-display {
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 模型选择弹窗样式 */
.model-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.channel-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.channel-item {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: var(--text-md);
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-secondary);
}

.channel-item:hover {
  border-color: var(--primary-color);
}

.channel-item.active {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: var(--text-md);
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-secondary);
}

.model-item:hover {
  border-color: var(--primary-color);
  background: var(--bg-tertiary);
}

.model-item.active {
  border-color: var(--primary-color);
  background: var(--primary-bg-light);
}

.model-item .model-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-item .check-icon {
  color: var(--primary-color);
  font-size: var(--text-base);
}

.empty-hint {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  padding: 8px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-item {
  display: flex;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: var(--text-sm);
}

.message-content-wrapper {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.message-bubble {
  background: var(--bg-tertiary);
  padding: 10px 12px;
  border-radius: 12px;
  border-top-left-radius: 2px;
  font-size: var(--text-md);
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
  overflow-wrap: break-word;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.user .message-bubble {
  background: var(--primary-color);
  color: #fff;
  border-top-left-radius: 12px;
  border-top-right-radius: 2px;
}

.message-meta {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.user .message-meta {
  justify-content: flex-end;
}

/* Markdown Styles */
.markdown-body {
  overflow: hidden;
  word-break: break-word;
  overflow-wrap: break-word;
}

.markdown-body :deep(pre) {
  background: var(--bg-primary);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.markdown-body :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: var(--text-sm);
}

.markdown-body :deep(p) {
  margin: 0 0 8px 0;
  word-break: break-word;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(.code-block-wrapper) {
  position: relative;
  margin: 8px 0;
}

.markdown-body :deep(.code-toolbar) {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.markdown-body :deep(.code-btn) {
  padding: 2px 8px;
  font-size: var(--text-xs);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.markdown-body :deep(.code-btn:hover) {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}

.markdown-body :deep(.run-btn) {
  background: var(--success-color);
  color: #fff;
  border-color: var(--success-color);
}

.markdown-body :deep(.run-btn:hover) {
  background: var(--success-color);
  opacity: 0.9;
}

.error-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  color: var(--danger-color);
  font-size: var(--text-sm);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary);
  text-align: center;
  padding: 40px;
}

.empty-state p {
  margin: 12px 0 4px;
}

.empty-state .hint {
  font-size: var(--text-sm);
  opacity: 0.7;
  margin: 0 0 16px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.chat-footer {
  padding: 12px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border-color);
}

/* 附加文件列表 */
.attached-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.attached-file {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--primary-bg-light);
  border: 1px solid var(--primary-color);
  border-radius: 4px;
  font-size: var(--text-sm);
  color: var(--primary-color);
}

.attached-file .file-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attached-file .remove-btn {
  cursor: pointer;
  opacity: 0.7;
}

.attached-file .remove-btn:hover {
  opacity: 1;
}

.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-container {
  position: relative;
}

/* 文件选择器弹出框 */
.file-selector-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background-color: var(--el-bg-color, #1e1e1e);
  border: 1px solid var(--el-border-color, #3c3c3c);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  max-height: 300px;
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.file-selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color, #3c3c3c);
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--el-text-color-primary, #e0e0e0);
  background-color: var(--el-bg-color, #1e1e1e);
  border-radius: 8px 8px 0 0;
}

.file-selector-header .header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-selector-header .sync-btn,
.file-selector-header .close-btn {
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.file-selector-header .sync-btn:hover,
.file-selector-header .close-btn:hover {
  opacity: 1;
}

.path-input-row {
  display: flex;
  gap: 4px;
  padding: 8px;
  background-color: var(--el-bg-color, #1e1e1e);
  border-bottom: 1px solid var(--el-border-color, #3c3c3c);
}

.path-input-row .el-input {
  flex: 1;
}

/* 快速路径标签 */
.quick-paths {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  background-color: var(--el-bg-color, #1e1e1e);
  border-bottom: 1px solid var(--el-border-color, #3c3c3c);
}

.quick-paths .el-tag {
  cursor: pointer;
  transition: all 0.2s;
}

.quick-paths .el-tag:hover {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}

.file-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--text-sm);
  background-color: var(--el-bg-color, #1e1e1e);
}

.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  background-color: var(--el-bg-color, #1e1e1e);
  border-radius: 0 0 8px 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--text-md);
  transition: background 0.2s;
  color: var(--el-text-color-primary, #e0e0e0);
}

.file-item:hover {
  background: var(--el-fill-color-light, #363636);
}

.file-item.dir {
  color: var(--primary-color);
}

.file-item .file-size {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary, #909399);
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background: var(--text-secondary);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) { animation-delay: 0s; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}
</style>
