<template>
  <div class="session-lock-panel">
    <div class="panel-header">
      <h2>会话锁定</h2>
    </div>

    <div class="panel-content">
      <!-- 锁定状态 -->
      <div class="lock-status">
        <div class="status-card" :class="{ locked: status.isLocked }">
          <el-icon :size="48">
            <Lock v-if="status.isLocked" />
            <Unlock v-else />
          </el-icon>
          <h3>{{ status.isLocked ? '已锁定' : '未锁定' }}</h3>
          <p v-if="!status.isLocked && status.hasPassword">
            {{ config.autoLockEnabled ? `${config.autoLockTimeout} 分钟无操作后自动锁定` : '自动锁定已禁用' }}
          </p>
        </div>
      </div>

      <!-- 锁定设置 -->
      <div class="settings-section">
        <h3>锁定设置</h3>
        <el-form label-width="120px">
          <el-form-item label="启用密码保护">
            <el-switch v-model="config.hasPassword" @change="handlePasswordToggle" />
          </el-form-item>
          <el-form-item label="自动锁定" v-if="config.hasPassword">
            <el-switch v-model="config.autoLockEnabled" @change="saveConfig" />
          </el-form-item>
          <el-form-item label="锁定超时" v-if="config.hasPassword && config.autoLockEnabled">
            <el-input-number v-model="config.autoLockTimeout" :min="1" :max="120" @change="saveConfig" />
            <span style="margin-left: 8px">分钟</span>
          </el-form-item>
          <el-form-item label="最小化时锁定" v-if="config.hasPassword">
            <el-switch v-model="config.lockOnMinimize" @change="saveConfig" />
          </el-form-item>
          <el-form-item label="休眠时锁定" v-if="config.hasPassword">
            <el-switch v-model="config.lockOnSuspend" @change="saveConfig" />
          </el-form-item>
        </el-form>
      </div>

      <!-- 密码管理 -->
      <div class="settings-section" v-if="config.hasPassword">
        <h3>密码管理</h3>
        <el-button @click="showChangePasswordDialog = true">修改密码</el-button>
        <el-button type="danger" @click="removePassword">移除密码</el-button>
      </div>

      <!-- 手动锁定 -->
      <div class="settings-section" v-if="config.hasPassword && !status.isLocked">
        <h3>手动锁定</h3>
        <el-button type="primary" @click="lockNow">立即锁定</el-button>
      </div>
    </div>

    <!-- 设置密码对话框 -->
    <el-dialog v-model="showSetPasswordDialog" title="设置密码" width="400px">
      <el-form label-width="80px">
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSetPasswordDialog = false">取消</el-button>
        <el-button type="primary" @click="setPassword">确定</el-button>
      </template>
    </el-dialog>

    <!-- 修改密码对话框 -->
    <el-dialog v-model="showChangePasswordDialog" title="修改密码" width="400px">
      <el-form label-width="80px">
        <el-form-item label="当前密码">
          <el-input v-model="currentPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showChangePasswordDialog = false">取消</el-button>
        <el-button type="primary" @click="changePassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Lock, Unlock } from '@element-plus/icons-vue'

const config = ref({
  hasPassword: false,
  autoLockEnabled: false,
  autoLockTimeout: 15,
  lockOnMinimize: false,
  lockOnSuspend: false
})

const status = ref({
  isLocked: false,
  hasPassword: false
})

const showSetPasswordDialog = ref(false)
const showChangePasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

onMounted(async () => {
  await loadConfig()
  await loadStatus()
})

const loadConfig = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.getConfig?.()
    if (result?.success) {
      config.value = { ...config.value, ...result.data }
    }
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

const loadStatus = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.getStatus?.()
    if (result?.success) {
      status.value = result.data
      config.value.hasPassword = result.data.hasPassword
    }
  } catch (error) {
    console.error('Failed to load status:', error)
  }
}

const saveConfig = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.updateConfig?.(config.value)
    if (result?.success) {
      ElMessage.success('设置已保存')
    }
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  }
}

const handlePasswordToggle = () => {
  if (config.value.hasPassword) {
    showSetPasswordDialog.value = true
  } else {
    removePassword()
  }
}

const setPassword = async () => {
  if (!newPassword.value) {
    ElMessage.warning('请输入密码')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  try {
    const result = await window.electronAPI.sessionLock?.setPassword?.(newPassword.value)
    if (result?.success) {
      ElMessage.success('密码已设置')
      showSetPasswordDialog.value = false
      newPassword.value = ''
      confirmPassword.value = ''
      await loadStatus()
      await saveConfig()
    }
  } catch (error: any) {
    ElMessage.error(`设置密码失败: ${error.message}`)
  }
}

const changePassword = async () => {
  if (!currentPassword.value || !newPassword.value) {
    ElMessage.warning('请填写所有字段')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }

  try {
    // 先验证当前密码
    const verifyResult = await window.electronAPI.sessionLock?.verifyPassword?.(currentPassword.value)
    if (!verifyResult?.success) {
      ElMessage.error('当前密码错误')
      return
    }

    // 设置新密码
    const result = await window.electronAPI.sessionLock?.setPassword?.(newPassword.value)
    if (result?.success) {
      ElMessage.success('密码已修改')
      showChangePasswordDialog.value = false
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
    }
  } catch (error: any) {
    ElMessage.error(`修改密码失败: ${error.message}`)
  }
}

const removePassword = async () => {
  try {
    await ElMessageBox.confirm('确定要移除密码保护吗？', '确认', {
      type: 'warning'
    })

    const result = await window.electronAPI.sessionLock?.removePassword?.()
    if (result?.success) {
      ElMessage.success('密码已移除')
      config.value.hasPassword = false
      await loadStatus()
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`移除密码失败: ${error.message}`)
    }
  }
}

const lockNow = async () => {
  try {
    const result = await window.electronAPI.sessionLock?.lock?.()
    if (result?.success) {
      ElMessage.success('已锁定')
      await loadStatus()
    }
  } catch (error: any) {
    ElMessage.error(`锁定失败: ${error.message}`)
  }
}
</script>

<style scoped>
.session-lock-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.panel-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-header h2 {
  margin: 0;
  font-size: 20px;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.lock-status {
  margin-bottom: 32px;
}

.status-card {
  text-align: center;
  padding: 32px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 2px solid var(--border-color);
}

.status-card.locked {
  border-color: var(--error-color);
  background: rgba(239, 68, 68, 0.1);
}

.status-card h3 {
  margin: 16px 0 8px;
  font-size: 24px;
}

.status-card p {
  margin: 0;
  color: var(--text-secondary);
}

.settings-section {
  margin-bottom: 32px;
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.settings-section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}
</style>
