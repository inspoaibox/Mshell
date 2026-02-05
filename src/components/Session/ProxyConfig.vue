<template>
  <div class="proxy-config">
    <div class="config-header">
      <el-checkbox v-model="localConfig.enabled" @change="handleUpdate">
        <el-icon><Promotion /></el-icon>
        <span>启用代理 (Proxy)</span>
      </el-checkbox>
      <el-button
        v-if="localConfig.enabled && localConfig.host"
        type="primary"
        size="small"
        :loading="testing"
        @click.prevent="testConnection"
      >
        测试连接
      </el-button>
    </div>

    <div v-if="localConfig.enabled" class="config-body">
      <el-form-item label="代理类型" label-width="100px">
        <el-radio-group v-model="localConfig.type" @change="handleUpdate">
          <el-radio value="socks5">SOCKS5</el-radio>
          <el-radio value="http">HTTP</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="主机" label-width="100px">
        <el-input 
          v-model="localConfig.host" 
          placeholder="proxy.example.com"
          @input="handleUpdate"
        />
      </el-form-item>

      <el-form-item label="端口" label-width="100px">
        <el-input-number 
          v-model="localConfig.port" 
          :min="1" 
          :max="65535"
          :controls="true"
          controls-position="right"
          style="width: 180px"
          @change="handleUpdate"
        />
      </el-form-item>

      <el-form-item label="用户名" label-width="100px">
        <el-input 
          v-model="localConfig.username" 
          placeholder="可选"
          @input="handleUpdate"
        />
      </el-form-item>

      <el-form-item label="密码" label-width="100px">
        <el-input 
          v-model="localConfig.password" 
          type="password"
          placeholder="可选"
          show-password
          @input="handleUpdate"
        />
      </el-form-item>

      <!-- 连接预览 -->
      <div class="connection-preview">
        <div class="preview-label">代理路径：</div>
        <div class="preview-chain">
          <el-tag type="info" size="small">本机</el-tag>
          <el-icon><Right /></el-icon>
          <el-tag type="warning" size="small">
            {{ localConfig.type.toUpperCase() }} {{ localConfig.host || 'host' }}:{{ localConfig.port }}
          </el-tag>
          <el-icon><Right /></el-icon>
          <el-tag type="success" size="small">
            {{ props.targetHost || '目标服务器' }}{{ props.targetPort ? ':' + props.targetPort : '' }}
          </el-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Promotion, Right } from '@element-plus/icons-vue'
import type { ProxyConfig as ProxyConfigType } from '@/types/session'

const props = defineProps<{
  config?: ProxyConfigType
  targetHost?: string
  targetPort?: number
}>()

const emit = defineEmits<{
  update: [config: ProxyConfigType]
}>()

const localConfig = ref<ProxyConfigType>({
  enabled: false,
  type: 'socks5',
  host: '',
  port: 1080,
  username: '',
  password: ''
})

const testing = ref(false)

watch(
  () => props.config,
  (newConfig) => {
    if (newConfig) {
      localConfig.value = { ...newConfig }
    } else {
      localConfig.value.enabled = false
    }
  },
  { immediate: true, deep: true }
)

const handleUpdate = () => {
  emit('update', { ...localConfig.value })
}

const testConnection = async () => {
  if (!localConfig.value.host || !localConfig.value.port) {
    ElMessage.warning('请填写代理主机和端口')
    return
  }

  testing.value = true
  try {
    const result = await window.electronAPI.ssh.testProxy({
      type: localConfig.value.type,
      host: localConfig.value.host,
      port: localConfig.value.port,
      username: localConfig.value.username,
      password: localConfig.value.password
    })

    if (result.success) {
      ElMessage.success(`${result.message} (延迟: ${result.latency}ms)`)
    } else {
      ElMessage.error(result.error || '代理连接失败')
    }
  } catch (error: any) {
    ElMessage.error(`测试失败: ${error.message}`)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.proxy-config {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  background-color: var(--bg-secondary);
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.config-header :deep(.el-checkbox__label) {
  display: flex;
  align-items: center;
  gap: 6px;
}

.config-body {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color);
}

.connection-preview {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  border: 1px dashed var(--border-color);
  margin-top: 12px;
}

.preview-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.preview-chain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.preview-chain .el-icon {
  color: var(--text-tertiary);
}
</style>
