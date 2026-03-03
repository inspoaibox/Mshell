<template>
  <div class="ai-chat-panel">
    <div class="chat-header">
      <div class="header-left">
        <span class="title">AI 助手</span>
        <span class="model-badge" v-if="currentModel">{{ currentModel.displayName }}</span>
      </div>
      <div class="header-actions">
        <el-tooltip content="清空对话" placement="bottom">
          <el-button link :icon="Delete" @click="handleClear" />
        </el-tooltip>
        <el-button link :icon="Close" @click="appStore.showAIChat = false" />
      </div>
    </div>

    <div class="chat-messages" ref="scrollContainer">
      <template v-if="aiStore.messages.length > 0">
        <div 
          v-for="msg in aiStore.messages" 
          :key="msg.id" 
          class="message-item"
          :class="msg.role"
        >
          <div class="message-avatar">
            <el-icon v-if="msg.role === 'user'"><User /></el-icon>
            <el-icon v-else><Monitor /></el-icon>
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
              </div>
            </div>
          </div>
        </div>
      </template>
      
      <div v-if="aiStore.chatLoading" class="message-item assistant loading">
        <div class="message-avatar">
          <el-icon><Monitor /></el-icon>
        </div>
        <div class="message-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
      
      <div v-if="aiStore.messages.length === 0 && !aiStore.chatLoading" class="empty-state">
        <el-icon :size="48"><ChatDotRound /></el-icon>
        <p>有什么我可以帮你的吗？</p>
        <div class="quick-actions">
          <el-button size="small" @click="setInput('解释选中的代码')">解释代码</el-button>
          <el-button size="small" @click="setInput('帮我写一个 SSH 连接脚本')">编写脚本</el-button>
        </div>
      </div>
    </div>

    <div class="chat-footer">
      <div class="input-wrapper">
        <el-input
          ref="inputRef"
          v-model="inputValue"
          type="textarea"
          :rows="3"
          placeholder="输入你的问题... (Shift+Enter 换行)"
          @keydown.enter.exact.prevent="sendMessage"
          resize="none"
        />
        <div class="footer-actions">
          <el-tooltip content="设置" placement="top">
            <el-button link :icon="Setting" size="small" @click="openSettings" />
          </el-tooltip>
          <el-button type="primary" size="small" :loading="aiStore.chatLoading" @click="sendMessage">
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
import { useAppStore } from '@/stores/app'
import { marked } from 'marked'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Delete, Close, User, Monitor, Warning, 
  ChatDotRound, Setting  
} from '@element-plus/icons-vue'

const aiStore = useAIStore()
const appStore = useAppStore()
const inputValue = ref('')
const scrollContainer = ref<HTMLElement>()
const inputRef = ref<any>()

const currentModel = computed(() => aiStore.defaultModel)

// 初始化
onMounted(async () => {
  if (aiStore.messages.length === 0) {
    await aiStore.loadChatHistory()
  }
  nextTick(() => scrollToBottom())
  document.addEventListener('click', handleCodeBlockClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleCodeBlockClick)
})

// 监听消息变化自动滚动
watch(() => aiStore.messages.length, () => {
  nextTick(() => scrollToBottom())
})

const scrollToBottom = () => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
  }
}

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 渲染 Markdown，为代码块添加工具栏
const renderMarkdown = (content: string) => {
  try {
    const html = marked.parse(content) as string
    return html.replace(
      /<pre><code([^>]*)>(.*?)<\/code><\/pre>/gs,
      (_match, attrs, code) => {
        const escapedCode = code
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
        const base64Code = btoa(unescape(encodeURIComponent(escapedCode)))
        return `<div class="code-block-wrapper">
          <div class="code-toolbar">
            <button class="code-btn copy-btn" data-code="${base64Code}" title="复制代码">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              复制
            </button>
            <button class="code-btn insert-btn" data-code="${base64Code}" title="插入终端">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4z"/></svg>
              插入终端
            </button>
          </div>
          <pre><code${attrs}>${code}</code></pre>
        </div>`
      }
    )
  } catch (e) {
    return content
  }
}

// 处理代码块按钮点击
const handleCodeBlockClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  const btn = target.closest('.code-btn') as HTMLElement
  if (!btn) return

  const base64Code = btn.dataset.code
  if (!base64Code) return

  try {
    const code = decodeURIComponent(escape(atob(base64Code)))
    
    if (btn.classList.contains('copy-btn')) {
      navigator.clipboard.writeText(code).then(() => {
        ElMessage.success('已复制到剪贴板')
      }).catch(() => {
        ElMessage.error('复制失败')
      })
    } else if (btn.classList.contains('insert-btn')) {
      const activeTab = appStore.activeTab
      if (!activeTab) {
        ElMessage.warning('请先打开一个终端会话')
        return
      }
      window.electronAPI?.ssh?.write?.(activeTab, code)
      ElMessage.success('已插入终端')
    }
  } catch (err) {
    ElMessage.error('操作失败')
  }
}

const setInput = (text: string) => {
  inputValue.value = text
  nextTick(() => {
    inputRef.value?.focus()
  })
}

const sendMessage = async () => {
  const content = inputValue.value.trim()
  if (!content) return
  
  if (!aiStore.hasDefaultModel) {
    ElMessage.warning('请先在配置中选择默认 AI 模型')
    return
  }

  inputValue.value = ''
  
  try {
    await aiStore.sendChatMessage(content)
  } catch (error) {
    // 错误已由 store 处理
  }
}

const handleClear = () => {
  if (aiStore.messages.length === 0) return
  
  ElMessageBox.confirm('确定要清空当前对话记录吗？', '清空对话', {
    confirmButtonText: '清空',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    aiStore.clearMessages()
  })
}

const openSettings = () => {
  appStore.activeView = 'settings'
}
</script>

<style scoped>
.ai-chat-panel {
  position: absolute;
  top: 56px;
  right: 0;
  bottom: 0;
  width: 400px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  z-index: 100;
  box-shadow: var(--shadow-lg);
}

.chat-header {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-tertiary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-weight: 600;
  font-size: 14px;
}

.model-badge {
  font-size: 10px;
  background: var(--primary-bg-light);
  color: var(--primary-color);
  padding: 2px 6px;
  border-radius: 4px;
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
  font-size: 12px;
}

.message-content-wrapper {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.message-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.user .message-meta {
  justify-content: flex-end;
}

.message-bubble {
  background: var(--bg-tertiary);
  padding: 10px 12px;
  border-radius: 12px;
  border-top-left-radius: 2px;
  font-size: 13px;
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

.error-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  color: var(--el-color-danger);
  font-size: 12px;
}

/* Markdown Styles */
.markdown-body {
  overflow: hidden;
  word-break: break-word;
}

.markdown-body :deep(pre) {
  background: var(--bg-main);
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
  max-width: 100%;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.markdown-body :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  word-break: break-all;
}

.markdown-body :deep(pre code) {
  white-space: pre-wrap;
  word-break: break-all;
}

.markdown-body :deep(p) {
  margin-bottom: 8px;
  word-break: break-word;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(ol),
.markdown-body :deep(ul) {
  padding-left: 20px;
  margin-bottom: 8px;
}

.markdown-body :deep(li) {
  margin-bottom: 4px;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin-top: 12px;
  margin-bottom: 8px;
  font-weight: 600;
}

.user .markdown-body :deep(pre) {
  background: rgba(0,0,0,0.1);
}

/* Code Block Toolbar */
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.markdown-body :deep(.code-btn:hover) {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--primary-bg-light);
}

.markdown-body :deep(.code-btn svg) {
  flex-shrink: 0;
}

.markdown-body :deep(.insert-btn:hover) {
  color: var(--success-color, #67c23a);
  border-color: var(--success-color, #67c23a);
  background: rgba(103, 194, 58, 0.1);
}

.user .markdown-body :deep(.code-btn) {
  background: rgba(255,255,255,0.2);
  border-color: rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.9);
}

.user .markdown-body :deep(.code-btn:hover) {
  background: rgba(255,255,255,0.3);
  border-color: rgba(255,255,255,0.5);
}

.chat-footer {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.input-wrapper {
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  padding: 8px;
}

.input-wrapper :deep(.el-textarea__inner) {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  resize: none;
}

.footer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  gap: 16px;
  opacity: 0.6;
}

.quick-actions {
  display: flex;
  gap: 8px;
}

.typing-indicator span {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--text-secondary);
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
</style>
