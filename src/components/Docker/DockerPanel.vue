<template>
  <div class="docker-panel">
    <div class="docker-header">
      <div>
        <h3>Docker 管理</h3>
        <p>{{ subtitle }}</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" :loading="loading" @click="loadOverview">刷新</el-button>
        <el-button :icon="Close" link @click="$emit('close')" />
      </div>
    </div>

    <div v-loading="loading || installing || cleaning || actionLoading" class="docker-content">
      <el-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        show-icon
        :closable="false"
      />

      <template v-if="overview">
        <div class="env-summary">
          <div class="env-status-card" :class="{ 'is-ready': overview.environment.installed }">
            <span class="env-status-dot" />
            <div>
              <span class="label">Docker</span>
              <strong>{{ overview.environment.installed ? '已安装' : '未安装' }}</strong>
            </div>
          </div>
          <div class="env-status-card" :class="{ 'is-ready': overview.environment.composeInstalled }">
            <span class="env-status-dot" />
            <div>
              <span class="label">Compose</span>
              <strong>{{ overview.environment.composeInstalled ? '已安装' : '未检测到' }}</strong>
            </div>
          </div>
          <div class="env-detail-card">
            <span class="label">服务状态</span>
            <strong>{{ overview.environment.serviceStatus || 'unknown' }}</strong>
          </div>
          <div class="env-detail-card">
            <span class="label">服务器系统</span>
            <strong :title="osLabel">{{ osLabel }}</strong>
          </div>
        </div>

        <div v-if="overview.environment.dockerVersion" class="version-line">
          {{ overview.environment.dockerVersion }}
          <span v-if="overview.environment.composeVersion"> / {{ overview.environment.composeVersion }}</span>
        </div>

        <el-alert
          v-if="overview.environment.installed && !overview.environment.socketAccessible"
          type="warning"
          title="已检测到 Docker，但当前用户无法访问 Docker Socket。请使用 root、配置 docker 用户组，或允许免密 sudo docker。"
          show-icon
          :closable="false"
        />

        <div v-if="!overview.environment.installed" class="install-box">
          <div>
            <h4>当前服务器未检测到 Docker</h4>
            <p>可尝试使用当前系统包管理器安装 Docker 与 Docker Compose 插件。</p>
          </div>
          <el-button type="primary" :icon="Download" :loading="installing" @click="installDocker">
            一键安装
          </el-button>
        </div>

        <template v-else>
          <div class="container-toolbar">
            <div class="container-title">
              <strong>容器</strong>
              <span>{{ overview.containers.length }} 个</span>
            </div>
            <div class="container-toolbar-actions">
              <el-button
                size="small"
                type="warning"
                plain
                :icon="Delete"
                :loading="cleaning"
                @click="cleanupUnused"
              >
                清理未使用
              </el-button>
              <el-input
                v-model="keyword"
                size="small"
                clearable
                placeholder="搜索容器 / 镜像"
              />
            </div>
          </div>

          <div class="container-stats">
            <button
              type="button"
              class="stat-item is-all"
              :class="{ 'is-active': stateFilter === 'all' }"
              @click="setStateFilter('all')"
            >
              全部 {{ overview.containers.length }}
            </button>
            <button
              type="button"
              class="stat-item is-running"
              :class="{ 'is-active': stateFilter === 'running' }"
              @click="setStateFilter('running')"
            >
              运行 {{ runningCount }}
            </button>
            <button
              type="button"
              class="stat-item is-paused"
              :class="{ 'is-active': stateFilter === 'paused' }"
              @click="setStateFilter('paused')"
            >
              暂停 {{ pausedCount }}
            </button>
            <button
              type="button"
              class="stat-item is-stopped"
              :class="{ 'is-active': stateFilter === 'stopped' }"
              @click="setStateFilter('stopped')"
            >
              停止 {{ stoppedCount }}
            </button>
          </div>

          <el-scrollbar class="container-list">
            <el-empty
              v-if="containerGroups.length === 0"
              description="暂无匹配容器"
            />
            <div
              v-for="group in containerGroups"
              :key="group.key"
              class="container-group"
              :class="{
                'is-compose': group.type === 'compose',
                'is-expanded': isGroupExpanded(group)
              }"
            >
              <div
                class="group-header"
                :class="{ 'is-clickable': group.type === 'compose' }"
                @click="toggleGroup(group)"
              >
                <button
                  v-if="group.type === 'compose'"
                  class="group-toggle"
                  type="button"
                  :aria-label="isGroupExpanded(group) ? '收起项目' : '展开项目'"
                  @click.stop="toggleGroup(group)"
                >
                  <el-icon>
                    <ArrowDown v-if="isGroupExpanded(group)" />
                    <ArrowRight v-else />
                  </el-icon>
                </button>
                <div class="group-title">
                  <span class="group-kind">
                    {{ group.type === 'compose' ? 'Compose 项目' : '独立容器' }}
                  </span>
                  <strong :title="group.name">{{ group.name }}</strong>
                  <span>
                    {{ group.containers.length }} 个容器 · 运行 {{ group.runningCount }} · 暂停 {{ group.pausedCount }} · 停止 {{ group.stoppedCount }}
                  </span>
                </div>
                <div class="group-actions" @click.stop>
                  <el-dropdown
                    v-if="group.type === 'compose'"
                    trigger="click"
                    placement="bottom-end"
                    @command="handleGroupCommand($event, group)"
                  >
                    <el-button
                      class="docker-project-trigger"
                      size="small"
                      :icon="MoreFilled"
                      circle
                      aria-label="项目操作"
                    />
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-if="groupActionCount('start', group) > 0"
                          command="start"
                          :icon="VideoPlay"
                        >
                          启动项目
                        </el-dropdown-item>
                        <el-dropdown-item
                          v-if="groupActionCount('pause', group) > 0"
                          command="pause"
                          :icon="VideoPause"
                        >
                          暂停项目
                        </el-dropdown-item>
                        <el-dropdown-item
                          v-if="groupActionCount('unpause', group) > 0"
                          command="unpause"
                          :icon="VideoPlay"
                        >
                          恢复项目
                        </el-dropdown-item>
                        <el-dropdown-item command="restart" :icon="Refresh">
                          重启项目
                        </el-dropdown-item>
                        <el-dropdown-item
                          v-if="groupActionCount('stop', group) > 0"
                          command="stop"
                          :icon="SwitchButton"
                        >
                          停止项目
                        </el-dropdown-item>
                        <el-dropdown-item command="remove" :icon="Delete" divided>
                          删除项目容器
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>

              <div v-if="isGroupExpanded(group)" class="group-containers">
                <div
                  v-for="container in group.containers"
                  :key="container.id"
                  class="container-card"
                >
                  <div class="container-card-main">
                    <div class="container-heading">
                      <div class="name-cell">
                        <span class="container-name" :title="container.name">
                          {{ container.name }}
                        </span>
                        <span class="container-id">
                          {{ shortId(container.id) }}
                          <template v-if="container.composeService">
                            · {{ container.composeService }}
                          </template>
                        </span>
                      </div>
                      <span class="state-pill" :class="stateClass(container.state)">
                        {{ stateLabel(container.state) }}
                      </span>
                    </div>

                    <div class="image-line" :title="container.image">
                      {{ container.image || '-' }}
                    </div>

                    <div class="container-metrics">
                      <div>
                        <span class="label">CPU</span>
                        <strong>{{ container.cpu || '-' }}</strong>
                      </div>
                      <div>
                        <span class="label">内存</span>
                        <strong>{{ container.memory || '-' }}</strong>
                      </div>
                      <div>
                        <span class="label">端口</span>
                        <strong :title="container.ports">{{ container.ports || '-' }}</strong>
                      </div>
                    </div>
                  </div>

                  <div class="container-card-actions">
                    <el-dropdown
                      trigger="click"
                      placement="bottom-end"
                      @command="handleContainerCommand($event, container)"
                    >
                      <el-button
                        class="docker-action-trigger"
                        size="small"
                        :icon="MoreFilled"
                        circle
                        aria-label="容器操作"
                      />
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-if="container.state !== 'running' && container.state !== 'paused'"
                            command="start"
                            :icon="VideoPlay"
                          >
                            启动
                          </el-dropdown-item>
                          <el-dropdown-item
                            v-if="container.state === 'running'"
                            command="pause"
                            :icon="VideoPause"
                          >
                            暂停
                          </el-dropdown-item>
                          <el-dropdown-item
                            v-if="container.state === 'paused'"
                            command="unpause"
                            :icon="VideoPlay"
                          >
                            恢复
                          </el-dropdown-item>
                          <el-dropdown-item command="restart" :icon="Refresh">
                            重启
                          </el-dropdown-item>
                          <el-dropdown-item
                            v-if="container.state === 'running' || container.state === 'paused'"
                            command="stop"
                            :icon="SwitchButton"
                          >
                            停止
                          </el-dropdown-item>
                          <el-dropdown-item command="remove" :icon="Delete" divided>
                            删除
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </div>
            </div>
          </el-scrollbar>
        </template>
      </template>

      <el-empty v-else-if="!loading" description="暂无 Docker 检测信息" />

      <div v-if="lastOutput" class="output-box">
        <div class="output-title">执行输出</div>
        <pre>{{ lastOutput }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue'
import { ElCheckbox, ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  ArrowRight,
  Close,
  Delete,
  Download,
  MoreFilled,
  Refresh,
  SwitchButton,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue'

type DockerContainerAction = 'start' | 'pause' | 'unpause' | 'restart' | 'stop' | 'remove'

type DockerStateFilter = 'all' | 'running' | 'paused' | 'stopped'

type DockerContainerActionOptions = {
  removeImage?: boolean
  removeNetworks?: boolean
}

interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  createdAt: string
  size: string
  cpu: string
  memory: string
  netIO: string
  composeProject: string
  composeService: string
  composeWorkingDir: string
  composeConfigFiles: string
}

interface DockerContainerGroup {
  key: string
  name: string
  type: 'compose' | 'standalone'
  containers: DockerContainer[]
  runningCount: number
  pausedCount: number
  stoppedCount: number
}

interface DockerOverview {
  environment: {
    installed: boolean
    dockerVersion: string
    composeInstalled: boolean
    composeVersion: string
    serviceStatus: string
    socketAccessible: boolean
    needsSudo: boolean
    os: {
      id: string
      versionId: string
      prettyName: string
      packageManager: string
    }
  }
  containers: DockerContainer[]
}

const props = defineProps<{
  connectionId: string
}>()

defineEmits<{
  close: []
}>()

const overview = ref<DockerOverview | null>(null)
const loading = ref(false)
const installing = ref(false)
const cleaning = ref(false)
const actionLoading = ref(false)
const keyword = ref('')
const errorMessage = ref('')
const lastOutput = ref('')
const expandedProjectKeys = ref<Set<string>>(new Set())
const stateFilter = ref<DockerStateFilter>('all')

const subtitle = computed(() => {
  if (!overview.value) return '检测 Docker 环境与容器状态'
  if (!overview.value.environment.installed) return '未安装 Docker'
  return overview.value.environment.socketAccessible ? 'Docker 可用' : 'Docker 权限受限'
})

const osLabel = computed(() => {
  const os = overview.value?.environment.os
  if (!os) return '-'
  return os.prettyName || [os.id, os.versionId].filter(Boolean).join(' ') || os.packageManager
})

const filteredContainers = computed(() => {
  const list = overview.value?.containers || []
  const query = keyword.value.trim().toLowerCase()
  return list.filter((container) => {
    if (!matchesStateFilter(container)) return false
    if (!query) return true
    return [
      container.name,
      container.image,
      container.status,
      container.id,
      container.composeProject,
      container.composeService
    ]
      .some(value => String(value || '').toLowerCase().includes(query))
  })
})

const matchesStateFilter = (container: DockerContainer) => {
  if (stateFilter.value === 'all') return true
  if (stateFilter.value === 'running') return container.state === 'running'
  if (stateFilter.value === 'paused') return container.state === 'paused'
  return container.state !== 'running' && container.state !== 'paused'
}

const setStateFilter = (filter: DockerStateFilter) => {
  stateFilter.value = stateFilter.value === filter && filter !== 'all' ? 'all' : filter
}

const containerGroups = computed<DockerContainerGroup[]>(() => {
  const groups = new Map<string, DockerContainerGroup>()

  for (const container of filteredContainers.value) {
    const project = (container.composeProject || '').trim()
    const key = project ? `compose:${project}` : `standalone:${container.id}`
    const group = groups.get(key) || {
      key,
      name: project || container.name,
      type: project ? 'compose' as const : 'standalone' as const,
      containers: [],
      runningCount: 0,
      pausedCount: 0,
      stoppedCount: 0
    }

    group.containers.push(container)
    groups.set(key, group)
  }

  const sortedGroups = Array.from(groups.values())
  for (const group of sortedGroups) {
    group.containers.sort((first, second) => {
      const firstName = first.composeService || first.name
      const secondName = second.composeService || second.name
      return firstName.localeCompare(secondName)
    })
    group.runningCount = group.containers.filter(container => container.state === 'running').length
    group.pausedCount = group.containers.filter(container => container.state === 'paused').length
    group.stoppedCount = group.containers.length - group.runningCount - group.pausedCount
  }

  return sortedGroups.sort((first, second) => {
    if (first.type !== second.type) {
      return first.type === 'compose' ? -1 : 1
    }
    return first.name.localeCompare(second.name)
  })
})

const hasActiveKeyword = computed(() => keyword.value.trim().length > 0)

const isGroupExpanded = (group: DockerContainerGroup) => {
  if (group.type !== 'compose') return true
  if (hasActiveKeyword.value) return true
  return expandedProjectKeys.value.has(group.key)
}

const toggleGroup = (group: DockerContainerGroup) => {
  if (group.type !== 'compose') return

  const nextKeys = new Set(expandedProjectKeys.value)
  if (nextKeys.has(group.key)) {
    nextKeys.delete(group.key)
  } else {
    nextKeys.add(group.key)
  }
  expandedProjectKeys.value = nextKeys
}

const runningCount = computed(() =>
  (overview.value?.containers || []).filter(container => container.state === 'running').length
)

const pausedCount = computed(() =>
  (overview.value?.containers || []).filter(container => container.state === 'paused').length
)

const stoppedCount = computed(() =>
  (overview.value?.containers || []).filter(container =>
    container.state !== 'running' && container.state !== 'paused'
  ).length
)

onMounted(() => {
  loadOverview()
})

const loadOverview = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.docker.getOverview(props.connectionId)
    if (result.success && result.data) {
      overview.value = result.data
    } else {
      errorMessage.value = result.error || 'Docker 检测失败'
    }
  } catch (error: any) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const installDocker = async () => {
  await ElMessageBox.confirm(
    '将在当前 SSH 服务器上安装 Docker 和 Docker Compose 插件。安装需要 root 或 sudo 权限，确认继续吗？',
    '安装 Docker',
    { type: 'warning' }
  )

  installing.value = true
  lastOutput.value = ''
  try {
    const result = await window.electronAPI.docker.install(props.connectionId)
    if (result.success) {
      lastOutput.value = result.data || ''
      ElMessage.success('Docker 安装命令已完成')
      await loadOverview()
    } else {
      lastOutput.value = result.error || ''
      ElMessage.error(`Docker 安装失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`Docker 安装失败: ${error.message}`)
    }
  } finally {
    installing.value = false
  }
}

const cleanupUnused = async () => {
  await ElMessageBox.confirm(
    '将清理当前服务器上未使用的 Docker 镜像、卷和构建缓存。正在使用的容器资源不会被删除，确认继续吗？',
    '清理未使用资源',
    {
      type: 'warning',
      confirmButtonText: '开始清理',
      cancelButtonText: '取消'
    }
  )

  cleaning.value = true
  lastOutput.value = ''
  try {
    const result = await window.electronAPI.docker.cleanupUnused(props.connectionId)
    if (result.success) {
      lastOutput.value = result.data || ''
      ElMessage.success('清理完成')
      await loadOverview()
    } else {
      lastOutput.value = result.error || ''
      ElMessage.error(`清理失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`清理失败: ${error.message}`)
    }
  } finally {
    cleaning.value = false
  }
}

const confirmRemoveContainers = async (
  title: string,
  containers: DockerContainer[]
): Promise<DockerContainerActionOptions> => {
  const removeOptions = reactive<DockerContainerActionOptions>({
    removeImage: false,
    removeNetworks: false
  })
  const imageText = Array.from(new Set(containers.map(container => container.image).filter(Boolean)))
    .slice(0, 3)
    .join('、')

  const message = h({
    name: 'DockerRemoveOptionsMessage',
    setup() {
      return () =>
        h('div', { style: 'display:flex;flex-direction:column;gap:10px;line-height:1.5;' }, [
          h('div', [
            `确认删除 ${title} 吗？`,
            h(
              'div',
              { style: 'margin-top:4px;color:var(--text-tertiary);font-size:12px;' },
              `容器：${containers.length} 个；镜像：${imageText || '-'}`
            )
          ]),
          h(
            ElCheckbox,
            {
              modelValue: removeOptions.removeImage,
              'onUpdate:modelValue': (value: boolean | string | number) => {
                removeOptions.removeImage = Boolean(value)
              }
            },
            () => '同时删除镜像文件'
          ),
          h(
            ElCheckbox,
            {
              modelValue: removeOptions.removeNetworks,
              'onUpdate:modelValue': (value: boolean | string | number) => {
                removeOptions.removeNetworks = Boolean(value)
              }
            },
            () => '同时删除关联网络（默认 bridge / host / none 会跳过）'
          )
        ])
    }
  })

  await ElMessageBox({
    title: containers.length > 1 ? '删除项目容器' : '删除容器',
    message,
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    confirmButtonClass: 'el-button--danger'
  })

  return {
    removeImage: Boolean(removeOptions.removeImage),
    removeNetworks: Boolean(removeOptions.removeNetworks)
  }
}

const confirmRemoveContainer = (container: DockerContainer) =>
  confirmRemoveContainers(`容器 "${container.name}"`, [container])

const actionLabels: Record<DockerContainerAction, string> = {
  start: '启动',
  pause: '暂停',
  unpause: '恢复',
  restart: '重启',
  stop: '停止',
  remove: '删除'
}

const isActionTarget = (action: DockerContainerAction, container: DockerContainer) => {
  if (action === 'start') return container.state !== 'running' && container.state !== 'paused'
  if (action === 'pause') return container.state === 'running'
  if (action === 'unpause') return container.state === 'paused'
  if (action === 'stop') return container.state === 'running' || container.state === 'paused'
  return true
}

const getActionTargets = (
  action: DockerContainerAction,
  containers: DockerContainer[]
) => containers.filter(container => isActionTarget(action, container))

const groupActionCount = (
  action: DockerContainerAction,
  group: DockerContainerGroup
) => getActionTargets(action, group.containers).length

const runAction = async (action: DockerContainerAction, container: DockerContainer) => {
  const actionOptions = action === 'remove'
    ? await confirmRemoveContainer(container)
    : undefined

  if (action === 'stop' || action === 'restart') {
    await ElMessageBox.confirm(
      `确认${actionLabels[action]}容器 "${container.name}" 吗？`,
      `${actionLabels[action]}容器`,
      { type: 'info' }
    )
  }

  actionLoading.value = true
  lastOutput.value = ''
  try {
    const result = await window.electronAPI.docker.containerAction(
      props.connectionId,
      action,
      container.id,
      actionOptions
    )

    if (result.success) {
      lastOutput.value = result.data || ''
      ElMessage.success(`${actionLabels[action]}成功`)
      await loadOverview()
    } else {
      lastOutput.value = result.error || ''
      ElMessage.error(`${actionLabels[action]}失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`${actionLabels[action]}失败: ${error.message}`)
    }
  } finally {
    actionLoading.value = false
  }
}

const runGroupAction = async (action: DockerContainerAction, group: DockerContainerGroup) => {
  const targets = getActionTargets(action, group.containers)
  if (targets.length === 0) {
    ElMessage.warning(`当前项目没有可${actionLabels[action]}的容器`)
    return
  }

  const actionOptions = action === 'remove'
    ? await confirmRemoveContainers(`项目 "${group.name}" 的 ${targets.length} 个容器`, targets)
    : undefined

  if (action === 'stop' || action === 'restart') {
    await ElMessageBox.confirm(
      `确认${actionLabels[action]}项目 "${group.name}" 中的 ${targets.length} 个容器吗？`,
      `${actionLabels[action]}项目`,
      { type: 'info' }
    )
  }

  actionLoading.value = true
  lastOutput.value = ''
  try {
    const result = await window.electronAPI.docker.containerBatchAction(
      props.connectionId,
      action,
      targets.map(container => container.id),
      actionOptions
    )

    if (result.success) {
      lastOutput.value = result.data || ''
      ElMessage.success(`${actionLabels[action]}项目成功`)
      await loadOverview()
    } else {
      lastOutput.value = result.error || ''
      ElMessage.error(`${actionLabels[action]}项目失败: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`${actionLabels[action]}项目失败: ${error.message}`)
    }
  } finally {
    actionLoading.value = false
  }
}

const isDockerContainerAction = (command: unknown): command is DockerContainerAction => {
  return (
    typeof command === 'string' &&
    ['start', 'pause', 'unpause', 'restart', 'stop', 'remove'].includes(command)
  )
}

const handleContainerCommand = (command: unknown, container: DockerContainer) => {
  if (isDockerContainerAction(command)) {
    void runAction(command, container)
  }
}

const handleGroupCommand = (command: unknown, group: DockerContainerGroup) => {
  if (isDockerContainerAction(command)) {
    void runGroupAction(command, group)
  }
}

const shortId = (id: string) => id.slice(0, 12)

const stateLabel = (state: string) => {
  const normalized = state.toLowerCase()
  if (normalized === 'running') return '运行中'
  if (normalized === 'paused') return '已暂停'
  if (normalized === 'exited') return '已停止'
  if (normalized === 'created') return '已创建'
  if (normalized === 'restarting') return '重启中'
  return state || 'unknown'
}

const stateClass = (state: string) => {
  const normalized = state.toLowerCase()
  if (normalized === 'running') return 'is-running'
  if (normalized === 'paused') return 'is-paused'
  if (normalized === 'exited') return 'is-stopped'
  return 'is-other'
}
</script>

<style scoped>
.docker-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
  color: var(--text-primary);
}

.docker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.docker-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 700;
}

.docker-header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.docker-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.env-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.env-status-card,
.env-detail-card {
  min-width: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.env-status-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
}

.env-status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--danger-color);
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
}

.env-status-card.is-ready .env-status-dot {
  background: var(--success-color);
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.12);
}

.env-detail-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
}

.env-status-card strong,
.env-detail-card strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.version-line {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.install-box h4 {
  margin: 0 0 6px;
  font-size: var(--text-base);
}

.install-box p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.container-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.container-title {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
}

.container-title strong {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.container-title span {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.container-toolbar-actions {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.container-toolbar-actions .el-input {
  width: min(220px, 100%);
}

.container-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  appearance: none;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--text-xs);
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.stat-item:hover,
.stat-item.is-active {
  border-color: var(--primary-color);
  background: rgba(59, 130, 246, 0.1);
  color: var(--primary-color);
}

.stat-item.is-running {
  border-color: rgba(34, 197, 94, 0.32);
  color: var(--success-color);
}

.stat-item.is-running.is-active,
.stat-item.is-running:hover {
  background: rgba(34, 197, 94, 0.1);
}

.stat-item.is-paused {
  border-color: rgba(245, 158, 11, 0.35);
  color: var(--warning-color);
}

.stat-item.is-paused.is-active,
.stat-item.is-paused:hover {
  background: rgba(245, 158, 11, 0.1);
}

.stat-item.is-stopped {
  color: var(--text-tertiary);
}

.stat-item.is-stopped.is-active,
.stat-item.is-stopped:hover {
  border-color: var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.container-list {
  flex: 1;
  min-height: 0;
}

.container-list :deep(.el-scrollbar__view) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.container-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.container-group.is-compose {
  border-color: rgba(59, 130, 246, 0.24);
  box-shadow: inset 3px 0 0 rgba(59, 130, 246, 0.42);
}

.group-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.group-header.is-clickable {
  cursor: pointer;
}

.group-toggle {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin: -2px 0 0 -2px;
  padding: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-main);
  color: var(--text-secondary);
  cursor: pointer;
}

.group-toggle:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.group-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.group-kind {
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
}

.group-title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-title span:last-child {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.group-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
}

.group-containers {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.container-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-main);
}

.container-card-main {
  min-width: 0;
}

.container-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.name-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.container-name,
.image-line,
.container-metrics strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-name {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 700;
  line-height: 1.35;
}

.container-id {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.image-line {
  margin-top: 7px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.state-pill {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1;
}

.state-pill.is-running {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.1);
  color: var(--success-color);
}

.state-pill.is-paused {
  border-color: rgba(245, 158, 11, 0.38);
  background: rgba(245, 158, 11, 0.1);
  color: var(--warning-color);
}

.state-pill.is-stopped {
  border-color: var(--border-light);
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
}

.state-pill.is-other {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger-color);
}

.container-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.container-metrics > div {
  min-width: 0;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-main);
}

.container-metrics strong {
  margin-top: 2px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}

.container-card-actions {
  display: flex;
  align-items: flex-start;
}

.docker-action-trigger,
.docker-project-trigger {
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  color: var(--text-secondary);
}

.output-box {
  flex-shrink: 0;
}

.output-title {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
}

.output-box pre {
  max-height: 120px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

:global(:root.app-appearance-terminal .docker-panel),
:global(:root.app-appearance-minimal .docker-panel) {
  background: var(--bg-main);
}

:global(:root.app-appearance-terminal .docker-header),
:global(:root.app-appearance-minimal .docker-header) {
  padding: 9px 12px;
}

:global(:root.app-appearance-terminal .docker-header h3),
:global(:root.app-appearance-minimal .docker-header h3) {
  font-family: var(--font-mono);
}
</style>
