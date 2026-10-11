<template>
  <section class="remote-sync-panel">
    <div class="panel-subhead">
      <div>
        <h3>远程同步</h3>
        <p>“同步”会与远端逐条合并，各设备的修改都会保留；同一条记录两边都改时保留修改时间较新的版本。</p>
      </div>
    </div>

    <div class="form-grid">
      <label>
        同步服务
        <select v-model="form.provider">
          <option value="github">GitHub Gist</option>
          <option value="gitlab">GitLab Snippet</option>
        </select>
      </label>
      <label>
        同步数据 URL
        <input
          v-model="form.remoteUrl"
          placeholder="已有 Gist/Snippet 地址；留空上传时创建新的私有同步数据"
        />
      </label>
      <label>
        远程访问 Token
        <span class="password-field">
          <input
            v-model="form.token"
            :type="showToken ? 'text' : 'password'"
            placeholder="上传和私有数据下载需要 Token"
          />
          <button type="button" class="secondary" @click="showToken = !showToken">
            {{ showToken ? '隐藏' : '显示' }}
          </button>
        </span>
      </label>
      <label>
        同步加密密码
        <span class="password-field">
          <input
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="与桌面端同步加密密码保持一致"
          />
          <button type="button" class="secondary" @click="showPassword = !showPassword">
            {{ showPassword ? '隐藏' : '显示' }}
          </button>
        </span>
      </label>
    </div>

    <div class="segmented-actions">
      <button type="button" @click="syncNow">同步</button>
      <button type="button" class="secondary" @click="downloadRemoteToLocal">
        下载到本地
      </button>
      <button type="button" class="secondary" @click="uploadLocalToRemote">
        上传本地
      </button>
    </div>

    <div class="form-actions compact">
      <button type="button" class="secondary" @click="saveConfig()">保存配置</button>
      <button type="button" class="danger" @click="clearConfig">清除配置</button>
    </div>

    <div v-if="syncConfig" class="sync-status-card">
      <p>已保存：{{ providerLabel(syncConfig.provider) }}</p>
      <p v-if="syncConfig.remoteUrl">{{ syncConfig.remoteUrl }}</p>
      <p v-if="syncConfig.lastSyncAt">最近同步：{{ formatTime(syncConfig.lastSyncAt) }}</p>
      <p v-if="syncConfig.lastUploadAt">最近上传：{{ formatTime(syncConfig.lastUploadAt) }}</p>
      <p v-if="syncConfig.lastDownloadAt">最近下载：{{ formatTime(syncConfig.lastDownloadAt) }}</p>
    </div>

    <p v-if="message" class="message">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { MobileSyncConfig } from '../types'
import { mobileStore } from '../services/mobile-store'
import {
  RemoteReadError,
  clearMobileSyncBase,
  forceDownloadMobile,
  forceUploadMobile,
  formatConflictMessage,
  formatMassDeleteMessage,
  loadMobileSyncBase,
  runMobileMergeSync,
  saveMobileSyncBase,
  type MobileSyncDeps
} from '../services/mobile-sync'
import {
  loadRemoteSyncPayload,
  uploadRemoteSyncPayload
} from '../services/remote-sync'

const emit = defineEmits<{ synced: [] }>()

const form = reactive<MobileSyncConfig>({
  enabled: true,
  provider: 'github',
  remoteUrl: '',
  token: '',
  password: ''
})
const syncConfig = ref<MobileSyncConfig | undefined>()
const showToken = ref(false)
const showPassword = ref(false)
const message = ref('')
const busy = ref<'sync' | 'download' | 'upload' | ''>('')

onMounted(() => {
  loadConfig()
})

const loadConfig = () => {
  const config = mobileStore.getState().syncConfig
  syncConfig.value = config ? { ...config } : undefined
  if (!config) return
  Object.assign(form, {
    enabled: true,
    provider: config.provider,
    remoteUrl: config.remoteUrl,
    token: config.token,
    password: config.password,
    lastSyncAt: config.lastSyncAt,
    lastUploadAt: config.lastUploadAt,
    lastDownloadAt: config.lastDownloadAt,
    lastSyncChecksum: config.lastSyncChecksum
  })
}

const saveConfig = (silent = false) => {
  const state = mobileStore.updateSyncConfig(buildConfig())
  syncConfig.value = state.syncConfig
  if (!silent) {
    message.value = '同步配置已保存'
  }
}

const clearConfig = () => {
  mobileStore.clearSyncConfig()
  clearMobileSyncBase()
  syncConfig.value = undefined
  Object.assign(form, {
    enabled: true,
    provider: 'github',
    remoteUrl: '',
    token: '',
    password: '',
    lastSyncAt: undefined,
    lastUploadAt: undefined,
    lastDownloadAt: undefined,
    lastSyncChecksum: undefined
  })
  message.value = '同步配置已清除'
}

const buildSyncDeps = (): MobileSyncDeps => ({
  store: mobileStore,
  password: form.password,
  loadRemote: async () =>
    form.remoteUrl.trim()
      ? (await loadRemoteSyncPayload(form.remoteUrl, form.token)).text
      : undefined,
  upload: async (content) => {
    const result = await uploadRemoteSyncPayload(
      form.remoteUrl,
      form.token,
      content,
      form.provider
    )
    form.remoteUrl = result.remoteUrl
    return result
  },
  loadBase: () => loadMobileSyncBase(form.provider, form.remoteUrl, form.password),
  saveBase: (data, remoteUrl) =>
    saveMobileSyncBase(form.provider, remoteUrl || form.remoteUrl, form.password, data)
})

const syncNow = async () => {
  if (busy.value) return
  busy.value = 'sync'
  try {
    validateBaseConfig()
    saveConfig(true)
    message.value = '正在与远端逐条合并...'

    let result = await runMobileMergeSync(buildSyncDeps())
    if (result.action === 'needs-confirm') {
      const confirmed = window.confirm(
        `本次同步将删除较多本地数据（其它设备已删除）：
${formatMassDeleteMessage(result.massDeletes)}

确认继续吗？`
      )
      if (!confirmed) {
        message.value = '已取消同步，本地数据未改动'
        return
      }
      result = await runMobileMergeSync(buildSyncDeps(), { allowMassDelete: true })
    }

    markSyncState({
      remoteUrl: form.remoteUrl,
      ...(result.remoteUrl ? { lastUploadAt: new Date().toISOString() } : {})
    })
    if (result.action === 'uploaded') {
      message.value = result.created
        ? '已创建远端同步数据并上传本地数据'
        : '本地数据已上传到远端'
    } else if (result.action === 'no-change') {
      message.value = '本地和远端数据一致，无需同步'
    } else {
      const summary = result.summary
      const conflictText = result.conflicts.length
        ? `
冲突 ${result.conflicts.length} 项（已保留修改时间较新的版本）：
${formatConflictMessage(result.conflicts)}`
        : ''
      message.value = `同步完成：上传 ${summary?.uploaded || 0} 项，下载 ${summary?.downloaded || 0} 项，删除 ${summary?.deleted || 0} 项${conflictText}`
    }
    emit('synced')
  } catch (error: any) {
    message.value = error.message || '同步失败'
  } finally {
    busy.value = ''
  }
}

const downloadRemoteToLocal = async () => {
  if (busy.value) return
  busy.value = 'download'
  try {
    validateBaseConfig()
    if (!form.remoteUrl.trim()) {
      throw new Error('请先填写同步数据 URL，或先上传本地创建远端同步数据')
    }

    saveConfig(true)
    message.value = '正在从远端下载同步数据...'
    await forceDownloadMobile(buildSyncDeps())
    const nextState = mobileStore.getState()
    markSyncState({ lastDownloadAt: new Date().toISOString() })
    message.value = `远端数据已下载到本地（不删除本地数据）：${nextState.sessions.length} 会话，${nextState.snippets.length} 片段，${nextState.sshKeys.length} 密钥`
    emit('synced')
  } catch (error: any) {
    message.value = error.message || '下载失败'
  } finally {
    busy.value = ''
  }
}

const uploadLocalToRemote = async () => {
  if (busy.value) return
  busy.value = 'upload'
  try {
    validateBaseConfig()
    saveConfig(true)
    message.value = '正在上传本地同步数据...'

    let result
    try {
      result = await forceUploadMobile(buildSyncDeps())
    } catch (error) {
      if (!(error instanceof RemoteReadError)) throw error
      const confirmed = window.confirm(
        `无法读取远端数据（${error.message}）。
继续上传将只保留移动端数据，远端中桌面端独有的数据（端口转发、设置等）会被清空。确认继续吗？`
      )
      if (!confirmed) {
        message.value = '已取消上传'
        return
      }
      result = await forceUploadMobile(buildSyncDeps(), { ignoreRemoteErrors: true })
    }

    markSyncState({
      remoteUrl: result.remoteUrl,
      lastUploadAt: new Date().toISOString()
    })
    message.value = result.created
      ? '已创建远端同步数据并上传本地数据'
      : '本地数据已上传到远端（覆盖远端的会话、片段和密钥）'
    emit('synced')
  } catch (error: any) {
    message.value = error.message || '上传失败'
  } finally {
    busy.value = ''
  }
}

const markSyncState = (updates: Partial<MobileSyncConfig>) => {
  const now = new Date().toISOString()
  const state = mobileStore.updateSyncConfig({
    ...buildConfig(),
    ...updates,
    lastSyncAt: now
  })
  syncConfig.value = state.syncConfig
  loadConfig()
}

const validateBaseConfig = () => {
  if (!form.token.trim()) {
    throw new Error(form.provider === 'gitlab' ? '请填写 GitLab Token' : '请填写 GitHub Token')
  }
  if (!form.password.trim()) {
    throw new Error('请填写同步加密密码')
  }
}

const buildConfig = (): MobileSyncConfig => ({
  enabled: true,
  provider: form.provider,
  remoteUrl: form.remoteUrl.trim(),
  token: form.token.trim(),
  password: form.password,
  lastSyncAt: syncConfig.value?.lastSyncAt,
  lastUploadAt: syncConfig.value?.lastUploadAt,
  lastDownloadAt: syncConfig.value?.lastDownloadAt,
  lastSyncChecksum: syncConfig.value?.lastSyncChecksum
})

const providerLabel = (provider: MobileSyncConfig['provider']) =>
  provider === 'gitlab' ? 'GitLab Snippet' : 'GitHub Gist'

const formatTime = (value: string) => new Date(value).toLocaleString()
</script>
