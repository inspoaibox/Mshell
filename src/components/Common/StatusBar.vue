<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">
        <el-icon><Connection /></el-icon>
        {{ activeConnections }} Active
      </span>
      <span class="status-item" v-if="currentSession">
        {{ currentSession.username }}@{{ currentSession.host }}:{{ currentSession.port }}
      </span>
    </div>
    
    <div class="status-right">
      <span class="status-item" v-if="transferring">
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ transferCount }} transfers
      </span>
      <span class="status-item">
        {{ displayVersion }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { Connection, Loading } from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

interface Props {
  activeConnections?: number
  currentSession?: SessionConfig | null
  transferCount?: number
  appVersion?: string
}

const props = withDefaults(defineProps<Props>(), {
  activeConnections: 0,
  currentSession: null,
  transferCount: 0,
  appVersion: 'v0.1.3' // Updated default
})

const dynamicVersion = ref('')

onMounted(async () => {
  if (window.electronAPI.app && window.electronAPI.app.getVersion) {
    try {
      const v = await window.electronAPI.app.getVersion()
      dynamicVersion.value = `v${v}`
    } catch (e) {
      console.error('Failed to get app version:', e)
    }
  }
})

// Use dynamic version if available, otherwise fallback to prop or default
const displayVersion = computed(() => dynamicVersion.value || props.appVersion)

const transferring = computed(() => props.transferCount > 0)
</script>

<style scoped>
.status-bar {
  height: 24px;
  background: #007acc;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: var(--text-sm);
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-item .el-icon {
  font-size: var(--text-base);
}
</style>
