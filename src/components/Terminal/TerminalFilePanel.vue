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
      <el-button :icon="Back" size="small" @click="goBack" :disabled="!canGoBack" />
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
      <el-dropdown @command="handleCreateCommand" trigger="click" size="small">
        <el-button size="small" :icon="Plus">
          新建
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
      <el-button size="small" :icon="Upload" @click="handleUpload">上传</el-button>
      <el-tooltip :content="showHiddenFiles ? '隐藏隐藏文件' : '显示隐藏文件'" placement="bottom">
        <el-button 
          size="small" 
          :icon="View"
          :type="showHiddenFiles ? 'primary' : 'default'"
          @click="toggleHiddenFiles"
        />
      </el-tooltip>
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
        <p>文件夹为空</p>
        <p class="drag-hint">拖曳文件到此处上传</p>
      </div>
      
      <div
        v-for="(file, index) in displayFiles"
        :key="file.path"
        class="file-item"
        :class="{ selected: isFileSelected(file) }"
        :draggable="file.type === 'file'"
        @click="(e) => selectFile(file, index, e)"
        @dblclick="handleDoubleClick(file)"
        @contextmenu.prevent="showContextMenu($event, file)"
        @dragstart="onFileDragStart($event, file)"
        @dragend="onFileDragEnd($event, file)"
      >
        <el-icon :size="20" class="file-icon">
          <Folder v-if="file.type === 'directory'" />
          <Document v-else-if="file.type === 'file'" />
          <Link v-else />
        </el-icon>
        <div class="file-info">
          <div class="file-name">{{ file.name }}</div>
          <div class="file-meta">
            <span v-if="file.type === 'file'">{{ formatSize(file.size) }}</span>
            <span v-else>文件夹</span>
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
        <div v-if="contextMenuFile?.type === 'file'" class="menu-item" @click="handlePreview">
          <el-icon><ZoomIn /></el-icon>
          <span>预览</span>
        </div>
        <div v-if="contextMenuFile?.type === 'file'" class="menu-item" @click="handleEdit">
          <el-icon><EditPen /></el-icon>
          <span>编辑</span>
        </div>
        <div v-if="contextMenuFile?.type === 'file'" class="menu-item" @click="handleDownload">
          <el-icon><Download /></el-icon>
          <span>下载</span>
        </div>
        <div class="menu-item" @click="handleRename">
          <el-icon><Edit /></el-icon>
          <span>重命名</span>
        </div>
        <div class="menu-item" @click="handlePermissions">
          <el-icon><Lock /></el-icon>
          <span>权限</span>
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" @click="handleCompress">
          <el-icon><Box /></el-icon>
          <span>压缩</span>
        </div>
        <div 
          v-if="isCompressedFile(contextMenuFile)" 
          class="menu-item" 
          @click="handleExtract"
        >
          <el-icon><FolderOpened /></el-icon>
          <span>解压</span>
        </div>
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
        <pre v-else class="preview-text">{{ previewContent }}</pre>
      </div>
      <template #footer>
        <el-button @click="showPreviewDialog = false">关闭</el-button>
      </template>
    </el-dialog>
    
    <!-- 编辑对话框 -->
    <el-dialog v-model="showEditDialog" title="编辑文件" width="800px" append-to-body>
      <div class="edit-content">
        <div v-if="editLoading" class="preview-loading">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <el-input
          v-else
          v-model="editContent"
          type="textarea"
          :rows="20"
          class="edit-textarea"
        />
      </div>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEditedFile" :loading="editSaving">保存</el-button>
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
          <el-input 
            v-if="selectedFiles.size <= 1" 
            :value="contextMenuFile?.name" 
            disabled 
          />
          <el-input 
            v-else 
            :value="`已选择 ${selectedFiles.size} 个项目`" 
            disabled 
          />
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Close, Back, HomeFilled, FolderOpened, Refresh, Plus, FolderAdd,
  Document, Upload, Download, Folder, Link, Edit, Delete, Lock, View,
  ZoomIn, EditPen, Loading, Position, Box, QuestionFilled
} from '@element-plus/icons-vue'

interface FileInfo {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifyTime: Date
  permissions?: number
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
const selectedFile = ref<FileInfo | null>(null)
const selectedFiles = ref<Set<string>>(new Set()) // 多选文件的 path 集合
const lastSelectedIndex = ref<number>(-1) // 用于 Shift 多选
const pathHistory = ref<string[]>([])
const showHiddenFiles = ref(false)

// 拖曳状态
const isDragOver = ref(false)
const isDraggingFile = ref(false)

// 过滤后的文件列表（根据是否显示隐藏文件）
const displayFiles = computed(() => {
  if (showHiddenFiles.value) {
    return files.value
  }
  return files.value.filter(f => !f.name.startsWith('.'))
})

// 切换显示隐藏文件
const toggleHiddenFiles = () => {
  showHiddenFiles.value = !showHiddenFiles.value
}

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
const editContent = ref('')
const editLoading = ref(false)
const editSaving = ref(false)
const editingFilePath = ref('')

// 权限编辑
const permissionBits = ref({
  ownerRead: false, ownerWrite: false, ownerExecute: false,
  groupRead: false, groupWrite: false, groupExecute: false,
  otherRead: false, otherWrite: false, otherExecute: false
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

// 支持的压缩文件扩展名
const compressedExtensions = ['.tar.gz', '.tgz', '.tar', '.zip', '.gz', '.bz2', '.xz', '.tar.bz2', '.tar.xz', '.rar', '.7z']

// 判断是否为压缩文件
const isCompressedFile = (file: FileInfo | null): boolean => {
  if (!file || file.type !== 'file') return false
  const name = file.name.toLowerCase()
  return compressedExtensions.some(ext => name.endsWith(ext))
}

// 获取不带扩展名的文件名（用于解压目录名）
const getBaseName = (filename: string): string => {
  let name = filename
  // 移除常见的压缩扩展名
  for (const ext of ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tar', '.zip', '.gz', '.bz2', '.xz', '.rar', '.7z']) {
    if (name.toLowerCase().endsWith(ext)) {
      return name.slice(0, -ext.length)
    }
  }
  return name
}

const canGoBack = computed(() => pathHistory.value.length > 0)

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

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 加载目录
const loadDirectory = async (path: string) => {
  loading.value = true
  // 清空选择状态
  selectedFiles.value.clear()
  selectedFile.value = null
  lastSelectedIndex.value = -1
  
  try {
    const result = await window.electronAPI.sftp.listDirectory(props.connectionId, path)
    if (result.success && result.files) {
      files.value = result.files
        .filter((f: FileInfo) => f.name !== '.' && f.name !== '..')
        .map((f: FileInfo) => ({
          ...f,
          // 确保 path 是完整路径
          path: f.path || (path === '/' ? '/' + f.name : path + '/' + f.name)
        }))
        .sort((a: FileInfo, b: FileInfo) => {
          // 文件夹优先
          if (a.type === 'directory' && b.type !== 'directory') return -1
          if (a.type !== 'directory' && b.type === 'directory') return 1
          return a.name.localeCompare(b.name)
        })
      currentPath.value = path
      pathInput.value = path
      console.log('[TerminalFilePanel] Loaded directory:', path, 'files:', files.value.length)
    } else {
      ElMessage.error(result.error || '加载目录失败')
    }
  } catch (error: any) {
    ElMessage.error('加载目录失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 导航到路径
const navigateToPath = () => {
  if (pathInput.value && pathInput.value !== currentPath.value) {
    pathHistory.value.push(currentPath.value)
    loadDirectory(pathInput.value)
  }
}

// 返回上级
const goBack = () => {
  if (pathHistory.value.length > 0) {
    const prevPath = pathHistory.value.pop()!
    loadDirectory(prevPath)
  }
}

// 返回主目录（用户的 home 目录）
const goHome = () => {
  pathHistory.value.push(currentPath.value)
  // 根据用户名判断 home 目录
  const homeDir = props.username && props.username !== 'root' 
    ? `/home/${props.username}` 
    : '/root'
  loadDirectory(homeDir)
}

// 刷新目录
const refreshDirectory = () => {
  loadDirectory(currentPath.value)
}

// 同步到终端当前目录
const syncToTerminalDir = async () => {
  // 设置待同步标记
  pendingSync.value = true
  // 请求父组件更新 currentDir
  emit('request-current-dir')
  
  // 等待一小段时间让父组件更新 currentDir
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // 如果 pendingSync 仍然是 true，说明 watch 没有触发（可能 currentDir 没变化）
  // 这时候直接使用 props.currentDir 刷新
  if (pendingSync.value) {
    pendingSync.value = false
    const targetPath = getInitialPath()
    console.log('[TerminalFilePanel] Direct sync to:', targetPath, 'currentDir:', props.currentDir)
    if (targetPath && targetPath !== currentPath.value) {
      pathHistory.value.push(currentPath.value)
      loadDirectory(targetPath)
      ElMessage.success(`已同步到: ${targetPath}`)
    } else if (!targetPath || targetPath === '/root') {
      ElMessage.info('未检测到终端目录，使用默认目录 /root')
    } else {
      ElMessage.info('已在当前目录')
    }
  }
}

// 检查文件是否被选中
const isFileSelected = (file: FileInfo): boolean => {
  return selectedFiles.value.has(file.path)
}

// 获取所有选中的文件
const getSelectedFiles = (): FileInfo[] => {
  return displayFiles.value.filter(f => selectedFiles.value.has(f.path))
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
  selectedFile.value = selected.length === 1 ? selected[0] : (selected.length > 0 ? file : null)
  
  contextMenuVisible.value = false
}

// 双击处理
const handleDoubleClick = (file: FileInfo) => {
  console.log('[TerminalFilePanel] Double click:', file.name, file.type, file.path)
  if (file.type === 'directory') {
    pathHistory.value.push(currentPath.value)
    loadDirectory(file.path)
  } else {
    // 双击文件打开预览
    contextMenuFile.value = file
    handlePreview()
  }
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
  let menuItemCount = isMultiSelect ? 3 : 3  // 基础项目数
  if (!isMultiSelect) {
    if (file.type === 'file') {
      menuItemCount += 3  // 文件额外：预览、编辑、下载
      if (isCompressedFile(file)) {
        menuItemCount += 1  // 压缩文件额外：解压
      }
    }
    menuItemCount += 1  // 删除
  }
  const dividerCount = isMultiSelect ? 1 : 2
  const estimatedHeight = menuItemCount * 36 + dividerCount * 9 + 16  // 16px padding
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

// 创建文件夹
const createFolder = async () => {
  if (!newFolderName.value.trim()) {
    ElMessage.warning('请输入文件夹名称')
    return
  }
  
  try {
    const newPath = currentPath.value === '/' 
      ? '/' + newFolderName.value 
      : currentPath.value + '/' + newFolderName.value
    
    const result = await window.electronAPI.sftp.createDirectory(props.connectionId, newPath)
    if (result.success) {
      ElMessage.success('文件夹创建成功')
      showCreateFolderDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '创建失败')
    }
  } catch (error: any) {
    ElMessage.error('创建文件夹失败: ' + error.message)
  }
}

// 创建文件
const createFile = async () => {
  if (!newFileName.value.trim()) {
    ElMessage.warning('请输入文件名称')
    return
  }
  
  try {
    const newPath = currentPath.value === '/' 
      ? '/' + newFileName.value 
      : currentPath.value + '/' + newFileName.value
    
    const result = await window.electronAPI.sftp.createFile(props.connectionId, newPath)
    if (result.success) {
      ElMessage.success('文件创建成功')
      showCreateFileDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '创建失败')
    }
  } catch (error: any) {
    ElMessage.error('创建文件失败: ' + error.message)
  }
}

// 上传文件
const handleUpload = async () => {
  try {
    const result = await window.electronAPI.dialog.openFile({
      properties: ['openFile', 'multiSelections']
    })
    
    if (result && result.length > 0) {
      for (const localPath of result) {
        const fileName = localPath.split(/[/\\]/).pop()
        const remotePath = currentPath.value === '/' 
          ? '/' + fileName 
          : currentPath.value + '/' + fileName
        
        ElMessage.info(`正在上传 ${fileName}...`)
        
        const uploadResult = await window.electronAPI.sftp.uploadFile(props.connectionId, localPath, remotePath)
        if (uploadResult.success) {
          ElMessage.success(`${fileName} 上传成功`)
        } else {
          ElMessage.error(`${fileName} 上传失败: ${uploadResult.error}`)
        }
      }
      refreshDirectory()
    }
  } catch (error: any) {
    ElMessage.error('上传失败: ' + error.message)
  }
}

// 拖曳上传 - dragover 事件
const onDragOver = (event: DragEvent) => {
  // 只有从外部拖入文件时才显示上传提示
  // 检查是否是内部拖曳（通过自定义类型判断）
  const isInternalDrag = event.dataTransfer?.types.includes('application/x-mshell-file') || isDraggingFile.value
  
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
  
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  
  // 获取文件路径（Electron 环境下可以获取完整路径）
  const filePaths: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i] as any
    // Electron 的 File 对象有 path 属性
    if (file.path) {
      filePaths.push(file.path)
    }
  }
  
  if (filePaths.length === 0) {
    ElMessage.warning('无法获取文件路径')
    return
  }
  
  // 上传文件
  for (const localPath of filePaths) {
    const fileName = localPath.split(/[/\\]/).pop()
    const remotePath = currentPath.value === '/' 
      ? '/' + fileName 
      : currentPath.value + '/' + fileName
    
    ElMessage.info(`正在上传 ${fileName}...`)
    
    try {
      const uploadResult = await window.electronAPI.sftp.uploadFile(props.connectionId, localPath, remotePath)
      if (uploadResult.success) {
        ElMessage.success(`${fileName} 上传成功`)
      } else {
        ElMessage.error(`${fileName} 上传失败: ${uploadResult.error}`)
      }
    } catch (error: any) {
      ElMessage.error(`${fileName} 上传失败: ${error.message}`)
    }
  }
  
  refreshDirectory()
}

// 文件拖曳开始 - 用于下载
const onFileDragStart = (event: DragEvent, file: FileInfo) => {
  if (file.type !== 'file') {
    event.preventDefault()
    return
  }
  
  isDraggingFile.value = true
  
  // 设置拖曳数据
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', file.name)
    event.dataTransfer.setData('application/x-mshell-file', JSON.stringify({
      connectionId: props.connectionId,
      remotePath: file.path,
      fileName: file.name
    }))
    event.dataTransfer.effectAllowed = 'copyMove'
    
    // 设置拖曳图像（使用文件名作为提示）
    const dragImage = document.createElement('div')
    dragImage.textContent = file.name
    dragImage.style.cssText = 'position: absolute; top: -1000px; padding: 8px 12px; background: #fff; border: 1px solid #ddd; border-radius: 4px; font-size: var(--text-md); box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
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
  // 如果拖到了窗口外部，提示用户使用右键下载
  if (event.dataTransfer?.dropEffect === 'none') {
    // 检查鼠标是否在窗口内
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    
    // 如果拖曳结束时鼠标在窗口外，说明用户想要下载到本地
    if (event.clientX <= 0 || event.clientX >= windowWidth || 
        event.clientY <= 0 || event.clientY >= windowHeight) {
      // 弹出保存对话框
      try {
        const saveDir = await window.electronAPI.dialog.openDirectory({
          properties: ['openDirectory', 'createDirectory']
        })
        
        if (saveDir) {
          const localPath = `${saveDir}/${file.name}`
          ElMessage.info(`正在下载 ${file.name}...`)
          
          const result = await window.electronAPI.sftp.downloadFile(props.connectionId, file.path, localPath)
          if (result.success) {
            ElMessage.success(`${file.name} 下载成功`)
          } else {
            ElMessage.error(`下载失败: ${result.error}`)
          }
        }
      } catch (error: any) {
        console.error('[TerminalFilePanel] Download error:', error)
      }
    }
  }
}

// 下载文件
const handleDownload = async () => {
  if (!contextMenuFile.value) return
  hideContextMenu()
  
  try {
    // 选择保存目录
    const saveDir = await window.electronAPI.dialog.openDirectory({
      properties: ['openDirectory', 'createDirectory']
    })
    
    if (!saveDir) return
    
    const file = contextMenuFile.value
    const localPath = `${saveDir}/${file.name}`
    
    ElMessage.info(`正在下载 ${file.name}...`)
    
    const result = await window.electronAPI.sftp.downloadFile(props.connectionId, file.path, localPath)
    if (result.success) {
      ElMessage.success(`${file.name} 下载成功`)
    } else {
      ElMessage.error(`下载失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error('下载失败: ' + error.message)
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
  if (!contextMenuFile.value || !renameValue.value.trim()) return
  
  try {
    const oldPath = contextMenuFile.value.path
    const newPath = currentPath.value === '/'
      ? '/' + renameValue.value
      : currentPath.value + '/' + renameValue.value
    
    const result = await window.electronAPI.sftp.renameFile(props.connectionId, oldPath, newPath)
    if (result.success) {
      ElMessage.success('重命名成功')
      showRenameDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '重命名失败')
    }
  } catch (error: any) {
    ElMessage.error('重命名失败: ' + error.message)
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
    const result = await window.electronAPI.sftp.chmod(props.connectionId, contextMenuFile.value.path, mode)
    if (result.success) {
      ElMessage.success('权限修改成功')
      showPermissionsDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '权限修改失败')
    }
  } catch (error: any) {
    ElMessage.error('权限修改失败: ' + error.message)
  }
}

// 删除
const handleDelete = async () => {
  if (!contextMenuFile.value) return
  hideContextMenu()
  
  const file = contextMenuFile.value
  
  try {
    await ElMessageBox.confirm(
      `确定要删除 "${file.name}" 吗？`,
      '确认删除',
      { type: 'warning' }
    )
    
    let result
    if (file.type === 'directory') {
      result = await window.electronAPI.sftp.deleteDirectories(props.connectionId, [file.path])
    } else {
      result = await window.electronAPI.sftp.deleteFile(props.connectionId, file.path)
    }
    
    if (result.success) {
      ElMessage.success('删除成功')
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败: ' + error.message)
    }
  }
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
  
  const selected = getSelectedFiles().filter(f => f.type === 'file')
  if (selected.length === 0) {
    ElMessage.warning('请选择要下载的文件')
    return
  }
  
  try {
    // 选择保存目录
    const saveDir = await window.electronAPI.dialog.openDirectory({
      properties: ['openDirectory', 'createDirectory']
    })
    
    if (!saveDir) return
    
    let successCount = 0
    let failCount = 0
    
    for (const file of selected) {
      const localPath = `${saveDir}/${file.name}`
      ElMessage.info(`正在下载 ${file.name}...`)
      
      try {
        const result = await window.electronAPI.sftp.downloadFile(props.connectionId, file.path, localPath)
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
      }
    }
    
    if (failCount === 0) {
      ElMessage.success(`成功下载 ${successCount} 个文件`)
    } else {
      ElMessage.warning(`下载完成：成功 ${successCount} 个，失败 ${failCount} 个`)
    }
  } catch (error: any) {
    ElMessage.error('下载失败: ' + error.message)
  }
}

// 多选删除
const handleDeleteMultiple = async () => {
  hideContextMenu()
  
  const selected = getSelectedFiles()
  if (selected.length === 0) return
  
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selected.length} 个项目吗？此操作不可恢复！`,
      '批量删除',
      { type: 'warning' }
    )
    
    let successCount = 0
    let failCount = 0
    
    for (const file of selected) {
      try {
        const result = await window.electronAPI.sftp.deleteFile(props.connectionId, file.path)
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
      }
    }
    
    if (failCount === 0) {
      ElMessage.success(`成功删除 ${successCount} 个项目`)
    } else {
      ElMessage.warning(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`)
    }
    
    refreshDirectory()
  } catch (error) {
    // 用户取消
  }
}

// 确认压缩
const confirmCompress = async () => {
  if (!compressOutputName.value.trim()) {
    ElMessage.warning('请输入输出文件名')
    return
  }
  
  compressing.value = true
  const selected = getSelectedFiles()
  const isMultiple = selected.length > 1
  
  // 如果是单选，使用 contextMenuFile；如果是多选，使用 selected
  const filesToCompress = isMultiple ? selected : (contextMenuFile.value ? [contextMenuFile.value] : [])
  
  if (filesToCompress.length === 0) {
    ElMessage.warning('没有选中的文件')
    compressing.value = false
    return
  }
  
  try {
    // 根据格式构建压缩命令
    let command = ''
    const sourceNames = filesToCompress.map(f => `"${f.name}"`).join(' ')
    
    switch (compressFormat.value) {
      case 'tar.gz':
        command = `cd "${currentPath.value}" && tar -czvf "${compressOutputName.value}" ${sourceNames}`
        break
      case 'tar':
        command = `cd "${currentPath.value}" && tar -cvf "${compressOutputName.value}" ${sourceNames}`
        break
      case 'tar.bz2':
        command = `cd "${currentPath.value}" && tar -cjvf "${compressOutputName.value}" ${sourceNames}`
        break
      case 'tar.xz':
        command = `cd "${currentPath.value}" && tar -cJvf "${compressOutputName.value}" ${sourceNames}`
        break
      case 'zip':
        command = `cd "${currentPath.value}" && zip -r "${compressOutputName.value}" ${sourceNames}`
        break
      default:
        command = `cd "${currentPath.value}" && tar -czvf "${compressOutputName.value}" ${sourceNames}`
    }
    
    const msg = isMultiple ? `正在压缩 ${filesToCompress.length} 个项目...` : `正在压缩 ${filesToCompress[0].name}...`
    ElMessage.info(msg)
    
    // 通过 SSH 执行压缩命令
    const result = await window.electronAPI.ssh.executeCommand(props.connectionId, command, 60000)
    
    if (result.success) {
      ElMessage.success('压缩完成')
      showCompressDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error('压缩失败: ' + (result.error || '未知错误'))
    }
  } catch (error: any) {
    ElMessage.error('压缩失败: ' + error.message)
  } finally {
    compressing.value = false
  }
}

// 解压文件
const handleExtract = () => {
  if (!contextMenuFile.value || !isCompressedFile(contextMenuFile.value)) return
  hideContextMenu()
  
  extractTarget.value = 'current'
  extractCustomPath.value = currentPath.value
  showExtractDialog.value = true
}

// 确认解压
const confirmExtract = async () => {
  if (!contextMenuFile.value) return
  
  extracting.value = true
  const file = contextMenuFile.value
  const fileName = file.name.toLowerCase()
  
  try {
    // 确定解压目标目录
    let targetDir = currentPath.value
    if (extractTarget.value === 'subfolder') {
      const baseName = getBaseName(file.name)
      targetDir = currentPath.value === '/' ? '/' + baseName : currentPath.value + '/' + baseName
      // 先创建目录
      await window.electronAPI.ssh.executeCommand(props.connectionId, `mkdir -p "${targetDir}"`, 10000)
    } else if (extractTarget.value === 'custom') {
      targetDir = extractCustomPath.value || currentPath.value
      // 确保目录存在
      await window.electronAPI.ssh.executeCommand(props.connectionId, `mkdir -p "${targetDir}"`, 10000)
    }
    
    // 根据文件类型构建解压命令（默认覆盖同名文件）
    let command = ''
    
    if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
      command = `tar -xzvf "${file.path}" -C "${targetDir}"`
    } else if (fileName.endsWith('.tar.bz2')) {
      command = `tar -xjvf "${file.path}" -C "${targetDir}"`
    } else if (fileName.endsWith('.tar.xz')) {
      command = `tar -xJvf "${file.path}" -C "${targetDir}"`
    } else if (fileName.endsWith('.tar')) {
      command = `tar -xvf "${file.path}" -C "${targetDir}"`
    } else if (fileName.endsWith('.zip')) {
      command = `unzip -o "${file.path}" -d "${targetDir}"`
    } else if (fileName.endsWith('.gz') && !fileName.endsWith('.tar.gz')) {
      command = `gunzip -c "${file.path}" > "${targetDir}/${getBaseName(file.name)}"`
    } else if (fileName.endsWith('.bz2') && !fileName.endsWith('.tar.bz2')) {
      command = `bunzip2 -c "${file.path}" > "${targetDir}/${getBaseName(file.name)}"`
    } else if (fileName.endsWith('.xz') && !fileName.endsWith('.tar.xz')) {
      command = `unxz -c "${file.path}" > "${targetDir}/${getBaseName(file.name)}"`
    } else if (fileName.endsWith('.rar')) {
      command = `unrar x -o+ "${file.path}" "${targetDir}/"`
    } else if (fileName.endsWith('.7z')) {
      command = `7z x -aoa "${file.path}" -o"${targetDir}"`
    } else {
      ElMessage.error('不支持的压缩格式')
      extracting.value = false
      return
    }
    
    ElMessage.info(`正在解压 ${file.name}...`)
    
    // 通过 SSH 执行解压命令
    const result = await window.electronAPI.ssh.executeCommand(props.connectionId, command, 120000)
    
    if (result.success) {
      ElMessage.success('解压完成')
      showExtractDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error('解压失败: ' + (result.error || '未知错误'))
    }
  } catch (error: any) {
    ElMessage.error('解压失败: ' + error.message)
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

// 预览文件
const handlePreview = async () => {
  if (!contextMenuFile.value || contextMenuFile.value.type !== 'file') return
  hideContextMenu()
  
  const file = contextMenuFile.value
  previewLoading.value = true
  previewContent.value = ''
  previewImageSrc.value = ''
  showPreviewDialog.value = true
  
  try {
    // 判断是否为图片文件
    if (isImageFile(file.name)) {
      // 检查图片大小，超过限制则提示下载
      if (file.size > IMAGE_PREVIEW_SIZE_LIMIT) {
        previewType.value = 'text'
        previewContent.value = `图片文件过大（${formatSize(file.size)}），超过预览限制（10MB）。\n请右键下载后使用本地图片查看器打开。`
        previewLoading.value = false
        return
      }
      
      previewType.value = 'image'
      // 使用 readFileBuffer 读取二进制数据
      const result = await window.electronAPI.sftp.readFileBuffer(props.connectionId, file.path)
      if (result.success && result.data) {
        // 将 Buffer 转换为 base64
        const base64 = result.data
        const mimeType = getImageMimeType(file.name)
        previewImageSrc.value = `data:${mimeType};base64,${base64}`
      } else {
        previewType.value = 'text'
        previewContent.value = `读取失败: ${result.error}`
      }
    } else {
      previewType.value = 'text'
      const result = await window.electronAPI.sftp.readFile(props.connectionId, file.path)
      if (result.success) {
        previewContent.value = result.data || ''
      } else {
        previewContent.value = `读取失败: ${result.error}`
      }
    }
  } catch (error: any) {
    previewType.value = 'text'
    previewContent.value = `读取失败: ${error.message}`
  } finally {
    previewLoading.value = false
  }
}

// 编辑文件
const handleEdit = async () => {
  if (!contextMenuFile.value || contextMenuFile.value.type !== 'file') return
  hideContextMenu()
  
  const file = contextMenuFile.value
  
  // 检查文件大小，超过 5MB 不建议在线编辑
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('文件过大（超过 5MB），建议下载后使用本地编辑器编辑')
    return
  }
  
  // 检查是否为二进制文件（通过扩展名判断）
  const binaryExtensions = ['.exe', '.dll', '.so', '.bin', '.img', '.iso', '.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.mp3', '.mp4', '.avi', '.mkv', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
  if (binaryExtensions.includes(ext)) {
    ElMessage.warning('二进制文件不支持在线编辑')
    return
  }
  
  editLoading.value = true
  editContent.value = ''
  editingFilePath.value = file.path
  showEditDialog.value = true
  
  try {
    const result = await window.electronAPI.sftp.readFile(props.connectionId, file.path)
    if (result.success) {
      editContent.value = result.data || ''
    } else {
      ElMessage.error(`读取失败: ${result.error}`)
      showEditDialog.value = false
    }
  } catch (error: any) {
    ElMessage.error(`读取失败: ${error.message}`)
    showEditDialog.value = false
  } finally {
    editLoading.value = false
  }
}

// 保存编辑的文件
const saveEditedFile = async () => {
  if (!editingFilePath.value) return
  
  editSaving.value = true
  try {
    const result = await window.electronAPI.sftp.writeFile(
      props.connectionId,
      editingFilePath.value,
      editContent.value
    )
    
    if (result.success) {
      ElMessage.success('保存成功')
      showEditDialog.value = false
      refreshDirectory()
    } else {
      ElMessage.error(result.error || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error('保存失败: ' + error.message)
  } finally {
    editSaving.value = false
  }
}

// SFTP 初始化状态
const sftpInitialized = ref(false)

// 获取初始目录（优先使用终端当前目录，否则根据用户名判断）
const getInitialPath = () => {
  if (props.currentDir && props.currentDir.trim()) {
    // 处理 ~ 开头的路径
    if (props.currentDir.startsWith('~')) {
      // 根据用户名确定 home 目录
      const homeDir = props.username === 'root' ? '/root' : `/home/${props.username || 'root'}`
      return props.currentDir.replace('~', homeDir)
    }
    return props.currentDir
  }
  // 根据用户名判断默认目录：root 用户打开 /root，其他用户打开 /home/用户名
  if (props.username && props.username !== 'root') {
    return `/home/${props.username}`
  }
  return '/root'
}

// 初始化 SFTP 连接
const initSFTP = async () => {
  if (sftpInitialized.value) return true
  
  loading.value = true
  try {
    await window.electronAPI.sftp.init(props.connectionId)
    sftpInitialized.value = true
    return true
  } catch (error: any) {
    ElMessage.error('SFTP 初始化失败: ' + error.message)
    return false
  } finally {
    loading.value = false
  }
}

// 点击外部关闭右键菜单
onMounted(async () => {
  document.addEventListener('click', hideContextMenu)
  // 先初始化 SFTP，然后加载目录（优先使用终端当前目录）
  const initialized = await initSFTP()
  if (initialized) {
    const initialPath = getInitialPath()
    loadDirectory(initialPath)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu)
})

// 是否需要同步到终端目录
const pendingSync = ref(false)

// 监听 connectionId 变化，重新初始化和加载
watch(() => props.connectionId, async () => {
  sftpInitialized.value = false
  pathHistory.value = []
  const initialized = await initSFTP()
  if (initialized) {
    const initialPath = getInitialPath()
    loadDirectory(initialPath)
  }
})

// 监听 currentDir 变化，如果有待同步请求则执行同步
watch(() => props.currentDir, (newDir) => {
  if (pendingSync.value && newDir) {
    pendingSync.value = false
    const targetPath = getInitialPath()
    console.log('[TerminalFilePanel] Syncing to:', targetPath)
    if (targetPath !== currentPath.value) {
      pathHistory.value.push(currentPath.value)
      loadDirectory(targetPath)
      ElMessage.success(`已同步到: ${targetPath}`)
    }
  }
})
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

.file-item[draggable="true"] {
  cursor: grab;
}

.file-item[draggable="true"]:active {
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

.file-item:has(.file-icon > .el-icon:first-child[class*="Folder"]) .file-icon {
  color: #f0a020;
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
:root[data-theme="dark"] .context-menu,
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
</style>
