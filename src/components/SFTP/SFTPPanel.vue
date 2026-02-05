<template>
  <div class="sftp-panel">
    <!-- 双面板布局 -->
    <div class="dual-panel">
      <!-- 左侧：本地文件浏览器 -->
      <div class="file-browser local-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>本地文件</h3>
            <el-tooltip content="Ctrl+点击 多选单个，Shift+点击 范围选择" placement="top">
              <el-icon class="help-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
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
          <VirtualTable
            :data="localFiles"
            :columns="localFileColumns"
            :row-height="40"
            :buffer="10"
            selectable
            selected-key="path"
            @row-click="handleLocalClick"
            @row-dblclick="handleLocalDoubleClick"
            @row-contextmenu="handleLocalContextMenu"
            @selection-change="handleLocalSelectionChange"
          >
            <template #name="{ row }">
              <div class="file-name-cell">
                <el-icon :size="18" class="file-icon">
                  <Folder v-if="row.type === 'directory'" />
                  <Document v-else />
                </el-icon>
                <span>{{ row.name }}</span>
              </div>
            </template>
            <template #size="{ row }">
              {{ formatSize({ size: row.size }) }}
            </template>
            <template #modifyTime="{ row }">
              {{ formatTime({ modifyTime: row.modifyTime }) }}
            </template>
          </VirtualTable>
        </div>
      </div>

      <!-- 中间：传输按钮 -->
      <div class="transfer-controls">
        <el-tooltip content="上传选中文件到远程" placement="left">
          <button
            class="transfer-btn upload-btn"
            @click="uploadSelected"
            :disabled="selectedLocalFiles.length === 0 || !currentSession"
          >
            <el-icon><Top /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip content="下载选中文件到本地" placement="right">
          <button
            class="transfer-btn download-btn"
            @click="downloadSelected"
            :disabled="selectedRemoteFiles.length === 0 || !currentSession"
          >
            <el-icon><Bottom /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <!-- 右侧：远程文件浏览器 -->
      <div class="file-browser remote-browser">
        <div class="browser-header">
          <div class="header-title">
            <h3>远程文件</h3>
            <el-tooltip content="Ctrl+点击 多选单个，Shift+点击 范围选择" placement="top">
              <el-icon class="help-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
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
          
          <FileDropZone
            v-else
            :disabled="!currentSession"
            @upload="handleFilesDrop"
          >
            <VirtualTable
              :data="remoteFiles"
              :columns="remoteFileColumns"
              :row-height="40"
              :buffer="10"
              selectable
              selected-key="path"
              @row-click="handleRemoteClick"
              @row-dblclick="handleRemoteDoubleClick"
              @row-contextmenu="handleRemoteContextMenu"
              @selection-change="handleRemoteSelectionChange"
            >
              <template #name="{ row }">
                <div class="file-name-cell">
                  <el-icon :size="18" class="file-icon">
                    <Folder v-if="row.type === 'directory'" />
                    <Document v-else-if="row.type === 'file'" />
                    <Link v-else />
                  </el-icon>
                  <span>{{ row.name }}</span>
                </div>
              </template>
              <template #size="{ row }">
                {{ formatSize({ size: row.size }) }}
              </template>
              <template #modifyTime="{ row }">
                {{ formatTime({ modifyTime: row.modifyTime }) }}
              </template>
              <template #permissions="{ row }">
                <span class="permissions">{{ formatPermissions(row.permissions) }}</span>
              </template>
            </VirtualTable>
          </FileDropZone>
        </div>
      </div>
    </div>

    <!-- 底部：传输队列 -->
    <div v-if="transfers.length > 0 || incompleteTransfers.length > 0" class="transfer-queue">
      <div class="queue-header">
        <el-tabs v-model="activeQueueTab" class="queue-tabs">
          <el-tab-pane label="当前传输" name="current">
            <template #label>
              <span>当前传输 ({{ activeTransfers }}/{{ transfers.length }})</span>
            </template>
          </el-tab-pane>
          <el-tab-pane label="未完成传输" name="incomplete">
            <template #label>
              <span>未完成传输 ({{ incompleteTransfers.length }})</span>
            </template>
          </el-tab-pane>
          <el-tab-pane label="传输历史" name="history">
            <template #label>
              <span>传输历史 ({{ transferHistory.length }})</span>
            </template>
          </el-tab-pane>
        </el-tabs>
        <div class="queue-actions">
          <el-button v-if="activeQueueTab === 'current'" text size="small" @click="pauseAllTransfers">全部暂停</el-button>
          <el-button v-if="activeQueueTab === 'current'" text size="small" @click="clearCompleted">清除已完成</el-button>
          <el-button v-if="activeQueueTab === 'current'" text size="small" @click="clearAll">清空队列</el-button>
          <el-button v-if="activeQueueTab === 'incomplete'" text size="small" @click="loadIncompleteTransfers">刷新</el-button>
          <el-button v-if="activeQueueTab === 'incomplete'" text size="small" @click="cleanupCompletedRecords">清理已完成</el-button>
          <el-button v-if="activeQueueTab === 'history'" text size="small" @click="clearHistory">清空历史</el-button>
          <el-button v-if="activeQueueTab === 'history'" text size="small" @click="exportHistory">导出历史</el-button>
        </div>
      </div>
      
      <!-- 当前传输列表 -->
      <div v-show="activeQueueTab === 'current'" class="queue-list">
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
            <div class="transfer-actions">
              <el-tooltip content="提高优先级" placement="top">
                <el-button 
                  v-if="transfer.status === 'pending' || transfer.status === 'active'" 
                  text 
                  size="small" 
                  @click="increasePriority(transfer.id)"
                  :icon="Top"
                  :disabled="(transfer.priority || 3) >= 5"
                />
              </el-tooltip>
              <el-tooltip content="降低优先级" placement="top">
                <el-button 
                  v-if="transfer.status === 'pending' || transfer.status === 'active'" 
                  text 
                  size="small" 
                  @click="decreasePriority(transfer.id)"
                  :icon="Bottom"
                  :disabled="(transfer.priority || 3) <= 1"
                />
              </el-tooltip>
              <el-button 
                v-if="transfer.status === 'active'" 
                text 
                size="small" 
                @click="pauseTransfer(transfer.id)"
                :icon="VideoPause"
              >
                暂停
              </el-button>
              <el-button 
                v-if="transfer.status === 'paused'" 
                text 
                size="small" 
                type="primary"
                @click="resumeTransfer(transfer.id)"
                :icon="VideoPlay"
              >
                继续
              </el-button>
              <el-button 
                v-if="transfer.status === 'failed'" 
                text 
                size="small" 
                type="warning"
                @click="retryTransfer(transfer.id)"
                :icon="Refresh"
              >
                重试
              </el-button>
              <el-button 
                text 
                size="small" 
                type="danger"
                @click="cancelTransfer(transfer.id)"
                :icon="Close"
              >
                取消
              </el-button>
            </div>
          </div>
          <el-progress
            :percentage="transfer.progress"
            :status="transfer.status === 'failed' ? 'exception' : transfer.status === 'completed' ? 'success' : transfer.status === 'paused' ? 'warning' : undefined"
          />
        </div>
      </div>
      
      <!-- 未完成传输列表 -->
      <div v-show="activeQueueTab === 'incomplete'" class="queue-list">
        <div v-if="incompleteTransfers.length === 0" class="empty-state">
          <el-icon :size="48"><CircleCheck /></el-icon>
          <p>没有未完成的传输</p>
        </div>
        <div v-for="record in incompleteTransfers" :key="record.taskId" class="transfer-item incomplete-item">
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="record.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ getFileName(record.remotePath) }}</div>
              <div class="transfer-path">
                <span class="path-label">本地:</span>
                <span class="path-value">{{ record.localPath }}</span>
              </div>
              <div class="transfer-path">
                <span class="path-label">远程:</span>
                <span class="path-value">{{ record.remotePath }}</span>
              </div>
              <div class="transfer-meta">
                <span>已传输: {{ formatSize({ size: record.transferred }) }} / {{ formatSize({ size: record.totalSize }) }}</span>
                <span>进度: {{ ((record.transferred / record.totalSize) * 100).toFixed(1) }}%</span>
                <span>时间: {{ formatTime({ modifyTime: new Date(record.lastModified) }) }}</span>
              </div>
            </div>
            <div class="transfer-actions">
              <el-button 
                text 
                size="small" 
                type="primary"
                @click="resumeIncompleteTransfer(record)"
                :icon="VideoPlay"
              >
                恢复传输
              </el-button>
              <el-button 
                text 
                size="small" 
                type="danger"
                @click="deleteTransferRecord(record.taskId)"
                :icon="Delete"
              >
                删除记录
              </el-button>
            </div>
          </div>
          <el-progress
            :percentage="(record.transferred / record.totalSize) * 100"
            status="warning"
          />
        </div>
      </div>
      
      <!-- 传输历史列表 -->
      <div v-show="activeQueueTab === 'history'" class="queue-list">
        <div v-if="transferHistory.length === 0" class="empty-state">
          <el-icon :size="48"><Clock /></el-icon>
          <p>暂无传输历史</p>
        </div>
        <div v-for="item in transferHistory" :key="item.id" class="transfer-item history-item">
          <div class="transfer-info">
            <el-icon>
              <Upload v-if="item.type === 'upload'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-details">
              <div class="transfer-name">{{ item.name }}</div>
              <div class="transfer-path">
                <span class="path-label">本地:</span>
                <span class="path-value">{{ item.localPath }}</span>
              </div>
              <div class="transfer-path">
                <span class="path-label">远程:</span>
                <span class="path-value">{{ item.remotePath }}</span>
              </div>
              <div class="transfer-meta">
                <span>大小: {{ formatSize({ size: item.size }) }}</span>
                <span>耗时: {{ formatDuration(item.duration) }}</span>
                <span>时间: {{ formatHistoryTime(item.endTime) }}</span>
              </div>
              <div v-if="item.error" class="transfer-error">
                <span class="error-label">错误:</span>
                <span class="error-message">{{ item.error }}</span>
              </div>
            </div>
            <div class="transfer-status">
              <el-tag 
                :type="item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'info'"
                size="small"
              >
                {{ item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : '已取消' }}
              </el-tag>
            </div>
          </div>
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

    <!-- 文件预览对话框 -->
    <FilePreview
      v-model="showPreview"
      :file="previewFile"
      :connection-id="currentSession?.id || ''"
      @download="handlePreviewDownload"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import {
  Connection, FolderOpened, Back, FolderAdd,
  Upload, Download, Refresh, Folder, Document, Link, ArrowDown,
  VideoPause, VideoPlay, Close, Delete, CircleCheck, Top, Bottom, Clock,
  QuestionFilled
} from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'
import FilePreview from './FilePreview.vue'
import FileDropZone from './FileDropZone.vue'
import VirtualTable from '../Common/VirtualTable.vue'
import type { Column } from '../Common/VirtualTable.vue'
import { useLocale } from '@/composables/useLocale'

// 国际化和格式化
const { t, formatBytes: formatBytesLocale, formatDateTime, formatRelativeTime } = useLocale()

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
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed'
  progress: number
  speed: number
  eta: number
  targetPath: string
  localPath?: string
  remotePath?: string
  priority?: number // 优先级：1-5，数字越大优先级越高
  startTime?: Date
  endTime?: Date
}

interface TransferRecord {
  taskId: string
  type: 'upload' | 'download'
  localPath: string
  remotePath: string
  totalSize: number
  transferred: number
  status: string
  lastModified: string
  connectionId?: string
}

interface TransferHistoryItem {
  id: string
  name: string
  type: 'upload' | 'download'
  status: 'completed' | 'failed' | 'cancelled'
  size: number
  startTime: Date
  endTime: Date
  duration: number // 毫秒
  localPath: string
  remotePath: string
  error?: string
}

const sessions = ref<SessionConfig[]>([])
const selectedSessionId = ref('')
const currentSession = ref<SessionConfig | null>(null)

// 本地文件列定义
const localFileColumns: Column[] = [
  { key: 'name', label: '名称', minWidth: '200px', sortable: true, slot: 'name' },
  { key: 'size', label: '大小', width: '100px', sortable: true, slot: 'size' },
  { key: 'modifyTime', label: '修改时间', width: '150px', sortable: true, slot: 'modifyTime' }
]

// 远程文件列定义
const remoteFileColumns: Column[] = [
  { key: 'name', label: '名称', minWidth: '200px', sortable: true, slot: 'name' },
  { key: 'size', label: '大小', width: '100px', sortable: true, slot: 'size' },
  { key: 'modifyTime', label: '修改时间', width: '150px', sortable: true, slot: 'modifyTime' },
  { key: 'permissions', label: '权限', width: '90px', slot: 'permissions' }
]

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
const incompleteTransfers = ref<TransferRecord[]>([])
const transferHistory = ref<TransferHistoryItem[]>([])
const activeQueueTab = ref<'current' | 'incomplete' | 'history'>('current')

// 对话框
const showCreateRemoteFolderDialog = ref(false)
const showCreateRemoteFileDialog = ref(false)
const showRenameDialog = ref(false)
const showPreview = ref(false)
const newRemoteFolderName = ref('')
const newRemoteFileName = ref('')
const renameValue = ref('')
const renamingFile = ref<{ file: FileInfo; isRemote: boolean } | null>(null)
const previewFile = ref<FileInfo | null>(null)

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
  await loadIncompleteTransfers()
  loadTransferHistory()
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
    // 获取 SSH 设置
    const settings = await window.electronAPI.settings.get()
    const sshSettings = settings?.ssh || {}
    
    // 连接到 SSH
    // 注意：privateKeyId 会在后端 ssh-handlers.ts 中处理
    // 优先使用 privateKeyId，如果没有则使用 privateKeyPath 或 privateKey
    const sshResult = await window.electronAPI.ssh.connect(session.id, {
      host: session.host,
      port: session.port,
      username: session.username,
      password: session.password,
      privateKey: session.privateKeyId ? undefined : (session.privateKeyPath || session.privateKey),
      privateKeyId: session.privateKeyId,
      passphrase: session.passphrase,
      // 应用 SSH 设置
      readyTimeout: (sshSettings.timeout || 30) * 1000,
      keepaliveInterval: sshSettings.keepalive ? (sshSettings.keepaliveInterval || 60) * 1000 : undefined,
      keepaliveCountMax: sshSettings.keepalive ? 3 : undefined,
      sessionName: session.name
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
      
      // 加载未完成的传输
      await loadIncompleteTransfers()
      
      // 如果有未完成的传输，提示用户
      if (incompleteTransfers.value.length > 0) {
        ElNotification({
          title: '发现未完成的传输',
          message: `有 ${incompleteTransfers.value.length} 个未完成的传输，可以在传输队列中恢复`,
          type: 'info',
          duration: 5000
        })
      }
      
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
const loadLocalDirectory = async (silent = false) => {
  if (!silent) {
    loadingLocal.value = true
  }
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

const refreshLocalDirectory = async () => {
  console.log('[SFTP] Refreshing local directory:', localPath.value)
  await loadLocalDirectory()
  console.log('[SFTP] Local directory refreshed, files:', localFiles.value.length)
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

// 本地文件单击 - 仅选择
const handleLocalClick = (row: FileInfo) => {
  // 单击只是选择，不做任何操作
  // 选择逻辑由 VirtualTable 的 selectable 属性处理
}

// 本地文件双击 - 打开文件夹
const handleLocalDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    localPath.value = row.path
    loadLocalDirectory(true)
  }
}

const handleLocalContextMenu = async (row: FileInfo, column: any, event: MouseEvent) => {
  event.preventDefault()
  
  const menuItems = []
  
  // 检查是否有多选
  const hasMultipleSelection = selectedLocalFiles.value.length > 1
  
  if (hasMultipleSelection) {
    // 多选菜单
    menuItems.push(
      { label: `上传 ${selectedLocalFiles.value.length} 个文件`, action: 'upload-multiple' },
      { label: `压缩 ${selectedLocalFiles.value.length} 个项目`, action: 'compress-multiple' },
      { label: `删除 ${selectedLocalFiles.value.length} 个项目`, action: 'delete-multiple' }
    )
  } else {
    // 单选菜单
    if (row.type === 'directory') {
      menuItems.push({ label: '打开', action: 'open' })
    }
    
    menuItems.push({ label: '上传到远程', action: 'upload' })
    
    // 压缩/解压选项
    const ext = row.name.toLowerCase()
    if (ext.endsWith('.zip') || ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz') || ext.endsWith('.7z')) {
      menuItems.push({ label: '解压到当前目录', action: 'extract' })
      menuItems.push({ label: '解压到...', action: 'extract-to' })
    } else {
      menuItems.push({ label: '压缩', action: 'compress' })
    }
    
    menuItems.push(
      { label: '重命名', action: 'rename' },
      { label: '删除', action: 'delete' }
    )
  }
  
  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)
    
    if (result === 'open' && row.type === 'directory') {
      localPath.value = row.path
      await loadLocalDirectory()
    } else if (result === 'upload' || result === 'upload-multiple') {
      if (!currentSession.value) {
        ElMessage.warning('请先连接到远程服务器')
        return
      }
      if (result === 'upload') {
        selectedLocalFiles.value = [row]
      }
      await uploadSelected()
    } else if (result === 'rename') {
      renamingFile.value = { file: row, isRemote: false }
      renameValue.value = row.name
      showRenameDialog.value = true
    } else if (result === 'delete') {
      await deleteLocalFile(row)
    } else if (result === 'delete-multiple') {
      await deleteLocalFilesMultiple()
    } else if (result === 'compress') {
      await compressLocalFile(row)
    } else if (result === 'compress-multiple') {
      await compressLocalFilesMultiple()
    } else if (result === 'extract') {
      await extractLocalFile(row, localPath.value)
    } else if (result === 'extract-to') {
      await extractLocalFileTo(row)
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

const deleteLocalFilesMultiple = async () => {
  if (selectedLocalFiles.value.length === 0) return
  
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedLocalFiles.value.length} 个项目吗？`,
      '批量删除',
      { type: 'warning' }
    )
    
    let successCount = 0
    let failCount = 0
    
    for (const file of selectedLocalFiles.value) {
      try {
        const result = await window.electronAPI.fs.deleteFile(file.path)
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
      }
    }
    
    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个项目`)
    }
    if (failCount > 0) {
      ElMessage.error(`${failCount} 个项目删除失败`)
    }
    
    await loadLocalDirectory()
  } catch (error) {
    // 用户取消
  }
}

// 远程文件操作
const loadRemoteDirectory = async (silent = false) => {
  if (!currentSession.value) return
  
  if (!silent) {
    loadingRemote.value = true
  }
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

const refreshRemoteDirectory = async () => {
  console.log('[SFTP] Refreshing remote directory:', remotePath.value)
  await loadRemoteDirectory()
  console.log('[SFTP] Remote directory refreshed, files:', remoteFiles.value.length)
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

// 远程文件单击 - 仅选择
const handleRemoteClick = (row: FileInfo) => {
  // 单击只是选择，不做任何操作
  // 选择逻辑由 VirtualTable 的 selectable 属性处理
}

// 远程文件双击 - 打开文件夹
const handleRemoteDoubleClick = (row: FileInfo) => {
  if (row.type === 'directory') {
    remotePath.value = row.path
    loadRemoteDirectory(true)
  }
}

const handleRemoteContextMenu = async (row: FileInfo, column: any, event: MouseEvent) => {
  event.preventDefault()

  if (!currentSession.value) return

  // 检查是否有多选
  const hasMultipleSelection = selectedRemoteFiles.value.length > 1
  
  let menuItems: any[] = []
  
  if (hasMultipleSelection) {
    // 多选菜单
    menuItems = [
      { label: `下载 ${selectedRemoteFiles.value.length} 个文件`, action: 'download-multiple' },
      { label: `压缩 ${selectedRemoteFiles.value.length} 个项目`, action: 'compress-multiple' },
      { label: `删除 ${selectedRemoteFiles.value.length} 个项目`, action: 'delete-multiple' }
    ]
  } else {
    // 单选菜单 - 检查是否是压缩文件
    const ext = row.name.toLowerCase()
    const isArchive = ext.endsWith('.zip') || ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz') || ext.endsWith('.gz')
    
    menuItems = row.type === 'directory'
      ? [
          { label: '打开', action: 'open' },
          { label: '压缩', action: 'compress' },
          { label: '重命名', action: 'rename' },
          { label: '移动', action: 'move' },
          { label: '复制', action: 'copy' },
          { label: '权限', action: 'permissions' },
          { label: '删除', action: 'delete' }
        ]
      : isArchive
        ? [
            { label: '预览', action: 'preview' },
            { label: '下载', action: 'download' },
            { label: '解压到当前目录', action: 'extract' },
            { label: '解压到...', action: 'extract-to' },
            { label: '重命名', action: 'rename' },
            { label: '移动', action: 'move' },
            { label: '复制', action: 'copy' },
            { label: '权限', action: 'permissions' },
            { label: '删除', action: 'delete' }
          ]
        : [
            { label: '预览', action: 'preview' },
            { label: '下载', action: 'download' },
            { label: '编辑', action: 'edit' },
            { label: '压缩', action: 'compress' },
            { label: '重命名', action: 'rename' },
            { label: '移动', action: 'move' },
            { label: '复制', action: 'copy' },
            { label: '权限', action: 'permissions' },
            { label: '删除', action: 'delete' }
          ]
  }

  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)

    if (result === 'open' && row.type === 'directory') {
      remotePath.value = row.path
      await loadRemoteDirectory()
    } else if (result === 'preview') {
      previewFile.value = row
      showPreview.value = true
    } else if (result === 'edit') {
      previewFile.value = row
      showPreview.value = true
      // 预览组件会自动切换到编辑模式
    } else if (result === 'download' || result === 'download-multiple') {
      if (result === 'download') {
        selectedRemoteFiles.value = [row]
      }
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
    } else if (result === 'delete-multiple') {
      await deleteRemoteFilesMultiple()
    } else if (result === 'compress') {
      await compressRemoteFile(row)
    } else if (result === 'compress-multiple') {
      await compressRemoteFilesMultiple()
    } else if (result === 'extract') {
      await extractRemoteFile(row, remotePath.value)
    } else if (result === 'extract-to') {
      await extractRemoteFileTo(row)
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

const deleteRemoteFilesMultiple = async () => {
  if (!currentSession.value || selectedRemoteFiles.value.length === 0) return
  
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedRemoteFiles.value.length} 个项目吗？`,
      '批量删除',
      { type: 'warning' }
    )
    
    // 分离文件和目录
    const files = selectedRemoteFiles.value.filter(f => f.type !== 'directory')
    const directories = selectedRemoteFiles.value.filter(f => f.type === 'directory')
    
    let successCount = 0
    let failCount = 0
    
    // 批量删除文件
    if (files.length > 0) {
      const filePaths = files.map(f => f.path)
      const result = await window.electronAPI.sftp.deleteFiles(
        currentSession.value.id,
        filePaths
      )
      
      if (result.success) {
        successCount += result.results.success.length
        failCount += result.results.failed.length
      } else {
        failCount += files.length
      }
    }
    
    // 批量删除目录
    if (directories.length > 0) {
      const dirPaths = directories.map(d => d.path)
      const result = await window.electronAPI.sftp.deleteDirectories(
        currentSession.value.id,
        dirPaths
      )
      
      if (result.success) {
        successCount += result.results.success.length
        failCount += result.results.failed.length
      } else {
        failCount += directories.length
      }
    }
    
    // 显示结果
    if (successCount > 0) {
      ElMessage.success(`成功删除 ${successCount} 个项目`)
    }
    if (failCount > 0) {
      ElMessage.error(`${failCount} 个项目删除失败`)
    }
    
    await loadRemoteDirectory()
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
// 处理文件拖拽上传
const handleFilesDrop = async (files: File[], targetPath: string) => {
  if (!currentSession.value) {
    ElMessage.warning('请先连接到远程服务器')
    return
  }
  
  if (files.length === 0) return
  
  ElMessage.info(`准备上传 ${files.length} 个文件...`)
  
  // 为每个文件创建传输记录
  const transferIds: string[] = []
  for (const file of files) {
    const transferId = Date.now().toString() + Math.random()
    transferIds.push(transferId)
    
    const remoteFilePath = `${remotePath.value}/${file.name}`.replace(/\/+/g, '/')
    
    transfers.value.push({
      id: transferId,
      name: file.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      targetPath: remoteFilePath,
      localPath: file.path || file.name,
      remotePath: remoteFilePath,
      priority: 3,
      startTime: new Date()
    })
  }
  
  // 使用 FileReader 读取文件并上传
  let successCount = 0
  let failCount = 0
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const transferId = transferIds[i]
    const transfer = transfers.value.find(t => t.id === transferId)
    
    try {
      // 读取文件内容
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      
      // 上传到远程
      const remoteFilePath = `${remotePath.value}/${file.name}`.replace(/\/+/g, '/')
      const result = await window.electronAPI.sftp.writeFile(
        currentSession.value.id,
        remoteFilePath,
        buffer
      )
      
      if (result.success) {
        if (transfer) {
          transfer.status = 'completed'
          transfer.progress = 100
          transfer.endTime = new Date()
          addToHistory(transfer)
        }
        successCount++
      } else {
        if (transfer) {
          transfer.status = 'failed'
          transfer.endTime = new Date()
          addToHistory(transfer)
        }
        failCount++
      }
    } catch (error: any) {
      if (transfer) {
        transfer.status = 'failed'
        transfer.endTime = new Date()
        addToHistory(transfer)
      }
      failCount++
      console.error(`Upload failed for ${file.name}:`, error)
    }
  }
  
  // 显示结果
  if (successCount > 0) {
    ElMessage.success(`成功上传 ${successCount} 个文件`)
  }
  if (failCount > 0) {
    ElMessage.error(`${failCount} 个文件上传失败`)
  }
  
  await loadRemoteDirectory()
}

const uploadSelected = async () => {
  if (selectedLocalFiles.value.length === 0 || !currentSession.value) return
  
  // 过滤掉文件夹
  const filesToUpload = selectedLocalFiles.value.filter(f => f.type !== 'directory')
  
  if (filesToUpload.length === 0) {
    ElMessage.warning('请选择文件进行上传（暂不支持文件夹）')
    return
  }
  
  // 跳过的文件夹
  const skippedFolders = selectedLocalFiles.value.filter(f => f.type === 'directory')
  if (skippedFolders.length > 0) {
    ElMessage.warning(`已跳过 ${skippedFolders.length} 个文件夹`)
  }
  
  // 准备批量上传的文件列表
  const files = filesToUpload.map(file => ({
    localPath: file.path,
    remotePath: `${remotePath.value}/${file.name}`.replace(/\/+/g, '/')
  }))
  
  // 为每个文件创建传输记录
  const transferIds: string[] = []
  for (const file of filesToUpload) {
    const transferId = Date.now().toString() + Math.random()
    transferIds.push(transferId)
    
    transfers.value.push({
      id: transferId,
      name: file.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      targetPath: `${remotePath.value}/${file.name}`.replace(/\/+/g, '/'),
      localPath: file.path,
      remotePath: `${remotePath.value}/${file.name}`.replace(/\/+/g, '/'),
      priority: 3, // 默认优先级
      startTime: new Date()
    })
  }
  
  try {
    // 使用批量上传 API
    const result = await window.electronAPI.sftp.uploadFiles(
      currentSession.value.id,
      files
    )
    
    if (result.success) {
      // 处理成功的文件
      result.results.success.forEach((localPath: string, index: number) => {
        const transfer = transfers.value.find(t => t.id === transferIds[index])
        if (transfer) {
          transfer.status = 'completed'
          transfer.progress = 100
          transfer.endTime = new Date()
          // 添加到历史记录
          addToHistory(transfer)
        }
      })
      
      // 处理失败的文件
      result.results.failed.forEach((failure: { path: string; error: string }) => {
        const fileIndex = files.findIndex(f => f.localPath === failure.path)
        if (fileIndex >= 0) {
          const transfer = transfers.value.find(t => t.id === transferIds[fileIndex])
          if (transfer) {
            transfer.status = 'failed'
            transfer.endTime = new Date()
            // 添加到历史记录
            addToHistory(transfer)
          }
        }
      })
      
      // 显示结果摘要
      if (result.results.success.length > 0) {
        ElMessage.success(`成功上传 ${result.results.success.length} 个文件`)
      }
      if (result.results.failed.length > 0) {
        ElMessage.error(`${result.results.failed.length} 个文件上传失败`)
      }
    } else {
      // 全部失败
      transferIds.forEach(id => {
        const transfer = transfers.value.find(t => t.id === id)
        if (transfer) {
          transfer.status = 'failed'
          transfer.endTime = new Date()
          addToHistory(transfer)
        }
      })
      ElMessage.error(`批量上传失败: ${result.error}`)
    }
  } catch (error: any) {
    // 异常情况
    transferIds.forEach(id => {
      const transfer = transfers.value.find(t => t.id === id)
      if (transfer) {
        transfer.status = 'failed'
        transfer.endTime = new Date()
        addToHistory(transfer)
      }
    })
    ElMessage.error(`上传失败: ${error.message || '未知错误'}`)
  }
  
  await loadRemoteDirectory()
}

const downloadSelected = async () => {
  if (selectedRemoteFiles.value.length === 0 || !currentSession.value) return
  
  // 过滤掉文件夹
  const filesToDownload = selectedRemoteFiles.value.filter(f => f.type !== 'directory')
  
  if (filesToDownload.length === 0) {
    ElMessage.warning('请选择文件进行下载（暂不支持文件夹）')
    return
  }
  
  // 跳过的文件夹
  const skippedFolders = selectedRemoteFiles.value.filter(f => f.type === 'directory')
  if (skippedFolders.length > 0) {
    ElMessage.warning(`已跳过 ${skippedFolders.length} 个文件夹`)
  }
  
  // 准备批量下载的文件列表
  const separator = localPath.value.endsWith('\\') ? '' : '\\'
  const files = filesToDownload.map(file => ({
    remotePath: file.path,
    localPath: localPath.value + separator + file.name
  }))
  
  // 为每个文件创建传输记录
  const transferIds: string[] = []
  for (const file of filesToDownload) {
    const transferId = Date.now().toString() + Math.random()
    transferIds.push(transferId)
    
    const localFilePath = localPath.value + separator + file.name
    
    transfers.value.push({
      id: transferId,
      name: file.name,
      type: 'download',
      status: 'active',
      progress: 0,
      speed: 0,
      eta: 0,
      targetPath: localFilePath,
      localPath: localFilePath,
      remotePath: file.path,
      priority: 3, // 默认优先级
      startTime: new Date()
    })
  }
  
  try {
    // 使用批量下载 API
    const result = await window.electronAPI.sftp.downloadFiles(
      currentSession.value.id,
      files
    )
    
    if (result.success) {
      // 处理成功的文件
      result.results.success.forEach((remotePath: string, index: number) => {
        const transfer = transfers.value.find(t => t.id === transferIds[index])
        if (transfer) {
          transfer.status = 'completed'
          transfer.progress = 100
          transfer.endTime = new Date()
          // 添加到历史记录
          addToHistory(transfer)
        }
      })
      
      // 处理失败的文件
      result.results.failed.forEach((failure: { path: string; error: string }) => {
        const fileIndex = files.findIndex(f => f.remotePath === failure.path)
        if (fileIndex >= 0) {
          const transfer = transfers.value.find(t => t.id === transferIds[fileIndex])
          if (transfer) {
            transfer.status = 'failed'
            transfer.endTime = new Date()
            // 添加到历史记录
            addToHistory(transfer)
          }
        }
      })
      
      // 显示结果摘要
      if (result.results.success.length > 0) {
        ElMessage.success(`成功下载 ${result.results.success.length} 个文件`)
      }
      if (result.results.failed.length > 0) {
        ElMessage.error(`${result.results.failed.length} 个文件下载失败`)
      }
    } else {
      // 全部失败
      transferIds.forEach(id => {
        const transfer = transfers.value.find(t => t.id === id)
        if (transfer) {
          transfer.status = 'failed'
          transfer.endTime = new Date()
          addToHistory(transfer)
        }
      })
      ElMessage.error(`批量下载失败: ${result.error}`)
    }
  } catch (error: any) {
    // 异常情况
    transferIds.forEach(id => {
      const transfer = transfers.value.find(t => t.id === id)
      if (transfer) {
        transfer.status = 'failed'
        transfer.endTime = new Date()
        addToHistory(transfer)
      }
    })
    ElMessage.error(`下载失败: ${error.message || '未知错误'}`)
  }
  
  await loadLocalDirectory()
}

// 处理预览对话框中的下载
const handlePreviewDownload = async (file: FileInfo) => {
  if (!currentSession.value) return
  
  selectedRemoteFiles.value = [file]
  await downloadSelected()
}

const clearCompleted = () => {
  // 将已完成的传输添加到历史记录
  const completedTransfers = transfers.value.filter(t => t.status === 'completed' || t.status === 'failed')
  completedTransfers.forEach(transfer => {
    addToHistory(transfer)
  })
  
  // 从当前列表中移除
  transfers.value = transfers.value.filter(t => t.status !== 'completed' && t.status !== 'failed')
}

const clearAll = () => {
  transfers.value = []
}

// 加载未完成的传输
const loadIncompleteTransfers = async () => {
  try {
    const result = await window.electronAPI.sftp.getIncompleteTransfers(currentSession.value?.id)
    if (result.success && result.data) {
      incompleteTransfers.value = result.data
    }
  } catch (error: any) {
    console.error('Failed to load incomplete transfers:', error)
  }
}

// 暂停传输
const pauseTransfer = async (transferId: string) => {
  try {
    const result = await window.electronAPI.sftp.pauseTransfer(transferId)
    if (result.success) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        transfer.status = 'paused'
        ElMessage.success('传输已暂停')
      }
    } else {
      ElMessage.error(`暂停失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`暂停失败: ${error.message}`)
  }
}

// 恢复传输
const resumeTransfer = async (transferId: string) => {
  if (!currentSession.value) return
  
  try {
    const result = await window.electronAPI.sftp.resumeTransfer(currentSession.value.id, transferId)
    if (result.success) {
      const transfer = transfers.value.find(t => t.id === transferId)
      if (transfer) {
        transfer.status = 'active'
        ElMessage.success('传输已恢复')
      }
    } else {
      ElMessage.error(`恢复失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`恢复失败: ${error.message}`)
  }
}

// 取消传输
const cancelTransfer = async (transferId: string) => {
  try {
    const transfer = transfers.value.find(t => t.id === transferId)
    
    const result = await window.electronAPI.sftp.cancelTask(transferId)
    if (result.success) {
      if (transfer) {
        transfer.status = 'cancelled'
        transfer.endTime = new Date()
        addToHistory(transfer)
      }
      transfers.value = transfers.value.filter(t => t.id !== transferId)
      ElMessage.success('传输已取消')
    } else {
      ElMessage.error(`取消失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`取消失败: ${error.message}`)
  }
}

// 重试传输
const retryTransfer = async (transferId: string) => {
  const transfer = transfers.value.find(t => t.id === transferId)
  if (!transfer || !currentSession.value) return
  
  transfer.status = 'active'
  transfer.progress = 0
  transfer.startTime = new Date() // 重新开始计时
  
  try {
    let result
    if (transfer.type === 'upload' && transfer.localPath) {
      result = await window.electronAPI.sftp.uploadFile(
        currentSession.value.id,
        transfer.localPath,
        transfer.remotePath || transfer.targetPath
      )
    } else if (transfer.type === 'download' && transfer.remotePath) {
      result = await window.electronAPI.sftp.downloadFile(
        currentSession.value.id,
        transfer.remotePath,
        transfer.localPath || transfer.targetPath
      )
    }
    
    if (result?.success) {
      transfer.status = 'completed'
      transfer.progress = 100
      transfer.endTime = new Date()
      addToHistory(transfer)
      ElMessage.success('传输成功')
    } else {
      transfer.status = 'failed'
      transfer.endTime = new Date()
      addToHistory(transfer)
      ElMessage.error(`传输失败: ${result?.error}`)
    }
  } catch (error: any) {
    transfer.status = 'failed'
    transfer.endTime = new Date()
    addToHistory(transfer)
    ElMessage.error(`传输失败: ${error.message}`)
  }
}

// 暂停所有传输
const pauseAllTransfers = async () => {
  const activeTransfersList = transfers.value.filter(t => t.status === 'active')
  for (const transfer of activeTransfersList) {
    await pauseTransfer(transfer.id)
  }
}

// 恢复未完成的传输
const resumeIncompleteTransfer = async (record: TransferRecord) => {
  if (!currentSession.value) {
    ElMessage.warning('请先连接到服务器')
    return
  }
  
  const transferId = record.taskId
  
  // 添加到当前传输列表
  transfers.value.push({
    id: transferId,
    name: getFileName(record.remotePath),
    type: record.type,
    status: 'active',
    progress: (record.transferred / record.totalSize) * 100,
    speed: 0,
    eta: 0,
    targetPath: record.type === 'upload' ? record.remotePath : record.localPath,
    localPath: record.localPath,
    remotePath: record.remotePath
  })
  
  // 切换到当前传输标签
  activeQueueTab.value = 'current'
  
  try {
    const result = await window.electronAPI.sftp.resumeTransfer(currentSession.value.id, transferId)
    
    const transfer = transfers.value.find(t => t.id === transferId)
    if (transfer) {
      if (result.success) {
        transfer.status = 'completed'
        transfer.progress = 100
        ElMessage.success('传输已完成')
        
        // 从未完成列表中移除
        await loadIncompleteTransfers()
      } else {
        transfer.status = 'failed'
        ElMessage.error(`传输失败: ${result.error}`)
      }
    }
  } catch (error: any) {
    const transfer = transfers.value.find(t => t.id === transferId)
    if (transfer) {
      transfer.status = 'failed'
    }
    ElMessage.error(`传输失败: ${error.message}`)
  }
}

// 删除传输记录
const deleteTransferRecord = async (taskId: string) => {
  try {
    await ElMessageBox.confirm('确定要删除此传输记录吗？', '确认删除', {
      type: 'warning'
    })
    
    const result = await window.electronAPI.sftp.deleteTransferRecord(taskId)
    if (result.success) {
      ElMessage.success('记录已删除')
      await loadIncompleteTransfers()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error) {
    // 用户取消
  }
}

// 清理已完成的记录
const cleanupCompletedRecords = async () => {
  try {
    const result = await window.electronAPI.sftp.cleanupCompletedRecords()
    if (result.success) {
      ElMessage.success('已清理完成的记录')
      await loadIncompleteTransfers()
    } else {
      ElMessage.error(`清理失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`清理失败: ${error.message}`)
  }
}

// 获取文件名
const getFileName = (path: string) => {
  return path.split('/').pop() || path
}

// 优先级调整
const increasePriority = (transferId: string) => {
  const transfer = transfers.value.find(t => t.id === transferId)
  if (transfer) {
    transfer.priority = Math.min((transfer.priority || 3) + 1, 5)
    // 重新排序传输队列
    sortTransfersByPriority()
  }
}

const decreasePriority = (transferId: string) => {
  const transfer = transfers.value.find(t => t.id === transferId)
  if (transfer) {
    transfer.priority = Math.max((transfer.priority || 3) - 1, 1)
    // 重新排序传输队列
    sortTransfersByPriority()
  }
}

const sortTransfersByPriority = () => {
  transfers.value.sort((a, b) => {
    // 优先级高的排前面
    const priorityA = a.priority || 3
    const priorityB = b.priority || 3
    if (priorityA !== priorityB) {
      return priorityB - priorityA
    }
    // 优先级相同，按创建时间排序
    return (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0)
  })
}

// 传输历史记录
const addToHistory = (transfer: Transfer) => {
  if (transfer.status === 'completed' || transfer.status === 'failed' || transfer.status === 'cancelled') {
    // 尝试获取文件大小
    let fileSize = 0
    if (transfer.type === 'upload' && transfer.localPath) {
      // 对于上传，从本地文件获取大小
      const localFile = localFiles.value.find(f => f.path === transfer.localPath)
      if (localFile) {
        fileSize = localFile.size
      }
    } else if (transfer.type === 'download' && transfer.remotePath) {
      // 对于下载，从远程文件获取大小
      const remoteFile = remoteFiles.value.find(f => f.path === transfer.remotePath)
      if (remoteFile) {
        fileSize = remoteFile.size
      }
    }
    
    const historyItem: TransferHistoryItem = {
      id: transfer.id,
      name: transfer.name,
      type: transfer.type,
      status: transfer.status,
      size: fileSize,
      startTime: transfer.startTime || new Date(),
      endTime: transfer.endTime || new Date(),
      duration: (transfer.endTime?.getTime() || Date.now()) - (transfer.startTime?.getTime() || Date.now()),
      localPath: transfer.localPath || (transfer.type === 'download' ? transfer.targetPath : ''),
      remotePath: transfer.remotePath || (transfer.type === 'upload' ? transfer.targetPath : ''),
      error: transfer.status === 'failed' ? '传输失败' : transfer.status === 'cancelled' ? '已取消' : undefined
    }
    
    transferHistory.value.unshift(historyItem)
    
    // 只保留最近100条历史记录
    if (transferHistory.value.length > 100) {
      transferHistory.value = transferHistory.value.slice(0, 100)
    }
    
    // 保存到 localStorage
    saveTransferHistory()
  }
}

const saveTransferHistory = () => {
  try {
    localStorage.setItem('sftp-transfer-history', JSON.stringify(transferHistory.value))
  } catch (error) {
    console.error('Failed to save transfer history:', error)
  }
}

const loadTransferHistory = () => {
  try {
    const saved = localStorage.getItem('sftp-transfer-history')
    if (saved) {
      const parsed = JSON.parse(saved)
      transferHistory.value = parsed.map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime),
        endTime: new Date(item.endTime)
      }))
    }
  } catch (error) {
    console.error('Failed to load transfer history:', error)
  }
}

const clearHistory = async () => {
  try {
    await ElMessageBox.confirm('确定要清空传输历史吗？', '确认清空', {
      type: 'warning'
    })
    
    transferHistory.value = []
    localStorage.removeItem('sftp-transfer-history')
    ElMessage.success('历史记录已清空')
  } catch (error) {
    // 用户取消
  }
}

const exportHistory = async () => {
  try {
    if (transferHistory.value.length === 0) {
      ElMessage.warning('没有历史记录可导出')
      return
    }
    
    const result = await window.electronAPI.dialog.saveFile({
      defaultPath: `transfer-history-${Date.now()}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (result) {
      const data = JSON.stringify(transferHistory.value, null, 2)
      
      // 使用 fs API 写入文件
      const writeResult = await window.electronAPI.fs.writeFile(result, data)
      
      if (writeResult.success) {
        ElMessage.success(`历史记录已导出到: ${result}`)
      } else {
        ElMessage.error(`导出失败: ${writeResult.error}`)
      }
    }
  } catch (error: any) {
    ElMessage.error(`导出失败: ${error.message}`)
  }
}

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分`
}

const formatHistoryTime = (date: Date): string => {
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 格式化函数
const formatSize = ({ size }: { size: number }) => {
  return formatBytesLocale(size)
}

const formatTime = ({ modifyTime }: { modifyTime: Date }) => {
  if (!modifyTime) return '-'
  return formatDateTime(modifyTime)
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
    paused: '已暂停',
    completed: '已完成',
    failed: '失败'
  }
  return map[status] || status
}

const formatSpeed = (speed: number) => {
  if (!speed) return ''
  return `${formatSize({ size: speed })}/s`
}

// ==================== 压缩/解压功能 ====================

// 本地文件压缩
const compressLocalFile = async (file: FileInfo) => {
  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      '请输入压缩文件名',
      '压缩文件',
      {
        inputValue: `${file.name}.zip`,
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz)'
      }
    )
    
    if (!archiveName) return
    
    const archivePath = `${localPath.value}/${archiveName}`.replace(/\\/g, '/')
    
    ElMessage.info('正在压缩...')
    
    const result = await window.electronAPI.fs.compress(file.path, archivePath)
    
    if (result.success) {
      ElMessage.success('压缩完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 本地多文件压缩
const compressLocalFilesMultiple = async () => {
  if (selectedLocalFiles.value.length === 0) return
  
  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      `将压缩 ${selectedLocalFiles.value.length} 个项目`,
      '批量压缩',
      {
        inputValue: 'archive.zip',
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz)'
      }
    )
    
    if (!archiveName) return
    
    const archivePath = `${localPath.value}/${archiveName}`.replace(/\\/g, '/')
    const filePaths = selectedLocalFiles.value.map(f => f.path)
    
    ElMessage.info('正在压缩...')
    
    const result = await window.electronAPI.fs.compressMultiple(filePaths, archivePath)
    
    if (result.success) {
      ElMessage.success('压缩完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 本地文件解压
const extractLocalFile = async (file: FileInfo, targetDir: string) => {
  try {
    ElMessage.info('正在解压...')
    
    const result = await window.electronAPI.fs.extract(file.path, targetDir)
    
    if (result.success) {
      ElMessage.success('解压完成')
      await loadLocalDirectory()
    } else {
      ElMessage.error(`解压失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 本地文件解压到指定目录
const extractLocalFileTo = async (file: FileInfo) => {
  try {
    const result = await window.electronAPI.dialog.openDirectory({ properties: ['openDirectory'] })
    if (!result) return
    
    await extractLocalFile(file, result as string)
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 远程文件压缩
const compressRemoteFile = async (file: FileInfo) => {
  if (!currentSession.value) return
  
  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      '请输入压缩文件名',
      '压缩文件',
      {
        inputValue: `${file.name}.tar.gz`,
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz|gz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz, .gz)'
      }
    )
    
    if (!archiveName) return
    
    const archivePath = `${remotePath.value}/${archiveName}`.replace(/\/+/g, '/')
    
    ElMessage.info('正在压缩...')
    
    const result = await window.electronAPI.sftp.compress(
      currentSession.value.id,
      file.path,
      archivePath
    )
    
    if (result.success) {
      ElMessage.success('压缩完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 远程多文件压缩
const compressRemoteFilesMultiple = async () => {
  if (!currentSession.value || selectedRemoteFiles.value.length === 0) return
  
  try {
    const { value: archiveName } = await ElMessageBox.prompt(
      `将压缩 ${selectedRemoteFiles.value.length} 个项目`,
      '批量压缩',
      {
        inputValue: 'archive.tar.gz',
        inputPattern: /^.+\.(zip|tar|tar\.gz|tgz|gz)$/,
        inputErrorMessage: '请输入有效的压缩文件名 (.zip, .tar, .tar.gz, .tgz, .gz)'
      }
    )
    
    if (!archiveName) return
    
    const archivePath = `${remotePath.value}/${archiveName}`.replace(/\/+/g, '/')
    const filePaths = selectedRemoteFiles.value.map(f => f.path)
    
    ElMessage.info('正在压缩...')
    
    const result = await window.electronAPI.sftp.compressMultiple(
      currentSession.value.id,
      filePaths,
      archivePath
    )
    
    if (result.success) {
      ElMessage.success('压缩完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`压缩失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`压缩失败: ${error.message || error}`)
    }
  }
}

// 远程文件解压
const extractRemoteFile = async (file: FileInfo, targetDir: string) => {
  if (!currentSession.value) return
  
  try {
    ElMessage.info('正在解压...')
    
    const result = await window.electronAPI.sftp.extract(
      currentSession.value.id,
      file.path,
      targetDir
    )
    
    if (result.success) {
      ElMessage.success('解压完成')
      await loadRemoteDirectory()
    } else {
      ElMessage.error(`解压失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`解压失败: ${error.message || error}`)
  }
}

// 远程文件解压到指定目录
const extractRemoteFileTo = async (file: FileInfo) => {
  if (!currentSession.value) return
  
  try {
    const { value: targetDir } = await ElMessageBox.prompt(
      '请输入解压目标目录',
      '解压到',
      {
        inputValue: remotePath.value,
        inputPattern: /^\/.*$/,
        inputErrorMessage: '请输入有效的目录路径'
      }
    )
    
    if (!targetDir) return
    
    await extractRemoteFile(file, targetDir)
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`解压失败: ${error.message || error}`)
    }
  }
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
  gap: 6px;
}

.header-title .help-icon {
  font-size: 14px;
  color: var(--text-tertiary);
  cursor: help;
  transition: color 0.2s;
}

.header-title .help-icon:hover {
  color: var(--primary-color);
}

.browser-header h3 {
  margin: 0;
  font-size: var(--text-base);
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
  font-size: var(--text-sm);
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
  font-size: var(--text-lg);
}

.session-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-host {
  font-size: var(--text-xs);
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
  border-left: 1px solid var(--border-color);
  z-index: 20;
  box-shadow: 0 0 10px rgba(0,0,0,0.2);
  padding: 0 12px;
}

.transfer-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.transfer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.transfer-btn .el-icon {
  font-size: 20px;
  color: white;
}

.upload-btn {
  background: var(--primary-color);
}

.upload-btn:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: scale(1.05);
}

.download-btn {
  background: var(--success-color);
}

.download-btn:hover:not(:disabled) {
  background: #16a34a;
  transform: scale(1.05);
}

/* File List Area */
.file-list {
  flex: 1;
  position: relative;
  overflow: auto; /* Internal scroll */
}

/* VirtualTable 选中状态样式 */
.file-list :deep(.table-row.selected) {
  background: rgba(14, 165, 233, 0.2) !important;
  border-left: 3px solid var(--primary-color);
}

.file-list :deep(.table-row.selected:hover) {
  background: rgba(14, 165, 233, 0.25) !important;
}

/* Table Enhancements */
.file-list :deep(.el-table) {
  --el-table-header-bg-color: var(--bg-main);
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.04);
  --el-table-border-color: transparent;
  --el-table-text-color: var(--text-secondary);
  --el-table-header-text-color: var(--text-secondary);
  background-color: transparent;
  font-size: var(--text-sm);
}

.file-list :deep(.el-table tr) {
  transition: background-color 0.1s;
}

.file-list :deep(.el-table th.el-table__cell) {
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  text-transform: uppercase;
  font-size: var(--text-xs);
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
  height: 200px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 10px rgba(0,0,0,0.1);
}

.queue-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.queue-tabs {
  flex: 1;
}

.queue-tabs :deep(.el-tabs__header) {
  margin: 0;
  border: none;
}

.queue-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.queue-tabs :deep(.el-tabs__item) {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 0 16px;
  height: 40px;
  line-height: 40px;
}

.queue-tabs :deep(.el-tabs__item.is-active) {
  color: var(--primary-color);
}

.queue-actions {
  display: flex;
  gap: 8px;
}

.queue-list {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.transfer-item {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  gap: 8px;
  font-size: var(--text-sm);
}

.transfer-item:last-child {
  border-bottom: none;
}

.incomplete-item {
  background: rgba(255, 193, 7, 0.05);
}

.transfer-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.transfer-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.transfer-name {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transfer-path {
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-xs);
}

.transfer-meta {
  display: flex;
  gap: 16px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.transfer-status {
  min-width: 100px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.transfer-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.status-text.active { color: var(--primary-color); }
.status-text.paused { color: var(--warning-color); }
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
  font-size: var(--text-sm);
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
  font-size: var(--text-base);
}

.octal-value {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--primary-color);
}
</style>
