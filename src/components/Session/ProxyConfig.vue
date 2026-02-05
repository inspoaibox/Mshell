<template>
  <div class="proxy-config">
    <div class="config-header">
      <el-checkbox v-model="localConfig.enabled" @change="handleUpdate">
        <el-icon><Promotion /></el-icon>
        <span>启用代理 (Proxy)</span>
      </el-checkbox>
    </div>

    <div v-if="localConfig.enabled" class="config-body">
      <el-form-item label="代理类型" label-width="100px">
        <el-radio-group v-model="localConfig.type" @change="handleUpdate">
          <el-radio value="socks5">SOCKS5</el-radio>
          <el-radio value="http">HTTP</el-radio>
        </el-radio-group>
      </el-form-item>

      <div class="host-port-row">
        <el-form-item label="主机" label-width="100px" style="flex: 1">
          <el-input 
            v-model="localConfig.host" 
            placeholder="proxy.example.com"
            @input="handleUpdate"
          />
        </el-form-item>
        <el-form-item label="端口" label-width="60px" style="width: 140px">
          <el-input-number 
            v-model="localConfig.port" 
            :min="1" 
            :max="65535"
            style="width: 100%"
            @change="handleUpdate"
          />
        </el-form-item>
      </div>

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
          <el-tag type="success" size="small">目标服务器</el-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Promotion, Right } from '@element-plus/icons-vue'
import type { ProxyConfig as ProxyConfigType } from '@/types/session'

const props = defineProps<{
  config?: ProxyConfigType
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
</script>
