<template>
  <div class="ssh-key-panel">
    <div class="panel-header">
      <h2>SSH 密钥管理</h2>
      <div class="header-actions">
        <el-button type="primary" :icon="Plus" @click="showAddDialog = true">
          手动添加
        </el-button>
        <el-button type="primary" :icon="Plus" @click="showGenerateDialog = true">
          生成密钥
        </el-button>
        <el-dropdown @command="handleImportCommand">
          <el-button :icon="Upload">
            导入密钥 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="single">导入单个密钥</el-dropdown-item>
              <el-dropdown-item command="batch">批量导入密钥</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="panel-content">
      <el-table :data="keys" style="width: 100%" v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="getKeyTypeColor(row.type)">{{ row.type.toUpperCase() }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="bits" label="位数" width="80" />
        <el-table-column prop="fingerprint" label="指纹" min-width="200" show-overflow-tooltip />
        <el-table-column prop="protected" label="密码保护" width="100">
          <template #default="{ row }">
            <el-icon v-if="row.protected" color="success"><Lock /></el-icon>
            <el-icon v-else color="info"><Unlock /></el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="usageCount" label="使用次数" width="100" />
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="200">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-tooltip content="复制公钥" placement="top">
                <el-button size="small" :icon="CopyDocument" @click="handleCopyPublicKey(row)" />
              </el-tooltip>
              <el-tooltip content="编辑" placement="top">
                <el-button size="small" :icon="Edit" @click="handleEdit(row)" />
              </el-tooltip>
              <el-tooltip content="导出" placement="top">
                <el-button size="small" :icon="Download" @click="handleExport(row)" />
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)" />
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 手动添加密钥对话框 -->
    <el-dialog v-model="showAddDialog" title="手动添加 SSH 密钥" width="700px">
      <el-form :model="addForm" label-width="100px">
        <el-form-item label="密钥名称">
          <el-input v-model="addForm.name" placeholder="例如: my-server-key" />
        </el-form-item>
        <el-form-item label="私钥内容">
          <el-input 
            v-model="addForm.privateKey" 
            type="textarea" 
            :rows="8"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
          />
        </el-form-item>
        <el-form-item label="公钥内容">
          <el-input 
            v-model="addForm.publicKey" 
            type="textarea" 
            :rows="3"
            placeholder="ssh-rsa AAAAB3NzaC1yc2EA... (可选)"
          />
        </el-form-item>
        <el-form-item label="密码保护">
          <el-input v-model="addForm.passphrase" type="password" placeholder="如果私钥有密码保护，请输入" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="addForm.comment" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="adding">添加</el-button>
      </template>
    </el-dialog>

    <!-- 编辑密钥对话框 -->
    <el-dialog v-model="showEditDialog" title="编辑 SSH 密钥" width="700px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="密钥名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="私钥内容">
          <el-input 
            v-model="editForm.privateKey" 
            type="textarea" 
            :rows="8"
          />
        </el-form-item>
        <el-form-item label="公钥内容">
          <el-input 
            v-model="editForm.publicKey" 
            type="textarea" 
            :rows="3"
          />
        </el-form-item>
        <el-form-item label="密码保护">
          <el-input v-model="editForm.passphrase" type="password" placeholder="如需修改密码请输入" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.comment" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdate" :loading="updating">保存</el-button>
      </template>
    </el-dialog>

    <!-- 生成密钥对话框 -->
    <el-dialog v-model="showGenerateDialog" title="生成 SSH 密钥" width="500px">
      <el-form :model="generateForm" label-width="100px">
        <el-form-item label="密钥名称">
          <el-input v-model="generateForm.name" placeholder="例如: my-server-key" />
        </el-form-item>
        <el-form-item label="密钥类型">
          <el-select v-model="generateForm.type" style="width: 100%">
            <el-option label="RSA" value="rsa" />
            <el-option label="ED25519" value="ed25519" />
            <el-option label="ECDSA" value="ecdsa" />
          </el-select>
        </el-form-item>
        <el-form-item label="密钥长度" v-if="generateForm.type === 'rsa'">
          <el-select v-model="generateForm.bits" style="width: 100%">
            <el-option label="2048 位" :value="2048" />
            <el-option label="3072 位" :value="3072" />
            <el-option label="4096 位" :value="4096" />
          </el-select>
        </el-form-item>
        <el-form-item label="密钥长度" v-if="generateForm.type === 'ecdsa'">
          <el-select v-model="generateForm.bits" style="width: 100%">
            <el-option label="256 位" :value="256" />
            <el-option label="384 位" :value="384" />
            <el-option label="521 位" :value="521" />
          </el-select>
        </el-form-item>
        <el-form-item label="密码保护">
          <el-input v-model="generateForm.passphrase" type="password" placeholder="可选" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="generateForm.comment" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleGenerate" :loading="generating">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Delete, Lock, Unlock, Edit, CopyDocument, ArrowDown } from '@element-plus/icons-vue'

const keys = ref<any[]>([])
const loading = ref(false)
const showGenerateDialog = ref(false)
const showAddDialog = ref(false)
const showEditDialog = ref(false)
const generating = ref(false)
const adding = ref(false)
const updating = ref(false)

const generateForm = ref({
  name: '',
  type: 'rsa',
  bits: 2048,
  passphrase: '',
  comment: ''
})

const addForm = ref({
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: '',
  comment: ''
})

const editForm = ref({
  id: '',
  name: '',
  privateKey: '',
  publicKey: '',
  passphrase: '',
  comment: ''
})

onMounted(() => {
  loadKeys()
})

const loadKeys = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.sshKey?.getAll?.()
    if (result?.success) {
      keys.value = result.data || []
    }
  } catch (error) {
    ElMessage.error('加载密钥列表失败')
  } finally {
    loading.value = false
  }
}

const handleGenerate = async () => {
  if (!generateForm.value.name) {
    ElMessage.warning('请输入密钥名称')
    return
  }

  generating.value = true
  try {
    // 将 Vue Proxy 对象转换为普通对象，避免 IPC 克隆错误
    const options = JSON.parse(JSON.stringify(generateForm.value))
    const result = await window.electronAPI.sshKey?.generate?.(options)
    if (result?.success) {
      ElMessage.success('密钥生成成功')
      showGenerateDialog.value = false
      loadKeys()
      generateForm.value = { name: '', type: 'rsa', bits: 2048, passphrase: '', comment: '' }
    } else {
      ElMessage.error(result?.error || '生成失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '生成失败')
  } finally {
    generating.value = false
  }
}

const handleAdd = async () => {
  if (!addForm.value.name || !addForm.value.privateKey) {
    ElMessage.warning('请输入密钥名称和私钥内容')
    return
  }

  adding.value = true
  try {
    // 将 Vue Proxy 对象转换为普通对象，避免 IPC 克隆错误
    const keyData = JSON.parse(JSON.stringify(addForm.value))
    const result = await window.electronAPI.sshKey?.add?.(keyData)
    if (result?.success) {
      ElMessage.success('密钥添加成功')
      showAddDialog.value = false
      loadKeys()
      addForm.value = { name: '', privateKey: '', publicKey: '', passphrase: '', comment: '' }
    } else {
      ElMessage.error(result?.error || '添加失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '添加失败')
  } finally {
    adding.value = false
  }
}

const handleEdit = async (key: any) => {
  try {
    // 获取私钥内容
    const privateKeyResult = await window.electronAPI.sshKey?.readPrivateKey?.(key.id)
    if (!privateKeyResult?.success) {
      ElMessage.error('获取私钥内容失败')
      return
    }
    
    editForm.value = {
      id: key.id,
      name: key.name,
      privateKey: privateKeyResult.data || '',
      publicKey: key.publicKey || '',
      passphrase: '',
      comment: key.comment || ''
    }
    showEditDialog.value = true
  } catch (error: any) {
    ElMessage.error(error.message || '获取密钥详情失败')
  }
}

const handleUpdate = async () => {
  if (!editForm.value.name || !editForm.value.privateKey) {
    ElMessage.warning('请输入密钥名称和私钥内容')
    return
  }

  updating.value = true
  try {
    // 将 Vue Proxy 对象转换为普通对象，避免 IPC 克隆错误
    const updates = {
      name: editForm.value.name,
      privateKey: editForm.value.privateKey,
      publicKey: editForm.value.publicKey,
      passphrase: editForm.value.passphrase,
      comment: editForm.value.comment
    }
    const result = await window.electronAPI.sshKey?.update?.(editForm.value.id, updates)
    if (result?.success) {
      ElMessage.success('密钥更新成功')
      showEditDialog.value = false
      loadKeys()
    } else {
      ElMessage.error(result?.error || '更新失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    updating.value = false
  }
}

const handleImportCommand = (command: string) => {
  if (command === 'single') {
    handleImportSingle()
  } else if (command === 'batch') {
    handleImportBatch()
  }
}

const handleImportSingle = async () => {
  try {
    const fileResult = await window.electronAPI.sshKey?.selectPrivateKeyFile?.()
    if (fileResult?.canceled) return

    const name = await ElMessageBox.prompt('请输入密钥名称', '导入密钥', {
      inputPattern: /.+/,
      inputErrorMessage: '请输入密钥名称'
    })

    const result = await window.electronAPI.sshKey?.import?.(name.value, fileResult.data)
    if (result?.success) {
      ElMessage.success('导入成功')
      loadKeys()
    } else {
      ElMessage.error(result?.error || '导入失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '导入失败')
    }
  }
}

const handleImportBatch = async () => {
  try {
    const fileResult = await window.electronAPI.sshKey?.selectPrivateKeyFiles?.()
    if (fileResult?.canceled || !fileResult?.data?.length) return

    const files = fileResult.data as string[]
    
    // 显示确认对话框
    await ElMessageBox.confirm(
      `即将导入 ${files.length} 个密钥文件，密钥名称将自动从文件名识别。是否继续？`,
      '批量导入确认',
      { type: 'info' }
    )

    const result = await window.electronAPI.sshKey?.importBatch?.(files)
    if (result?.success) {
      const results = result.data as { success: boolean; name: string; error?: string }[]
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      if (failCount === 0) {
        ElMessage.success(`成功导入 ${successCount} 个密钥`)
      } else {
        // 显示详细结果
        const failedItems = results.filter(r => !r.success)
        ElMessage.warning(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个`)
        
        // 显示失败详情
        if (failedItems.length > 0) {
          const failedNames = failedItems.map(f => `${f.name}: ${f.error}`).join('\n')
          ElMessageBox.alert(failedNames, '导入失败的密钥', { type: 'warning' })
        }
      }
      loadKeys()
    } else {
      ElMessage.error(result?.error || '批量导入失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '批量导入失败')
    }
  }
}

// 保留旧方法名以兼容
const handleImport = handleImportSingle

const handleCopyPublicKey = async (key: any) => {
  try {
    if (!key.publicKey || key.publicKey === 'Public key not available' || key.publicKey === 'Public key not provided') {
      ElMessage.warning('该密钥没有可用的公钥')
      return
    }
    await navigator.clipboard.writeText(key.publicKey)
    ElMessage.success('公钥已复制到剪贴板')
  } catch (error: any) {
    ElMessage.error('复制失败')
  }
}

const handleExport = async (key: any) => {
  try {
    const pathResult = await window.electronAPI.sshKey?.selectExportPath?.(key.name)
    if (pathResult?.canceled) return

    const result = await window.electronAPI.sshKey?.export?.(key.id, pathResult.data)
    if (result?.success) {
      ElMessage.success('导出成功')
    } else {
      ElMessage.error(result?.error || '导出失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '导出失败')
  }
}

const handleDelete = async (key: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除密钥 "${key.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.sshKey?.delete?.(key.id)
    if (result?.success) {
      ElMessage.success('删除成功')
      loadKeys()
    } else {
      ElMessage.error(result?.error || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const getKeyTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    rsa: 'primary',
    ed25519: 'success',
    ecdsa: 'warning'
  }
  return colors[type] || 'info'
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN')
}
</script>

<style scoped>
.ssh-key-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--bg-primary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.panel-header h2 {
  margin: 0;
  font-size: var(--text-2xl);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  min-height: 0;
}

.panel-content :deep(.el-table) {
  width: 100%;
}

.action-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  white-space: nowrap;
}
</style>
