<template>
  <div class="proxy-jump-config">
    <div class="config-header">
      <el-checkbox v-model="localConfig.enabled" @change="emitUpdate">
        <el-icon><Connection /></el-icon>
        <span>启用跳板机 (ProxyJump)</span>
      </el-checkbox>
      <el-button
        v-if="localConfig.enabled && !isNested"
        type="primary"
        size="small"
        :icon="Plus"
        @click.prevent="addNextJump"
      >
        添加下一级
      </el-button>
    </div>

    <div v-if="localConfig.enabled" class="config-body">
      <div v-if="level > 0" class="level-indicator">
        <el-tag type="primary" size="small">第 {{ level + 1 }} 级跳板</el-tag>
        <el-button 
          type="danger" 
          size="small" 
          :icon="Delete" 
          circle 
          @click.prevent="removeThisLevel"
        />
      </div>

      <div class="host-port-row">
        <el-form-item label="主机" label-width="100px" style="flex: 1">
          <el-input
            v-model="localConfig.host"
            placeholder="跳板机IP或域名"
            @input="emitUpdate"
          />
        </el-form-item>
        <el-form-item label="端口" label-width="60px" style="width: 140px">
          <el-input-number
            v-model="localConfig.port"
            :min="1"
            :max="65535"
            style="width: 100%"
            @change="emitUpdate"
          />
        </el-form-item>
      </div>

      <el-form-item label="用户名" label-width="100px">
        <el-input
          v-model="localConfig.username"
          placeholder="用户名"
          @input="emitUpdate"
        />
      </el-form-item>

      <el-form-item label="认证方式" label-width="100px">
        <el-radio-group v-model="localConfig.authType" @change="emitUpdate">
          <el-radio value="password">密码</el-radio>
          <el-radio value="privateKey">私钥</el-radio>
        </el-radio-group>
      </el-form-item>

      <!-- 密码认证 -->
      <el-form-item v-if="localConfig.authType === 'password'" label="密码" label-width="100px">
        <el-input
          v-model="localConfig.password"
          type="password"
          placeholder="跳板机密码"
          show-password
          @input="emitUpdate"
        />
      </el-form-item>

      <!-- 私钥认证 -->
      <el-form-item v-if="localConfig.authType === 'privateKey'" label="私钥路径" label-width="100px">
        <el-input
          v-model="localConfig.privateKeyPath"
          placeholder="私钥文件路径"
          @input="emitUpdate"
        >
          <template #append>
            <el-button @click.prevent="selectPrivateKey">浏览</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item v-if="localConfig.authType === 'privateKey'" label="私钥密码" label-width="100px">
        <el-input
          v-model="localConfig.passphrase"
          type="password"
          placeholder="如果私钥有密码保护（可选）"
          show-password
          @input="emitUpdate"
        />
      </el-form-item>

      <!-- 连接预览 -->
      <div class="connection-preview">
        <div class="preview-label">连接路径：</div>
        <div class="preview-chain">
          <el-tag type="info" size="small">本机</el-tag>
          <el-icon><Right /></el-icon>
          <el-tag type="primary" size="small">
            {{ localConfig.username || 'user' }}@{{ localConfig.host || 'host' }}:{{ localConfig.port }}
          </el-tag>
          <template v-if="localConfig.nextJump">
            <el-icon><Right /></el-icon>
            <el-tag type="warning" size="small">...</el-tag>
          </template>
          <el-icon><Right /></el-icon>
          <el-tag type="success" size="small">目标服务器</el-tag>
        </div>
      </div>

      <!-- 递归渲染下一级跳板 -->
      <div v-if="localConfig.nextJump" class="next-jump">
        <ProxyJumpConfig
          :config="localConfig.nextJump"
          :level="level + 1"
          :is-nested="true"
          @update="handleNextJumpUpdate"
          @remove="removeNextJump"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Connection, Plus, Delete, Right } from '@element-plus/icons-vue'
import type { ProxyJumpConfig as ProxyJumpConfigType } from '@/types/session'

interface Props {
  config?: ProxyJumpConfigType
  level?: number
  isNested?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  level: 0,
  isNested: false
})

const emit = defineEmits<{
  update: [config: ProxyJumpConfigType]
  remove: []
}>()

// 本地配置
const localConfig = ref<ProxyJumpConfigType>({
  enabled: props.config?.enabled || false,
  host: props.config?.host || '',
  port: props.config?.port || 22,
  username: props.config?.username || '',
  authType: props.config?.authType || 'password',
  password: props.config?.password || '',
  privateKeyPath: props.config?.privateKeyPath || '',
  passphrase: props.config?.passphrase || '',
  nextJump: props.config?.nextJump
})

// 监听外部配置变化
watch(() => props.config, (newConfig) => {
  if (newConfig) {
    localConfig.value = { ...newConfig }
  }
}, { deep: true })

// 发送更新
const emitUpdate = () => {
  emit('update', { ...localConfig.value })
}

// 添加下一级跳板
const addNextJump = () => {
  localConfig.value.nextJump = {
    enabled: true,
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    password: ''
  }
  emitUpdate()
}

// 移除下一级跳板
const removeNextJump = () => {
  localConfig.value.nextJump = undefined
  emitUpdate()
}

// 处理下一级跳板更新
const handleNextJumpUpdate = (config: ProxyJumpConfigType) => {
  localConfig.value.nextJump = config
  emitUpdate()
}

// 移除当前级别
const removeThisLevel = () => {
  emit('remove')
}

// 选择私钥文件
const selectPrivateKey = async () => {
  try {
    const result = await window.electronAPI.dialog.openFile({
      title: '选择私钥文件',
      filters: [
        { name: '私钥文件', extensions: ['pem', 'key', 'ppk'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result) {
      localConfig.value.privateKeyPath = result
      emitUpdate()
    }
  } catch (error) {
    console.error('Failed to select private key:', error)
  }
}
</script>

<style scoped>
.proxy-jump-config {
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

.level-indicator {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.host-port-row {
  display: flex;
  gap: 12px;
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

.next-jump {
  margin-top: 16px;
  margin-left: 16px;
  padding-left: 16px;
  border-left: 2px solid var(--primary-color);
}
</style>
