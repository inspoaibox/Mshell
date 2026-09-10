<template>
  <div
    ref="screen"
    class="lock-screen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="lock-title"
    @keydown.tab="containFocus"
  >
    <header class="lock-header">
      <div class="lock-brand">
        <span class="lock-wordmark">MShell</span><span class="lock-product">SSH Client</span>
      </div>
      <span class="lock-status"
        ><el-icon><Lock /></el-icon>会话已锁定</span
      >
    </header>

    <main class="lock-main">
      <section class="lock-content">
        <div class="lock-identity">
          <div class="lock-emblem">
            <img :src="logo" alt="" width="64" height="64" draggable="false" />
            <span class="lock-emblem-badge" aria-hidden="true"
              ><el-icon><Lock /></el-icon
            ></span>
          </div>
          <h1 id="lock-title">解锁 MShell</h1>
          <p>继续你的工作会话</p>
        </div>

        <form class="unlock-form" :aria-busy="unlocking" @submit.prevent="handleUnlock">
          <label for="unlock-password">解锁密码</label>
          <div
            class="password-field"
            :class="{ 'has-error': errorMessage, 'is-disabled': isLocked || unlocking }"
          >
            <el-icon class="password-key" aria-hidden="true"><Key /></el-icon>
            <input
              id="unlock-password"
              ref="passwordInput"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              placeholder="输入密码"
              autocomplete="current-password"
              :disabled="isLocked || unlocking"
              :aria-invalid="Boolean(errorMessage)"
              aria-describedby="unlock-feedback"
              @input="errorMessage = ''"
              @keydown="updateCapsLock"
              @keyup="updateCapsLock"
              @keydown.enter="preventCompositionSubmit"
              @blur="capsLock = false"
            />
            <button
              type="button"
              class="password-visibility"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              :aria-pressed="showPassword"
              :disabled="isLocked || unlocking"
              @pointerdown.prevent
              @click="showPassword = !showPassword"
            >
              <el-icon><Hide v-if="showPassword" /><View v-else /></el-icon>
            </button>
          </div>

          <div id="unlock-feedback" class="unlock-feedback" aria-live="polite" aria-atomic="true">
            <p v-if="isLocked" class="feedback-warning">
              <el-icon aria-hidden="true"><Timer /></el-icon
              ><span>尝试次数过多，{{ lockoutRemaining }} 秒后重试</span>
            </p>
            <p v-else-if="errorMessage" class="feedback-error">
              <el-icon aria-hidden="true"><Warning /></el-icon><span>{{ errorMessage }}</span>
            </p>
            <p v-else-if="capsLock" class="feedback-warning">
              <el-icon aria-hidden="true"><Warning /></el-icon><span>大写锁定已开启</span>
            </p>
          </div>

          <button
            class="unlock-button"
            type="submit"
            :disabled="isLocked || unlocking || !password"
          >
            <el-icon v-if="unlocking" class="unlock-spinner" aria-hidden="true"
              ><Loading
            /></el-icon>
            <span>{{ unlocking ? '正在验证' : isLocked ? '暂时无法解锁' : '解锁会话' }}</span>
            <el-icon v-if="!unlocking && !isLocked" aria-hidden="true"><Right /></el-icon>
          </button>
        </form>

        <div class="lock-detail">
          <el-icon aria-hidden="true"><Clock /></el-icon><span>锁定于</span>
          <time :datetime="lockedAt.toISOString()">{{ lockTime }}</time>
        </div>
      </section>
    </main>

    <footer class="lock-footer">
      <span
        ><el-icon aria-hidden="true"><Monitor /></el-icon>本地会话保护</span
      ><span>MShell</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  Clock,
  Hide,
  Key,
  Loading,
  Lock,
  Monitor,
  Right,
  Timer,
  View,
  Warning
} from '@element-plus/icons-vue'
import logo from '../../assets/logo.png'

const emit = defineEmits<{ unlock: [] }>()
const screen = ref<HTMLElement>()
const passwordInput = ref<HTMLInputElement>()
const password = ref('')
const showPassword = ref(false)
const capsLock = ref(false)
const unlocking = ref(false)
const errorMessage = ref('')
const lockedAt = new Date()
const lockTime = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}).format(lockedAt)
const lockoutRemaining = ref(0)
const isLocked = computed(() => lockoutRemaining.value > 0)
let lockoutTimer: ReturnType<typeof setInterval> | undefined
let disposed = false

async function focusPassword() {
  await nextTick()
  if (!disposed && !isLocked.value) passwordInput.value?.focus()
}

function startLockout(seconds: number) {
  if (lockoutTimer) clearInterval(lockoutTimer)
  const deadline = Date.now() + seconds * 1000
  lockoutRemaining.value = seconds
  lockoutTimer = setInterval(() => {
    lockoutRemaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!isLocked.value) {
      clearInterval(lockoutTimer)
      lockoutTimer = undefined
      errorMessage.value = ''
      void focusPassword()
    }
  }, 1000)
}

onMounted(async () => {
  void focusPassword()
  try {
    const result = await window.electronAPI?.sessionLock?.getStatus?.()
    if (!disposed && result?.success && result.data?.isLockedOut) {
      startLockout(Math.max(1, result.data.lockoutRemainingMinutes || 1) * 60)
    }
  } catch {
    // Authentication and attempt limits remain enforced by the main process.
  }
})

onUnmounted(() => {
  disposed = true
  password.value = ''
  if (lockoutTimer) clearInterval(lockoutTimer)
})

function updateCapsLock(event: KeyboardEvent) {
  capsLock.value = event.getModifierState?.('CapsLock') || false
}

function preventCompositionSubmit(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) event.preventDefault()
}

function containFocus(event: KeyboardEvent) {
  const controls = screen.value?.querySelectorAll<HTMLElement>(
    'input:not(:disabled), button:not(:disabled)'
  )
  if (!controls?.length) {
    event.preventDefault()
    return
  }
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

async function handleUnlock() {
  if (!password.value || unlocking.value || isLocked.value) return
  errorMessage.value = ''
  unlocking.value = true
  try {
    const unlock = window.electronAPI?.sessionLock?.unlock
    if (!unlock) throw new Error('解锁服务暂不可用，请重新打开 MShell')
    const result = await unlock(password.value)
    if (disposed) return
    if (result.success) {
      password.value = ''
      emit('unlock')
      return
    }
    const message = result.error || ''
    if (/locked out|try again in/i.test(message)) {
      const minutes = Number(message.match(/(\d+)\s*minute/i)?.[1] || 1)
      startLockout(Math.max(1, minutes) * 60)
    } else {
      const attempts = message.match(/(\d+)\s*attempts?\s*remaining/i)
      errorMessage.value = attempts
        ? `密码不正确，还可尝试 ${attempts[1]} 次`
        : /invalid password|password required/i.test(message) || !message
          ? '密码不正确，请重新输入'
          : message
    }
  } catch (error) {
    if (!disposed) errorMessage.value = error instanceof Error ? error.message : '验证失败，请重试'
  } finally {
    password.value = ''
    showPassword.value = false
    unlocking.value = false
    if (!disposed) void focusPassword()
  }
}
</script>

<style scoped>
.lock-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  grid-template-rows: auto minmax(min-content, 1fr) auto;
  overflow-y: auto;
  background: var(--bg-main);
  color: var(--text-primary);
  letter-spacing: 0;
}
.lock-header,
.lock-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 0 40px;
}
.lock-header {
  min-height: 80px;
  border-bottom: 1px solid var(--border-color);
}
.lock-brand {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.lock-wordmark {
  font-size: 20px;
  font-weight: 650;
}
.lock-product {
  font-size: 12px;
  color: var(--text-secondary);
}
.lock-status,
.lock-footer span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.lock-status .el-icon {
  color: var(--primary-color);
  font-size: 15px;
}
.lock-main {
  display: grid;
  place-items: center;
  padding: 48px 24px 64px;
}
.lock-content {
  width: 100%;
  max-width: 352px;
}
.lock-identity {
  text-align: center;
  margin-bottom: 36px;
}
.lock-emblem {
  position: relative;
  width: 64px;
  height: 64px;
  margin: 0 auto 24px;
}
.lock-emblem img {
  display: block;
  border-radius: 8px;
  object-fit: cover;
}
.lock-emblem-badge {
  position: absolute;
  right: -8px;
  bottom: -5px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 3px solid var(--bg-main);
  border-radius: 50%;
  background: var(--primary-color);
  color: var(--text-inverse);
  font-size: 13px;
}
.lock-identity h1 {
  margin: 0 0 10px;
  font-size: 28px;
  line-height: 1.35;
  font-weight: 600;
}
.lock-identity p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}
.unlock-form label {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 500;
}
.password-field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 6px 0 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: min(var(--radius-md), 8px);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}
.password-field:focus-within {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(var(--primary-color-rgb), 0.12);
}
.password-field.has-error {
  border-color: var(--error-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--error-color) 10%, transparent);
}
.password-field.is-disabled {
  opacity: 0.6;
}
.password-key {
  flex: 0 0 16px;
  font-size: 16px;
  color: var(--text-secondary);
}
.password-field input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  outline: none;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  caret-color: var(--primary-color);
  font-family: inherit;
  font-size: 14px;
  letter-spacing: 0;
}
.password-field input::placeholder {
  color: var(--text-tertiary);
}
.password-field input::-ms-reveal,
.password-field input::-ms-clear {
  display: none;
}
.password-field input:disabled {
  cursor: not-allowed;
}
.password-visibility {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 17px;
  cursor: pointer;
}
.password-visibility:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.unlock-feedback {
  min-height: 44px;
  padding: 10px 0;
  font-size: 12px;
  line-height: 20px;
}
.unlock-feedback p {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  overflow-wrap: anywhere;
}
.unlock-feedback .el-icon {
  flex-shrink: 0;
  margin-top: 3px;
  font-size: 14px;
}
.feedback-error {
  color: var(--error-color);
}
.feedback-warning {
  color: var(--warning-color);
}
.unlock-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: min(var(--radius-md), 8px);
  background: var(--primary-color);
  color: var(--text-inverse);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    transform 120ms ease;
}
.unlock-button .el-icon {
  font-size: 17px;
}
.unlock-button:active:not(:disabled) {
  transform: scale(0.985);
}
.unlock-button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
.unlock-button:disabled {
  cursor: not-allowed;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-color: var(--border-color);
}
.unlock-spinner {
  animation: unlock-spin 750ms linear infinite;
}
@keyframes unlock-spin {
  to {
    transform: rotate(360deg);
  }
}
.lock-detail {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 24px;
  font-size: 12px;
  color: var(--text-secondary);
}
.lock-detail time {
  font-variant-numeric: tabular-nums;
}
.lock-footer {
  min-height: 56px;
  border-top: 1px solid var(--border-color);
}
@media (hover: hover) {
  .password-visibility:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .unlock-button:hover:not(:disabled) {
    background: var(--primary-hover);
  }
}
@media (max-width: 540px) {
  .lock-header,
  .lock-footer {
    margin: 0 24px;
  }
  .lock-header {
    min-height: 64px;
  }
  .lock-product {
    display: none;
  }
  .lock-main {
    padding: 36px 24px;
  }
  .lock-identity h1 {
    font-size: 26px;
  }
}
@media (max-height: 600px) {
  .lock-header {
    min-height: 56px;
  }
  .lock-main {
    padding-top: 24px;
    padding-bottom: 24px;
  }
  .lock-identity {
    margin-bottom: 24px;
  }
  .lock-emblem {
    margin-bottom: 16px;
    width: 48px;
    height: 48px;
  }
  .lock-emblem img {
    width: 48px;
    height: 48px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lock-screen *,
  .lock-screen *::before,
  .lock-screen *::after {
    animation: none;
    transition: none;
  }
  .unlock-button:active:not(:disabled) {
    transform: none;
  }
}
</style>
