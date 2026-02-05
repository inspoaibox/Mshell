<template>
  <el-dialog
    v-model="visible"
    :title="file?.name || '文件预览'"
    width="80%"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="file-preview">
      <!-- 文本文件预览 -->
      <div v-if="isTextFile" class="text-preview">
        <div class="preview-toolbar">
          <el-button-group>
            <el-button :icon="View" size="small" :type="mode === 'view' ? 'primary' : ''" @click="mode = 'view'">
              查看
            </el-button>
            <el-button :icon="Edit" size="small" :type="mode === 'edit' ? 'primary' : ''" @click="mode = 'edit'">
              编辑
            </el-button>
          </el-button-group>
          <el-select v-model="language" size="small" style="width: 150px; margin-left: 12px">
            <el-option label="自动检测" value="auto" />
            <el-option label="JavaScript" value="javascript" />
            <el-option label="TypeScript" value="typescript" />
            <el-option label="Python" value="python" />
            <el-option label="Java" value="java" />
            <el-option label="C/C++" value="cpp" />
            <el-option label="Shell" value="shell" />
            <el-option label="JSON" value="json" />
            <el-option label="XML" value="xml" />
            <el-option label="HTML" value="html" />
            <el-option label="CSS" value="css" />
            <el-option label="Markdown" value="markdown" />
            <el-option label="纯文本" value="plaintext" />
          </el-select>
        </div>
        <div v-if="mode === 'view'" class="code-viewer">
          <pre><code :class="`language-${language}`">{{ content }}</code></pre>
        </div>
        <div v-else class="code-editor">
          <el-input
            v-model="content"
            type="textarea"
            :rows="20"
            :autosize="{ minRows: 20, maxRows: 30 }"
          />
        </div>
      </div>

      <!-- 图片预览 -->
      <div v-else-if="isImageFile" class="image-preview">
        <img :src="imageUrl" :alt="file?.name" />
      </div>

      <!-- 不支持的文件类型 -->
      <div v-else class="unsupported-preview">
        <el-icon :size="64"><Document /></el-icon>
        <p>不支持预览此类型文件</p>
        <p class="file-info">{{ file?.name }} ({{ formatSize(file?.size || 0) }})</p>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button v-if="isTextFile && mode === 'edit'" type="primary" @click="handleSave" :loading="saving">
        保存
      </el-button>
      <el-button type="success" @click="handleDownload">
        下载
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { View, Edit, Document } from '@element-plus/icons-vue'

interface FileInfo {
  name: string
  path: string
  size: number
  type: 'file' | 'directory'
}

interface Props {
  modelValue: boolean
  file: FileInfo | null
  connectionId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  download: [file: FileInfo]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const content = ref('')
const mode = ref<'view' | 'edit'>('view')
const language = ref('auto')
const saving = ref(false)
const imageUrl = ref('')

// 判断文件类型
const isTextFile = computed(() => {
  if (!props.file) return false
  const ext = props.file.name.split('.').pop()?.toLowerCase()
  const textExtensions = [
    'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'py', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'yml', 'yaml',
    'conf', 'config', 'ini', 'log', 'sql', 'php', 'rb', 'go', 'rs'
  ]
  return textExtensions.includes(ext || '')
})

const isImageFile = computed(() => {
  if (!props.file) return false
  const ext = props.file.name.split('.').pop()?.toLowerCase()
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp']
  return imageExtensions.includes(ext || '')
})

// 自动检测语言
const detectLanguage = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'cpp',
    'cpp': 'cpp',
    'h': 'cpp',
    'hpp': 'cpp',
    'sh': 'shell',
    'bash': 'shell',
    'json': 'json',
    'xml': 'xml',
    'html': 'html',
    'css': 'css',
    'md': 'markdown',
    'yml': 'yaml',
    'yaml': 'yaml'
  }
  return languageMap[ext || ''] || 'plaintext'
}

// 加载文件内容
const loadFile = async () => {
  if (!props.file || !props.connectionId) return

  try {
    if (isTextFile.value) {
      const result = await window.electronAPI.sftp.readFile(props.connectionId, props.file.path)
      if (result.success) {
        content.value = result.data
        if (language.value === 'auto') {
          language.value = detectLanguage(props.file.name)
        }
      } else {
        ElMessage.error(`读取文件失败: ${result.error}`)
      }
    } else if (isImageFile.value) {
      const result = await window.electronAPI.sftp.readFileBuffer(props.connectionId, props.file.path)
      if (result.success) {
        // 将 buffer 转换为 base64 URL
        const base64 = btoa(String.fromCharCode(...new Uint8Array(result.data)))
        const ext = props.file.name.split('.').pop()?.toLowerCase()
        imageUrl.value = `data:image/${ext};base64,${base64}`
      } else {
        ElMessage.error(`读取图片失败: ${result.error}`)
      }
    }
  } catch (error: any) {
    ElMessage.error(`加载文件失败: ${error.message}`)
  }
}

// 保存文件
const handleSave = async () => {
  if (!props.file || !props.connectionId) return

  saving.value = true
  try {
    const result = await window.electronAPI.sftp.writeFile(
      props.connectionId,
      props.file.path,
      content.value
    )
    
    if (result.success) {
      ElMessage.success('文件已保存')
      mode.value = 'view'
    } else {
      ElMessage.error(`保存失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`保存失败: ${error.message}`)
  } finally {
    saving.value = false
  }
}

// 下载文件
const handleDownload = () => {
  if (props.file) {
    emit('download', props.file)
  }
}

// 关闭对话框
const handleClose = () => {
  content.value = ''
  imageUrl.value = ''
  mode.value = 'view'
  language.value = 'auto'
  // 触发 v-model 更新以关闭对话框
  emit('update:modelValue', false)
}

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// 监听文件变化
watch(() => props.file, (newFile) => {
  if (newFile && visible.value) {
    loadFile()
  }
}, { immediate: true })

watch(visible, (newVisible) => {
  if (newVisible && props.file) {
    loadFile()
  }
})
</script>

<style scoped>
.file-preview {
  min-height: 400px;
  max-height: 70vh;
  overflow: auto;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.text-preview {
  width: 100%;
}

.code-viewer {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: 16px;
  overflow: auto;
  max-height: 60vh;
}

.code-viewer pre {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-primary);
}

.code-viewer code {
  font-family: inherit;
}

.code-editor {
  width: 100%;
}

.code-editor :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
}

.image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
}

.image-preview img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.unsupported-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  color: var(--text-tertiary);
}

.unsupported-preview p {
  margin: 12px 0;
}

.file-info {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
