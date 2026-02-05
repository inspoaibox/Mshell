<template>
  <div class="split-terminal-tab">
    <SplitTerminalContainer
      :session-id="connectionId"
      @terminal-create="handleTerminalCreate"
      @terminal-close="handleTerminalClose"
      @terminal-focus="handleTerminalFocus"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import SplitTerminalContainer from './SplitTerminalContainer.vue'
import type { SessionConfig } from '@/types/session'

interface Props {
  connectionId: string
  session: SessionConfig
  terminalOptions?: any
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: [connectionId: string]
}>()

// 存储所有终端连接的映射
const terminalConnections = ref<Map<string, boolean>>(new Map())
const activeTerminalId = ref<string>('')

// 处理新终端创建
const handleTerminalCreate = async (terminalId: string) => {
  console.log(`[SplitTerminalTab] Creating terminal: ${terminalId}`)
  
  try {
    // 获取 SSH 设置
    const settings = await window.electronAPI.settings.get()
    const sshSettings = settings?.ssh || {}
    
    // 连接到 SSH（每个面板使用独立的连接）
    // 注意：privateKeyId 会在后端 ssh-handlers.ts 中处理
    // 优先使用 privateKeyId，如果没有则使用 privateKeyPath 或 privateKey
    const result = await window.electronAPI.ssh.connect(terminalId, {
      host: props.session.host,
      port: props.session.port,
      username: props.session.username,
      password: props.session.password,
      privateKey: props.session.privateKeyId ? undefined : (props.session.privateKeyPath || props.session.privateKey),
      privateKeyId: props.session.privateKeyId,
      passphrase: props.session.passphrase,
      // 应用 SSH 设置
      readyTimeout: (sshSettings.timeout || 30) * 1000,
      keepaliveInterval: sshSettings.keepalive ? (sshSettings.keepaliveInterval || 60) * 1000 : undefined,
      keepaliveCountMax: sshSettings.keepalive ? 3 : undefined,
      sessionName: props.session.name,
      // 跳板机和代理配置 - 序列化以便 IPC 传输
      proxyJump: props.session.proxyJump ? JSON.parse(JSON.stringify(props.session.proxyJump)) : undefined,
      proxy: props.session.proxy ? JSON.parse(JSON.stringify(props.session.proxy)) : undefined
    })

    if (result.success) {
      console.log(`[SplitTerminalTab] Terminal ${terminalId} connected`)
      terminalConnections.value.set(terminalId, true)
    } else {
      ElMessage.error(`连接失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error(`[SplitTerminalTab] Connection error:`, error)
    ElMessage.error(`连接错误: ${error.message}`)
  }
}

// 处理终端关闭
const handleTerminalClose = async (terminalId: string) => {
  console.log(`[SplitTerminalTab] Closing terminal: ${terminalId}`)
  
  try {
    // 断开 SSH 连接
    await window.electronAPI.ssh.disconnect(terminalId)
    terminalConnections.value.delete(terminalId)
    console.log(`[SplitTerminalTab] Terminal ${terminalId} disconnected`)
  } catch (error) {
    console.error(`[SplitTerminalTab] Error closing terminal:`, error)
  }
}

// 处理终端焦点
const handleTerminalFocus = (terminalId: string) => {
  activeTerminalId.value = terminalId
  console.log(`[SplitTerminalTab] Focus terminal: ${terminalId}`)
}

onMounted(() => {
  console.log(`[SplitTerminalTab] Mounted for session: ${props.session.host}`)
})

onUnmounted(async () => {
  console.log(`[SplitTerminalTab] Cleaning up all terminals`)
  
  // 清理所有终端连接
  for (const terminalId of terminalConnections.value.keys()) {
    try {
      await window.electronAPI.ssh.disconnect(terminalId)
    } catch (error) {
      console.error(`Error cleaning up terminal ${terminalId}:`, error)
    }
  }
  
  terminalConnections.value.clear()
})

defineExpose({
  focus: () => {
    console.log(`[SplitTerminalTab] Focus requested for active terminal: ${activeTerminalId.value}`)
  }
})
</script>

<style scoped>
.split-terminal-tab {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-main);
}
</style>
