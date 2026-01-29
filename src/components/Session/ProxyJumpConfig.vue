<template>
  <div class="proxy-jump-config">
    <div class="config-header">
      <label class="checkbox-label">
        <input
          type="checkbox"
          v-model="localConfig.enabled"
          @change="emitUpdate"
        />
        <span>启用跳板机（ProxyJump）</span>
      </label>
      <button
        v-if="localConfig.enabled && !isNested"
        @click="addNextJump"
        class="btn-add"
        title="添加下一级跳板"
      >
        ➕ 添加下一级
      </button>
    </div>

    <div v-if="localConfig.enabled" class="config-content">
      <div class="config-level">
        <div v-if="level > 0" class="level-indicator">
          <span class="level-badge">第 {{ level + 1 }} 级跳板</span>
          <button @click="removeThisLevel" class="btn-remove" title="删除此级">
            🗑️
          </button>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label>主机地址 *</label>
            <input
              v-model="localConfig.host"
              type="text"
              placeholder="跳板机IP或域名"
              @input="emitUpdate"
            />
          </div>

          <div class="form-group">
            <label>端口 *</label>
            <input
              v-model.number="localConfig.port"
              type="number"
              placeholder="22"
              @input="emitUpdate"
            />
          </div>

          <div class="form-group">
            <label>用户名 *</label>
            <input
              v-model="localConfig.username"
              type="text"
              placeholder="用户名"
              @input="emitUpdate"
            />
          </div>

          <div class="form-group">
            <label>认证方式 *</label>
            <select v-model="localConfig.authType" @change="emitUpdate">
              <option value="password">密码</option>
              <option value="privateKey">私钥</option>
            </select>
          </div>
        </div>

        <!-- 密码认证 -->
        <div v-if="localConfig.authType === 'password'" class="form-group">
          <label>密码 *</label>
          <input
            v-model="localConfig.password"
            type="password"
            placeholder="跳板机密码"
            @input="emitUpdate"
          />
        </div>

        <!-- 私钥认证 -->
        <div v-if="localConfig.authType === 'privateKey'" class="form-group">
          <label>私钥路径 *</label>
          <div class="input-with-button">
            <input
              v-model="localConfig.privateKeyPath"
              type="text"
              placeholder="私钥文件路径"
              @input="emitUpdate"
            />
            <button @click="selectPrivateKey" class="btn-browse">
              浏览
            </button>
          </div>
        </div>

        <div v-if="localConfig.authType === 'privateKey'" class="form-group">
          <label>私钥密码（可选）</label>
          <input
            v-model="localConfig.passphrase"
            type="password"
            placeholder="如果私钥有密码保护"
            @input="emitUpdate"
          />
        </div>

        <!-- 连接预览 -->
        <div class="connection-preview">
          <div class="preview-label">连接路径：</div>
          <div class="preview-chain">
            <span class="chain-item">本机</span>
            <span class="chain-arrow">→</span>
            <span class="chain-item highlight">
              {{ localConfig.username }}@{{ localConfig.host }}:{{ localConfig.port }}
            </span>
            <template v-if="localConfig.nextJump">
              <span class="chain-arrow">→</span>
              <span class="chain-item">...</span>
            </template>
            <span class="chain-arrow">→</span>
            <span class="chain-item">目标服务器</span>
          </div>
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
  border-radius: 6px;
  padding: 16px;
  background: var(--bg-secondary);
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.btn-add {
  padding: 6px 12px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-add:hover {
  background: var(--primary-hover);
}

.config-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-level {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.level-indicator {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.level-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
}

.btn-remove {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-remove:hover {
  background: var(--error-color);
  border-color: var(--error-color);
  color: white;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.form-group input,
.form-group select {
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 14px;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--primary-color);
}

.input-with-button {
  display: flex;
  gap: 8px;
}

.input-with-button input {
  flex: 1;
}

.btn-browse {
  padding: 8px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-browse:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.connection-preview {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  border: 1px dashed var(--border-color);
}

.preview-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.preview-chain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.chain-item {
  padding: 4px 8px;
  background: var(--bg-primary);
  border-radius: 4px;
  color: var(--text-primary);
}

.chain-item.highlight {
  background: var(--primary-color);
  color: white;
  font-weight: 500;
}

.chain-arrow {
  color: var(--text-tertiary);
  font-weight: bold;
}

.next-jump {
  margin-left: 24px;
  padding-left: 16px;
  border-left: 2px solid var(--border-color);
}
</style>
