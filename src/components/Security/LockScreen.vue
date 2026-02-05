<template>
  <div class="lock-screen">
    <div class="lock-overlay"></div>
    <div class="lock-content">
      <div class="lock-icon">
        <el-icon :size="64"><Lock /></el-icon>
      </div>
      <h1 class="lock-title">会话已锁定</h1>
      <p class="lock-subtitle">请输入密码以继续</p>
      
      <el-form @submit.prevent="handleUnlock" class="unlock-form">
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            placeholder="请输入解锁密码"
            size="large"
            show-password
            :disabled="isLocked"
            ref="passwordInput"
            @keyup.enter="handleUnlock"
            class="lock-input"
          >
            <template #prefix>
              <el-icon><Key /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        
        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
          class="lock-alert"
        />
        
        <el-alert
          v-if="isLocked"
          :title="`尝试次数过多，请等待 ${lockoutRemaining} 秒后重试`"
          type="warning"
          :closable="false"
          show-icon
          class="lock-alert"
        />
        
        <el-button
          type="primary"
          size="large"
          @click="handleUnlock"
          :loading="unlocking"
          :disabled="isLocked || !password"
          class="unlock-button"
        >
          <span v-if="!unlocking">解锁</span>
          <span v-else>验证中...</span>
        </el-button>
      </el-form>
      
      <div class="lock-info">
        <div class="info-item">
          <span class="info-label">锁定时间</span>
          <span class="info-value">{{ lockTime }}</span>
        </div>
        <div v-if="remainingAttempts > 0 && remainingAttempts < 5" class="info-item">
          <span class="info-label">剩余尝试</span>
          <span class="info-value attempts-warning">{{ remainingAttempts }} 次</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Lock, Key } from '@element-plus/icons-vue'

const emit = defineEmits<{
  unlock: []
}>()

const password = ref('')
const passwordInput = ref()
const unlocking = ref(false)
const errorMessage = ref('')
const lockTime = ref('')
const remainingAttempts = ref(5)
const isLocked = ref(false)
const lockoutRemaining = ref(0)
let lockoutTimer: NodeJS.Timeout | null = null

onMounted(() => {
  // 设置锁定时间
  lockTime.value = new Date().toLocaleString('zh-CN')
  
  // 自动聚焦密码输入框
  setTimeout(() => {
    passwordInput.value?.focus()
  }, 300)
})

onUnmounted(() => {
  if (lockoutTimer) {
    clearInterval(lockoutTimer)
  }
})

const handleUnlock = async () => {
  if (!password.value || unlocking.value || isLocked.value) return
  
  errorMessage.value = ''
  unlocking.value = true
  
  try {
    // 调用后端的 unlock 方法，它会处理密码验证、失败次数跟踪和锁定逻辑
    const result = await window.electronAPI.sessionLock?.unlock?.(password.value)
    
    if (result?.success) {
      ElMessage.success('解锁成功')
      emit('unlock')
    } else {
      // 显示后端返回的错误信息
      errorMessage.value = result?.error || '密码错误'
      
      // 检查是否包含锁定信息
      if (result?.error?.includes('locked out') || result?.error?.includes('try again in')) {
        // 从错误信息中提取剩余分钟数
        const match = result.error.match(/(\d+)\s*minute/)
        if (match) {
          const minutes = parseInt(match[1])
          isLocked.value = true
          lockoutRemaining.value = minutes * 60
          
          lockoutTimer = setInterval(() => {
            lockoutRemaining.value--
            if (lockoutRemaining.value <= 0) {
              isLocked.value = false
              if (lockoutTimer) {
                clearInterval(lockoutTimer)
              }
            }
          }, 1000)
        }
      } else {
        // 从错误信息中提取剩余尝试次数
        const match = result?.error?.match(/(\d+)\s*attempts?\s*remaining/)
        if (match) {
          remainingAttempts.value = parseInt(match[1])
        }
      }
      
      password.value = ''
      passwordInput.value?.focus()
    }
  } catch (error: any) {
    errorMessage.value = error.message || '验证失败'
    password.value = ''
  } finally {
    unlocking.value = false
  }
}
</script>

<style scoped>
.lock-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
}

.lock-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, 
    rgba(14, 165, 233, 0.95) 0%, 
    rgba(99, 102, 241, 0.95) 100%
  );
}

.lock-content {
  position: relative;
  z-index: 1;
  background: var(--bg-elevated);
  border-radius: 24px;
  padding: 56px 48px;
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-medium);
  max-width: 440px;
  width: 90%;
  text-align: center;
  animation: slideIn 0.4s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.lock-icon {
  width: 96px;
  height: 96px;
  margin: 0 auto 32px;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: var(--shadow-glow);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: var(--shadow-glow);
  }
  50% {
    transform: scale(1.05);
    box-shadow: 0 12px 32px rgba(14, 165, 233, 0.5);
  }
}

.lock-title {
  margin: 0 0 12px 0;
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.lock-subtitle {
  margin: 0 0 40px 0;
  font-size: 16px;
  color: var(--text-secondary);
  font-weight: 500;
}

.unlock-form {
  margin-bottom: 32px;
}

.unlock-form :deep(.el-form-item) {
  margin-bottom: 20px;
}

.lock-input :deep(.el-input__wrapper) {
  background: var(--bg-tertiary);
  border: 2px solid var(--border-color);
  box-shadow: none;
  padding: 12px 16px;
  border-radius: 12px;
  transition: all 0.3s;
}

.lock-input :deep(.el-input__wrapper:hover) {
  border-color: var(--border-strong);
}

.lock-input :deep(.el-input__wrapper.is-focus) {
  border-color: var(--primary-color);
  background: var(--bg-secondary);
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.15);
}

.lock-input :deep(.el-input__inner) {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 500;
}

.lock-input :deep(.el-input__inner::placeholder) {
  color: var(--text-tertiary);
}

.lock-input :deep(.el-input__prefix) {
  color: var(--text-secondary);
}

/* 密码显示/隐藏按钮 */
.lock-input :deep(.el-input__suffix) {
  color: var(--text-secondary);
}

.lock-input :deep(.el-input__password) {
  color: var(--text-secondary);
}

.lock-alert {
  margin-bottom: 20px;
  border-radius: 12px;
}

.unlock-button {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 600;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border: none;
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.4);
  transition: all 0.3s;
}

.unlock-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(14, 165, 233, 0.5);
}

.unlock-button:active:not(:disabled) {
  transform: translateY(0);
}

.unlock-button:disabled {
  background: var(--bg-tertiary);
  color: var(--text-disabled);
  box-shadow: none;
  cursor: not-allowed;
}

.lock-info {
  padding-top: 28px;
  border-top: 2px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.info-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.info-value {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 600;
}

.attempts-warning {
  color: var(--warning-color);
}

/* 响应式 */
@media (max-width: 480px) {
  .lock-content {
    padding: 40px 32px;
  }
  
  .lock-title {
    font-size: 28px;
  }
  
  .lock-subtitle {
    font-size: 14px;
  }
}
</style>
