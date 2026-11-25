<template>
  <div class="terminal-file-panel">
    <div class="panel-header">
      <div class="header-title">
        <h3>文件管理</h3>
        <el-tooltip content="Ctrl+点击 多选，Shift+点击 范围选择" placement="bottom">
          <el-icon class="help-icon"><QuestionFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-button :icon="Close" link @click="$emit('close')" />
    </div>

    <!-- 路径导航 -->
    <div class="path-nav">
      <el-tooltip content="返回历史路径" placement="bottom">
        <el-button :icon="Back" size="small" @click="goBack" :disabled="!canGoBack" />
      </el-tooltip>
      <el-tooltip content="上一级目录" placement="bottom">
        <el-button
          :icon="ArrowUp"
          size="small"
          @click="goParentDirectory"
          :disabled="!canGoParent"
        />
      </el-tooltip>
      <el-button :icon="HomeFilled" size="small" @click="goHome" />
      <el-input
        v-model="pathInput"
        size="small"
        placeholder="输入路径"
        @keyup.enter="navigateToPath"
        class="path-input"
      >
        <template #prefix>
          <el-icon><FolderOpened /></el-icon>
        </template>
      </el-input>
      <el-tooltip content="同步终端目录" placement="bottom">
        <el-button :icon="Position" size="small" @click="syncToTerminalDir" />
      </el-tooltip>
      <el-button :icon="Refresh" size="small" @click="refreshDirectory" />
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-dropdown
        @command="handleCreateCommand"
        trigger="click"
        size="small"
        :disabled="!directoryLoaded"
      >
        <el-button size="small" :icon="Plus" :disabled="!directoryLoaded"> 新建 </el-button>
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
      <el-button size="small" :icon="Upload" :disabled="!directoryLoaded" @click="handleUpload"
        >上传</el-button
      >
      <el-tooltip :content="showHiddenFiles ? '隐藏隐藏文件' : '显示隐藏文件'" placement="bottom">
        <el-button
          size="small"
          :icon="View"
          :type="showHiddenFiles ? 'primary' : 'default'"
          @click="toggleHiddenFiles"
        />
      </el-tooltip>
    </div>

    <div v-if="panelTransfers.length > 0" class="panel-transfers">
      <div class="panel-transfers-header">
        <span>当前传输</span>
        <el-button text size="small" @click="clearCompletedPanelTransfers">清除完成</el-button>
      </div>
      <div v-for="transfer in panelTransfers" :key="transfer.id" class="panel-transfer-item">
        <div class="panel-transfer-row">
          <div class="panel-transfer-name" :title="transfer.name">{{ transfer.name }}</div>
          <div class="panel-transfer-actions">
            <span :class="['panel-transfer-status', transfer.status]">
              {{ getPanelTransferStatusText(transfer) }}
            </span>
            <el-tooltip
              v-if="transfer.status === 'active' || transfer.status === 'pending'"
              content="取消传输"
              placement="top"
            >
              <el-button
                :icon="Close"
                link
                size="small"
                class="panel-transfer-cancel"
                @click="cancelPanelTransfer(transfer)"
              />
            </el-tooltip>
          </div>
        </div>
        <el-progress
          :percentage="transfer.progress"
          :precision="1"
          :status="
            transfer.status === 'failed'
              ? 'exception'
              : transfer.status === 'completed'
                ? 'success'
                : transfer.status === 'paused'
                  ? 'warning'
                  : undefined
          "
        />
        <div v-if="transfer.status === 'active'" class="panel-transfer-meta">
          <span>{{ formatSize(transfer.transferred) }} / {{ formatSize(transfer.total) }}</span>
          <span>{{ formatPanelSpeed(transfer.speed) }}</span>
        </div>
      </div>
    </div>

    <!-- 文件列表 -->
    <div
      class="file-list"
      v-loading="loading"
      element-loading-background="var(--bg-secondary)"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      :class="{ 'drag-over': isDragOver }"
    >
      <!-- 拖曳上传提示 -->
      <div v-if="isDragOver" class="drag-overlay">
        <el-icon :size="48"><Upload /></el-icon>
        <p>释放以上传文件</p>
      </div>

      <div v-if="displayFiles.length === 0 && !loading && !isDragOver" class="empty-state">
        <el-icon :size="48"><FolderOpened /></el-icon>
        <template v-if="directoryError">
          <p>{{ directoryError }}</p>
          <el-button size="small" type="primary" @click="refreshDirectory">重试</el-button>
        </template>
        <template v-else>
          <p>文件夹为空</p>
          <p class="drag-hint">拖曳文件到此处上传</p>
        </template>
      </div>

      <div
        v-for="(file, index) in displayFiles"
        :key="file.path"
        class="file-item"
        :class="{ selected: isFileSelected(file) }"
        :draggable="isFileLike(file)"
        @click="(e) => selectFile(file, index, e)"
        @dblclick="handleDoubleClick(file)"
        @contextmenu.prevent="showContextMenu($event, file)"
        @dragstart="onFileDragStart($event, file)"
        @dragend="onFileDragEnd($event, file)"
      >
        <span class="file-icon-wrapper">
          <el-icon :size="20" class="file-icon">
            <Folder v-if="isDirectoryLike(file)" />
            <Document v-else-if="isFileLike(file)" />
            <Link v-else />
          </el-icon>
          <el-icon
            v-if="file.type === 'symlink' && !isBrokenLink(file)"
            :size="10"
            class="link-badge"
          >
            <Link />
          </el-icon>
        </span>
        <div class="file-info">
          <div class="file-name">{{ file.name }}</div>
          <div class="file-meta">
            <span>{{ getFileMetaText(file) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenuVisible"
      class="context-menu"
      :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
      @click.stop
    >
      <!-- 多选菜单 -->
      <template v-if="selectedFiles.size > 1">
        <div class="menu-item" @click="handleDownloadMultiple">
          <el-icon><Download /></el-icon>
          <span>下载 {{ selectedFiles.size }} 个文件</span>
        </div>
        <div class="menu-item" @click="handleCompressMultiple">
          <el-icon><Box /></el-icon>
          <span>压缩 {{ selectedFiles.size }} 个项目</span>
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item danger" @click="handleDeleteMultiple">
          <el-icon><Delete /></el-icon>
          <span>删除 {{ selectedFiles.size }} 个项目</span>
        </div>
      </template>
      <!-- 单选菜单 -->
      <template v-else>
        <template v-if="contextMenuFile && isFileLike(contextMenuFile)">
          <div class="menu-item" @click="handlePreview">
            <el-icon><ZoomIn /></el-icon>
            <span>预览</span>
          </div>
          <div class="menu-item" @click="handleEdit">
            <el-icon><EditPen /></el-icon>
            <span>编辑</span>
          </div>
          <div class="menu-item" @click="handleDownload">
            <el-icon><Download /></el-icon>
            <span>下载</span>
          </div>
        </template>
        <div class="menu-item" @click="handleRename">
          <el-icon><Edit /></el-icon>
          <span>重命名</span>
        </div>
        <template v-if="contextMenuFile && !isBrokenLink(contextMenuFile)">
          <div class="menu-item" @click="handlePermissions">
            <el-icon><Lock /></el-icon>
            <span>权限</span>
          </div>
          <div class="menu-divider"></div>
          <div class="menu-item" @click="handleCompress">
            <el-icon><Box /></el-icon>
            <span>压缩</span>
          </div>
          <div v-if="isCompressedFile(contextMenuFile)" class="menu-item" @click="handleExtract">
            <el-icon><FolderOpened /></el-icon>
            <span>解压</span>
          </div>
        </template>
        <div class="menu-divider"></div>
        <div class="menu-item danger" @click="handleDelete">
          <el-icon><Delete /></el-icon>
          <span>删除</span>
        </div>
      </template>
    </div>

    <!-- 预览对话框 -->
    <el-dialog v-model="showPreviewDialog" title="文件预览" width="700px" append-to-body>
      <div class="preview-content">
        <div v-if="previewLoading" class="preview-loading">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else-if="previewType === 'image'" class="preview-image-container">
          <img :src="previewImageSrc" class="preview-image" alt="预览图片" />
        </div>
        <template v-else>
          <div v-if="previewNotice" class="preview-notice">{{ previewNotice }}</div>
          <pre class="preview-text">{{ previewContent }}</pre>
        </template>
      </div>
      <template #footer>
        <el-button @click="showPreviewDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="showEditDialog"
      title="编辑文件"
      width="860px"
      append-to-body
      @closed="handleEditDialogClosed"
      @keydown.ctrl.s.prevent="saveEditedFile"
      @keydown.meta.s.prevent="saveEditedFile"
    >
      <div class="edit-content">
        <!-- 搜索替换工具栏（常驻） -->
        <div class="search-replace-bar">
          <div class="search-row">
            <el-input
              v-model="searchText"
              placeholder="搜索"
              size="small"
              clearable
              class="search-input"
              @keyup.enter="findNext"
              @keyup.shift.enter.prevent="findPrev"
            >
              <template #suffix>
                <span class="match-info">{{ searchMatchInfo }}</span>
              </template>
            </el-input>
            <el-tooltip content="区分大小写">
              <el-button
                size="small"
                :type="searchMatchCase ? 'primary' : ''"
                @click="searchMatchCase = !searchMatchCase"
                class="case-btn"
                >Aa</el-button
              >
            </el-tooltip>
            <el-button
              size="small"
              :icon="ArrowUp"
              @click="findPrev"
              :disabled="searchMatches.length === 0"
            />
            <el-button
              size="small"
              :icon="ArrowDown"
              @click="findNext"
              :disabled="searchMatches.length === 0"
            />
          </div>
          <div class="replace-row">
            <el-input
              v-model="replaceText"
              placeholder="替换"
              size="small"
              clearable
              class="search-input"
              @keyup.enter="replaceCurrent"
            />
            <el-button size="small" @click="replaceCurrent" :disabled="searchMatches.length === 0"
              >替换</el-button
            >
            <el-button size="small" @click="replaceAll" :disabled="!searchText">全部替换</el-button>
          </div>
        </div>

        <div v-if="editLoading" class="preview-loading">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <el-input
          v-else
          ref="editTextareaRef"
          v-model="editContent"
          type="textarea"
          :rows="20"
          class="edit-textarea"
        />
      </div>
      <template #footer>
        <div class="edit-footer">
          <div class="footer-actions">
            <el-button @click="showEditDialog = false">取消</el-button>
            <el-button type="primary" @click="saveEditedFile" :loading="editSaving">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 新建文件夹对话框 -->
    <el-dialog v-model="showCreateFolderDialog" title="新建文件夹" width="350px" append-to-body>
      <el-input v-model="newFolderName" placeholder="输入文件夹名称" @keyup.enter="createFolder" />
      <template #footer>
        <el-button @click="showCreateFolderDialog = false">取消</el-button>
        <el-button type="primary" @click="createFolder">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建文件对话框 -->
    <el-dialog v-model="showCreateFileDialog" title="新建文件" width="350px" append-to-body>
      <el-input v-model="newFileName" placeholder="输入文件名称" @keyup.enter="createFile" />
      <template #footer>
        <el-button @click="showCreateFileDialog = false">取消</el-button>
        <el-button type="primary" @click="createFile">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重命名对话框 -->
    <el-dialog v-model="showRenameDialog" title="重命名" width="350px" append-to-body>
      <el-input v-model="renameValue" placeholder="输入新名称" @keyup.enter="confirmRename" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 权限编辑对话框 -->
    <el-dialog v-model="showPermissionsDialog" title="修改权限" width="400px" append-to-body>
      <div class="permissions-editor">
        <div class="permission-group">
          <h4>所有者(Owner)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.ownerRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.ownerExecute">执行 (x)</el-checkbox>
          </div>
        </div>
        <div class="permission-group">
          <h4>组(Group)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.groupRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.groupExecute">执行 (x)</el-checkbox>
          </div>
        </div>
        <div class="permission-group">
          <h4>其他 (Others)</h4>
          <div class="permission-checkboxes">
            <el-checkbox v-model="permissionBits.otherRead">读取 (r)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherWrite">写入 (w)</el-checkbox>
            <el-checkbox v-model="permissionBits.otherExecute">执行 (x)</el-checkbox>
          </div>
        </div>
        <div class="permission-octal">
          <strong>八进制：</strong>
          <span class="octal-value">{{ computedOctalPermission }}</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="showPermissionsDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPermissions">确定</el-button>
      </template>
    </el-dialog>

    <!-- 压缩对话框 -->
    <el-dialog v-model="showCompressDialog" title="压缩文件" width="400px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="源文件">
          <el-input v-if="selectedFiles.size <= 1" :value="contextMenuFile?.name" disabled />
          <el-input v-else :value="`已选择 ${selectedFiles.size} 个项目`" disabled />
        </el-form-item>
        <el-form-item label="压缩格式">
          <el-select v-model="compressFormat" style="width: 100%">
            <el-option label="tar.gz (推荐)" value="tar.gz" />
            <el-option label="zip" value="zip" />
            <el-option label="tar" value="tar" />
            <el-option label="tar.bz2" value="tar.bz2" />
            <el-option label="tar.xz" value="tar.xz" />
          </el-select>
        </el-form-item>
        <el-form-item label="输出文件">
          <el-input v-model="compressOutputName" placeholder="输出文件名" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCompressDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCompress" :loading="compressing">压缩</el-button>
      </template>
    </el-dialog>

    <!-- 解压对话框 -->
    <el-dialog v-model="showExtractDialog" title="解压文件" width="400px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="压缩文件">
          <el-input :value="contextMenuFile?.name" disabled />
        </el-form-item>
        <el-form-item label="解压到">
          <el-radio-group v-model="extractTarget">
            <el-radio value="current">当前目录</el-radio>
            <el-radio value="subfolder">同名子文件夹</el-radio>
            <el-radio value="custom">自定义目录</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="extractTarget === 'custom'" label="目标目录">
          <el-input v-model="extractCustomPath" placeholder="输入目标目录路径" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showExtractDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmExtract" :loading="extracting">解压</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, h } from 'vue'
import { ElButton, ElMessage, ElMessageBox } from 'element-plus'
import {
  Close,
  Back,
  HomeFilled,
  FolderOpened,
  Refresh,
  Plus,
  FolderAdd,
  Document,
  Upload,
  Download,
  Folder,
  Link,
  Edit,
  Delete,
  Lock,
  View,
  ZoomIn,
  EditPen,
  Loading,
  Position,
  Box,
  QuestionFilled,
  ArrowUp,
  ArrowDown
} from '@element-plus/icons-vue'
import { formatSftpOperationError } from '@/utils/sftp-errors'
import {
  invalidEntryNameReason,
  joinLocalPath,
  joinRemotePath,
  normalizeLocalPath,
  parentRemotePath,
  unsafeLocalFileNameReason
} from '@/utils/transfer-path'
import {
  base64ToBytes,
  decodeEditableText,
  encodeEditedText,
  errorMessageOf,
  expandHomePath,
  generateConflictRename,
  guessHomeDir,
  hasNameConflict,
  isBrokenLink,
  isDirectoryLike,
  isExtractableArchiveName,
  isFileLike,
  isMessageBoxDismissal,
  looksBinaryText,
  planTransfers,
  stripArchiveExtension,
  type ConflictDecision,
  type ConflictPromptContext,
  type EditableTextFormat,
  type ExistingTarget
} from './terminal-file-panel-utils'

interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  targetType?: 'file' | 'directory'
  size: number
  modifyTime: Date
  permissions?: number
}

interface DeleteBatchSummary {
  success: string[]
  failed: Array<{ path: string; error: string }>
}

interface PanelTransfer {
  id: string
  name: string
  type: 'upload' | 'download'
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  transferred: number
  total: number
  speed: number
  eta: number
  localPath: string
  remotePath: string
  error?: string
}

const props = defineProps<{
  connectionId: string
  sessionName?: string
  username?: string
  currentDir?: string
}>()

const emit = defineEmits<{
  close: []
  'request-current-dir': []
}>()

const loading = ref(false)
const currentPath = ref('/')
const pathInput = ref('/')
const files = ref<FileInfo[]>([])
const directoryError = ref('')
// 当前目录是否已成功加载；加载失败时禁用上传/新建，避免基于空列表做冲突判断
const directoryLoaded = ref(false)
// 目录加载请求序号：只有最新一次请求的结果会被应用
let loadSequence = 0
// 是否曾成功加载过目录（失败重试时决定重新走初始目录流程还是重试当前路径）
let hasLoadedDirectory = false
// 面板已卸载：停止启动新的传输，忽略迟到的结果
let disposed = false
// 缓存的登录用户 home 目录（sftp realpath('.')）
let cachedHomeDir: string | null = null
// 设置中的默认本地目录（下载保存/上传选择对话框的初始目录）
const defaultLocalPath = ref('')
let lastAppliedShowHidden: boolean | undefined
const selectedFile = ref<FileInfo | null>(null)
const selectedFiles = ref<Set<string>>(new Set()) // 多选文件的 path 集合
const lastSelectedIndex = ref<number>(-1) // 用于 Shift 多选
const pathHistory = ref<string[]>([])
const showHiddenFiles = ref(false)
const confirmBeforeDelete = ref(true)
const cleanupFunctions: Array<() => void> = []
const panelTransfers = ref<PanelTransfer[]>([])

// 拖曳状态
const isDragOver = ref(false)
const isDraggingFile = ref(false)

// 过滤后的文件列表（根据是否显示隐藏文件）
const displayFiles = computed(() => {
  if (showHiddenFiles.value) {
    return files.value
  }
  return files.value.filter((f) => !f.name.startsWith('.'))
})

// 切换显示隐藏文件
const toggleHiddenFiles = () => {
  showHiddenFiles.value = !showHiddenFiles.value
}

const loadFilePanelSettings = async () => {
  try {
    const settings = await window.electronAPI.settings.get()
    applyFilePanelSettings(settings)
  } catch (error) {
    console.error('[TerminalFilePanel] Failed to load SFTP settings:', error)
  }
}

const applyFilePanelSettings = (settings: any) => {
  // 只有“显示隐藏文件”设置本身变化时才覆盖面板上的临时切换
  const showHidden = settings?.sftp?.showHiddenFiles === true
  if (showHidden !== lastAppliedShowHidden) {
    lastAppliedShowHidden = showHidden
    showHiddenFiles.value = showHidden
  }
  confirmBeforeDelete.value = settings?.sftp?.confirmBeforeDelete !== false
  const localPath = settings?.sftp?.defaultLocalPath
  defaultLocalPath.value = typeof localPath === 'string' ? localPath.trim() : ''
}

const localDialogDefaultPath = () =>
  defaultLocalPath.value ? normalizeLocalPath(defaultLocalPath.value) : undefined

const pickLocalDirectory = () =>
  window.electronAPI.dialog.openDirectory({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: localDialogDefaultPath()
  })

// 右键菜单
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuFile = ref<FileInfo | null>(null)

// 对话框
const showCreateFolderDialog = ref(false)
const showCreateFileDialog = ref(false)
const showRenameDialog = ref(false)
const showPermissionsDialog = ref(false)
const showPreviewDialog = ref(false)
const showEditDialog = ref(false)
const newFolderName = ref('')
const newFileName = ref('')
const renameValue = ref('')

// 预览和编辑
const previewContent = ref('')
const previewLoading = ref(false)
const previewType = ref<'text' | 'image'>('text')
const previewImageSrc = ref('')
const previewNotice = ref('')
const editContent = ref('')
const editLoading = ref(false)
const editSaving = ref(false)
const editingFilePath = ref('')
// 正在编辑的文件的原始格式（换行符、BOM），保存时还原
let editFormat: EditableTextFormat = { eol: '\n', bom: false, mixedEol: false }

// 搜索替换
const editTextareaRef = ref<any>(null)
const searchText = ref('')
const replaceText = ref('')
const searchMatchCase = ref(false)
const searchCurrentIndex = ref(-1)
const searchMatches = ref<number[]>([])

const escapeRegex = (s: string) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, (c) => `\\${c}`)

const computedSearchMatches = computed(() => {
  if (!searchText.value || !editContent.value) return []
  const flags = searchMatchCase.value ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(searchText.value), flags)
  const matches: number[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(editContent.value)) !== null) {
    matches.push(m.index)
  }
  return matches
})

watch(computedSearchMatches, (val) => {
  searchMatches.value = val
  searchCurrentIndex.value = val.length > 0 ? 0 : -1
  if (val.length > 0) nextTick(() => scrollToMatch(0))
})

watch([searchText, searchMatchCase], () => {
  searchMatches.value = computedSearchMatches.value
  searchCurrentIndex.value = searchMatches.value.length > 0 ? 0 : -1
  if (searchMatches.value.length > 0) nextTick(() => scrollToMatch(0))
})

const searchMatchInfo = computed(() => {
  if (!searchText.value) return ''
  const total = searchMatches.value.length
  if (total === 0) return '无匹配'
  return `${searchCurrentIndex.value + 1} / ${total}`
})

const getNativeTextarea = (): HTMLTextAreaElement | null => {
  if (!editTextareaRef.value) return null
  return (
    editTextareaRef.value.textarea || editTextareaRef.value.$el?.querySelector('textarea') || null
  )
}

const scrollToMatch = (index: number) => {
  const ta = getNativeTextarea()
  if (!ta || searchMatches.value.length === 0) return
  const pos = searchMatches.value[index]
  const len = searchText.value.length
  ta.focus()
  ta.setSelectionRange(pos, pos + len)
  const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20
  const textBefore = editContent.value.slice(0, pos)
  const linesBefore = textBefore.split('\n').length - 1
  const targetScrollTop = linesBefore * lineHeight - ta.clientHeight / 2
  ta.scrollTop = Math.max(0, targetScrollTop)
}

const findNext = () => {
  if (searchMatches.value.length === 0) return
  searchCurrentIndex.value = (searchCurrentIndex.value + 1) % searchMatches.value.length
  scrollToMatch(searchCurrentIndex.value)
}

const findPrev = () => {
  if (searchMatches.value.length === 0) return
  searchCurrentIndex.value =
    (searchCurrentIndex.value - 1 + searchMatches.value.length) % searchMatches.value.length
  scrollToMatch(searchCurrentIndex.value)
}

const replaceCurrent = () => {
  if (searchMatches.value.length === 0 || searchCurrentIndex.value < 0) return
  const idx = searchMatches.value[searchCurrentIndex.value]
  const before = editContent.value.slice(0, idx)
  const after = editContent.value.slice(idx + searchText.value.length)
  editContent.value = before + replaceText.value + after
}

const replaceAll = () => {
  if (!searchText.value) return
  const flags = searchMatchCase.value ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(searchText.value), flags)
  const count = (editContent.value.match(regex) || []).length
  editContent.value = editContent.value.replace(regex, replaceText.value)
  ElMessage.success(`已替换 ${count} 处`)
}

const handleEditDialogClosed = () => {
  searchText.value = ''
  replaceText.value = ''
}

// 权限编辑
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

// 压缩和解压
const showCompressDialog = ref(false)
const showExtractDialog = ref(false)
const compressFormat = ref('tar.gz')
const compressOutputName = ref('')
const compressing = ref(false)
const extractTarget = ref<'current' | 'subfolder' | 'custom'>('current')
const extractCustomPath = ref('')
const extracting = ref(false)

// 判断是否为可解压的压缩文件（与后端 sftp:extract 支持的格式一致，不区分大小写）
const isCompressedFile = (file: FileInfo | null): boolean =>
  !!file && isFileLike(file) && isExtractableArchiveName(file.name)

// 获取不带扩展名的文件名（用于解压目录名）
const getBaseName = (filename: string): string => stripArchiveExtension(filename)

const normalizeCompressOutputName = (fileName: string, format: string) => {
  const extension = `.${format}`
  const baseName = getBaseName(fileName.trim() || 'archive')
  return `${baseName}${extension}`
}

// 文件列表第二行的说明文字（符号链接按目标类型显示）
const getFileMetaText = (file: FileInfo): string => {
  if (file.type === 'directory') return '文件夹'
  if (file.type === 'file') return formatSize(file.size)
  if (file.targetType === 'directory') return '链接 → 文件夹'
  if (file.targetType === 'file') return '链接 → 文件'
  return '失效链接'
}

const readLocalDirectoryNames = async (dirPath: string) => {
  try {
    const result = await window.electronAPI.fs.readDirectory(dirPath)
    if (!result.success || !result.files) return []
    return result.files.map((file: any) => file.name).filter(Boolean)
  } catch {
    return []
  }
}

const statLocalPath = async (filePath: string) => {
  try {
    const result = await window.electronAPI.fs.stat(filePath)
    if (!result.success || !result.stats) {
      return { exists: false, isDirectory: false, size: 0 }
    }
    return {
      exists: true,
      isDirectory: Boolean(result.stats.isDirectory),
      size: Number(result.stats.size || 0)
    }
  } catch {
    return { exists: false, isDirectory: false, size: 0 }
  }
}

/**
 * 同名冲突提示：跳过 / 重命名 / 续传 / 覆盖，并可勾选“全部应用”对其余冲突执行相同操作。
 */
const showTransferConflictChoice = async (
  context: ConflictPromptContext & {
    direction: 'upload' | 'download'
    targetPath: string
    validateName: (name: string) => string | undefined
  }
): Promise<ConflictDecision> => {
  let settled = false
  let applyToAll = false

  const settle = (
    resolve: (choice: ConflictDecision) => void,
    action: ConflictDecision['action']
  ) => {
    if (settled) return
    settled = true
    resolve({ action, applyToAll })
    ElMessageBox.close()
  }

  const conflictTitle =
    context.targetType === 'queued'
      ? '本次传输中已有同名文件：'
      : `目标位置已存在同名${context.targetType === 'directory' ? '目录' : '文件'}：`

  const choice = await new Promise<ConflictDecision>((resolve) => {
    ElMessageBox({
      title: context.direction === 'upload' ? '上传同名处理' : '下载同名处理',
      message: h('div', { class: 'transfer-conflict-message' }, [
        h('p', { class: 'transfer-conflict-title' }, [
          conflictTitle,
          h('strong', context.fileName)
        ]),
        h('p', { class: 'transfer-conflict-path' }, context.targetPath),
        context.remaining > 0
          ? h(
              'label',
              {
                class: 'transfer-conflict-apply-all',
                style:
                  'display: flex; align-items: center; gap: 6px; margin: 8px 0; cursor: pointer;'
              },
              [
                h('input', {
                  type: 'checkbox',
                  onChange: (event: Event) => {
                    applyToAll = (event.target as HTMLInputElement).checked
                  }
                }),
                h('span', `全部应用（其余 ${context.remaining} 个文件遇到冲突时执行相同操作）`)
              ]
            )
          : null,
        h('div', { class: 'transfer-conflict-actions' }, [
          h(ElButton, { onClick: () => settle(resolve, 'skip') }, () => '跳过'),
          h(ElButton, { onClick: () => settle(resolve, 'rename') }, () => '重命名'),
          context.canResume
            ? h(
                ElButton,
                { type: 'warning', onClick: () => settle(resolve, 'resume') },
                () => '续传'
              )
            : null,
          context.canOverwrite
            ? h(
                ElButton,
                { type: 'danger', onClick: () => settle(resolve, 'overwrite') },
                () => '覆盖'
              )
            : null
        ])
      ]),
      showConfirmButton: false,
      showCancelButton: false,
      closeOnClickModal: false,
      closeOnPressEscape: false,
      beforeClose: (_action, _instance, done) => {
        if (!settled) {
          settled = true
          resolve({ action: 'skip' })
        }
        done()
      }
    }).catch(() => {
      if (!settled) {
        settled = true
        resolve({ action: 'skip' })
      }
    })
  })

  // “全部重命名”时后续冲突自动生成名称；当前这个仍让用户确认名称
  if (choice.action !== 'rename') return choice

  const generatedName = generateConflictRename(
    context.fileName,
    context.takenNames,
    context.caseSensitive
  )

  while (true) {
    const { value } = await ElMessageBox.prompt('请输入新的文件名', '重命名传输', {
      inputValue: generatedName,
      inputValidator: (input: string) => context.validateName(input.trim()) || true,
      closeOnClickModal: false,
      closeOnPressEscape: false
    }).catch(() => ({ value: '' }))

    const newName = (value || '').trim()
    if (!newName) return { action: 'skip' }
    if (!hasNameConflict(newName, context.takenNames, context.caseSensitive)) {
      return { action: 'rename', fileName: newName, applyToAll: choice.applyToAll }
    }

    ElMessage.warning('该名称仍然冲突，请重新输入')
  }
}

// 远程目录项转为冲突检测用的目标：指向目录的链接按目录处理（不能被文件覆盖）
const toExistingRemoteTarget = (file: {
  name: string
  type: string
  targetType?: string
  size: number
}): ExistingTarget => ({
  name: file.name,
  type:
    file.type === 'directory' || (file.type === 'symlink' && file.targetType === 'directory')
      ? 'directory'
      : 'file',
  size: Number(file.size) || 0
})

interface PanelTransferJob {
  type: 'upload' | 'download'
  connectionId: string
  name: string
  localPath: string
  remotePath: string
  size: number
  resumeFromExisting: boolean
}

type PanelTransferOutcome = 'completed' | 'failed' | 'paused' | 'cancelled'

interface PanelTransferResult {
  job: PanelTransferJob
  outcome: PanelTransferOutcome
  error?: string
}

/** 启动一个传输：先以“等待中”加入列表，由后端全局并发限制决定何时真正开始 */
const runPanelTransfer = async (job: PanelTransferJob): Promise<PanelTransferResult> => {
  const taskId = createPanelTransferId(job.type)
  addPanelTransfer({
    id: taskId,
    name: job.name,
    type: job.type,
    status: 'pending',
    progress: 0,
    transferred: 0,
    total: job.size || 0,
    speed: 0,
    eta: 0,
    localPath: job.localPath,
    remotePath: job.remotePath
  })

  if (disposed) {
    markPanelTransferCancelled(taskId)
    return { job, outcome: 'cancelled' }
  }

  try {
    const options = { resumeFromExisting: job.resumeFromExisting, taskId }
    const result =
      job.type === 'upload'
        ? await window.electronAPI.sftp.uploadFile(
            job.connectionId,
            job.localPath,
            job.remotePath,
            options
          )
        : await window.electronAPI.sftp.downloadFile(
            job.connectionId,
            job.remotePath,
            job.localPath,
            options
          )
    if (result.success) {
      markPanelTransferCompleted(taskId)
      return { job, outcome: 'completed' }
    }
    if (result.cancelled) {
      markPanelTransferCancelled(taskId)
      return { job, outcome: 'cancelled' }
    }
    if (result.paused) {
      markPanelTransferPaused(taskId)
      return { job, outcome: 'paused' }
    }
    markPanelTransferFailed(taskId, result.error)
    return { job, outcome: 'failed', error: result.error }
  } catch (error) {
    const message = errorMessageOf(error)
    markPanelTransferFailed(taskId, message)
    return { job, outcome: 'failed', error: message }
  }
}

/** 并发启动一批传输（后端按全局并发数排队），全部结束后汇总提示 */
const runPanelTransferBatch = async (jobs: PanelTransferJob[]) => {
  const label = jobs[0]?.type === 'download' ? '下载' : '上传'
  if (jobs.length === 1) {
    ElMessage.info(`正在${label} ${jobs[0].name}...`)
  } else if (jobs.length > 1) {
    ElMessage.info(`开始${label} ${jobs.length} 个文件`)
  }

  const settled = await Promise.allSettled(jobs.map((job) => runPanelTransfer(job)))
  const results = settled.map(
    (item, index): PanelTransferResult =>
      item.status === 'fulfilled'
        ? item.value
        : { job: jobs[index], outcome: 'failed', error: errorMessageOf(item.reason) }
  )
  const count = (outcome: PanelTransferOutcome) =>
    results.filter((result) => result.outcome === outcome).length

  if (results.length === 1) {
    const [result] = results
    if (result.outcome === 'completed') ElMessage.success(`${result.job.name} ${label}成功`)
    else if (result.outcome === 'failed') {
      ElMessage.error(`${result.job.name} ${label}失败: ${result.error || '未知错误'}`)
    } else if (result.outcome === 'paused') ElMessage.info(`${result.job.name} 已暂停`)
    else ElMessage.info(`已取消${label} ${result.job.name}`)
  } else if (results.length > 1) {
    const completed = count('completed')
    const failed = count('failed')
    const paused = count('paused')
    const cancelled = count('cancelled')
    if (completed === results.length) {
      ElMessage.success(`成功${label} ${completed} 个文件`)
    } else {
      const parts = [`成功 ${completed} 个`]
      if (failed) parts.push(`失败 ${failed} 个`)
      if (paused) parts.push(`暂停 ${paused} 个`)
      if (cancelled) parts.push(`取消 ${cancelled} 个`)
      ElMessage.warning(`${label}结束：${parts.join('，')}`)
    }
  }

  return results
}

const cancelPanelTransfer = async (transfer: PanelTransfer) => {
  try {
    const result = await window.electronAPI.sftp.cancelTask(transfer.id)
    if (result.success) {
      markPanelTransferCancelled(transfer.id)
    } else {
      ElMessage.error(`取消失败: ${result.error || '未知错误'}`)
    }
  } catch (error) {
    ElMessage.error(`取消失败: ${errorMessageOf(error)}`)
  }
}

/**
 * 上传本地文件到当前目录：
 * 目标目录在开始时固定；用目标目录的最新列表检测冲突，所有冲突决定后再一起开始传输。
 */
const uploadLocalPaths = async (localPaths: string[]) => {
  if (!directoryLoaded.value) {
    ElMessage.warning('当前目录未成功加载，请刷新后再上传')
    return
  }

  const connectionId = props.connectionId
  const targetDir = currentPath.value

  const sources: Array<{ name: string; size: number; localPath: string }> = []
  let folderCount = 0
  const unreadable: string[] = []
  for (const localPath of localPaths) {
    const name = localPath.split(/[/\\]/).pop()
    if (!name) continue
    const stat = await statLocalPath(localPath)
    if (!stat.exists) {
      unreadable.push(name)
      continue
    }
    if (stat.isDirectory) {
      folderCount += 1
      continue
    }
    sources.push({ name, size: stat.size, localPath })
  }

  if (folderCount > 0) {
    ElMessage.warning(`暂不支持上传文件夹，已跳过 ${folderCount} 个文件夹`)
  }
  if (unreadable.length > 0) {
    ElMessage.error(`无法读取本地文件：${unreadable.join('、')}`)
  }
  if (sources.length === 0 || disposed) return

  let existing: ExistingTarget[]
  try {
    const listing = await window.electronAPI.sftp.listDirectory(connectionId, targetDir)
    if (!listing.success || !listing.files) {
      throw new Error(listing.error || '无法读取目标目录')
    }
    existing = listing.files
      .filter((file) => file.name !== '.' && file.name !== '..')
      .map(toExistingRemoteTarget)
  } catch (error) {
    ElMessage.error(
      `${formatSftpOperationError('读取目标目录', errorMessageOf(error), targetDir)}，已取消上传`
    )
    return
  }
  if (disposed) return

  const { planned, skipped } = await planTransfers(sources, existing, true, (context) =>
    showTransferConflictChoice({
      ...context,
      direction: 'upload',
      targetPath: joinRemotePath(targetDir, context.fileName),
      validateName: invalidEntryNameReason
    })
  )

  if (skipped.length > 0) ElMessage.info(`已跳过 ${skipped.length} 个文件`)
  if (planned.length === 0 || disposed) return

  await runPanelTransferBatch(
    planned.map((item) => ({
      type: 'upload' as const,
      connectionId,
      name: item.targetName,
      localPath: item.source.localPath,
      remotePath: joinRemotePath(targetDir, item.targetName),
      size: item.source.size,
      resumeFromExisting: item.resumeFromExisting
    }))
  )

  if (!disposed && currentPath.value === targetDir) refreshDirectory()
}

/** 下载远程文件：跳过本地无法使用的文件名，冲突全部决定后再一起开始 */
const downloadRemoteFiles = async (list: FileInfo[]) => {
  const connectionId = props.connectionId
  const candidates = list.filter((file) => isFileLike(file))
  if (candidates.length === 0) {
    ElMessage.warning('请选择要下载的文件')
    return
  }

  const unsafe: string[] = []
  const safeFiles = candidates.filter((file) => {
    const reason = unsafeLocalFileNameReason(file.name)
    if (reason) unsafe.push(`${file.name}（${reason}）`)
    return !reason
  })
  if (unsafe.length > 0) {
    ElMessage.warning({
      message: `以下文件名无法保存到本地，已跳过：${unsafe.join('、')}`,
      duration: 6000
    })
  }
  if (safeFiles.length === 0) return

  const saveDir = await pickLocalDirectory()
  if (!saveDir || disposed) return

  const existing: ExistingTarget[] = []
  for (const file of safeFiles) {
    const stat = await statLocalPath(joinLocalPath(saveDir, file.name))
    if (stat.exists) {
      existing.push({
        name: file.name,
        type: stat.isDirectory ? 'directory' : 'file',
        size: stat.size
      })
    }
  }
  // 目录中的其它名称只用于生成不冲突的新名称
  for (const name of await readLocalDirectoryNames(saveDir)) {
    if (!existing.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      existing.push({ name, type: 'file', size: 0 })
    }
  }
  if (disposed) return

  const sources = safeFiles.map((file) => ({ name: file.name, size: file.size || 0, file }))
  const { planned, skipped } = await planTransfers(sources, existing, false, (context) =>
    showTransferConflictChoice({
      ...context,
      direction: 'download',
      targetPath: joinLocalPath(saveDir, context.fileName),
      validateName: (name) => invalidEntryNameReason(name) || unsafeLocalFileNameReason(name)
    })
  )

  if (skipped.length > 0) ElMessage.info(`已跳过 ${skipped.length} 个文件`)
  if (planned.length === 0 || disposed) return

  await runPanelTransferBatch(
    planned.map((item) => ({
      type: 'download' as const,
      connectionId,
      name: item.targetName,
      localPath: joinLocalPath(saveDir, item.targetName),
      remotePath: item.source.file.path,
      size: item.source.size,
      resumeFromExisting: item.resumeFromExisting
    }))
  )
}

const canGoBack = computed(() => pathHistory.value.length > 0)

const computedOctalPermission = computed(() => {
  const owner =
    (permissionBits.value.ownerRead ? 4 : 0) +
    (permissionBits.value.ownerWrite ? 2 : 0) +
    (permissionBits.value.ownerExecute ? 1 : 0)
  const group =
    (permissionBits.value.groupRead ? 4 : 0) +
    (permissionBits.value.groupWrite ? 2 : 0) +
    (permissionBits.value.groupExecute ? 1 : 0)
  const other =
    (permissionBits.value.otherRead ? 4 : 0) +
    (permissionBits.value.otherWrite ? 2 : 0) +
    (permissionBits.value.otherExecute ? 1 : 0)
  return `${owner}${group}${other}`
})

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 加载目录
const normalizeRemotePath = (path: string) => {
  const trimmed = path.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed.replace(/\/+/g, '/') : `/${trimmed}`.replace(/\/+/g, '/')
}

const getParentRemotePath = (path: string) => {
  const normalized = normalizeRemotePath(path)
  if (normalized === '/') return '/'
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? `/${parts.join('/')}` : '/'
}

const canGoParent = computed(() => getParentRemotePath(currentPath.value) !== currentPath.value)

const createPanelTransferId = (type: 'upload' | 'download') =>
  `terminal-file-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const normalizePanelByteCount = (value: unknown, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback
}

const normalizePanelProgress = (value: unknown, transferred: number, total: number) => {
  const numberValue = Number(value)
  if (Number.isFinite(numberValue)) {
    return Math.max(0, Math.min(numberValue, 100))
  }
  if (total <= 0) return 0
  return Math.max(0, Math.min((transferred / total) * 100, 100))
}

const addPanelTransfer = (transfer: PanelTransfer) => {
  const existing = panelTransfers.value.find((item) => item.id === transfer.id)
  if (existing) {
    Object.assign(existing, transfer)
    return existing
  }
  panelTransfers.value.unshift(transfer)
  return transfer
}

const findPanelTransfer = (taskId: string) =>
  panelTransfers.value.find((item) => item.id === taskId)

// 排队中的传输真正开始（sftp:started 或首次进度）
const markPanelTransferStarted = (taskId: string) => {
  const transfer = findPanelTransfer(taskId)
  if (transfer && (transfer.status === 'pending' || transfer.status === 'paused')) {
    transfer.status = 'active'
  }
}

const markPanelTransferPaused = (taskId: string) => {
  const transfer = findPanelTransfer(taskId)
  if (!transfer || (transfer.status !== 'active' && transfer.status !== 'pending')) return
  transfer.status = 'paused'
  transfer.speed = 0
  transfer.eta = 0
}

const markPanelTransferCancelled = (taskId: string) => {
  const transfer = findPanelTransfer(taskId)
  if (!transfer || transfer.status === 'completed' || transfer.status === 'failed') return
  transfer.status = 'cancelled'
  transfer.speed = 0
  transfer.eta = 0
}

const markPanelTransferCompleted = (taskId: string) => {
  const transfer = panelTransfers.value.find((item) => item.id === taskId)
  if (!transfer || transfer.status === 'cancelled') return
  transfer.status = 'completed'
  transfer.progress = 100
  transfer.transferred = transfer.total || transfer.transferred
  transfer.speed = 0
  transfer.eta = 0
}

const markPanelTransferFailed = (taskId: string, error?: string) => {
  const transfer = panelTransfers.value.find((item) => item.id === taskId)
  if (!transfer || transfer.status === 'cancelled') return
  transfer.status = 'failed'
  transfer.error = error
  transfer.speed = 0
  transfer.eta = 0
}

const updatePanelTransferProgress = (taskId: string, progress: any) => {
  const transfer = panelTransfers.value.find((item) => item.id === taskId)
  if (!transfer) return
  if (transfer.status === 'pending') transfer.status = 'active'
  if (transfer.status !== 'active') return

  transfer.transferred = normalizePanelByteCount(progress?.transferred, transfer.transferred)
  transfer.total = normalizePanelByteCount(progress?.total, transfer.total)
  transfer.progress = normalizePanelProgress(
    progress?.percentage,
    transfer.transferred,
    transfer.total
  )
  transfer.speed = normalizePanelByteCount(progress?.speed)
  transfer.eta = normalizePanelByteCount(progress?.eta)
}

const clearCompletedPanelTransfers = () => {
  panelTransfers.value = panelTransfers.value.filter(
    (transfer) =>
      transfer.status !== 'completed' &&
      transfer.status !== 'failed' &&
      transfer.status !== 'cancelled'
  )
}

const getPanelTransferStatusText = (transfer: PanelTransfer) => {
  if (transfer.status === 'pending') return '等待中'
  if (transfer.status === 'active') return transfer.type === 'upload' ? '上传中' : '下载中'
  if (transfer.status === 'completed') return '已完成'
  if (transfer.status === 'paused') return '已暂停'
  if (transfer.status === 'failed') return transfer.error || '失败'
  return '已取消'
}

const formatPanelSpeed = (bytesPerSecond: number) => `${formatSize(bytesPerSecond)}/s`

/**
 * 加载目录。返回 true 成功、false 失败、null 表示结果已过期（期间又发起了新的加载）。
 * 只有最新一次请求的结果会被应用，也只有它会结束 loading 状态。
 */
const loadDirectory = async (path: string, notify = true): Promise<boolean | null> => {
  const sequence = ++loadSequence
  const connectionId = props.connectionId
  const targetPath = normalizeRemotePath(path)
  loading.value = true
  directoryError.value = ''
  // 清空选择状态
  selectedFiles.value.clear()
  selectedFile.value = null
  lastSelectedIndex.value = -1

  const applyFailure = (rawError?: string) => {
    const message = formatSftpOperationError('加载目录', rawError, targetPath)
    directoryError.value = message
    files.value = []
    // 失败时停留在失败的路径上并显示错误；上传/新建在成功加载前被禁用
    currentPath.value = targetPath
    pathInput.value = targetPath
    directoryLoaded.value = false
    if (notify) ElMessage.error(message)
  }

  try {
    const result = await window.electronAPI.sftp.listDirectory(connectionId, targetPath)
    if (sequence !== loadSequence || disposed) return null
    if (result.success && result.files) {
      files.value = (result.files as FileInfo[])
        .filter((f) => f.name !== '.' && f.name !== '..')
        .map((f) => ({
          ...f,
          // 确保 path 是完整路径
          path: f.path || joinRemotePath(targetPath, f.name)
        }))
        .sort((a, b) => {
          // 文件夹（含指向文件夹的链接）优先
          const aDir = isDirectoryLike(a)
          const bDir = isDirectoryLike(b)
          if (aDir && !bDir) return -1
          if (!aDir && bDir) return 1
          return a.name.localeCompare(b.name)
        })
      currentPath.value = targetPath
      pathInput.value = targetPath
      directoryLoaded.value = true
      hasLoadedDirectory = true
      return true
    }
    applyFailure(result.error)
    return false
  } catch (error) {
    if (sequence !== loadSequence || disposed) return null
    applyFailure(errorMessageOf(error))
    return false
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

const loadFirstAccessibleDirectory = async (paths: string[]) => {
  const normalizedPaths = Array.from(new Set(paths.map(normalizeRemotePath)))
  let lastError = ''

  for (const path of normalizedPaths) {
    const loaded = await loadDirectory(path, false)
    // 期间用户已导航到其它目录，放弃自动回退
    if (loaded === null) return
    if (loaded) {
      if (path !== normalizedPaths[0]) {
        ElMessage.warning(`默认目录不可访问，已切换到 ${path}`)
      }
      return
    }
    lastError = directoryError.value
  }

  if (lastError) {
    directoryError.value = lastError
    ElMessage.error(lastError)
  }
}

// 登录用户的 home 目录：优先 sftp realpath('.')（结果缓存），失败时按用户名猜测
const resolveHomeDir = async (): Promise<string> => {
  if (cachedHomeDir) return cachedHomeDir
  const connectionId = props.connectionId
  try {
    const result = await window.electronAPI.sftp.realpath(connectionId, '.')
    if (result.success && result.path && result.path.startsWith('/')) {
      if (connectionId === props.connectionId) cachedHomeDir = result.path
      return result.path
    }
  } catch {
    // 回退到按用户名猜测
  }
  return guessHomeDir(props.username)
}

// 终端当前目录（展开 ~）；未检测到或无法解析时返回 null
const getTerminalDir = async (): Promise<string | null> => {
  const dir = props.currentDir?.trim()
  if (!dir) return null
  if (dir.startsWith('~')) {
    const expanded = expandHomePath(dir, await resolveHomeDir())
    return expanded.startsWith('~') ? null : expanded
  }
  return dir
}

// 获取初始目录（优先使用终端当前目录，否则使用 home 目录）
const getInitialPath = async () => (await getTerminalDir()) || (await resolveHomeDir())

// 导航到路径
const navigateToPath = async () => {
  const input = pathInput.value.trim()
  if (!input) return
  const target = input.startsWith('~') ? expandHomePath(input, await resolveHomeDir()) : input
  if (normalizeRemotePath(target) === currentPath.value && directoryLoaded.value) return
  pathHistory.value.push(currentPath.value)
  loadDirectory(target)
}

// 返回历史路径
const goBack = () => {
  if (pathHistory.value.length > 0) {
    const prevPath = pathHistory.value.pop()!
    loadDirectory(prevPath)
  }
}

// 返回父目录
const goParentDirectory = () => {
  const parentPath = getParentRemotePath(currentPath.value)
  if (parentPath === currentPath.value) return
  pathHistory.value.push(currentPath.value)
  loadDirectory(parentPath)
}

// 返回主目录（登录用户的 home 目录）
const goHome = async () => {
  const homeDir = await resolveHomeDir()
  pathHistory.value.push(currentPath.value)
  loadDirectory(homeDir)
}

// 刷新目录；加载失败后的重试会先重新初始化 SFTP（断线重连后旧会话已失效）
const refreshDirectory = async () => {
  if (directoryLoaded.value) {
    await loadDirectory(currentPath.value)
    return
  }
  const initialized = await initSFTP(true)
  if (!initialized) return
  if (!hasLoadedDirectory) {
    await loadFirstAccessibleDirectory([await getInitialPath(), '/', '/tmp'])
    return
  }
  await loadDirectory(currentPath.value)
}

// 同步到终端当前目录（未检测到终端目录时不导航）
const syncToDetectedTerminalDir = async () => {
  const targetPath = await getTerminalDir()
  if (!targetPath) {
    ElMessage.info('未检测到终端当前目录')
    return
  }
  const normalized = normalizeRemotePath(targetPath)
  if (normalized === currentPath.value && directoryLoaded.value) {
    ElMessage.info('已在当前目录')
    return
  }
  pathHistory.value.push(currentPath.value)
  const loaded = await loadDirectory(normalized)
  if (loaded) ElMessage.success(`已同步到: ${normalized}`)
}

const syncToTerminalDir = async () => {
  // 设置待同步标记，请求父组件更新 currentDir
  pendingSync.value = true
  emit('request-current-dir')

  // 等待一小段时间让父组件更新 currentDir
  await new Promise((resolve) => setTimeout(resolve, 100))

  // 如果 pendingSync 仍然是 true，说明 watch 没有触发（currentDir 没变化），直接使用当前值
  if (pendingSync.value) {
    pendingSync.value = false
    await syncToDetectedTerminalDir()
  }
}

// 检查文件是否被选中
const isFileSelected = (file: FileInfo): boolean => {
  return selectedFiles.value.has(file.path)
}

// 获取所有选中的文件
const getSelectedFiles = (): FileInfo[] => {
  return displayFiles.value.filter((f) => selectedFiles.value.has(f.path))
}

// 选择文件
const selectFile = (file: FileInfo, index: number, event?: MouseEvent) => {
  const isCtrlSelect = event?.ctrlKey || event?.metaKey
  const isShiftSelect = event?.shiftKey

  if (isShiftSelect && lastSelectedIndex.value !== -1) {
    // Shift + 点击：范围选择
    const start = Math.min(lastSelectedIndex.value, index)
    const end = Math.max(lastSelectedIndex.value, index)

    // 如果没有按 Ctrl，先清空之前的选择
    if (!isCtrlSelect) {
      selectedFiles.value.clear()
    }

    // 选择范围内的所有文件
    for (let i = start; i <= end; i++) {
      const f = displayFiles.value[i]
      if (f) {
        selectedFiles.value.add(f.path)
      }
    }
    // Shift 选择后不更新 lastSelectedIndex，保持锚点不变
  } else if (isCtrlSelect) {
    // Ctrl/Cmd + 点击：切换单个选择
    if (selectedFiles.value.has(file.path)) {
      selectedFiles.value.delete(file.path)
    } else {
      selectedFiles.value.add(file.path)
    }
    lastSelectedIndex.value = index
  } else {
    // 普通点击：单选模式
    selectedFiles.value.clear()
    selectedFiles.value.add(file.path)
    lastSelectedIndex.value = index
  }

  // 触发响应式更新
  selectedFiles.value = new Set(selectedFiles.value)

  // 更新 selectedFile（用于右键菜单等）
  const selected = getSelectedFiles()
  selectedFile.value = selected.length === 1 ? selected[0] : selected.length > 0 ? file : null

  contextMenuVisible.value = false
}

// 双击处理
const handleDoubleClick = async (file: FileInfo) => {
  if (isDirectoryLike(file)) {
    pathHistory.value.push(currentPath.value)
    loadDirectory(file.path)
    return
  }
  if (!isFileLike(file)) {
    ElMessage.warning('链接目标不存在，无法打开')
    return
  }

  // 双击文件打开预览；较大的文件先确认（文本只读取开头部分）
  // 图片超过限制时由 handlePreview 直接提示，不会读取文件
  if (!isImageFile(file.name) && file.size > TEXT_PREVIEW_MAX_BYTES) {
    try {
      await ElMessageBox.confirm(
        `文件较大（${formatSize(file.size)}），预览只显示前 ${formatSize(TEXT_PREVIEW_MAX_BYTES)}，是否继续？`,
        '预览文件',
        { type: 'info', confirmButtonText: '预览', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  contextMenuFile.value = file
  handlePreview()
}

// 显示右键菜单
const showContextMenu = (event: MouseEvent, file: FileInfo) => {
  // 如果右键点击的文件不在选中列表中，则单选该文件
  if (!selectedFiles.value.has(file.path)) {
    selectedFiles.value.clear()
    selectedFiles.value.add(file.path)
    selectedFiles.value = new Set(selectedFiles.value)
  }

  selectedFile.value = file
  contextMenuFile.value = file

  // 计算菜单高度
  const isMultiSelect = selectedFiles.value.size > 1
  let menuItemCount = 3 // 多选：下载、压缩、删除；单选：重命名、删除 + 下面的附加项
  if (!isMultiSelect) {
    menuItemCount = 2
    if (isFileLike(file)) {
      menuItemCount += 3 // 文件额外：预览、编辑、下载
    }
    if (!isBrokenLink(file)) {
      menuItemCount += 2 // 权限、压缩
      if (isCompressedFile(file)) {
        menuItemCount += 1 // 压缩文件额外：解压
      }
    }
  }
  const dividerCount = isMultiSelect ? 1 : isBrokenLink(file) ? 1 : 2
  const estimatedHeight = menuItemCount * 36 + dividerCount * 9 + 16 // 16px padding
  const menuWidth = isMultiSelect ? 180 : 150

  // 确保菜单不超出窗口边界
  let x = event.clientX
  let y = event.clientY

  // 右边界检查
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10
  }

  // 底部边界检查：如果菜单会超出底部，则向上显示
  if (y + estimatedHeight > window.innerHeight) {
    y = window.innerHeight - estimatedHeight - 10
  }

  // 确保不会出现负值
  contextMenuX.value = Math.max(10, x)
  contextMenuY.value = Math.max(10, y)
  contextMenuVisible.value = true
}

// 隐藏右键菜单
const hideContextMenu = () => {
  contextMenuVisible.value = false
}

// 新建命令处理
const handleCreateCommand = (command: string) => {
  if (command === 'folder') {
    newFolderName.value = ''
    showCreateFolderDialog.value = true
  } else if (command === 'file') {
    newFileName.value = ''
    showCreateFileDialog.value = true
  }
}

// 校验新建/重命名的名称；返回去除首尾空白后的名称，不合法时提示并返回 null
const validateNewEntryName = (rawName: string, emptyMessage: string, ignoreName?: string) => {
  const name = rawName.trim()
  if (!name) {
    ElMessage.warning(emptyMessage)
    return null
  }
  const reason = invalidEntryNameReason(name)
  if (reason) {
    ElMessage.warning(reason)
    return null
  }
  if (name !== ignoreName && files.value.some((file) => file.name === name)) {
    ElMessage.warning(`当前目录已存在同名项目：${name}`)
    return null
  }
  return name
}

// 创建文件夹
const createFolder = async () => {
  if (!directoryLoaded.value) return
  const name = validateNewEntryName(newFolderName.value, '请输入文件夹名称')
  if (!name) return
  const newPath = joinRemotePath(currentPath.value, name)

  try {
    const result = await window.electronAPI.sftp.createDirectory(props.connectionId, newPath)
    if (result.success) {
      ElMessage.success('文件夹创建成功')
      showCreateFolderDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(formatSftpOperationError('创建文件夹', result.error, newPath))
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('创建文件夹', errorMessageOf(error), newPath))
  }
}

// 创建文件
const createFile = async () => {
  if (!directoryLoaded.value) return
  const name = validateNewEntryName(newFileName.value, '请输入文件名称')
  if (!name) return
  const newPath = joinRemotePath(currentPath.value, name)

  try {
    const result = await window.electronAPI.sftp.createFile(props.connectionId, newPath)
    if (result.success) {
      ElMessage.success('文件创建成功')
      showCreateFileDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(formatSftpOperationError('创建文件', result.error, newPath))
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('创建文件', errorMessageOf(error), newPath))
  }
}

// 上传文件
const handleUpload = async () => {
  if (!directoryLoaded.value) return
  try {
    const result = await window.electronAPI.dialog.openFiles({
      properties: ['openFile', 'multiSelections'],
      defaultPath: localDialogDefaultPath()
    })
    if (!result || result.length === 0) return
    await uploadLocalPaths(result)
  } catch (error) {
    ElMessage.error('上传失败: ' + errorMessageOf(error))
  }
}

// 拖曳上传 - dragover 事件
const onDragOver = (event: DragEvent) => {
  // 只有从外部拖入文件时才显示上传提示
  // 检查是否是内部拖曳（通过自定义类型判断）
  const isInternalDrag =
    event.dataTransfer?.types.includes('application/x-mshell-file') || isDraggingFile.value

  if (event.dataTransfer?.types.includes('Files') && !isInternalDrag) {
    event.dataTransfer.dropEffect = 'copy'
    isDragOver.value = true
  }
}

// 拖曳上传 - dragleave 事件
const onDragLeave = (event: DragEvent) => {
  // 检查是否真的离开了容器（而不是进入子元素）
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = event.clientX
  const y = event.clientY

  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
    isDragOver.value = false
  }
}

// 拖曳上传 - drop 事件
const onDrop = async (event: DragEvent) => {
  isDragOver.value = false

  // 如果是内部拖曳，不处理
  if (isDraggingFile.value || event.dataTransfer?.types.includes('application/x-mshell-file')) {
    return
  }

  const dataTransfer = event.dataTransfer
  if (!dataTransfer || dataTransfer.files.length === 0) return

  if (!directoryLoaded.value) {
    ElMessage.warning('当前目录未成功加载，请刷新后再上传')
    return
  }

  // 必须在事件同步阶段读取 items：识别文件夹（暂不支持上传），并取得本地路径
  const filePaths: string[] = []
  let folderCount = 0
  const items = Array.from(dataTransfer.items || [])
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        folderCount += 1
        continue
      }
      // Electron 的 File 对象有 path 属性
      const path = (item.getAsFile() as (File & { path?: string }) | null)?.path
      if (path) filePaths.push(path)
    }
  } else {
    for (const file of Array.from(dataTransfer.files)) {
      const path = (file as File & { path?: string }).path
      if (path) filePaths.push(path)
    }
  }

  if (folderCount > 0) {
    ElMessage.warning(`暂不支持上传文件夹，已跳过 ${folderCount} 个文件夹`)
  }

  if (filePaths.length === 0) {
    if (folderCount === 0) ElMessage.warning('无法获取文件路径')
    return
  }

  try {
    await uploadLocalPaths(filePaths)
  } catch (error) {
    ElMessage.error('上传失败: ' + errorMessageOf(error))
  }
}

// 文件拖曳开始 - 用于下载
const onFileDragStart = (event: DragEvent, file: FileInfo) => {
  if (!isFileLike(file)) {
    event.preventDefault()
    return
  }

  isDraggingFile.value = true

  // 设置拖曳数据
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', file.name)
    event.dataTransfer.setData(
      'application/x-mshell-file',
      JSON.stringify({
        connectionId: props.connectionId,
        remotePath: file.path,
        fileName: file.name
      })
    )
    event.dataTransfer.effectAllowed = 'copyMove'

    // 设置拖曳图像（使用文件名作为提示）
    const dragImage = document.createElement('div')
    dragImage.textContent = file.name
    dragImage.style.cssText =
      'position: absolute; top: -1000px; padding: 8px 12px; background: #fff; border: 1px solid #ddd; border-radius: 4px; font-size: var(--text-md); box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
    document.body.appendChild(dragImage)
    event.dataTransfer.setDragImage(dragImage, 0, 0)

    // 延迟移除拖曳图像元素
    setTimeout(() => {
      document.body.removeChild(dragImage)
    }, 0)
  }
}

// 文件拖曳结束 - 检查是否拖到了外部
const onFileDragEnd = async (event: DragEvent, file: FileInfo) => {
  isDraggingFile.value = false

  // 检查拖曳是否成功（dropEffect 不为 none 表示被接受）
  // 如果拖到了窗口外部，弹出保存目录选择后下载
  if (event.dataTransfer?.dropEffect !== 'none') return

  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight
  if (
    event.clientX <= 0 ||
    event.clientX >= windowWidth ||
    event.clientY <= 0 ||
    event.clientY >= windowHeight
  ) {
    try {
      await downloadRemoteFiles([file])
    } catch (error) {
      console.error('[TerminalFilePanel] Download error:', error)
      ElMessage.error('下载失败: ' + errorMessageOf(error))
    }
  }
}

// 下载文件
const handleDownload = async () => {
  if (!contextMenuFile.value) return
  hideContextMenu()
  try {
    await downloadRemoteFiles([contextMenuFile.value])
  } catch (error) {
    ElMessage.error('下载失败: ' + errorMessageOf(error))
  }
}

// 重命名
const handleRename = () => {
  if (!contextMenuFile.value) return
  hideContextMenu()
  renameValue.value = contextMenuFile.value.name
  showRenameDialog.value = true
}

const confirmRename = async () => {
  const file = contextMenuFile.value
  if (!file) return
  const name = validateNewEntryName(renameValue.value, '请输入新名称', file.name)
  if (!name) return
  if (name === file.name) {
    showRenameDialog.value = false
    return
  }

  // 新路径基于原文件所在目录构建，名称已校验不含路径分隔符
  const oldPath = file.path
  const newPath = joinRemotePath(parentRemotePath(oldPath), name)
  try {
    const result = await window.electronAPI.sftp.renameFile(props.connectionId, oldPath, newPath)
    if (result.success) {
      ElMessage.success('重命名成功')
      showRenameDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(formatSftpOperationError('重命名', result.error, oldPath))
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('重命名', errorMessageOf(error), oldPath))
  }
}

// 权限编辑
const handlePermissions = () => {
  if (!contextMenuFile.value) return
  hideContextMenu()

  const perms = contextMenuFile.value.permissions || 0o644
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
}

const confirmPermissions = async () => {
  if (!contextMenuFile.value) return

  try {
    const mode = parseInt(computedOctalPermission.value, 8)
    const result = await window.electronAPI.sftp.chmod(
      props.connectionId,
      contextMenuFile.value.path,
      mode
    )
    if (result.success) {
      ElMessage.success('权限修改成功')
      showPermissionsDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(
        formatSftpOperationError('权限修改', result.error, contextMenuFile.value.path)
      )
    }
  } catch (error: any) {
    ElMessage.error(formatSftpOperationError('权限修改', error.message, contextMenuFile.value.path))
  }
}

// 删除
const handleDelete = async () => {
  if (!contextMenuFile.value) return
  hideContextMenu()

  const file = contextMenuFile.value

  if (confirmBeforeDelete.value) {
    try {
      await ElMessageBox.confirm(`确定要删除 "${file.name}" 吗？`, '确认删除', { type: 'warning' })
    } catch (error) {
      if (!isMessageBoxDismissal(error)) ElMessage.error('删除失败: ' + errorMessageOf(error))
      return
    }
  }

  try {
    // 符号链接（包括指向目录的链接）按文件删除，只删除链接本身
    const result =
      file.type === 'directory'
        ? await window.electronAPI.sftp.deleteDirectories(props.connectionId, [file.path])
        : await window.electronAPI.sftp.deleteFile(props.connectionId, file.path)

    const batchResults = (result as { results?: DeleteBatchSummary }).results
    const batchFailure = batchResults?.failed[0]?.error
    if (result.success && !batchFailure) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error(
        formatSftpOperationError('删除', batchFailure || result.error || '删除失败', file.path)
      )
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('删除', errorMessageOf(error), file.path))
  }
  refreshDirectory()
}

// 压缩文件/文件夹
const handleCompress = () => {
  if (!contextMenuFile.value) return
  hideContextMenu()

  const file = contextMenuFile.value
  // 设置默认输出文件名
  compressOutputName.value = `${file.name}.tar.gz`
  compressFormat.value = 'tar.gz'
  showCompressDialog.value = true
}

// 多选压缩
const handleCompressMultiple = () => {
  hideContextMenu()

  const selected = getSelectedFiles()
  if (selected.length === 0) return

  // 设置默认输出文件名
  compressOutputName.value = 'archive.tar.gz'
  compressFormat.value = 'tar.gz'
  showCompressDialog.value = true
}

// 多选下载
const handleDownloadMultiple = async () => {
  hideContextMenu()
  try {
    await downloadRemoteFiles(getSelectedFiles())
  } catch (error) {
    ElMessage.error('下载失败: ' + errorMessageOf(error))
  }
}

// 多选删除
const handleDeleteMultiple = async () => {
  hideContextMenu()

  const selected = getSelectedFiles()
  if (selected.length === 0) return

  if (confirmBeforeDelete.value) {
    try {
      await ElMessageBox.confirm(
        `确定要删除选中的 ${selected.length} 个项目吗？此操作不可恢复！`,
        '批量删除',
        { type: 'warning' }
      )
    } catch (error) {
      if (!isMessageBoxDismissal(error)) ElMessage.error('删除失败: ' + errorMessageOf(error))
      return
    }
  }

  let successCount = 0
  const failures: string[] = []

  const filePaths = selected.filter((file) => file.type !== 'directory').map((file) => file.path)
  const dirPaths = selected.filter((file) => file.type === 'directory').map((file) => file.path)

  const runBatch = async (
    paths: string[],
    remove: (
      connectionId: string,
      paths: string[]
    ) => Promise<{ success: boolean; results?: DeleteBatchSummary; error?: string }>
  ) => {
    if (paths.length === 0) return
    try {
      const result = await remove(props.connectionId, paths)
      if (result.results) {
        successCount += result.results.success.length
        result.results.failed.forEach((item) => failures.push(`${item.path}: ${item.error}`))
      } else if (result.success) {
        successCount += paths.length
      } else {
        paths.forEach((path) => failures.push(`${path}: ${result.error || '删除失败'}`))
      }
    } catch (error) {
      const message = errorMessageOf(error)
      paths.forEach((path) => failures.push(`${path}: ${message}`))
    }
  }

  await runBatch(filePaths, window.electronAPI.sftp.deleteFiles)
  await runBatch(dirPaths, window.electronAPI.sftp.deleteDirectories)

  if (failures.length === 0) {
    ElMessage.success(`成功删除 ${successCount} 个项目`)
  } else {
    console.warn('[TerminalFilePanel] Delete failures:', failures)
    ElMessage.error({
      message: `删除完成：成功 ${successCount} 个，失败 ${failures.length} 个。${failures[0]}`,
      duration: 6000
    })
  }

  refreshDirectory()
}

// 确认压缩
const confirmCompress = async () => {
  const selected = getSelectedFiles()
  const isMultiple = selected.length > 1

  // 如果是单选，使用 contextMenuFile；如果是多选，使用 selected
  const filesToCompress = isMultiple
    ? selected
    : contextMenuFile.value
      ? [contextMenuFile.value]
      : []

  if (filesToCompress.length === 0) {
    ElMessage.warning('没有选中的文件')
    return
  }

  const rawName = compressOutputName.value.trim()
  if (!rawName) {
    ElMessage.warning('请输入输出文件名')
    return
  }
  const outputName = normalizeCompressOutputName(rawName, compressFormat.value)
  const nameError = invalidEntryNameReason(outputName)
  if (nameError) {
    ElMessage.warning(nameError)
    return
  }
  compressOutputName.value = outputName

  // 压缩包放在源文件所在目录
  const archiveDir = parentRemotePath(filesToCompress[0].path)
  const archivePath = joinRemotePath(archiveDir, outputName)
  if (archiveDir === currentPath.value && files.value.some((file) => file.name === outputName)) {
    ElMessage.warning(`当前目录已存在 ${outputName}，请修改输出文件名`)
    return
  }

  compressing.value = true
  try {
    const msg = isMultiple
      ? `正在压缩 ${filesToCompress.length} 个项目...`
      : `正在压缩 ${filesToCompress[0].name}...`
    ElMessage.info(msg)

    const result = isMultiple
      ? await window.electronAPI.sftp.compressMultiple(
          props.connectionId,
          filesToCompress.map((file) => file.path),
          archivePath
        )
      : await window.electronAPI.sftp.compress(
          props.connectionId,
          filesToCompress[0].path,
          archivePath
        )

    if (result.success) {
      ElMessage.success('压缩完成')
      showCompressDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error({
        message: formatSftpOperationError('压缩', result.error, archivePath),
        duration: 6000
      })
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('压缩', errorMessageOf(error), archivePath))
  } finally {
    compressing.value = false
  }
}

// 解压文件
const handleExtract = () => {
  if (!contextMenuFile.value || !isCompressedFile(contextMenuFile.value)) return
  hideContextMenu()

  extractTarget.value = 'current'
  extractCustomPath.value = parentRemotePath(contextMenuFile.value.path)
  showExtractDialog.value = true
}

// 确认解压
const confirmExtract = async () => {
  if (!contextMenuFile.value) return

  const file = contextMenuFile.value
  const archiveDir = parentRemotePath(file.path)

  // 确定解压目标目录
  let targetDir = archiveDir
  if (extractTarget.value === 'subfolder') {
    targetDir = joinRemotePath(archiveDir, getBaseName(file.name))
  } else if (extractTarget.value === 'custom') {
    const custom = extractCustomPath.value.trim()
    if (!custom) {
      ElMessage.warning('请输入目标目录')
      return
    }
    targetDir = normalizeRemotePath(
      custom.startsWith('~') ? expandHomePath(custom, await resolveHomeDir()) : custom
    )
  }

  extracting.value = true
  try {
    ElMessage.info(`正在解压 ${file.name}...`)

    const result = await window.electronAPI.sftp.extract(props.connectionId, file.path, targetDir)

    if (result.success) {
      ElMessage.success('解压完成')
      showExtractDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error({
        message: formatSftpOperationError('解压', result.error, targetDir),
        duration: 6000
      })
    }
  } catch (error) {
    ElMessage.error(formatSftpOperationError('解压', errorMessageOf(error), targetDir))
  } finally {
    extracting.value = false
  }
}

// 判断是否为图片文件
const isImageFile = (filename: string): boolean => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return imageExtensions.includes(ext)
}

// 获取图片 MIME 类型
const getImageMimeType = (filename: string): string => {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }
  return mimeTypes[ext] || 'image/png'
}

// 图片预览大小限制（10MB）
const IMAGE_PREVIEW_SIZE_LIMIT = 10 * 1024 * 1024
// 文本预览最多读取的字节数
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024
// 预览请求序号：快速切换文件时只显示最新一次的结果
let previewSequence = 0

// 预览文件
const handlePreview = async () => {
  const file = contextMenuFile.value
  if (!file || !isFileLike(file)) return
  hideContextMenu()

  const sequence = ++previewSequence
  const isCurrent = () => sequence === previewSequence && !disposed
  previewLoading.value = true
  previewContent.value = ''
  previewNotice.value = ''
  previewImageSrc.value = ''
  showPreviewDialog.value = true

  try {
    // 判断是否为图片文件
    if (isImageFile(file.name)) {
      // 检查图片大小，超过限制则提示下载
      if (file.size > IMAGE_PREVIEW_SIZE_LIMIT) {
        previewType.value = 'text'
        previewContent.value = `图片文件过大（${formatSize(file.size)}），超过预览限制（10MB）。\n请右键下载后使用本地图片查看器打开。`
        return
      }

      previewType.value = 'image'
      // 使用 readFileBuffer 读取二进制数据（base64）
      const result = await window.electronAPI.sftp.readFileBuffer(props.connectionId, file.path)
      if (!isCurrent()) return
      if (result.success && result.data) {
        const mimeType = getImageMimeType(file.name)
        previewImageSrc.value = `data:${mimeType};base64,${result.data}`
      } else {
        previewType.value = 'text'
        previewContent.value = `读取失败: ${result.error}`
      }
    } else {
      previewType.value = 'text'
      // 只读取文件开头部分，避免大文件整份读入内存
      const result = await window.electronAPI.sftp.readFilePreview(
        props.connectionId,
        file.path,
        TEXT_PREVIEW_MAX_BYTES
      )
      if (!isCurrent()) return
      if (!result.success) {
        previewContent.value = `读取失败: ${result.error}`
        return
      }
      const data = result.data || ''
      if (looksBinaryText(data)) {
        previewContent.value = '二进制文件，无法预览'
        return
      }
      previewContent.value = data
      if (result.truncated) {
        const totalSize = result.size ?? file.size
        previewNotice.value = `文件较大（${formatSize(totalSize)}），仅显示前 ${formatSize(TEXT_PREVIEW_MAX_BYTES)}`
      }
    }
  } catch (error) {
    if (!isCurrent()) return
    previewType.value = 'text'
    previewContent.value = `读取失败: ${errorMessageOf(error)}`
  } finally {
    if (sequence === previewSequence) previewLoading.value = false
  }
}

// 编辑文件
const handleEdit = async () => {
  const file = contextMenuFile.value
  if (!file || !isFileLike(file)) return
  hideContextMenu()

  // 检查文件大小，超过 5MB 不建议在线编辑
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('文件过大（超过 5MB），建议下载后使用本地编辑器编辑')
    return
  }

  // 检查是否为二进制文件（通过扩展名判断）
  const binaryExtensions = [
    '.exe',
    '.dll',
    '.so',
    '.bin',
    '.img',
    '.iso',
    '.zip',
    '.tar',
    '.gz',
    '.bz2',
    '.xz',
    '.rar',
    '.7z',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.ico',
    '.mp3',
    '.mp4',
    '.avi',
    '.mkv',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx'
  ]
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
  if (binaryExtensions.includes(ext)) {
    ElMessage.warning('二进制文件不支持在线编辑')
    return
  }

  editLoading.value = true
  editContent.value = ''
  editFormat = { eol: '\n', bom: false, mixedEol: false }
  editingFilePath.value = file.path
  showEditDialog.value = true

  const isCurrent = () => !disposed && showEditDialog.value && editingFilePath.value === file.path

  try {
    // 按字节读取并严格按 UTF-8 解码，非 UTF-8 文件拒绝编辑，避免保存时写坏
    const result = await window.electronAPI.sftp.readFileBuffer(props.connectionId, file.path)
    if (!isCurrent()) return
    if (!result.success || typeof result.data !== 'string') {
      ElMessage.error(`读取失败: ${result.error || '未知错误'}`)
      showEditDialog.value = false
      return
    }
    const decoded = decodeEditableText(base64ToBytes(result.data))
    if (!decoded.ok) {
      ElMessage.warning(decoded.reason)
      showEditDialog.value = false
      return
    }
    editFormat = decoded.format
    editContent.value = decoded.text
    if (decoded.format.mixedEol) {
      ElMessage.warning(
        `文件混用了多种换行符，保存时将统一为 ${decoded.format.eol === '\r\n' ? 'CRLF' : 'LF'}`
      )
    }
  } catch (error) {
    if (!isCurrent()) return
    ElMessage.error(`读取失败: ${errorMessageOf(error)}`)
    showEditDialog.value = false
  } finally {
    if (editingFilePath.value === file.path) editLoading.value = false
  }
}

// 保存编辑的文件（按原文件的换行符和 BOM 写回）
const saveEditedFile = async () => {
  if (!editingFilePath.value || editSaving.value || editLoading.value) return

  editSaving.value = true
  try {
    const result = await window.electronAPI.sftp.writeFile(
      props.connectionId,
      editingFilePath.value,
      encodeEditedText(editContent.value, editFormat)
    )

    if (result.success) {
      ElMessage.success('保存成功')
      showEditDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(formatSftpOperationError('保存文件', result.error, editingFilePath.value))
    }
  } catch (error) {
    ElMessage.error(
      formatSftpOperationError('保存文件', errorMessageOf(error), editingFilePath.value)
    )
  } finally {
    editSaving.value = false
  }
}

// SFTP 初始化状态
const sftpInitialized = ref(false)

// 初始化 SFTP 连接；force 时总是重新调用 init（断线重连后旧会话已失效，重复调用无害）
const initSFTP = async (force = false) => {
  if (sftpInitialized.value && !force) return true

  const fail = (message: string) => {
    directoryError.value = message
    directoryLoaded.value = false
    ElMessage.error(message)
    return false
  }

  loading.value = true
  try {
    const result = await window.electronAPI.sftp.init(props.connectionId)
    if (result && result.success === false) {
      sftpInitialized.value = false
      return fail(result.error || 'SFTP 初始化失败')
    }
    sftpInitialized.value = true
    return true
  } catch (error) {
    sftpInitialized.value = false
    return fail('SFTP 初始化失败: ' + errorMessageOf(error))
  } finally {
    loading.value = false
  }
}

// 初始化 SFTP 并加载初始目录（优先使用终端当前目录）
const initializePanel = async () => {
  const initialized = await initSFTP()
  if (!initialized || disposed) return
  const initialPath = await getInitialPath()
  if (disposed) return
  await loadFirstAccessibleDirectory([initialPath, '/', '/tmp'])
}

onMounted(async () => {
  // 先注册监听（同步），避免在 await 期间卸载导致监听泄漏
  document.addEventListener('click', hideContextMenu)
  cleanupFunctions.push(
    window.electronAPI.sftp.onProgress(updatePanelTransferProgress),
    window.electronAPI.sftp.onComplete(markPanelTransferCompleted),
    window.electronAPI.sftp.onError(markPanelTransferFailed),
    window.electronAPI.sftp.onStarted((taskId) => markPanelTransferStarted(taskId)),
    window.electronAPI.sftp.onPaused(markPanelTransferPaused),
    window.electronAPI.sftp.onCancelled(markPanelTransferCancelled)
  )
  const cleanupSettings = window.electronAPI.settings.onChange((settings: any) => {
    applyFilePanelSettings(settings)
  })
  if (cleanupSettings) {
    cleanupFunctions.push(cleanupSettings)
  }

  await loadFilePanelSettings()
  if (disposed) return
  await initializePanel()
})

onUnmounted(() => {
  disposed = true
  // 让仍在进行的目录加载结果作废
  loadSequence += 1
  previewSequence += 1
  document.removeEventListener('click', hideContextMenu)
  cleanupFunctions.forEach((cleanup) => {
    try {
      cleanup()
    } catch {
      // ignore cleanup errors
    }
  })
  cleanupFunctions.length = 0

  // 面板关闭：取消仍在排队、尚未开始的传输；已开始的传输继续在后台完成
  for (const transfer of panelTransfers.value) {
    if (transfer.status === 'pending') {
      window.electronAPI.sftp.cancelTask(transfer.id).catch(() => {
        // 任务可能已结束
      })
    }
  }
})

// 是否需要同步到终端目录
const pendingSync = ref(false)

// 监听 connectionId 变化，重新初始化和加载
watch(
  () => props.connectionId,
  async () => {
    sftpInitialized.value = false
    cachedHomeDir = null
    hasLoadedDirectory = false
    directoryLoaded.value = false
    files.value = []
    pathHistory.value = []
    await initializePanel()
  }
)

// 监听 currentDir 变化，如果有待同步请求则执行同步
watch(
  () => props.currentDir,
  (newDir) => {
    if (pendingSync.value && newDir) {
      pendingSync.value = false
      syncToDetectedTerminalDir()
    }
  }
)
</script>

<style scoped>
.terminal-file-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.panel-header .header-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-header .header-title .help-icon {
  font-size: 14px;
  color: var(--text-tertiary);
  cursor: help;
  transition: color 0.2s;
}

.panel-header .header-title .help-icon:hover {
  color: var(--primary-color);
}

.panel-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
}

.path-nav {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  align-items: center;
}

.path-input {
  flex: 1;
}

.toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.panel-transfers {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.panel-transfers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.panel-transfer-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.panel-transfer-row,
.panel-transfer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.panel-transfer-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.panel-transfer-status {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.panel-transfer-status.active {
  color: var(--primary-color);
}

.panel-transfer-status.paused {
  color: var(--warning-color);
}

.panel-transfer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.panel-transfer-cancel {
  padding: 0;
  height: auto;
}

.panel-transfer-status.completed {
  color: var(--success-color);
}

.panel-transfer-status.failed {
  color: var(--danger-color);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-transfer-meta {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  position: relative;
  user-select: none; /* 禁用文本选择 */
}

.file-list.drag-over {
  background: rgba(14, 165, 233, 0.05);
  border: 2px dashed var(--primary-color);
  border-radius: 8px;
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(14, 165, 233, 0.1);
  border-radius: 8px;
  z-index: 10;
  color: var(--primary-color);
  font-size: var(--text-base);
  font-weight: 500;
}

.drag-overlay .el-icon {
  margin-bottom: 8px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-secondary);
}

.empty-state p {
  margin-top: 12px;
  font-size: var(--text-sm);
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
  word-break: break-word;
}

.empty-state .drag-hint {
  margin-top: 8px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.file-item[draggable='true'] {
  cursor: grab;
}

.file-item[draggable='true']:active {
  cursor: grabbing;
}

.file-item:hover {
  background: var(--bg-hover);
}

.file-item.selected {
  background: rgba(14, 165, 233, 0.15);
}

.file-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.file-item:has(.file-icon > .el-icon:first-child[class*='Folder']) .file-icon {
  color: #f0a020;
}

.file-icon-wrapper {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.link-badge {
  position: absolute;
  right: -3px;
  bottom: -2px;
  padding: 1px;
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--primary-color);
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin-top: 2px;
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  padding: 4px;
  z-index: 9999;
  min-width: 160px;
  backdrop-filter: none;
}

/* 暗色主题下的右键菜单 */
:root[data-theme='dark'] .context-menu,
.dark .context-menu {
  background-color: #2d2d2d;
  border-color: #404040;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 36px;
  line-height: 36px;
  box-sizing: border-box;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.2s;
  white-space: nowrap;
}

.menu-item :deep(.el-icon) {
  width: 16px;
  height: 16px;
  font-size: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-item span {
  flex: 1;
  line-height: 1;
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-item.danger {
  color: #f56c6c;
}

.menu-item.danger:hover {
  background: rgba(245, 108, 108, 0.1);
}

.menu-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 8px;
}

/* 权限编辑器 */
.permissions-editor {
  padding: 8px 0;
}

.permission-group {
  margin-bottom: 16px;
}

.permission-group h4 {
  margin: 0 0 8px 0;
  font-size: var(--text-sm);
  font-weight: 600;
}

.permission-checkboxes {
  display: flex;
  gap: 16px;
}

.permission-octal {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.octal-value {
  font-family: monospace;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--primary-color);
  margin-left: 8px;
}

/* 预览和编辑 */
.preview-content {
  max-height: 500px;
  overflow: auto;
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: var(--text-secondary);
}

.preview-notice {
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: var(--text-xs);
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
}

.preview-text {
  margin: 0;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 450px;
  overflow: auto;
}

.preview-image-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  max-height: 500px;
  overflow: auto;
}

.preview-image {
  max-width: 100%;
  max-height: 450px;
  object-fit: contain;
  border-radius: 4px;
}

.edit-content {
  min-height: 400px;
}

.edit-textarea :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--text-sm);
  line-height: 1.5;
  resize: none;
}

.search-replace-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-secondary, #f5f7fa);
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 6px;
  margin-bottom: 8px;
}

.search-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  flex: 1;
}

.match-info {
  font-size: 11px;
  color: var(--text-secondary, #909399);
  white-space: nowrap;
  padding-right: 4px;
}

.case-btn {
  font-weight: bold;
  min-width: 32px;
}

.edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.footer-actions {
  display: flex;
  gap: 8px;
}
</style>
