<template>
  <div class="sftp-panel">
    <!-- 双面板布局 -->
    <div class="dual-panel">
      <!-- 左侧：本地文件浏览器 -->
      <div class="file-browser local-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>本地文件</h3>
          </div>
          
          <!-- 盘符选择 -->
          <div class="drive-selector">
            <el-select v-model="currentDrive" @change="changeDrive" size="small" style="width: 100%">
              <el-option
                v-for="drive in availableDrives"
                :key="drive"
                :label="drive"
                :value="drive"
              />
            </el-select>
          </div>
          
          <!-- 路径输入 -->
          <div class="path-input">
            <el-input
              v-model="localPathInput"
              size="small"
              placeholder="输入路径按回车跳转"
              @keyup.enter="navigateToLocalPathInput"
            >
              <template #prefix>
                <el-icon><FolderOpened /></el-icon>
              </template>
            </el-input>
          </div>
          
          <!-- 工具栏 -->
          <div class="toolbar">
            <el-button :icon="Back" size="small" @click="goBackLocal" :disabled="!canGoBackLocal">
              返回
            </el-button>
            <el-button :icon="FolderAdd" size="small" @click="createLocalFolder">
              新建
            </el-button>
            <el-button :icon="Refresh" size="small" @click="refreshLocalDirectory">
              刷新
            </el-button>
          </div>
        </div>
        
        <div class="file-list" v-loading="loadingLocal">
          <el-table
            :data="localFiles"
            height="100%"
            @selection-change="handleLocalSelectionChange"
            @row-dblclick="handleLocalDoubleClick"
            @row-contextmenu="handleLocalContextMenu"
          >
            <el-table-column type="selection" width="40" />
            <el-table-column label="名称" min-width="200">
              <template #default="{ row }">
                <div class="file-name-cell">
                  <el-icon :size="18" class="file-icon">
                    <Folder v-if="row.type === 'directory'" />
                    <Document v-else />
                  </el-icon>
                  <span>{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="100" :formatter="formatSize" />
            <el-table-column label="修改时间" width="150" :formatter="formatTime" />
          </el-table>
        </div>
      </div>

      <!-- 中间：传输按钮 -->
      <div class="transfer-controls">
        <el-tooltip content="上传选中文件到远程" placement="left">
          <el-button
            type="primary"
            :icon="Upload"
            @click="uploadSelected"
            :disabled="selectedLocalFiles.length === 0 || !currentSession"
            circle
            size="large"
          />
        </el-tooltip>
        <el-tooltip content="下载选中文件到本地" placement="right">
          <el-button
            type="success"
            :icon="Download"
            @click="downloadSelected"
            :disabled="selectedRemoteFiles.length === 0 || !currentSession"
            circle
            size="large"
          />
        </el-tooltip>
      </div>

      <!-- 右侧：远程文件浏览器 -->
      <div class="file-browser remote-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>远程文件</h3>
          </div>
          
          <!-- 会话选择 -->
          <div v-if="!currentSession" class="session-selector">
            <div style="display: flex; gap: 8px; align-items: center;">
              <el-select
                v-model="selectedSessionId"
                placeholder="选择会话连接"
                @change="connectToSession"
                filterable
                size="small"
                style="flex: 1"
              >
                <el-option
                  v-for="session in sessions"
                  :key="session.id"
                  :label="session.name"
                  :value="session.id"
                >
                  <div class="session-option">
                    <span>{{ session.name }}</span>
                    <span class="session-host">{{ session.username }}@{{ session.host }}</span>
                  </div>
                </el-option>
              </el-select>
              <el-tooltip content="刷新会话列表" placement="top">
                <el-button 
                  :icon="Refresh" 
                  size="small"
                  @click="loadSessions"
                />
              </el-tooltip>
            </div>
          </div>
          
          <!-- 已连接状态 -->
          <div v-else class="connected-session">
            <div class="session-info">
              <el-icon class="connected-icon"><Connection /></el-icon>
              <span>{{ currentSession.name }}</span>
            </div>
            <el-button size="small" @click="disconnectSession">断开</el-button>
          </div>
          
          <!-- 路径输入 -->
          <div v-if="currentSession" class="path-input">
            <el-input
              v-model="remotePathInput"
              size="small"
              placeholder="输入路径按回车跳转"
              @keyup.enter="navigateToRemotePathInput"
            >
              <template #prefix>
                <el-icon><FolderOpened /></el-icon>
              </template>
            </el-input>
          </div>
          
          <!-- 工具栏 -->
          <div v-if="currentSession" class="toolbar">
            <el-button :icon="Back" size="small" @click="goBackRemote" :disabled="!canGoBackRemote">
              返回
            </el-button>
            <el-dropdown @command="handleCreateCommand" trigger="click">
              <el-button :icon="FolderAdd" size="small">
                新建<el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="folder">
                    <el-icon><FolderAdd /></el-icon>
                    新建文件夹
                  </el-dropdown-item>
                  <el-dropdown-item command="file">
                    <el-icon><Document /></el-icon>
                    新建文件
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button :icon="Refresh" size="small" @click="refreshRemoteDirectory">
              刷新
            </el-button>
          </div>
        </div>
        
        <div class="file-list" v-loading="loadingRemote">
          <div v-if="!currentSession" class="empty-state">
            <el-icon :size="64"><FolderOpened /></el-icon>
            <p>请选择会话连接到远程服务器</p>
          </div>
          
          <el-table
            v-else
            :data="remoteFiles"
            height="100%"
            @selection-change="handleRemoteSelectionChange"
            @row-dblclick="handleRemoteDoubleClick"
            @row-contextmenu="handleRemoteContextMenu"
          >
            <el-table-column type="selection" width="40" />
            <el-table-column label="名称" min-width="200">
              <template #default="{ row }">
                <div class="file-name-cell">
                  <el-icon :size="18" class="file-icon">
                    <Folder v-if="row.type === 'directory'" />
                    <Document v-else-if="row.type === 'file'" />
                    <Link v-else />
                  </el-icon>
                  <span>{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="100" :formatter="formatSize" />
            <el-table-column label="修改时间" width="150" :formatter="formatTime" />
            <el-table-column label="权限" width="90">
              <template #default="{ row }">
                <span class="permissions">{{ formatPermissions(row.permissions) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>

    <!-- 底部：传输队列 -->
    <div v-if="transfers.length > 0" class="transfer-queue">
      <div class="queue-header">
        <span>传输队列 ({{ activeTransfers }}/{{ transfers.length }})</span>
        <div class="queue-actions">
          <el-button text size="small" @click="clearCompleted">清除已完成</el-button>
          <el-button text size="small" @click="clearAll">清空队列</el-button>
        </div>
      </div>
      <div class="queue-list">
        <div v-for="transfer in transfers" :key="transfer.id" class="transfer-item">
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="transfer.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ transfer.name }}</div>
              <div class="transfer-path">
                <span class="path-label">{{ transfer.type === 'upload' ? '上传至' : '下载至' }}:</span>
                <span class="path-value">{{ transfer.targetPath }}</span>
              </div>
            </div>
            <div class="transfer-status">
              <span :class="['status-text', transfer.status]">{{ getStatusText(transfer.status) }}</span>
              <span v-if="transfer.status === 'active'" class="transfer-speed">{{ formatSpeed(transfer.speed) }}</span>
            </div>
          </div>
          <el-progress
            :percentage="transfer.progress"
            :status="transfer.status === 'failed' ? 'exception' : transfer.status === 'completed' ? 'success' : undefined"
          />
        </div>
      </div>
    </div>

    <!-- 新建远程文件夹对话框 -->
    <el-dialog v-model="showCreateRemoteFolderDialog" title="新建远程文件夹" width="400px">
      <el-input v-model="newRemoteFolderName" placeholder="输入文件夹名称" @keyup.enter="createRemoteFolder" />
      <template #footer>
        <el-button @click="showCreateRemoteFolderDialog = false">取消</el-button>
        <el-button type="primary" @click="createRemoteFolder">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建远程文件对话框 -->
    <el-dialog v-model="showCreateRemoteFileDialog" title="新建远程文件" width="400px">
      <el-input v-model="newRemoteFileName" placeholder="输入文件名称" @keyup.enter="createRemoteFile" />
      <template #footer>
        <el-button @click="showCreateRemoteFileDialog = false">取消</el-button>
        <el-button type="primary" @click="createRemoteFile">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="showRenameDialog" title="重命名" width="400px">
      <el-input v-model="renameValue" placeholder="输入新名称" @keyup.enter="confirmRename" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动文件对话框 -->
    <el-dialog v-model="showMoveDialog" title="移动文件/文件夹" width="500px">
      <div style="margin-bottom: 12px;">
        <strong>源文件：</strong> {{ movingFile?.name }}
      </div>
      <el-input v-model="moveTargetPath" placeholder="输入目标路径" />
      <template #footer>
        <el-button @click="showMoveDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmMove">移动</el-button>
      </template>
    </el-dialog>

    <!-- 复制文件对话框 -->
    <el-dialog v-model="showCopyDialog" title="复制文件/文件夹" width="500px">
      <div style="margin-bottom: 12px;">
        <strong>源文件：</strong> {{ copyingFile?.name }}
      </div>
      <el-input v-model="copyTargetPath" placeholder="输入目标路径" />
      <template #footer>
        <el-button @click="showCopyDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCopy">复制</el-button>
      </template>
    </el-dialog>

    <!-- 权限编辑对话框 -->
    <el-dialog v-model="showPermissionsDialog" title="修改权限" width="450px">
      <div style="margin-bottom: 16px;">
        <strong>文件：</strong> {{ editingPermissions?.name }}
      </div>

      <div class="permissions-editor">
        <!-- 所有者权限 -->
        <div class="permission-group">
          <h4>所有者 (Owner)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.ownerRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 组权限 -->
        <div class="permission-group">
          <h4>组 (Group)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.groupRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 其他用户权限 -->
        <div class="permission-group">
          <h4>其他 (Others)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.otherRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherExecute">执行 (x)</el-checkbox>
          </div>
        </div>

        <!-- 八进制表示 -->
        <div class="permission-octal">
          <strong>八进制表示：</strong>
          <span class="octal-value">{{ computedOctalPermission }}</span>
        </div>
      </div>

      <template #footer>
        <el-button @click="showPermissionsDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPermissions">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Connection, FolderOpened, Back, FolderAdd,
  Upload, Download, Refresh, Folder, Document, Link, ArrowDown
} from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifyTime: Date
  permissions?: number
}

interface Transfer {
  id: string
  name: string
  type: 'upload' | 'download'
  status: 'pending' | 'active' | 'completed' | 'failed'
  progress: number
  speed: number
  eta: number
  targetPath: string
}

const sessions = ref<SessionConfig[]>([])
const selectedSessionId = ref('')
const currentSession = ref<SessionConfig | null>(null)

// 本地文件
const localPath = ref('')
const localPathInput = ref('')
const currentDrive = ref('C:')
const availableDrives = ref<string[]>(['C:', 'D:', 'E:', 'F:', 'G:'])
const localFiles = ref<FileInfo[]>([])
const selectedLocalFiles = ref<FileInfo[]>([])
const loadingLocal = ref(false)

// 远程文件
const remotePath = ref('/')
const remotePathInput = ref('')
const remoteFiles = ref<FileInfo[]>([])
const selectedRemoteFiles = ref<FileInfo[]>([])
const loadingRemote = ref(false)

// 传输
const transfers = ref<Transfer[]>([])

// 对话框
const showCreateRemoteFolderDialog = ref(false)
const showCreateRemoteFileDialog = ref(false)
const showRenameDialog = ref(false)
const newRemoteFolderName = ref('')
const newRemoteFileName = ref('')
const renameValue = ref('')
const renamingFile = ref<{ file: FileInfo; isRemote: boolean } | null>(null)

// 移动文件相关
const showMoveDialog = ref(false)
const movingFile = ref<FileInfo | null>(null)
const moveTargetPath = ref('')

// 复制文件相关
const showCopyDialog = ref(false)
const copyingFile = ref<FileInfo | null>(null)
const copyTargetPath = ref('')

// 权限编辑相关
const showPermissionsDialog = ref(false)
const editingPermissions = ref<FileInfo | null>(null)
const permissionBits = ref({
  ownerRead: false,
  ownerWrite: false,
  ownerExecute: false,
  groupRead: false,
  groupWrite: false,
  groupExecute: false,
  otherRead: false,
  otherWrite: false,
  otherExecute: false
})

const canGoBackLocal = computed(() => {
  if (!localPath.value) return false
  const isRoot = localPath.value.match(/^[A-Z]:\\?$/i) || localPath.value === '/'
  return !isRoot
})

const canGoBackRemote = computed(() => {
  return remotePath.value !== '/'
})

const activeTransfers = computed(() => {
  return transfers.value.filter(t => t.status === 'active' || t.status === 'pending').length
})

// 计算八进制权限值
const computedOctalPermission = computed(() => {
  const owner = (permissionBits.value.ownerRead ? 4 : 0) +
                (permissionBits.value.ownerWrite ? 2 : 0) +
                (permissionBits.value.ownerExecute ? 1 : 0)
  const group = (permissionBits.value.groupRead ? 4 : 0) +
                (permissionBits.value.groupWrite ? 2 : 0) +
                (permissionBits.value.groupExecute ? 1 : 0)
  const other = (permissionBits.value.otherRead ? 4 : 0) +
                (permissionBits.value.otherWrite ? 2 : 0) +
                (permissionBits.value.otherExecute ? 1 : 0)
  return `${owner}${group}${other}`
})

onMounted(async () => {
  // 设置默认本地路径为用户目录
  const userProfile = (window as any).electronAPI.process?.env?.USERPROFILE || 
                      (window as any).electronAPI.process?.env?.HOME || 
                      'C:\\'
  localPath.value = userProfile
  localPathInput.value = userProfile
  
  // 检测当前盘符
  if (userProfile.match(/^[A-Z]:/i)) {
    currentDrive.value = userProfile.substring(0, 2).toUpperCase()
  }
  
  await loadSessions()
  await loadLocalDirectory()
})

const loadSessions = async () => {
  try {
    console.log('Loading sessions for SFTP...')
    sessions.value = await window.electronAPI.session.getAll()
    console.log('Loaded sessions:', sessions.value.length, sessions.value)
    ElMessage.success(`已加载 ${sessions.value.length} 个会话`)
  } catch (error) {
    console.error('Failed to load sessions:', error)
    ElMessage.error('加载会话列表失败')
  }
}

const connectToSession = async () => {
  const session = sessions.value.find(s => s.id === selectedSessionId.value)
  if (!session) return
  
  await connectSession(session)
}

const connectSession = async (session: SessionConfig) => {
  loadingRemote.value = true
  const loadingMsg = ElMessage({
    message: `正在连接到 ${session.name}...`,
    type: 'info',
    duration: 0
  })
  
  try {
    const sshResult = await window.electronAPI.ssh.connect(session.id, {
      host: session.host,
      port: session.port,
      username: session.username,
      password: session.password,
      privateKey: session.privateKey,
      passphrase: session.passphrase
    })

    if (!sshResult.success) {
      loadingMsg.close()
      ElMessage.error(`SSH 连接失败: ${sshResult.error}`)
      return
    }

    const sftpResult = await window.electronAPI.sftp.init(session.id)
    if (sftpResult.success) {
      currentSession.value = session
      
      // root 用户默认 /root，其他用户 /home/username
      if (session.username === 'root') {
        remotePath.value = '/root'
      } else {
        remotePath.value = `/home/${session.username}`
      }
      
      remotePathInput.value = remotePath.value
      await loadRemoteDirectory()
      loadingMsg.close()
      ElMessage.success(`已连接到 ${session.name}`)
    } else {
      loadingMsg.close()
      ElMessage.error(`SFTP 连接失败: ${sftpResult.error}`)
    }
  } catch (error: any) {
    loadingMsg.close()
    ElMessage.error(`连接失败: ${error.message}`)
  } finally {
    loadingRemote.value = false
  }
}

const disconnectSession = async () => {
  if (!currentSession.value) return
  
  try {
    await window.electronAPI.ssh.disconnect(currentSession.value.id)
    currentSession.value = null
    selectedSessionId.value = ''
    remoteFiles.value = []
    ElMessage.success('已断开连接')
  } catch (error: any) {
    ElMessage.error(`断开连接失败: ${error.message}`)
  }
}

// 本地文件操作
const loadLocalDirectory = async () => {
  loadingLocal.value = true
  try {
    const result = await window.electronAPI.fs.readDirectory(localPath.value)
    if (result.success && result.files) {
      localFiles.value = result.files.map((file: any) => ({
        name: file.name,
        path: localPath.value + (localPath.value.endsWith('\\') || localPath.value.endsWith('/') ? '' : '\\') + file.name,
        type: file.isDirectory ? 'directory' : 'file',
        size: file.size || 0,
        modifyTime: new Date(file.mtime)
      }))
    }
  } catch (error: any) {
    ElMessage.error(`加载本地目录失败: ${error.message}`)
  } finally {
    loadingLocal.value = false
  }
}

const goBackLocal = () => {
  const parts = localPath.value.split('\\').filter(p => p)
  if (parts.length > 1) {
    parts.pop()
    localPath.value = parts.join('\\')
  } else if (parts.length === 1) {
    localPath.value = parts[0] + '\\'
  }
  localPathInput.value = localPath.value
  loadLocalDirectory()
}

const changeDrive = () => {
  localPath.value = currentDrive.value + '\\'
  localPathInput.value = localPath.value
  loadLocalDirectory()
}

const navigateToLocalPathInput = async () => {
  const inputPath = localPathInput.value.trim()
  if (!inputPath) return
  
  try {
    // 检查路径是否存在
    const result = await window.electronAPI.fs.stat(inputPath)
    if (result.success && result.stats.isDirectory) {
      localPath.value = inputPath
      await loadLocalDirectory()
    } else {
      ElMessage.error('路径不存在或不是目录')
      localPathInput.value = localPath.value
    }
  } catch (error: any) {
    ElMessage.error(`无效路径: ${error.message}`)
    localPathInput.value = localPath.value
  }
}

const refreshLocalDirectory = () => {
  loadLocalDirectory()
}

const createLocalFolder = async () => {
  try {
    const { value: folderName } = await ElMessageBox.prompt('输入文件夹名称', '新建本地文件夹', {
      inputPattern: /.+/,
      inputErrorMessage: '请输入文件夹名称'
    })
    
    if (folderName) {
      const newPath = localPath.value + (localPath.value.endsWith('\\') ? '' : '\\') + folderName
      const result = await window.electronAPI.fs.createDirectory(newPath)
      if (result.success) {
        ElMessage.success('文件夹创建成功')
        await loadLocalDirectory()
      } else {
        ElMessage.error(`创建失败: ${result.error}`)
      }
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`创建失败: ${error.message}`)
    }
  }
}

const handleLocalSelectionChange = (selection: FileInfo[]) => {
  selectedLocalFiles.value = selection
}

const handleLocalDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    localPath.value = row.path
    loadLocalDirectory()
  }
}

const handleLocalContextMenu = async (row: FileInfo, column: any, event: MouseEvent) => {
  event.preventDefault()
  
  const menuItems = []
  
  if (row.type === 'directory') {
    menuItems.push({ label: '打开', action: 'open' })
  }
  
  // Always show Upload option, we handle validation logic later
  menuItems.push({ label: '上传到远程', action: 'upload' })
  
  menuItems.push(
    { label: '重命名', action: 'rename' },
    { label: '删除', action: 'delete' }
  )
  
  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)
    
    if (result === 'open' && row.type === 'directory') {
      localPath.value = row.path
      await loadLocalDirectory()
    } else if (result === 'upload') {
      if (!currentSession.value) {
        ElMessage.warning('请先连接到远程服务器')
        return
      }
      selectedLocalFiles.value = [row]
      await uploadSelected()
    } else if (result === 'rename') {
      renamingFile.value = { file: row, isRemote: false }
      renameValue.value = row.name
      showRenameDialog.value = true
    } else if (result === 'delete') {
      await deleteLocalFile(row)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteLocalFile = async (file: FileInfo) => {
  try {
    await ElMessageBox.confirm(`确定要删除 "${file.name}" 吗？`, '确认删除', {
      type: 'warning'
    })
    
    const result = await window.electronAPI.fs.deleteFile(file.path)
    if (result.success) {
      ElMessage.success('删除成功')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

// 远程文件操作
const loadRemoteDirectory = async () => {
  if (!currentSession.value) return
  
  loadingRemote.value = true
  try {
    const result = await window.electronAPI.sftp.listDirectory(
      currentSession.value.id,
      remotePath.value
    )
    
    if (result.success && result.files) {
      remoteFiles.value = result.files.map((file: any) => ({
        name: file.name,
        path: `${remotePath.value}/${file.name}`.replace(/\/+/g, '/'),
        type: file.type,
        size: file.size,
        modifyTime: new Date(file.modifyTime),
        permissions: file.permissions
      }))
    }
  } catch (error: any) {
    ElMessage.error(`加载远程目录失败: ${error.message}`)
  } finally {
    loadingRemote.value = false
  }
}

const goBackRemote = () => {
  const parts = remotePath.value.split('/').filter(p => p)
  parts.pop()
  remotePath.value = '/' + parts.join('/')
  remotePathInput.value = remotePath.value
  loadRemoteDirectory()
}

const navigateToRemotePathInput = async () => {
  const inputPath = remotePathInput.value.trim()
  if (!inputPath) return
  
  remotePath.value = inputPath
  await loadRemoteDirectory()
}

const refreshRemoteDirectory = () => {
  loadRemoteDirectory()
}

const createRemoteFolder = async () => {
  if (!newRemoteFolderName.value.trim() || !currentSession.value) return

  try {
    const newPath = `${remotePath.value}/${newRemoteFolderName.value}`.replace(/\/+/g, '/')
    const result = await window.electronAPI.sftp.createDirectory(currentSession.value.id, newPath)

    if (result.success) {
      ElMessage.success('文件夹创建成功')
      showCreateRemoteFolderDialog.value = false
      newRemoteFolderName.value = ''
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`创建失败: ${error.message}`)
  }
}

// 处理新建命令
const handleCreateCommand = (command: string) => {
  if (command === 'folder') {
    showCreateRemoteFolderDialog.value = true
  } else if (command === 'file') {
    showCreateRemoteFileDialog.value = true
  }
}

// 新建远程文件
const createRemoteFile = async () => {
  if (!newRemoteFileName.value.trim() || !currentSession.value) return

  try {
    const newPath = `${remotePath.value}/${newRemoteFileName.value}`.replace(/\/+/g, '/')
    const result = await window.electronAPI.sftp.createFile(currentSession.value.id, newPath)

    if (result.success) {
      ElMessage.success('文件创建成功')
      showCreateRemoteFileDialog.value = false
      newRemoteFileName.value = ''
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`创建失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`创建失败: ${error.message}`)
  }
}

const handleRemoteSelectionChange = (selection: FileInfo[]) => {
  selectedRemoteFiles.value = selection
}

const handleRemoteDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    remotePath.value = row.path
    loadRemoteDirectory()
  }
}

const handleRemoteContextMenu = async (row: FileInfo, column: any, event: MouseEvent) => {
  event.preventDefault()

  if (!currentSession.value) return

  const menuItems = row.type === 'directory'
    ? [
        { label: '打开', action: 'open' },
        { label: '重命名', action: 'rename' },
        { label: '移动', action: 'move' },
        { label: '复制', action: 'copy' },
        { label: '权限', action: 'permissions' },
        { label: '删除', action: 'delete' }
      ]
    : [
        { label: '下载', action: 'download' },
        { label: '重命名', action: 'rename' },
        { label: '移动', action: 'move' },
        { label: '复制', action: 'copy' },
        { label: '权限', action: 'permissions' },
        { label: '删除', action: 'delete' }
      ]

  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)

    if (result === 'open' && row.type === 'directory') {
      remotePath.value = row.path
      await loadRemoteDirectory()
    } else if (result === 'download') {
      selectedRemoteFiles.value = [row]
      await downloadSelected()
    } else if (result === 'rename') {
      renamingFile.value = { file: row, isRemote: true }
      renameValue.value = row.name
      showRenameDialog.value = true
    } else if (result === 'move') {
      movingFile.value = row
      moveTargetPath.value = remotePath.value
      showMoveDialog.value = true
    } else if (result === 'copy') {
      copyingFile.value = row
      copyTargetPath.value = remotePath.value
      showCopyDialog.value = true
    } else if (result === 'permissions') {
      editingPermissions.value = row
      // 将八进制权限转换为复选框状态
      const perms = row.permissions || 0o644
      permissionBits.value = {
        ownerRead: !!(perms & 0o400),
        ownerWrite: !!(perms & 0o200),
        ownerExecute: !!(perms & 0o100),
        groupRead: !!(perms & 0o040),
        groupWrite: !!(perms & 0o020),
        groupExecute: !!(perms & 0o010),
        otherRead: !!(perms & 0o004),
        otherWrite: !!(perms & 0o002),
        otherExecute: !!(perms & 0o001)
      }
      showPermissionsDialog.value = true
    } else if (result === 'delete') {
      await deleteRemoteFile(row)
    }
  } catch (error) {
    // 用户取消
  }
}

const deleteRemoteFile = async (file: FileInfo) => {
  if (!currentSession.value) return
  
  try {
    await ElMessageBox.confirm(`确定要删除 "${file.name}" 吗？`, '确认删除', {
      type: 'warning'
    })
    
    const result = await window.electronAPI.sftp.deleteFile(
      currentSession.value.id,
      file.path
    )
    
    if (result.success) {
      ElMessage.success('删除成功')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

const confirmRename = async () => {
  if (!renameValue.value.trim() || !renamingFile.value) return
  
  try {
    if (renamingFile.value.isRemote) {
      if (!currentSession.value) return
      
      const oldPath = renamingFile.value.file.path
      const newPath = oldPath.replace(/[^/]+$/, renameValue.value)
      
      const result = await window.electronAPI.sftp.renameFile(
        currentSession.value.id,
        oldPath,
        newPath
      )
      
      if (result.success) {
        ElMessage.success('重命名成功')
        await loadRemoteDirectory()
      } else {
        ElMessage.error(`重命名失败: ${result.error}`)
      }
    } else {
      const oldPath = renamingFile.value.file.path
      const parts = oldPath.split('\\')
      parts[parts.length - 1] = renameValue.value
      const newPath = parts.join('\\')
      
      const result = await window.electronAPI.fs.rename(oldPath, newPath)
      
      if (result.success) {
        ElMessage.success('重命名成功')
        await loadLocalDirectory()
      } else {
        ElMessage.error(`重命名失败: ${result.error}`)
      }
    }
    
    showRenameDialog.value = false
    renamingFile.value = null
    renameValue.value = ''
  } catch (error: any) {
    ElMessage.error(`重命名失败: ${error.message}`)
  }
}

// 移动文件
const confirmMove = async () => {
  if (!moveTargetPath.value.trim() || !movingFile.value || !currentSession.value) return

  try {
    const sourcePath = movingFile.value.path
    const targetPath = moveTargetPath.value.endsWith('/')
      ? moveTargetPath.value + movingFile.value.name
      : moveTargetPath.value + '/' + movingFile.value.name

    const result = await window.electronAPI.sftp.renameFile(
      currentSession.value.id,
      sourcePath,
      targetPath
    )

    if (result.success) {
      ElMessage.success('移动成功')
      await loadRemoteDirectory()
      showMoveDialog.value = false
      movingFile.value = null
    } else {
      ElMessage.error(`移动失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`移动失败: ${error.message}`)
  }
}

// 复制文件
const confirmCopy = async () => {
  if (!copyTargetPath.value.trim() || !copyingFile.value || !currentSession.value) return

  try {
    const sourcePath = copyingFile.value.path
    const targetPath = copyTargetPath.value.endsWith('/')
      ? copyTargetPath.value + copyingFile.value.name
      : copyTargetPath.value + '/' + copyingFile.value.name

    ElMessage.info('正在复制文件...')

    // 使用 SFTP 的复制功能（通过读取和写入实现）
    const result = await window.electronAPI.sftp.copyFile(
      currentSession.value.id,
      sourcePath,
      targetPath
    )

    if (result.success) {
      ElMessage.success('复制成功')
      await loadRemoteDirectory()
      showCopyDialog.value = false
      copyingFile.value = null
    } else {
      ElMessage.error(`复制失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`复制失败: ${error.message}`)
  }
}

// 修改权限
const confirmPermissions = async () => {
  if (!editingPermissions.value || !currentSession.value) return

  try {
    const filePath = editingPermissions.value.path

    // 从复选框计算权限值
    const owner = (permissionBits.value.ownerRead ? 4 : 0) +
                  (permissionBits.value.ownerWrite ? 2 : 0) +
                  (permissionBits.value.ownerExecute ? 1 : 0)
    const group = (permissionBits.value.groupRead ? 4 : 0) +
                  (permissionBits.value.groupWrite ? 2 : 0) +
                  (permissionBits.value.groupExecute ? 1 : 0)
    const other = (permissionBits.value.otherRead ? 4 : 0) +
                  (permissionBits.value.otherWrite ? 2 : 0) +
                  (permissionBits.value.otherExecute ? 1 : 0)

    const mode = parseInt(`${owner}${group}${other}`, 8)

    const result = await window.electronAPI.sftp.chmod(
      currentSession.value.id,
      filePath,
      mode
    )

    if (result.success) {
      ElMessage.success('权限修改成功')
      await loadRemoteDirectory()
      showPermissionsDialog.value = false
      editingPermissions.value = null
    } else {
      ElMessage.error(`权限修改失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`权限修改失败: ${error.message}`)
  }
}

// 传输操作
const uploadSelected = async () => {
  if (selectedLocalFiles.value.length === 0 || !currentSession.value) return
  
  for (const file of selectedLocalFiles.value) {
    if (file.type === 'directory') {
      ElMessage.warning(`暂时不支持文件夹上传: ${file.name}`)
      continue
    }
    
    // Check if file exists remotely? Overwrite default.
    
    const remoteFilePath = `${remotePath.value}/${file.name}`.replace(/\/+/g, '/')
    const transferId = Date.now().toString() + Math.random()
    
    transfers.value.push({
      id: transferId,
      name: file.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      targetPath: remoteFilePath
    })
    
    try {
      const result = await window.electronAPI.sftp.uploadFile(
        currentSession.value.id,
        file.path,
        remoteFilePath
      )
      
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        if (result.success) {
          transfer.status = 'completed'
          transfer.progress = 100
          ElMessage.success(`上传成功: ${file.name}`)
        } else {
          transfer.status = 'failed'
          ElMessage.error(`上传失败: ${result.error}`)
        }
      }
    } catch (error: any) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        transfer.status = 'failed'
      }
      ElMessage.error(`上传失败: ${error.message || '未知错误'}`)
    }
  }
  
  await loadRemoteDirectory()
}

const downloadSelected = async () => {
  if (selectedRemoteFiles.value.length === 0 || !currentSession.value) return
  
  for (const file of selectedRemoteFiles.value) {
    if (file.type === 'directory') {
      ElMessage.warning(`跳过文件夹: ${file.name}`)
      continue
    }
    
    // 下载到当前本地目录
    const separator = localPath.value.endsWith('\\') ? '' : '\\'
    const localFilePath = localPath.value + separator + file.name
    const transferId = Date.now().toString() + Math.random()
    
    transfers.value.push({
      id: transferId,
      name: file.name,
      type: 'download',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      targetPath: localFilePath
    })
    
    try {
      const result = await window.electronAPI.sftp.downloadFile(
        currentSession.value.id,
        file.path,
        localFilePath
      )
      
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        if (result.success) {
          transfer.status = 'completed'
          transfer.progress = 100
          ElMessage.success(`下载成功: ${file.name}`)
        } else {
          transfer.status = 'failed'
          ElMessage.error(`下载失败: ${result.error}`)
        }
      }
    } catch (error: any) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        transfer.status = 'failed'
      }
      ElMessage.error(`下载失败: ${error.message || '未知错误'}`)
    }
  }
  
  await loadLocalDirectory()
}

const clearCompleted = () => {
  transfers.value = transfers.value.filter(t => t.status !== 'completed')
}

const clearAll = () => {
  transfers.value = []
}

// 格式化函数
const formatSize = ({ size }: { size: number }) => {
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

const formatTime = ({ modifyTime }: { modifyTime: Date }) => {
  if (!modifyTime) return '-'
  const date = new Date(modifyTime)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatPermissions = (permissions: number | undefined) => {
  if (permissions === undefined) return '-'
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  const owner = perms[(permissions >> 6) & 7]
  const group = perms[(permissions >> 3) & 7]
  const other = perms[permissions & 7]
  return owner + group + other
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    pending: '等待中',
    active: '传输中',
    completed: '已完成',
    failed: '失败'
  }
  return map[status] || status
}

const formatSpeed = (speed: number) => {
  if (!speed) return ''
  return `${formatSize({ size: speed })}/s`
}
</script>


<style scoped>
/* 
  Re-architected Layout System 
  Using CSS Grid for absolute column discipline 
*/
.sftp-panel {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-main);
  font-family: 'Inter', system-ui, sans-serif;
  overflow: hidden;
}

/* Main Content Area: Grid Layout */
.dual-panel {
  flex: 1; /* Occupy all available vertical space */
  display: grid;
  grid-template-columns: 1fr 50px 1fr; /* Strict 50/50 split with fixed control strip */
  grid-template-rows: 100%;
  overflow: hidden;
  position: relative;
}

/* File Browser Container */
.file-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-main);
  border-right: 1px solid var(--border-color);
}

.file-browser:last-child {
  border-right: none;
}

/* Professional Header Design */
.browser-header {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid #3e3e3e;
}

.header-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.browser-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.drive-selector {
  width: 100%;
}

.session-selector {
  width: 100%;
}

.connected-session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-main);
  border: 1px solid #007acc;
  border-radius: 4px;
}

.path-input {
  width: 100%;
}

.toolbar {
  display: flex;
  gap: 8px;
}

.path-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Path Navigator */
.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.breadcrumb-wrapper {
  flex: 1;
  height: 30px;
  background: var(--bg-main);
  border: 1px solid var(--border-color);
  border-radius: 4px; /* Standard radius */
  display: flex;
  align-items: center;
  padding: 0 10px;
  transition: border-color 0.2s;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
}

.breadcrumb-wrapper:hover {
  border-color: var(--text-tertiary);
}

.path-text {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--success-color);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.connected-icon {
  color: var(--success-color);
  font-size: 16px;
}

.session-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-host {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Central Control Strip */
.transfer-controls {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  background: var(--bg-tertiary);
  border-right: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color); /* Double border for separation */
  z-index: 20;
  box-shadow: 0 0 10px rgba(0,0,0,0.2);
}

.transfer-controls .el-button {
  width: 32px;
  height: 32px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

/* File List Area */
.file-list {
  flex: 1;
  position: relative;
  overflow: auto; /* Internal scroll */
}

/* Table Enhancements */
.file-list :deep(.el-table) {
  --el-table-header-bg-color: var(--bg-main);
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.04);
  --el-table-border-color: transparent;
  --el-table-text-color: var(--text-secondary);
  --el-table-header-text-color: var(--text-secondary);
  background-color: transparent;
  font-size: 12px;
}

.file-list :deep(.el-table tr) {
  transition: background-color 0.1s;
}

.file-list :deep(.el-table th.el-table__cell) {
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
}

.file-list :deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid rgba(255,255,255,0.03);
  padding: 6px 0;
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
  color: var(--text-primary);
  transition: color 0.2s;
}

.file-list :deep(.el-table__row:hover) .file-name-cell {
  color: var(--primary-color);
}

/* Icons */
.file-icon {
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
}

/* Transfer Queue (Bottom Panel) */
.transfer-queue {
  height: 160px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 10px rgba(0,0,0,0.1);
}

.queue-header {
  height: 32px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.queue-list {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.transfer-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  gap: 12px;
  font-size: 12px;
}

.transfer-item:last-child {
  border-bottom: none;
}

.transfer-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.transfer-name {
  font-weight: 600;
  color: var(--text-primary);
  min-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-path {
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.transfer-status {
  width: 100px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.status-text.active { color: var(--primary-color); }
.status-text.completed { color: var(--success-color); }
.status-text.failed { color: var(--error-color); }

/* Empty States */
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  opacity: 0.5;
}

/* Button & Input Overrides for "Tightness" */
:deep(.el-button--small) {
  padding: 6px 10px;
  font-weight: 500;
}

:deep(.el-input__wrapper) {
  box-shadow: none !important;
  border: 1px solid var(--border-color);
  background-color: var(--bg-main) !important;
}

/* Scrollbar Polish */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-main);
}
::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* 权限编辑器样式 */
.permissions-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.permission-group {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
}

.permission-group h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.permission-checkboxes {
  display: flex;
  gap: 16px;
}

.permission-octal {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-medium);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.octal-value {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--primary-color);
}
</style>
