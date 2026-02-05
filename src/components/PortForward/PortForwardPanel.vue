<template>
  <div class="port-forward-panel">
    <div class="panel-header">
      <h3>端口转发管理</h3>
      <el-button type="primary" :icon="Plus" @click="showAddDialog = true">
        添加转发
      </el-button>
    </div>

    <div class="forward-list">
      <el-table :data="forwards" style="width: 100%" v-loading="loading">
        <el-table-column label="类型" prop="type" width="120">
          <template #default="{ row }">
            <el-tag :type="getTypeTagType(row.type)">
              {{ getTypeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="本地地址" width="200">
          <template #default="{ row }">
            {{ row.localHost }}:{{ row.localPort }}
          </template>
        </el-table-column>
        <el-table-column label="远程地址" width="200">
          <template #default="{ row }">
            <span v-if="row.type !== 'dynamic'">
              {{ row.remoteHost }}:{{ row.remotePort }}
            </span>
            <span v-else class="text-muted">SOCKS5 代理</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="描述" prop="description" min-width="200" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'inactive'"
              size="small"
              type="primary"
              @click="startForward(row)"
            >
              启动
            </el-button>
            <el-button
              v-if="row.status === 'active'"
              size="small"
              type="warning"
              @click="stopForward(row)"
            >
              停止
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="deleteForward(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 添加转发对话框 -->
    <el-dialog
      v-model="showAddDialog"
      title="添加端口转发"
      width="600px"
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="转发类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio value="local">本地转发</el-radio>
            <el-radio value="remote">远程转发</el-radio>
            <el-radio value="dynamic">动态转发</el-radio>
          </el-radio-group>
          <div class="form-help">
            <div v-if="form.type === 'local'">
              本地端口 → SSH服务器 → 远程地址
            </div>
            <div v-if="form.type === 'remote'">
              远程端口 → SSH服务器 → 本地地址
            </div>
            <div v-if="form.type === 'dynamic'">
              本地SOCKS5代理 → SSH服务器 → 任意地址
            </div>
          </div>
        </el-form-item>

        <el-form-item label="本地主机" prop="localHost">
          <el-input v-model="form.localHost" placeholder="127.0.0.1" />
        </el-form-item>

        <el-form-item label="本地端口" prop="localPort">
          <el-input-number
            v-model="form.localPort"
            :min="1"
            :max="65535"
            placeholder="8080"
          />
        </el-form-item>

        <template v-if="form.type !== 'dynamic'">
          <el-form-item label="远程主机" prop="remoteHost">
            <el-input v-model="form.remoteHost" placeholder="localhost" />
          </el-form-item>

          <el-form-item label="远程端口" prop="remotePort">
            <el-input-number
              v-model="form.remotePort"
              :min="1"
              :max="65535"
              placeholder="3306"
            />
          </el-form-item>
        </template>

        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="例如：MySQL数据库转发"
          />
        </el-form-item>

        <el-form-item label="自动启动">
          <el-switch v-model="form.autoStart" />
          <span class="form-help">连接SSH时自动启动此转发</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAdd">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

interface PortForward {
  id: string
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  status: 'active' | 'inactive' | 'error'
  description?: string
  autoStart?: boolean
}

interface Props {
  connectionId: string
}

const props = defineProps<Props>()

const forwards = ref<PortForward[]>([])
const loading = ref(false)
const showAddDialog = ref(false)
const formRef = ref()

const form = ref({
  type: 'local' as 'local' | 'remote' | 'dynamic',
  localHost: '127.0.0.1',
  localPort: 8080,
  remoteHost: 'localhost',
  remotePort: 3306,
  description: '',
  autoStart: false
})

const rules = {
  type: [{ required: true, message: '请选择转发类型', trigger: 'change' }],
  localHost: [{ required: true, message: '请输入本地主机', trigger: 'blur' }],
  localPort: [{ required: true, message: '请输入本地端口', trigger: 'blur' }],
  remoteHost: [
    {
      required: true,
      message: '请输入远程主机',
      trigger: 'blur',
      validator: (_rule: any, value: any, callback: any) => {
        if (form.value.type === 'dynamic') {
          callback()
        } else if (!value) {
          callback(new Error('请输入远程主机'))
        } else {
          callback()
        }
      }
    }
  ],
  remotePort: [
    {
      required: true,
      message: '请输入远程端口',
      trigger: 'blur',
      validator: (_rule: any, value: any, callback: any) => {
        if (form.value.type === 'dynamic') {
          callback()
        } else if (!value) {
          callback(new Error('请输入远程端口'))
        } else {
          callback()
        }
      }
    }
  ]
}

onMounted(() => {
  loadForwards()
})

const loadForwards = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.portForward.getAll(props.connectionId)
    if (result.success) {
      forwards.value = result.forwards || []
    }
  } catch (error: any) {
    ElMessage.error(`加载转发列表失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

const handleAdd = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return

    try {
      const forwardData = {
        type: form.value.type,
        localHost: form.value.localHost,
        localPort: form.value.localPort,
        remoteHost: form.value.remoteHost,
        remotePort: form.value.remotePort,
        description: form.value.description,
        autoStart: form.value.autoStart
      }

      const result = await window.electronAPI.portForward.add(
        props.connectionId,
        forwardData
      )

      if (result.success) {
        ElMessage.success('添加转发成功')
        showAddDialog.value = false
        await loadForwards()
      } else {
        ElMessage.error(`添加转发失败: ${result.error}`)
      }
    } catch (error: any) {
      ElMessage.error(`添加转发失败: ${error.message}`)
    }
  })
}

const startForward = async (forward: PortForward) => {
  try {
    const result = await window.electronAPI.portForward.start(
      props.connectionId,
      forward.id
    )

    if (result.success) {
      ElMessage.success('启动转发成功')
      await loadForwards()
    } else {
      ElMessage.error(`启动转发失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`启动转发失败: ${error.message}`)
  }
}

const stopForward = async (forward: PortForward) => {
  try {
    const result = await window.electronAPI.portForward.stop(
      props.connectionId,
      forward.id
    )

    if (result.success) {
      ElMessage.success('停止转发成功')
      await loadForwards()
    } else {
      ElMessage.error(`停止转发失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`停止转发失败: ${error.message}`)
  }
}

const deleteForward = async (forward: PortForward) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除转发 ${forward.localHost}:${forward.localPort} 吗？`,
      '确认删除',
      { type: 'warning' }
    )

    const result = await window.electronAPI.portForward.delete(
      props.connectionId,
      forward.id
    )

    if (result.success) {
      ElMessage.success('删除转发成功')
      await loadForwards()
    } else {
      ElMessage.error(`删除转发失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`删除转发失败: ${error.message}`)
    }
  }
}

const resetForm = () => {
  form.value = {
    type: 'local',
    localHost: '127.0.0.1',
    localPort: 8080,
    remoteHost: 'localhost',
    remotePort: 3306,
    description: '',
    autoStart: false
  }
  formRef.value?.resetFields()
}

const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    local: '本地转发',
    remote: '远程转发',
    dynamic: '动态转发'
  }
  return labels[type] || type
}

const getTypeTagType = (type: string) => {
  const types: Record<string, any> = {
    local: 'primary',
    remote: 'success',
    dynamic: 'warning'
  }
  return types[type] || ''
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    active: '运行中',
    inactive: '未启动',
    error: '错误'
  }
  return labels[status] || status
}

const getStatusTagType = (status: string) => {
  const types: Record<string, any> = {
    active: 'success',
    inactive: 'info',
    error: 'danger'
  }
  return types[status] || ''
}
</script>

<style scoped>
.port-forward-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
  color: var(--text-primary);
}

.panel-header {
  padding: 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}

.forward-list {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.text-muted {
  color: var(--text-tertiary);
  font-style: italic;
}

.form-help {
  margin-top: 8px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  line-height: 1.5;
}

:deep(.el-table) {
  background: transparent;
  color: var(--text-primary);
}

:deep(.el-table th.el-table__cell) {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

:deep(.el-table tr) {
  background: transparent;
}

:deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid var(--border-light);
}

:deep(.el-table__body tr:hover > td) {
  background: var(--bg-hover) !important;
}
</style>
