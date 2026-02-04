<template>
  <div class="vnc-tab">
    <div class="vnc-header glass-header">
      <div class="status-indicator">
        <span class="status-dot" :class="statusClass"></span>
      </div>
      <div class="connection-info">
        <span class="host-name">{{ displayName }}</span>
        <span class="status-text">{{ connectionStatusText }}</span>
      </div>
      <div class="header-actions">
        <el-tooltip content="全屏" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="FullScreen"
            @click="toggleFullscreen"
            class="action-btn"
          />
        </el-tooltip>
        <el-tooltip content="发送 Ctrl+Alt+Del" placement="bottom">
          <el-button
            type="primary"
            link
            @click="sendCtrlAltDel"
            class="action-btn"
          >
            <span style="font-size: 10px;">CAD</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="剪贴板" placement="bottom">
          <el-button
            type="primary"
            link
            :icon="DocumentCopy"
            @click="showClipboard = !showClipboard"
            class="action-btn"
            :class="{ 'is-active': showClipboard }"
          />
        </el-tooltip>
        <el-tooltip content="断开连接" placement="bottom">
          <el-button
            type="danger"
            link
            :icon="Close"
            @click="handleDisconnect"
            class="action-btn"
          />
        </el-tooltip>
      </div>
    </div>
    
    <div class="vnc-body" ref="vncContainerRef">
      <!-- 连接中状态 -->
      <div v-if="connectionStatus === 'connecting'" class="connecting-overlay">
        <div class="loader"></div>
        <div class="loading-text">正在连接到 {{ session?.host }}:{{ session?.port || 5900 }}...</div>
      </div>
      
      <!-- 错误状态 -->
      <div v-else-if="connectionStatus === 'error'" class="error-overlay">
        <el-icon :size="48" class="error-icon"><CircleClose /></el-icon>
        <div class="error-text">{{ errorMessage }}</div>
        <el-button type="primary" @click="reconnect">重新连接</el-button>
      </div>
      
      <!-- VNC 画布 -->
      <div 
        v-show="connectionStatus === 'connected'" 
        ref="vncScreenRef" 
        class="vnc-screen"
      ></div>
    </div>
    
    <!-- 剪贴板面板 -->
    <transition name="slide-left">
      <div v-if="showClipboard" class="clipboard-panel">
        <div class="panel-header">
          <h3>剪贴板</h3>
          <el-button :icon="Close" link @click="showClipboard = false" />
        </div>
        <div class="panel-content">
          <el-input
            v-model="clipboardText"
            type="textarea"
            :rows="10"
            placeholder="在此输入要发送到远程的文本..."
          />
          <div class="clipboard-actions">
            <el-button size="small" @click="pasteFromLocal">从本地粘贴</el-button>
            <el-button size="small" type="primary" @click="sendToRemote">发送到远程</el-button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { FullScreen, DocumentCopy, Close, CircleClose } from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

// noVNC 使用本地 ESM 源码
import RFB from '@/lib/novnc/rfb.js'

interface Props {
  connectionId: string
  session: SessionConfig
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: [connectionId: string]
}>()

const vncContainerRef = ref<HTMLElement>()
const vncScreenRef = ref<HTMLElement>()
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const errorMessage = ref('')
const showClipboard = ref(false)
const clipboardText = ref('')
const wsPort = ref(0)

let rfb: any = null

const displayName = computed(() => {
  return props.session.name || `${props.session.host}:${props.session.port || 5900}`
})

const connectionStatusText = computed(() => {
  switch (connectionStatus.value) {
    case 'connecting': return '连接中...'
    case 'connected': return '已连接'
    case 'disconnected': return '已断开'
    case 'error': return '连接错误'
    default: return ''
  }
})

const statusClass = computed(() => ({
  'status-connecting': connectionStatus.value === 'connecting',
  'status-connected': connectionStatus.value === 'connected',
  'status-disconnected': connectionStatus.value === 'disconnected',
  'status-error': connectionStatus.value === 'error'
}))

// 连接 VNC
const connect = async () => {
  connectionStatus.value = 'connecting'
  errorMessage.value = ''

  try {
    // 启动 WebSocket 代理
    const vncConfig = {
      id: props.connectionId,
      host: props.session.host,
      port: props.session.port || 5900,
      password: props.session.password,
      ...(props.session.vncOptions || {})
    }

    const result = await window.electronAPI.vnc.connect(vncConfig)
    
    if (!result.success) {
      throw new Error(result.error || '启动 VNC 代理失败')
    }

    wsPort.value = result.wsPort!
    console.log(`[VNCTab] WebSocket proxy started on port ${wsPort.value}`)

    // 等待 DOM 更新
    await nextTick()

    // 创建 noVNC 连接
    if (!vncScreenRef.value) {
      throw new Error('VNC 容器未就绪')
    }

    const url = `ws://127.0.0.1:${wsPort.value}`
    console.log(`[VNCTab] Connecting to ${url}`)

    rfb = new RFB(vncScreenRef.value, url, {
      credentials: props.session.password ? { password: props.session.password } : undefined,
      shared: props.session.vncOptions?.sharedConnection !== false,
      wsProtocols: ['binary']
    })

    // 配置 RFB
    rfb.viewOnly = props.session.vncOptions?.viewOnly || false
    rfb.scaleViewport = true
    rfb.resizeSession = true
    rfb.showDotCursor = props.session.vncOptions?.localCursor !== false

    // 设置质量和压缩
    if (props.session.vncOptions?.quality !== undefined) {
      rfb.qualityLevel = props.session.vncOptions.quality
    }
    if (props.session.vncOptions?.compression !== undefined) {
      rfb.compressionLevel = props.session.vncOptions.compression
    }

    // 事件处理
    rfb.addEventListener('connect', () => {
      console.log('[VNCTab] Connected to VNC server')
      connectionStatus.value = 'connected'
      ElMessage.success('VNC 连接成功')
    })

    rfb.addEventListener('disconnect', (e: any) => {
      console.log('[VNCTab] Disconnected from VNC server', e.detail)
      connectionStatus.value = 'disconnected'
      if (e.detail.clean) {
        ElMessage.info('VNC 连接已断开')
      } else {
        errorMessage.value = '连接意外断开'
        connectionStatus.value = 'error'
        ElMessage.error('VNC 连接意外断开')
      }
    })

    rfb.addEventListener('credentialsrequired', () => {
      console.log('[VNCTab] Credentials required')
      if (props.session.password) {
        rfb?.sendCredentials({ password: props.session.password })
      } else {
        errorMessage.value = 'VNC 服务器需要密码'
        connectionStatus.value = 'error'
      }
    })

    rfb.addEventListener('securityfailure', (e: any) => {
      console.error('[VNCTab] Security failure:', e.detail)
      errorMessage.value = `认证失败: ${e.detail.reason || '密码错误'}`
      connectionStatus.value = 'error'
    })

  } catch (error: any) {
    console.error('[VNCTab] Connection error:', error)
    errorMessage.value = error.message
    connectionStatus.value = 'error'
    ElMessage.error(`VNC 连接失败: ${error.message}`)
  }
}

// 断开连接
const handleDisconnect = async () => {
  try {
    if (rfb) {
      rfb.disconnect()
      rfb = null
    }
    await window.electronAPI.vnc.disconnect(props.connectionId)
  } catch (error) {
    console.error('[VNCTab] Disconnect error:', error)
  }
  emit('close', props.connectionId)
}

// 重新连接
const reconnect = () => {
  if (rfb) {
    rfb.disconnect()
    rfb = null
  }
  connect()
}

// 全屏切换
const toggleFullscreen = () => {
  if (!vncContainerRef.value) return
  
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    vncContainerRef.value.requestFullscreen()
  }
}

// 发送 Ctrl+Alt+Del
const sendCtrlAltDel = () => {
  if (rfb) {
    rfb.sendCtrlAltDel()
    ElMessage.success('已发送 Ctrl+Alt+Del')
  }
}

// 从本地剪贴板粘贴
const pasteFromLocal = async () => {
  try {
    const text = await navigator.clipboard.readText()
    clipboardText.value = text
  } catch (error) {
    ElMessage.error('无法读取剪贴板')
  }
}

// 发送文本到远程
const sendToRemote = () => {
  if (rfb && clipboardText.value) {
    rfb.clipboardPasteFrom(clipboardText.value)
    ElMessage.success('已发送到远程剪贴板')
  }
}

onMounted(() => {
  connect()
})

onUnmounted(() => {
  if (rfb) {
    rfb.disconnect()
    rfb = null
  }
  // 清理代理
  window.electronAPI.vnc.disconnect(props.connectionId).catch(() => {})
})
</script>

<style scoped>
.vnc-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.vnc-header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.status-dot.status-connecting {
  background: var(--warning-color);
  animation: pulse 1.5s infinite;
}

.status-dot.status-connected {
  background: var(--success-color);
}

.status-dot.status-disconnected,
.status-dot.status-error {
  background: var(--danger-color);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.connection-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.host-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  padding: 6px;
}

.action-btn.is-active {
  color: var(--primary-color);
  background: var(--primary-color-light);
}

.vnc-body {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000;
}

.vnc-screen {
  width: 100%;
  height: 100%;
}

.vnc-screen :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}

.connecting-overlay,
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  gap: 16px;
}

.loader {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text,
.error-text {
  font-size: 14px;
  color: var(--text-secondary);
}

.error-icon {
  color: var(--danger-color);
}

.error-text {
  color: var(--danger-color);
}

/* 剪贴板面板 */
.clipboard-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 300px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-content {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.clipboard-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* 动画 */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.3s ease;
}

.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(100%);
}
</style>
