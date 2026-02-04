<template>
  <div class="session-list">
    <!-- 头部区域 -->
    <div class="session-list-header">
      <div class="header-top">
        <h2 class="header-title">会话管理</h2>
        <el-tooltip content="新建分组" placement="bottom">
          <el-button 
            :icon="FolderAdd" 
            circle 
            size="small"
            @click="showGroupDialog = true"
          />
        </el-tooltip>
      </div>
      
      <div class="search-wrapper">
        <el-input
          v-model="searchQuery"
          placeholder="搜索会话..."
          :prefix-icon="Search"
          clearable
          size="large"
        />
      </div>
    </div>
    
    <!-- 会话列表 -->
    <div class="session-groups-container">
      <el-collapse v-model="activeGroups" class="session-collapse">
        <!-- 分组会话 -->
        <el-collapse-item
          v-for="group in filteredGroups"
          :key="group.id"
          :name="group.id"
          class="group-item"
        >
          <template #title>
            <div 
              class="group-header" 
              @contextmenu.prevent.stop="handleGroupContextMenu(group, $event)"
            >
              <div class="group-info">
                <el-icon class="group-icon"><Folder /></el-icon>
                <span class="group-name">{{ group.name }}</span>
              </div>
              <el-tag size="small" round>{{ getGroupSessions(group.id).length }}</el-tag>
            </div>
          </template>
          
          <DroppableGroup
            :group-id="group.id"
            :group-name="group.name"
            @drop="handleSessionDropToGroup"
          >
            <div class="session-items">
              <VirtualList
                v-if="getGroupSessions(group.id).length > 0"
                :items="getGroupSessions(group.id)"
                :item-height="54"
                :buffer="3"
                key-field="id"
              >
                <template #default="{ item: session, index }">
                  <DraggableSessionItem
                    :session-id="session.id"
                    :session-data="session"
                    :index="index"
                    @reorder="(from, to) => handleSessionReorder(group.id, from, to)"
                    @move-to-group="handleSessionDropToGroup"
                  >
                    <div
                      class="session-card"
                      @click="handleSessionClick(session)"
                      @contextmenu.prevent="handleContextMenu(session, $event)"
                    >
                      <div class="session-status">
                        <div class="status-dot"></div>
                      </div>
                      
                      <div class="session-icon" :class="{ 'has-flag': !!getRegionFlag(session.region) }">
                        <span 
                          v-if="getRegionFlag(session.region)" 
                          class="session-flag-icon"
                          v-html="getRegionFlag(session.region)"
                          :title="session.region"
                        ></span>
                        <el-icon v-else :size="20"><Connection /></el-icon>
                      </div>
                      
                      <div class="session-content">
                        <div class="session-name-row">
                          <el-tag 
                            v-if="session.type === 'rdp'" 
                            size="small" 
                            type="warning"
                            effect="plain"
                            class="session-type-tag"
                          >RDP</el-tag>
                          <el-tag 
                            v-else-if="session.type === 'vnc'" 
                            size="small" 
                            type="success"
                            effect="plain"
                            class="session-type-tag"
                          >VNC</el-tag>
                          <span class="session-name">{{ session.name }}</span>
                        </div>
                        <div class="session-details">
                          <span class="detail-item">
                            <el-icon :size="12"><User /></el-icon>
                            {{ session.username || '-' }}
                          </span>
                          <span class="detail-separator">•</span>
                          <span class="detail-item">
                            <el-icon :size="12"><Monitor /></el-icon>
                            {{ session.host }}:{{ session.port }}
                          </span>
                        </div>
                      </div>
                      
                      <div class="session-actions-wrapper">
                        <div v-if="session.expiryDate" class="expiry-info">
                          <el-tag 
                            :type="getExpiryTagType(session.expiryDate)" 
                            size="small"
                            effect="plain"
                            class="expiry-tag"
                          >
                            {{ getExpiryText(session.expiryDate) }}
                          </el-tag>
                        </div>
                      </div>
                    </div>
                  </DraggableSessionItem>
                </template>
              </VirtualList>
            </div>
          </DroppableGroup>
        </el-collapse-item>
        
        <!-- 未分组会话 -->
        <el-collapse-item 
          name="ungrouped" 
          v-if="ungroupedSessions.length > 0"
          class="group-item"
        >
          <template #title>
            <div class="group-header">
              <div class="group-info">
                <el-icon class="group-icon"><Files /></el-icon>
                <span class="group-name">未分组</span>
              </div>
              <el-tag size="small" round>{{ ungroupedSessions.length }}</el-tag>
            </div>
          </template>
          
          <div class="session-items">
            <VirtualList
              v-if="ungroupedSessions.length > 0"
              :items="ungroupedSessions"
              :item-height="54"
              :buffer="3"
              key-field="id"
            >
              <template #default="{ item: session, index }">
                <DraggableSessionItem
                  :session-id="session.id"
                  :session-data="session"
                  :index="index"
                  @reorder="(from, to) => handleSessionReorder('ungrouped', from, to)"
                  @move-to-group="handleSessionDropToGroup"
                >
                  <div
                    class="session-card"
                    @click="handleSessionClick(session)"
                    @contextmenu.prevent="handleContextMenu(session, $event)"
                  >
                    <div class="session-status">
                      <div class="status-dot"></div>
                    </div>
                    
                    <div class="session-icon" :class="{ 'has-flag': !!getRegionFlag(session.region) }">
                      <span 
                        v-if="getRegionFlag(session.region)" 
                        class="session-flag-icon"
                        v-html="getRegionFlag(session.region)"
                        :title="session.region"
                      ></span>
                      <el-icon v-else :size="20"><Connection /></el-icon>
                    </div>
                    
                    <div class="session-content">
                      <div class="session-name-row">
                        <el-tag 
                          v-if="session.type === 'rdp'" 
                          size="small" 
                          type="warning"
                          effect="plain"
                          class="session-type-tag"
                        >RDP</el-tag>
                        <el-tag 
                          v-else-if="session.type === 'vnc'" 
                          size="small" 
                          type="success"
                          effect="plain"
                          class="session-type-tag"
                        >VNC</el-tag>
                        <span class="session-name">{{ session.name }}</span>
                      </div>
                      <div class="session-details">
                        <span class="detail-item">
                          <el-icon :size="12"><User /></el-icon>
                          {{ session.username || '-' }}
                        </span>
                        <span class="detail-separator">•</span>
                        <span class="detail-item">
                          <el-icon :size="12"><Monitor /></el-icon>
                          {{ session.host }}:{{ session.port }}
                        </span>
                      </div>
                    </div>
                    
                    <div class="session-actions-wrapper">
                      <div v-if="session.expiryDate" class="expiry-info">
                        <el-tag 
                          :type="getExpiryTagType(session.expiryDate)" 
                          size="small"
                          effect="plain"
                          class="expiry-tag"
                        >
                          {{ getExpiryText(session.expiryDate) }}
                        </el-tag>
                      </div>
                    </div>
                  </div>
                </DraggableSessionItem>
              </template>
            </VirtualList>
          </div>
        </el-collapse-item>
      </el-collapse>
      
      <!-- 空状态 -->
      <div v-if="filteredSessions.length === 0" class="empty-state">
        <el-icon :size="64" class="empty-icon"><Connection /></el-icon>
        <p class="empty-text">暂无会话</p>
        <p class="empty-hint">点击右上角按钮创建新会话</p>
      </div>
    </div>
    
    <!-- 新建分组对话框 -->
    <el-dialog 
      v-model="showGroupDialog" 
      title="新建分组" 
      width="420px"
      :close-on-click-modal="false"
    >
      <el-form :model="groupForm" label-width="80px" label-position="top">
        <el-form-item label="分组名称">
          <el-input 
            v-model="groupForm.name" 
            placeholder="例如：生产环境" 
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input 
            v-model="groupForm.description" 
            type="textarea" 
            :rows="3" 
            placeholder="可选，简要描述该分组用途"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGroupDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateGroup">创建</el-button>
      </template>
    </el-dialog>
    
    <!-- 重命名分组对话框 -->
    <el-dialog 
      v-model="showRenameDialog" 
      title="重命名分组" 
      width="420px"
      :close-on-click-modal="false"
    >
      <el-input 
        v-model="renameGroupName" 
        placeholder="输入新名称"
        maxlength="50"
        show-word-limit
      />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="handleRenameGroup">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动分组对话框 -->
    <el-dialog
      v-model="showMoveDialog"
      title="移动到分组"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-select v-model="moveGroupId" placeholder="选择分组" style="width: 100%">
        <el-option label="未分组" value="" />
        <el-option
          v-for="group in appStore.groups"
          :key="group.id"
          :label="group.name"
          :value="group.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="showMoveDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmMove">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup lang="ts">
import { ref, computed } from 'vue'
import { 
  Search, Connection, FolderAdd, Folder, Files, User, Monitor 
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAppStore } from '@/stores/app'
import type { SessionConfig, SessionGroup } from '@/types/session'
import * as FlagIcons from 'country-flag-icons/string/3x2'
import VirtualList from '../Common/VirtualList.vue'
import DraggableSessionItem from './DraggableSessionItem.vue'
import DroppableGroup from './DroppableGroup.vue'
import { useLocale } from '@/composables/useLocale'

// 国际化
const { t } = useLocale()

// 使用 store - 不需要 props!
const appStore = useAppStore()

const emit = defineEmits<{
  connect: [session: SessionConfig]
  edit: [session: SessionConfig]
}>()

const searchQuery = ref('')
const activeGroups = ref<string[]>(['ungrouped'])
const showGroupDialog = ref(false)
const showRenameDialog = ref(false)
const showMoveDialog = ref(false)
const moveGroupId = ref('')
const movingSession = ref<SessionConfig | null>(null)
const renameGroupName = ref('')
const currentGroup = ref<SessionGroup | null>(null)
const groupForm = ref({
  name: '',
  description: ''
})

// 计算属性 - 直接从 store 获取数据
const filteredSessions = computed(() => {
  if (!searchQuery.value) return appStore.sessions
  
  const query = searchQuery.value.toLowerCase()
  return appStore.sessions.filter(
    (session) =>
      session.name.toLowerCase().includes(query) ||
      session.host.toLowerCase().includes(query) ||
      session.username.toLowerCase().includes(query) ||
      (session.provider && session.provider.toLowerCase().includes(query)) ||
      (session.region && session.region.toLowerCase().includes(query)) ||
      (session.notes && session.notes.toLowerCase().includes(query))
  )
})

const filteredGroups = computed(() => {
  return appStore.groups
})

const ungroupedSessions = computed(() => {
  const groupedSessionIds = new Set<string>()
  appStore.groups.forEach(group => {
    group.sessions.forEach(sid => groupedSessionIds.add(sid))
  })
  return filteredSessions.value.filter((session) => !groupedSessionIds.has(session.id))
})

const getGroupSessions = (groupId: string) => {
  const group = appStore.groups.find(g => g.id === groupId)
  if (!group) return []
  
  const sessionIds = new Set(group.sessions)
  return filteredSessions.value.filter((session) => sessionIds.has(session.id))
}

const handleSessionClick = (session: SessionConfig) => {
  // 根据会话类型选择不同的连接方式
  if (session.type === 'rdp') {
    // RDP 连接 - 调用外部 mstsc
    connectRDP(session)
  } else if (session.type === 'vnc') {
    // VNC 连接 - 内嵌 noVNC
    emit('connect', session)
  } else {
    // SSH 连接（默认）
    emit('connect', session)
  }
}

// RDP 连接
const connectRDP = async (session: SessionConfig) => {
  try {
    ElMessage.info(`正在启动 RDP 连接到 ${session.host}...`)
    
    const rdpConfig = {
      id: session.id,
      host: session.host,
      port: session.port || 3389,
      username: session.username,
      password: session.password,
      ...(session.rdpOptions || {})
    }
    
    const result = await window.electronAPI.rdp.connect(rdpConfig)
    
    if (result.success) {
      ElMessage.success('RDP 连接已启动')
      // 更新使用次数和最后连接时间
      await appStore.updateSession(session.id, {
        usageCount: (session.usageCount || 0) + 1,
        lastConnected: new Date()
      })
    } else {
      ElMessage.error(`RDP 连接失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`RDP 连接失败: ${error.message}`)
  }
}

const handleDelete = async (session: SessionConfig) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除会话 "${session.name}" 吗？此操作不可恢复。`,
      '确认删除',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消'
      }
    )

    await appStore.deleteSession(session.id)
    ElMessage.success('会话已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`删除失败: ${error.message}`)
    }
  }
}

const handleContextMenu = async (session: SessionConfig, event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  const items = [
    { label: '连接', action: 'connect' },
    { type: 'separator' },
    { label: '编辑', action: 'edit' },
    { label: '复制会话', action: 'copy' },
    { label: '移动到分组...', action: 'move' },
    { type: 'separator' },
    { label: '删除', action: 'delete' }
  ]
  
  try {
    const action = await window.electronAPI.dialog.showContextMenu(items)
    if (action === 'connect') emit('connect', session)
    if (action === 'edit') emit('edit', session)
    if (action === 'copy') handleCopy(session)
    if (action === 'move') handleMove(session)
    if (action === 'delete') handleDelete(session)
  } catch (error) {
    // Ignore cancelled
  }
}

const handleCopy = async (session: SessionConfig) => {
  try {
    const { id, createdAt, updatedAt, ...rest } = session
    const newSession = {
      ...rest,
      name: `${session.name} (副本)`,
    }
    await appStore.createSession(newSession)
    ElMessage.success('会话已复制')
  } catch (err: any) {
    ElMessage.error(err.message)
  }
}

const handleMove = (session: SessionConfig) => {
  movingSession.value = session
  moveGroupId.value = session.group || ''
  showMoveDialog.value = true
}

const confirmMove = async () => {
  if (!movingSession.value) return
  try {
    await appStore.updateSession(movingSession.value.id, { 
      group: moveGroupId.value || undefined 
    }) 
    ElMessage.success('移动成功')
    showMoveDialog.value = false
  } catch (err: any) {
    ElMessage.error(err.message)
  }
}

const getExpiryText = (expiryDate: Date | string): string => {
  const expiry = new Date(expiryDate)
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  
  if (diffMs < 0) {
    return '已过期'
  } else if (diffDays === 0) {
    return `今天到期 (${diffHours}小时)`
  } else if (diffDays < 7) {
    return `${diffDays}天${diffHours}小时后到期`
  } else if (diffDays < 30) {
    return `${diffDays}天后到期`
  } else {
    const months = Math.floor(diffDays / 30)
    return `${months}个月后到期`
  }
}

const getExpiryTagType = (expiryDate: Date | string): 'success' | 'warning' | 'danger' | 'info' => {
  const expiry = new Date(expiryDate)
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffMs < 0) {
    return 'danger'
  } else if (diffDays <= 7) {
    return 'danger'
  } else if (diffDays <= 30) {
    return 'warning'
  } else {
    return 'success'
  }
}

const getRegionFlag = (region?: string) => {
  if (!region) return ''
  
  const map: Record<string, string> = {
    '香港': 'HK', 'Hong Kong': 'HK', 'HK': 'HK',
    '美国': 'US', 'USA': 'US', 'US': 'US', 'Los Angeles': 'US', '洛杉矶': 'US',
    '日本': 'JP', 'Japan': 'JP', 'JP': 'JP', 'Tokyo': 'JP', '东京': 'JP',
    '新加坡': 'SG', 'Singapore': 'SG', 'SG': 'SG',
    '韩国': 'KR', 'Korea': 'KR', 'KR': 'KR', 'Seoul': 'KR',
    '中国': 'CN', 'China': 'CN', 'CN': 'CN', '上海': 'CN', '北京': 'CN',
    '德国': 'DE', 'Germany': 'DE', 'DE': 'DE', 'Frankfurt': 'DE',
    '英国': 'GB', 'UK': 'GB', 'GB': 'GB', 'London': 'GB',
    '法国': 'FR', 'France': 'FR', 'FR': 'FR',
    '俄罗斯': 'RU', 'Russia': 'RU', 'RU': 'RU',
    '加拿大': 'CA', 'Canada': 'CA', 'CA': 'CA'
  }
  
  let code = map[region] || (region.length === 2 ? region.toUpperCase() : undefined)
  
  if (!code) {
    const key = Object.keys(map).find(k => region.includes(k))
    if (key) code = map[key]
  }
  
  if (code && (FlagIcons as any)[code]) {
    return (FlagIcons as any)[code]
  }
  
  return ''
}

const handleCreateGroup = async () => {
  if (!groupForm.value.name.trim()) {
    ElMessage.warning('请输入分组名称')
    return
  }
  
  try {
    await appStore.createGroup(groupForm.value.name, groupForm.value.description || undefined)
    ElMessage.success('分组已创建')
    groupForm.value = { name: '', description: '' }
    showGroupDialog.value = false
  } catch (error: any) {
    ElMessage.error(`创建分组失败: ${error.message}`)
  }
}

const handleGroupContextMenu = async (group: SessionGroup, event: MouseEvent) => {
  event.stopPropagation()
  
  const menuItems = [
    { label: '重命名', action: 'rename' },
    { label: '删除', action: 'delete' }
  ]
  
  try {
    const result = await window.electronAPI.dialog.showContextMenu(menuItems)
    
    if (result === 'rename') {
      currentGroup.value = group
      renameGroupName.value = group.name
      showRenameDialog.value = true
    } else if (result === 'delete') {
      const sessions = getGroupSessions(group.id)
      const message = sessions.length > 0 
        ? `分组 "${group.name}" 中有 ${sessions.length} 个会话，删除后会话将移至未分组。确定删除吗？`
        : `确定删除分组 "${group.name}" 吗？`
      
      await ElMessageBox.confirm(message, '确认删除', { type: 'warning' })
      await appStore.deleteGroup(group.id)
      ElMessage.success('分组已删除')
    }
  } catch (error) {
    // 用户取消
  }
}

const handleRenameGroup = async () => {
  if (!renameGroupName.value.trim() || !currentGroup.value) {
    ElMessage.warning('请输入分组名称')
    return
  }
  
  try {
    await appStore.renameGroup(currentGroup.value.id, renameGroupName.value)
    ElMessage.success('分组已重命名')
    showRenameDialog.value = false
    currentGroup.value = null
    renameGroupName.value = ''
  } catch (error: any) {
    ElMessage.error(`重命名失败: ${error.message}`)
  }
}

// 处理会话拖拽排序
const handleSessionReorder = async (groupId: string, fromIndex: number, toIndex: number) => {
  console.log('[SessionList] Reordering sessions in group:', groupId, fromIndex, '->', toIndex)
  
  try {
    // 获取该分组的所有会话
    const sessions = getGroupSessions(groupId)
    
    if (fromIndex < 0 || fromIndex >= sessions.length || toIndex < 0 || toIndex >= sessions.length) {
      console.error('Invalid index for reordering')
      return
    }
    
    // 重新排序
    const [movedSession] = sessions.splice(fromIndex, 1)
    sessions.splice(toIndex, 0, movedSession)
    
    // 更新每个会话的 sortOrder
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]
      await appStore.updateSession(session.id, { sortOrder: i })
    }
    
    // 重新加载会话列表以反映更改
    await appStore.loadSessions()
    
    ElMessage.success('会话已重新排序')
  } catch (error: any) {
    console.error('Failed to reorder sessions:', error)
    ElMessage.error(`排序失败: ${error.message}`)
  }
}

// 处理会话拖拽到分组
const handleSessionDropToGroup = async (sessionId: string, groupId: string) => {
  console.log('[SessionList] Moving session to group:', sessionId, '->', groupId)
  try {
    await appStore.updateSession(sessionId, { group: groupId || undefined })
    ElMessage.success('会话已移动到新分组')
  } catch (error: any) {
    ElMessage.error(`移动失败: ${error.message}`)
  }
}
</script>


<style scoped>
.session-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  transition: background-color var(--transition-normal);
}

.session-list-header {
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-secondary);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.header-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.search-wrapper {
  position: relative;
}

.session-groups-container {
  flex: 1;
  overflow-y: auto;
  padding: 5px; /* 统一为5px */
}

.session-collapse {
  border: none;
  --el-collapse-header-bg-color: transparent;
  --el-collapse-content-bg-color: transparent;
  --el-collapse-border-color: transparent;
}

.group-item {
  margin: 5px; /* 统一为5px */
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  transition: all var(--transition-fast);
  width: calc(100% - 10px); /* 减去左右margin */
  box-sizing: border-box;
}

.group-item:hover {
  border-color: var(--border-medium);
  box-shadow: var(--shadow-sm);
}

.session-groups-container :deep(.el-collapse-item__header) {
  height: 40px;
  line-height: 40px;
  padding: 0 8px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  background: transparent;
  transition: all var(--transition-fast);
}

.session-groups-container :deep(.el-collapse-item__header:hover) {
  background: var(--bg-hover);
}

.session-groups-container :deep(.el-collapse-item__wrap) {
  border: none;
  background: transparent;
}

.session-groups-container :deep(.el-collapse-item__content) {
  padding: 5px; /* 统一为5px */
}

.session-groups-container :deep(.el-collapse-item__arrow) {
  color: var(--text-tertiary);
  transition: transform var(--transition-normal);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 8px;
}

.group-info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}

.group-icon {
  color: var(--primary-color);
  font-size: 14px;
}

.group-name {
  font-weight: 600;
  font-size: 13px;
}

.session-items {
  display: flex;
  flex-direction: column;
  padding: 5px; /* 统一为5px */
  max-height: 600px;
  width: 100%;
}

.session-items :deep(.virtual-scroll) {
  padding: 0;
  width: 100%;
}

.session-items :deep(.virtual-scroll-item) {
  padding: 0;
  width: 100%;
}

.session-card {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin: 5px; /* 统一为5px */
  width: calc(100% - 10px); /* 减去左右margin */
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.session-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px; /* 减小宽度 */
  background: var(--primary-color);
  transform: scaleY(0);
  transition: transform var(--transition-fast);
}

.session-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  transform: translateX(2px); /* 减少移动距离 */
  box-shadow: var(--shadow-md);
}

.session-card:hover::before {
  transform: scaleY(1);
}

.session-card:active {
  transform: translateX(1px); /* 减少移动距离 */
}

.session-status {
  margin-right: 4px; /* 减少间距 */
}

.status-dot {
  width: 4px; /* 减小尺寸 */
  height: 4px; /* 减小尺寸 */
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: all var(--transition-fast);
}

.session-card:hover .status-dot {
  background: var(--success-color);
  box-shadow: 0 0 8px var(--success-color);
}

.session-icon {
  width: 24px;
  height: 24px;
  background: var(--bg-main);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.session-card:hover .session-icon {
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  color: white;
  transform: scale(1.05);
}

.session-icon.has-flag {
  background: transparent;
}

.session-flag-icon {
  width: 18px; /* 减小尺寸 */
  height: 13px; /* 减小尺寸 */
  display: flex !important;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.session-flag-icon :deep(svg) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.session-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px; /* 减少间距 */
}

.session-name-row {
  display: flex;
  align-items: center;
  margin-bottom: 1px; /* 减少间距 */
  gap: 4px;
}

.session-type-tag {
  flex-shrink: 0;
  font-size: 9px !important;
  height: 14px;
  line-height: 14px;
  padding: 0 4px;
}

.session-name {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.2px;
  line-height: 1.3;
}

.session-actions-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  align-self: flex-start;
  gap: 2px; /* 减少间距 */
  margin-left: 4px; /* 减少间距 */
  padding-top: 0; /* 移除顶部padding */
}

.expiry-info {
  display: flex;
  justify-content: flex-end;
}

.expiry-tag {
  flex-shrink: 0;
  font-size: 9px !important;
  height: 15px; /* 减小高度 */
  line-height: 15px; /* 减小高度 */
  padding: 0 4px; /* 减少内边距 */
}

.session-details {
  display: flex;
  align-items: center;
  gap: 3px; /* 减少间距 */
  font-size: 10px;
  color: var(--text-tertiary);
  line-height: 1.2;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 3px; /* 减少间距 */
}

.detail-separator {
  color: var(--text-disabled);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  text-align: center;
  min-height: 300px;
}

.empty-icon {
  color: var(--text-disabled);
  margin-bottom: var(--spacing-lg);
  opacity: 0.5;
}

.empty-text {
  font-size: var(--text-lg);
  color: var(--text-secondary);
  font-weight: 600;
  margin: 0 0 var(--spacing-sm) 0;
}

.empty-hint {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin: 0;
}

@media (max-width: 768px) {
  .session-list-header {
    padding: 8px 6px; /* 减少padding */
  }
  
  .session-card {
    padding: 5px 6px; /* 移动端更紧凑 */
  }
  
  .session-icon {
    width: 22px;
    height: 22px;
  }
}

.session-card {
  animation: none;
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
