<template>
  <div class="settings-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h2>设置</h2>
      <div class="header-actions">
        <el-button type="primary" @click="saveSettings">保存设置</el-button>
      </div>
    </div>

    <!-- 设置内容 -->
    <div class="settings-content">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <!-- 通用设置 -->
        <el-tab-pane label="通用" name="general">
          <div class="settings-section">
            <h3>应用设置</h3>
            <el-form label-position="left">
              <el-form-item label="启动时打开">
                <el-switch v-model="settings.general.startWithSystem" />
              </el-form-item>
              <el-form-item label="最小化到托盘">
                <el-switch v-model="settings.general.minimizeToTray" />
              </el-form-item>
              <el-form-item label="关闭时最小化">
                <el-switch v-model="settings.general.closeToTray" />
              </el-form-item>
              <el-form-item label="主题">
                <el-select v-model="settings.general.theme" style="width: 200px">
                  <el-option label="自动" value="auto" />
                  <el-option label="深色" value="dark" />
                  <el-option label="浅色" value="light" />
                </el-select>
              </el-form-item>
              <el-form-item label="语言">
                <el-select v-model="settings.general.language" style="width: 200px">
                  <el-option label="简体中文" value="zh-CN" />
                  <el-option label="English" value="en-US" />
                </el-select>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- SFTP设置 -->
        <el-tab-pane label="SFTP" name="sftp">
          <div class="settings-section">
            <h3>传输设置</h3>
            <el-form label-position="left">
              <el-form-item label="默认本地路径">
                <div style="display: flex; gap: 8px; flex: 1;">
                  <el-input v-model="settings.sftp.defaultLocalPath" placeholder="默认下载目录" readonly />
                  <el-button @click="selectDownloadDir">选择</el-button>
                </div>
              </el-form-item>
              <el-form-item label="最大并发数">
                <el-input-number v-model="settings.sftp.maxConcurrentTransfers" :min="1" :max="10" />
              </el-form-item>
              <el-form-item label="显示隐藏文件">
                <el-switch v-model="settings.sftp.showHiddenFiles" />
              </el-form-item>
              <el-form-item label="删除确认">
                <el-switch v-model="settings.sftp.confirmBeforeDelete" />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 安全设置 -->
        <el-tab-pane label="安全" name="security">
          <div class="settings-section">
            <h3>安全选项</h3>
            <el-form label-position="left">
              <el-form-item label="保存密码">
                <el-switch v-model="settings.security.savePasswords" />
                <span class="form-hint">记住SSH连接密码</span>
              </el-form-item>
              <el-form-item label="验证主机密钥">
                <el-switch v-model="settings.security.verifyHostKey" />
                <span class="form-hint">Strict Host Key Checking</span>
              </el-form-item>
              <el-form-item label="会话超时">
                <el-input-number v-model="settings.security.sessionTimeout" :min="0" :step="5" />
                <span class="form-hint">分钟 (0 表示不超时)</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 终端设置 -->
        <el-tab-pane label="终端" name="terminal">
          <div class="settings-section">
            <h3>终端外观</h3>
            <el-form label-position="left">
              <el-form-item label="字体大小">
                <el-slider 
                  v-model="settings.terminal.fontSize" 
                  :min="10" 
                  :max="24"
                  :step="1"
                  show-input
                  style="width: 300px"
                />
              </el-form-item>
              <el-form-item label="字体">
                <el-select v-model="settings.terminal.fontFamily" style="width: 300px">
                  <el-option label="JetBrains Mono" value="JetBrains Mono" />
                  <el-option label="Fira Code" value="Fira Code" />
                  <el-option label="Consolas" value="Consolas" />
                  <el-option label="Monaco" value="Monaco" />
                </el-select>
              </el-form-item>
              <el-form-item label="配色方案">
                <el-select v-model="settings.terminal.theme" style="width: 300px">
                  <el-option 
                    v-for="(theme, key) in themes" 
                    :key="key" 
                    :label="theme.name" 
                    :value="key" 
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="光标样式">
                <el-radio-group v-model="settings.terminal.cursorStyle">
                  <el-radio label="block">方块</el-radio>
                  <el-radio label="underline">下划线</el-radio>
                  <el-radio label="bar">竖线</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="光标闪烁">
                <el-switch v-model="settings.terminal.cursorBlink" />
              </el-form-item>
              <el-form-item label="渲染类型">
                <el-select v-model="settings.terminal.rendererType" style="width: 200px">
                  <el-option label="自动" value="auto" />
                  <el-option label="WebGL (推荐)" value="webgl" />
                  <el-option label="Canvas" value="canvas" />
                  <el-option label="DOM (慢, 兼容性好)" value="dom" />
                </el-select>
              </el-form-item>
              <el-form-item label="滚动行数">
                <el-input-number 
                  v-model="settings.terminal.scrollback"  
                  :min="1000" 
                  :max="50000"
                  :step="1000"
                />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- SSH设置 -->
        <el-tab-pane label="SSH" name="ssh">
          <div class="settings-section">
            <h3>连接设置</h3>
            <el-form label-position="left">
              <el-form-item label="连接超时">
                <el-input-number 
                  v-model="settings.ssh.timeout" 
                  :min="5" 
                  :max="120"
                  :step="5"
                />
                <span class="form-hint">秒</span>
              </el-form-item>
              <el-form-item label="保持连接">
                <el-switch v-model="settings.ssh.keepalive" />
              </el-form-item>
              <el-form-item label="保持间隔">
                <el-input-number 
                  v-model="settings.ssh.keepaliveInterval" 
                  :min="10" 
                  :max="300"
                  :step="10"
                  :disabled="!settings.ssh.keepalive"
                />
                <span class="form-hint">秒</span>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 备份与恢复 -->
        <el-tab-pane label="备份" name="backup">
          <div class="settings-section">
            <h3>自动备份</h3>
            <el-form label-position="left">
              <el-form-item label="启用自动备份">
                <el-switch v-model="backupConfig.enabled" @change="saveBackupConfig" />
              </el-form-item>
              <el-form-item label="备份目录">
                <div style="display: flex; gap: 8px; flex: 1;">
                  <el-input 
                    v-model="backupConfig.backupDir" 
                    placeholder="默认：应用数据目录/backups"
                    readonly
                  />
                  <el-button @click="selectBackupDir">选择</el-button>
                </div>
              </el-form-item>
              <el-form-item label="备份间隔">
                <el-select 
                  v-model="backupConfig.interval" 
                  style="width: 200px"
                  :disabled="!backupConfig.enabled"
                  @change="saveBackupConfig"
                >
                  <el-option label="每6小时" :value="6" />
                  <el-option label="每12小时" :value="12" />
                  <el-option label="每24小时" :value="24" />
                  <el-option label="每48小时" :value="48" />
                  <el-option label="每周" :value="168" />
                </el-select>
              </el-form-item>
              <el-form-item label="保留备份数">
                <el-input-number 
                  v-model="backupConfig.maxBackups" 
                  :min="1" 
                  :max="50"
                  :disabled="!backupConfig.enabled"
                  @change="saveBackupConfig"
                />
              </el-form-item>
              <el-form-item label="最后备份">
                <span class="form-hint">{{ formatBackupTime(backupConfig.lastBackup) }}</span>
              </el-form-item>
            </el-form>
          </div>

          <div class="settings-section">
            <h3>手动备份</h3>
            <div class="backup-actions">
              <el-button type="primary" :icon="Download" @click="showCreateBackupDialog = true">
                创建备份
              </el-button>
              <el-button type="success" :icon="Upload" @click="showRestoreBackupDialog = true">
                恢复备份
              </el-button>
            </div>
          </div>

          <div class="settings-section">
            <h3>备份历史</h3>
            <el-table :data="backupList" style="width: 100%" max-height="300">
              <el-table-column prop="name" label="文件名" min-width="200" />
              <el-table-column label="大小" width="100">
                <template #default="{ row }">
                  {{ formatFileSize(row.size) }}
                </template>
              </el-table-column>
              <el-table-column label="日期" width="180">
                <template #default="{ row }">
                  {{ formatDate(row.date) }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button 
                    type="primary" 
                    link 
                    size="small"
                    @click="restoreFromHistory(row)"
                  >
                    恢复
                  </el-button>
                  <el-button 
                    type="danger" 
                    link 
                    size="small"
                    @click="deleteBackup(row)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 更新设置 -->
        <el-tab-pane label="更新" name="updates">
          <div class="settings-section">
            <h3>自动更新</h3>
            <el-form label-position="left">
              <el-form-item label="自动检查更新">
                <el-switch v-model="settings.updates.autoCheck" />
              </el-form-item>
              <el-form-item label="自动下载更新">
                <el-switch v-model="settings.updates.autoDownload" />
              </el-form-item>
              <el-form-item label="手动检查">
                <el-button :icon="Refresh" @click="checkForUpdates">
                  立即检查
                </el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 关于 -->
        <el-tab-pane label="关于" name="about">          <div class="settings-section about-section">
            <div class="app-info">
              <div class="app-logo">M</div>
              <h2>MShell</h2>
              <p class="version">版本 {{ appVersion }}</p>
              <p class="description">专业的SSH客户端</p>
            </div>
            
            <div class="info-grid">
              <div class="info-item">
                <label>开发者</label>
                <span>MShell Team</span>
              </div>
              <div class="info-item">
                <label>许可证</label>
                <span>MIT License</span>
              </div>
              <div class="info-item">
                <label>GitHub</label>
                <a href="https://github.com/inspoaibox/Mshell" target="_blank">https://github.com/inspoaibox/Mshell</a>
              </div>
              <div class="info-item">
                <label>反馈</label>
                <a href="https://github.com/inspoaibox/Mshell/issues" target="_blank">GitHub Issues</a>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 创建备份对话框 -->
    <el-dialog v-model="showCreateBackupDialog" title="创建备份" width="500px">
      <el-form label-position="top">
        <el-form-item label="备份密码">
          <el-input 
            v-model="backupPassword" 
            type="password" 
            placeholder="请输入备份密码（用于加密数据）"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input 
            v-model="backupPasswordConfirm" 
            type="password" 
            placeholder="请再次输入密码"
            show-password
          />
        </el-form-item>
        <el-alert 
          type="warning" 
          :closable="false"
          show-icon
        >
          <template #title>
            请妥善保管备份密码，丢失后将无法恢复数据
          </template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="showCreateBackupDialog = false">取消</el-button>
        <el-button type="primary" @click="createBackup" :loading="backupLoading">
          创建备份
        </el-button>
      </template>
    </el-dialog>

    <!-- 恢复备份对话框 -->
    <el-dialog v-model="showRestoreBackupDialog" title="恢复备份" width="600px">
      <el-form label-position="top" v-if="!restoreBackupData">
        <el-form-item label="备份文件">
          <div style="display: flex; gap: 8px;">
            <el-input 
              v-model="restoreFilePath" 
              placeholder="选择备份文件"
              readonly
            />
            <el-button @click="selectRestoreFile">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="备份密码">
          <el-input 
            v-model="restorePassword" 
            type="password" 
            placeholder="请输入备份密码"
            show-password
          />
        </el-form-item>
      </el-form>

      <div v-if="restoreBackupData" class="restore-options">
        <h4>选择要恢复的数据</h4>
        <el-checkbox-group v-model="restoreOptions">
          <el-checkbox label="sessions">
            SSH会话 ({{ restoreBackupData.sessions?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="snippets">
            命令片段 ({{ restoreBackupData.snippets?.length || 0 }} 个)
          </el-checkbox>
          <el-checkbox label="settings">设置</el-checkbox>
        </el-checkbox-group>
        <el-alert 
          type="info" 
          :closable="false"
          show-icon
          style="margin-top: 16px;"
        >
          <template #title>
            备份时间: {{ formatDate(restoreBackupData.timestamp) }}
          </template>
        </el-alert>
      </div>

      <template #footer>
        <el-button @click="cancelRestore">取消</el-button>
        <el-button 
          v-if="!restoreBackupData"
          type="primary" 
          @click="loadBackupFile" 
          :loading="backupLoading"
        >
          加载备份
        </el-button>
        <el-button 
          v-else
          type="primary" 
          @click="applyRestore" 
          :loading="backupLoading"
        >
          恢复数据
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, toRaw, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Upload, Refresh } from '@element-plus/icons-vue'
import { themes } from '@/utils/terminal-themes'

const activeTab = ref('general')

const settings = ref({
  general: {
    startWithSystem: false,
    minimizeToTray: true,
    closeToTray: false,
    language: 'zh-CN',
    theme: 'dark' as 'light' | 'dark' | 'auto'
  },
  terminal: {
    fontSize: 14,
    fontFamily: 'JetBrains Mono',
    cursorStyle: 'block' as 'block' | 'underline' | 'bar',
    cursorBlink: true,
    scrollback: 10000,
    theme: 'dark',
    rendererType: 'auto' as 'auto' | 'webgl' | 'canvas' | 'dom'
  },
  ssh: {
    timeout: 30,
    keepalive: true,
    keepaliveInterval: 60
  },
  sftp: {
    maxConcurrentTransfers: 3,
    defaultLocalPath: '',
    confirmBeforeDelete: true,
    showHiddenFiles: false
  },
  security: {
    savePasswords: true,
    sessionTimeout: 0,
    verifyHostKey: true
  },
  updates: {
    autoCheck: true,
    autoDownload: false
  }
})

// 备份相关状态
const backupConfig = ref({
  enabled: false,
  interval: 24,
  maxBackups: 10,
  backupDir: '',
  lastBackup: undefined as string | undefined
})

const backupList = ref<any[]>([])
const showCreateBackupDialog = ref(false)
const showRestoreBackupDialog = ref(false)
const backupPassword = ref('')
const backupPasswordConfirm = ref('')
const restoreFilePath = ref('')
const restorePassword = ref('')
const restoreBackupData = ref<any>(null)
const restoreOptions = ref<string[]>(['sessions', 'snippets', 'settings'])
const backupLoading = ref(false)

const appVersion = ref('0.1.3')

watch(() => settings.value.general.theme, (newTheme) => {
  if (newTheme === 'light' && settings.value.terminal.theme === 'dark') {
    settings.value.terminal.theme = 'light'
  } else if (newTheme === 'dark' && settings.value.terminal.theme === 'light') {
    settings.value.terminal.theme = 'dark'
  }
})

onMounted(async () => {
  loadSettings()
  loadBackupConfig()
  loadBackupList()
  
  if (window.electronAPI.app && window.electronAPI.app.getVersion) {
    try {
      appVersion.value = await window.electronAPI.app.getVersion()
    } catch (e) {
      console.error('Failed to get app version:', e)
    }
  }
})

const loadSettings = async () => {
  try {
    const saved = await window.electronAPI.settings.get()
    if (saved) {
      settings.value = { ...settings.value, ...saved }
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
}

const saveSettings = async () => {
  try {
    // 使用toRaw获取原始对象，避免Vue响应式代理导致的序列化问题
    await window.electronAPI.settings.update(toRaw(settings.value))
    ElMessage.success('设置已保存')
  } catch (error) {
    console.error('Save settings error:', error)
    ElMessage.error('保存设置失败')
  }
}

// 备份配置相关
const loadBackupConfig = async () => {
  try {
    const result = await window.electronAPI.backup.getConfig()
    if (result.success) {
      backupConfig.value = result.data
    }
  } catch (error) {
    console.error('Failed to load backup config:', error)
  }
}

const saveBackupConfig = async () => {
  try {
    // 使用toRaw获取原始对象，避免Vue响应式代理导致的序列化问题
    const configToSave = toRaw(backupConfig.value)
    
    const result = await window.electronAPI.backup.updateConfig(configToSave)
    if (result.success) {
      ElMessage.success('备份配置已保存')
    } else {
      ElMessage.error('保存失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('保存备份配置失败: ' + error.message)
  }
}

const selectDownloadDir = async () => {
  try {
    const result = await window.electronAPI.dialog.openDirectory({ properties: ['openDirectory'] })
    if (result) {
      settings.value.sftp.defaultLocalPath = result as unknown as string // result definition might vary
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}

const selectBackupDir = async () => {
  try {
    const result = await window.electronAPI.backup.selectDirectory()
    if (result.success && result.data) {
      backupConfig.value.backupDir = result.data
      await saveBackupConfig()
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}

const loadBackupList = async () => {
  try {
    const result = await window.electronAPI.backup.list()
    if (result.success) {
      backupList.value = result.data
    }
  } catch (error) {
    console.error('Failed to load backup list:', error)
  }
}

// 创建备份
const createBackup = async () => {
  if (!backupPassword.value) {
    ElMessage.warning('请输入备份密码')
    return
  }

  if (backupPassword.value !== backupPasswordConfirm.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  try {
    backupLoading.value = true

    // 选择保存位置
    const pathResult = await window.electronAPI.backup.selectSavePath(backupConfig.value.backupDir)
    if (!pathResult.success) {
      return
    }

    // 创建备份
    const result = await window.electronAPI.backup.create(backupPassword.value, pathResult.data)
    
    if (result.success) {
      ElMessage.success('备份创建成功')
      showCreateBackupDialog.value = false
      backupPassword.value = ''
      backupPasswordConfirm.value = ''
      await loadBackupList()
      await loadBackupConfig()
    } else {
      ElMessage.error('创建备份失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('创建备份失败: ' + error.message)
  } finally {
    backupLoading.value = false
  }
}

// 选择恢复文件
const selectRestoreFile = async () => {
  try {
    const result = await window.electronAPI.backup.selectOpenPath()
    if (result.success) {
      restoreFilePath.value = result.data
    }
  } catch (error) {
    ElMessage.error('选择文件失败')
  }
}

// 加载备份文件
const loadBackupFile = async () => {
  if (!restoreFilePath.value) {
    ElMessage.warning('请选择备份文件')
    return
  }

  if (!restorePassword.value) {
    ElMessage.warning('请输入备份密码')
    return
  }

  try {
    backupLoading.value = true
    const result = await window.electronAPI.backup.restore(restoreFilePath.value, restorePassword.value)
    
    if (result.success) {
      restoreBackupData.value = result.data
      ElMessage.success('备份文件加载成功')
    } else {
      ElMessage.error('加载失败: ' + result.error)
    }
  } catch (error: any) {
    ElMessage.error('加载备份文件失败: ' + error.message)
  } finally {
    backupLoading.value = false
  }
}

// 应用恢复
const applyRestore = async () => {
  if (restoreOptions.value.length === 0) {
    ElMessage.warning('请至少选择一项要恢复的数据')
    return
  }

  try {
    await ElMessageBox.confirm(
      '恢复数据将会添加备份中的数据到当前系统，是否继续？',
      '确认恢复',
      {
        type: 'warning'
      }
    )

    backupLoading.value = true

    const options = {
      restoreSessions: restoreOptions.value.includes('sessions'),
      restoreSnippets: restoreOptions.value.includes('snippets'),
      restoreSettings: restoreOptions.value.includes('settings')
    }

    const result = await window.electronAPI.backup.apply(toRaw(restoreBackupData.value), options)
    
    if (result.success) {
      ElMessage.success('数据恢复成功，应用将自动刷新')
      showRestoreBackupDialog.value = false
      cancelRestore()
      
      // Delay slightly to let the modal close animation finish, then reload to reflect changes
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } else {
      ElMessage.error('恢复失败: ' + result.error)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('恢复数据失败: ' + error.message)
    }
  } finally {
    backupLoading.value = false
  }
}

// 从历史恢复
const restoreFromHistory = (backup: any) => {
  restoreFilePath.value = backup.path
  showRestoreBackupDialog.value = true
}

// 删除备份
const deleteBackup = async (backup: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除备份 "${backup.name}" 吗？`,
      '确认删除',
      {
        type: 'warning'
      }
    )

    const result = await window.electronAPI.backup.delete(backup.path)
    
    if (result.success) {
      ElMessage.success('备份已删除')
      await loadBackupList()
    } else {
      ElMessage.error('删除失败: ' + result.error)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除备份失败: ' + error.message)
    }
  }
}

// 取消恢复
const cancelRestore = () => {
  showRestoreBackupDialog.value = false
  restoreFilePath.value = ''
  restorePassword.value = ''
  restoreBackupData.value = null
  restoreOptions.value = ['sessions', 'snippets', 'settings']
}

// 格式化函数
const formatBackupTime = (time?: string) => {
  if (!time) return '从未备份'
  const date = new Date(time)
  return date.toLocaleString('zh-CN')
}

const formatDate = (date: string | Date) => {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN')
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}
const checkForUpdates = async () => {
  // Placeholder for update check logic
  ElMessage.info('正在检查更新... (功能尚在开发中)')
}
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
  transition: background-color var(--transition-normal);
}

/* 头部 */
.panel-header {
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* 内容区域 */
.settings-content {
  flex: 1;
  overflow: hidden;
}

.settings-tabs {
  height: 100%;
}

.settings-tabs :deep(.el-tabs__header) {
  padding-left: var(--spacing-xl);
  margin: 0;
}

.settings-tabs :deep(.el-tabs__content) {
  height: calc(100% - 55px);
  overflow-y: auto;
  padding: var(--spacing-xl);
}

.settings-tabs :deep(.el-tab-pane) {
  width: 100%;
}

/* 设置区块 */
.settings-section {
  width: 100%;
  margin-bottom: var(--spacing-xl);
}

.settings-section :deep(.el-form) {
  width: 100%;
}

.settings-section :deep(.el-form-item) {
  margin-bottom: var(--spacing-lg);
  display: flex;
  align-items: center;
}

.settings-section :deep(.el-form-item__label) {
  width: 120px;
  flex-shrink: 0;
  text-align: left;
  padding-right: var(--spacing-md);
}

.settings-section :deep(.el-form-item__content) {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.settings-section h3 {
  margin: 0 0 var(--spacing-lg) 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

.form-hint {
  margin-left: var(--spacing-sm);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* 关于页面 */
.about-section {
  max-width: 600px;
  text-align: center;
}

.app-info {
  padding: var(--spacing-2xl) 0;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: var(--spacing-xl);
}

.app-logo {
  width: 80px;
  height: 80px;
  margin: 0 auto var(--spacing-lg);
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: 800;
  color: white;
  box-shadow: var(--shadow-lg);
}

.app-info h2 {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.version {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.description {
  margin: 0;
  font-size: var(--text-base);
  color: var(--text-secondary);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-lg);
  text-align: left;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.info-item label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-item span,
.info-item a {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.info-item a {
  color: var(--primary-color);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.info-item a:hover {
  color: var(--primary-light);
}

/* 备份相关样式 */
.backup-actions {
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.restore-options {
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.restore-options h4 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.restore-options :deep(.el-checkbox-group) {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.restore-options :deep(.el-checkbox) {
  margin-right: 0;
}

</style>
