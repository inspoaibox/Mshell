<template>
  <div class="docker-panel">
    <div class="docker-header">
      <div>
        <h3>Docker 管理</h3>
        <p>{{ subtitle }}</p>
      </div>
      <div class="header-actions">
        <el-button
          :icon="Refresh"
          :loading="refreshing"
          :disabled="busy || !connected"
          @click="loadOverview"
          >刷新</el-button
        >
        <el-button :icon="Close" link @click="$emit('close')" />
      </div>
    </div>

    <div class="refresh-toolbar">
      <label
        >自动刷新
        <select v-model.number="refreshInterval" aria-label="Docker 自动刷新间隔">
          <option :value="5000">5 秒</option>
          <option :value="10000">10 秒</option>
          <option :value="30000">30 秒</option>
          <option :value="0">关闭</option>
        </select>
      </label>
      <span role="status">{{ refreshStatus }}</span>
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
          <div
            class="env-status-card"
            :class="{ 'is-ready': overview.environment.composeInstalled }"
          >
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
          <span v-if="overview.environment.composeVersion">
            / {{ overview.environment.composeVersion }}</span
          >
        </div>

        <el-alert
          v-if="overview.environment.installed && !overview.environment.socketAccessible"
          type="warning"
          :title="accessMessage"
          show-icon
          :closable="false"
        />

        <el-alert
          v-for="warning in overview.warnings"
          :key="warning"
          :title="warning"
          type="warning"
          :closable="false"
        />
        <div
          v-if="!overview.environment.installed || !overview.environment.composeInstalled"
          class="install-box"
        >
          <div>
            <h4>
              {{
                overview.environment.installed
                  ? 'Docker Compose 未就绪'
                  : '当前服务器未检测到 Docker'
              }}
            </h4>
            <p>可尝试使用当前系统包管理器安装 Docker 与 Docker Compose 插件。</p>
          </div>
          <el-button
            type="primary"
            :icon="Download"
            :loading="installing"
            :disabled="busy || !connected || stale"
            @click="installDocker"
          >
            {{ overview.environment.installed ? '补全安装' : '一键安装' }}
          </el-button>
        </div>

        <template v-if="overview.environment.installed && overview.environment.socketAccessible">
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
                :disabled="!canOperate"
                @click="cleanupUnused"
              >
                清理未使用
              </el-button>
              <el-input v-model="keyword" size="small" clearable placeholder="搜索容器 / 镜像" />
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
            <button
              type="button"
              class="stat-item"
              :class="{ 'is-active': stateFilter === 'other' }"
              @click="setStateFilter('other')"
            >
              重启中 / 其他 {{ otherCount }}
            </button>
          </div>

          <el-scrollbar class="container-list">
            <el-empty v-if="containerGroups.length === 0" description="暂无匹配容器" />
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
                    {{ group.containers.length }} 个容器 · 运行 {{ group.runningCount }} · 暂停
                    {{ group.pausedCount }} · 停止 {{ group.stoppedCount }}
                    <template v-if="group.visibleContainers.length !== group.containers.length">
                      · 匹配 {{ group.visibleContainers.length }}</template
                    >
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
                      :disabled="!canOperate"
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
                        <el-dropdown-item
                          v-if="groupActionCount('restart', group) > 0"
                          command="restart"
                          :icon="Refresh"
                        >
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
                  v-for="container in group.visibleContainers"
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
                        :disabled="!canOperate"
                      />
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item
                            v-if="isActionTarget('start', container)"
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
                          <el-dropdown-item
                            v-if="isActionTarget('restart', container)"
                            command="restart"
                            :icon="Refresh"
                          >
                            重启
                          </el-dropdown-item>
                          <el-dropdown-item
                            v-if="isActionTarget('stop', container)"
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
        <div class="output-title">{{ operationSummary || '执行输出' }}</div>
        <pre>{{ lastOutput }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
import { isDockerActionTarget as isActionTarget } from '@/types/docker'
import type {
  DockerContainer,
  DockerContainerAction,
  DockerContainerActionOptions,
  DockerOverview,
  DockerOperationResult
} from '@/types/docker'

type DockerStateFilter = 'all' | 'running' | 'paused' | 'stopped' | 'other'
interface DockerContainerGroup {
  key: string
  name: string
  type: 'compose' | 'standalone'
  containers: DockerContainer[]
  visibleContainers: DockerContainer[]
  runningCount: number
  pausedCount: number
  stoppedCount: number
}
const props = withDefaults(defineProps<{ connectionId: string; active?: boolean }>(), {
  active: true
})
defineEmits<{ close: [] }>()
const overview = ref<DockerOverview | null>(null)
const refreshing = ref(false)
const installing = ref(false)
const cleaning = ref(false)
const actionLoading = ref(false)
const confirming = ref(false)
const busy = computed(
  () => installing.value || cleaning.value || actionLoading.value || confirming.value
)
const loading = computed(() => refreshing.value && !overview.value)
const connected = ref(true)
const visible = ref(!document.hidden)
const stale = ref(true)
const keyword = ref('')
const errorMessage = ref('')
const lastOutput = ref('')
const operationSummary = ref('')
const lastUpdated = ref('')
const refreshInterval = ref(5000)
const expandedProjectKeys = ref<Set<string>>(new Set())
const stateFilter = ref<DockerStateFilter>('all')
let disposed = false
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> | undefined
let refreshRequested = false
const cleanups: Array<() => void> = []
const canRefresh = computed(() => props.active && visible.value && connected.value && !busy.value)
const canOperate = computed(
  () =>
    props.active &&
    connected.value &&
    !busy.value &&
    !stale.value &&
    !!overview.value?.environment.socketAccessible
)
const refreshStatus = computed(() => {
  if (!connected.value) return '连接已断开 · 数据未更新'
  if (busy.value) return '操作中 · 自动刷新暂停'
  if (!props.active || !visible.value) return '页面隐藏 · 自动刷新暂停'
  if (refreshing.value) return '正在刷新…'
  if (stale.value && overview.value) return '刷新失败 · 显示上次数据'
  return lastUpdated.value ? '更新于 ' + lastUpdated.value : '等待检测'
})
const accessMessage = computed(() => {
  const env = overview.value?.environment
  if (!env) return ''
  const reason =
    env.accessStatus === 'permission-denied'
      ? '当前用户没有 Docker 访问权限，请检查用户组或免密 sudo docker 配置。'
      : 'Docker 服务不可访问，请检查服务是否启动以及 Docker 连接配置。'
  return reason + (env.accessError ? '\n' + env.accessError : '')
})
const subtitle = computed(() => {
  if (!overview.value) return '检测 Docker 环境与容器状态'
  if (!overview.value.environment.installed) return '未安装 Docker'
  return overview.value.environment.socketAccessible ? 'Docker 可用' : 'Docker 不可访问'
})
const osLabel = computed(() => {
  const os = overview.value?.environment.os
  return os
    ? os.prettyName || [os.id, os.versionId].filter(Boolean).join(' ') || os.packageManager
    : '-'
})
const isStopped = (container: DockerContainer) => ['exited', 'created'].includes(container.state)
const matchesFilter = (container: DockerContainer) => {
  const filter = stateFilter.value
  if (filter === 'running' || filter === 'paused') {
    if (container.state !== filter) return false
  } else if (filter === 'stopped' && !isStopped(container)) return false
  else if (
    filter === 'other' &&
    (isStopped(container) || ['running', 'paused'].includes(container.state))
  )
    return false
  const query = keyword.value.trim().toLowerCase()
  return (
    !query ||
    [
      container.name,
      container.image,
      container.status,
      container.id,
      container.composeProject,
      container.composeService
    ].some((value) => value.toLowerCase().includes(query))
  )
}
const setStateFilter = (filter: DockerStateFilter) => {
  stateFilter.value = stateFilter.value === filter && filter !== 'all' ? 'all' : filter
}
const containerGroups = computed<DockerContainerGroup[]>(() => {
  const groups = new Map<string, DockerContainerGroup>()
  // Filtering changes only the displayed children, never a project's operation targets.
  for (const container of overview.value?.containers || []) {
    const project = container.composeProject.trim()
    const key = project ? 'compose:' + project : 'standalone:' + container.id
    const group = groups.get(key) || {
      key,
      name: project || container.name,
      type: project ? ('compose' as const) : ('standalone' as const),
      containers: [],
      visibleContainers: [],
      runningCount: 0,
      pausedCount: 0,
      stoppedCount: 0
    }
    group.containers.push(container)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.containers.sort((a, b) =>
      (a.composeService || a.name).localeCompare(b.composeService || b.name)
    )
    group.visibleContainers = group.containers.filter(matchesFilter)
    group.runningCount = group.containers.filter((c) => c.state === 'running').length
    group.pausedCount = group.containers.filter((c) => c.state === 'paused').length
    group.stoppedCount = group.containers.filter(isStopped).length
  }
  return [...groups.values()]
    .filter((group) => group.visibleContainers.length)
    .sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'compose' ? -1 : 1
    )
})
const isGroupExpanded = (group: DockerContainerGroup) =>
  group.type !== 'compose' ||
  !!keyword.value.trim() ||
  stateFilter.value !== 'all' ||
  expandedProjectKeys.value.has(group.key)
const toggleGroup = (group: DockerContainerGroup) => {
  const keys = new Set(expandedProjectKeys.value)
  if (keys.has(group.key)) keys.delete(group.key)
  else keys.add(group.key)
  expandedProjectKeys.value = keys
}
const runningCount = computed(
  () => overview.value?.containers.filter((c) => c.state === 'running').length || 0
)
const pausedCount = computed(
  () => overview.value?.containers.filter((c) => c.state === 'paused').length || 0
)
const stoppedCount = computed(() => overview.value?.containers.filter(isStopped).length || 0)
const otherCount = computed(
  () =>
    (overview.value?.containers.length || 0) -
    runningCount.value -
    pausedCount.value -
    stoppedCount.value
)
const stopTimer = () => {
  if (timer) clearTimeout(timer)
  timer = undefined
}
const schedule = () => {
  stopTimer()
  if (!disposed && canRefresh.value && refreshInterval.value > 0 && !pending)
    timer = setTimeout(() => {
      void loadOverview()
    }, refreshInterval.value)
}
const loadOverview = (): Promise<void> => {
  if (disposed || !canRefresh.value) return Promise.resolve()
  stopTimer()
  if (pending) {
    refreshRequested = true
    return pending
  }
  const version = generation
  const id = props.connectionId
  refreshing.value = true
  pending = Promise.resolve().then(async () => {
    try {
      const result = await window.electronAPI.docker.getOverview(id)
      if (
        disposed ||
        version !== generation ||
        id !== props.connectionId ||
        !connected.value ||
        !props.active ||
        !visible.value
      )
        return
      if (!result.success || !result.data) throw new Error(result.error || 'Docker 检测失败')
      overview.value = result.data
      stale.value = false
      errorMessage.value = ''
      lastUpdated.value = new Date().toLocaleTimeString()
    } catch (error) {
      if (disposed || version !== generation || id !== props.connectionId) return
      stale.value = true
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      pending = undefined
      refreshing.value = false
      if (refreshRequested) {
        refreshRequested = false
        void loadOverview()
      } else schedule()
    }
  })
  return pending
}
type ApiOperation = { success: boolean; data?: DockerOperationResult; error?: string }
const runOperation = async (
  label: string,
  kind: 'install' | 'cleanup' | 'container',
  confirm: () => Promise<unknown>,
  execute: (id: string) => Promise<ApiOperation>
) => {
  if (busy.value || !connected.value || stale.value || !props.active) return
  const id = props.connectionId
  const version = generation
  const flag = kind === 'install' ? installing : kind === 'cleanup' ? cleaning : actionLoading
  confirming.value = true
  stopTimer()
  let started = false
  try {
    await confirm()
    if (
      disposed ||
      id !== props.connectionId ||
      version !== generation ||
      !connected.value ||
      !props.active
    )
      return
    confirming.value = false
    flag.value = true
    started = true
    generation++
    stale.value = true
    lastOutput.value = ''
    operationSummary.value = ''
    const result = await execute(id)
    if (disposed || id !== props.connectionId) return
    lastOutput.value = result.data?.output || result.error || '未收到操作结果'
    if (result.data) {
      const ok = result.data.items.filter((item) => item.status === 'success').length
      const failed = result.data.items.filter((item) => item.status === 'failed').length
      const skipped = result.data.items.filter((item) => item.status === 'skipped').length
      operationSummary.value =
        label + '：成功 ' + ok + ' 项，失败 ' + failed + ' 项，跳过 ' + skipped + ' 项'
      if (result.data.status === 'success') ElMessage.success(label + '成功')
      else if (result.data.status === 'partial')
        ElMessage.warning(label + '部分成功，请查看逐项结果')
      else ElMessage.error(label + '失败，请查看逐项结果')
    } else {
      operationSummary.value = label + '结果未确认'
      ElMessage.error(result.error || label + '失败')
    }
  } catch (error) {
    if (disposed || id !== props.connectionId || error === 'cancel' || error === 'close') return
    lastOutput.value = error instanceof Error ? error.message : String(error)
    operationSummary.value = label + (started ? '结果未确认' : '未执行')
    ElMessage.error(lastOutput.value)
  } finally {
    if (!disposed && id === props.connectionId) {
      confirming.value = false
      flag.value = false
      // Failures and timeouts can follow partial remote changes, so always re-read.
      if (started) await loadOverview()
      else schedule()
    }
  }
}
const installDocker = () =>
  runOperation(
    '安装 Docker',
    'install',
    () =>
      ElMessageBox.confirm(
        '将在当前 SSH 服务器安装或补全 Docker 和 Compose，并验证服务可用性。需要 root 或免密 sudo 权限，确认继续吗？',
        '安装 Docker',
        { type: 'warning' }
      ),
    (id) => window.electronAPI.docker.install(id)
  )
const cleanupUnused = () =>
  runOperation(
    '清理资源',
    'cleanup',
    () =>
      ElMessageBox.confirm(
        '将清理当前服务器所有项目的未使用镜像、未使用卷和构建缓存。未被容器引用的卷可能仍有重要数据，删除后无法恢复。确认继续吗？',
        '清理未使用资源',
        { type: 'warning', confirmButtonText: '开始清理', cancelButtonText: '取消' }
      ),
    (id) => window.electronAPI.docker.cleanupUnused(id)
  )

const confirmRemoveContainers = async (
  title: string,
  containers: DockerContainer[]
): Promise<DockerContainerActionOptions> => {
  const options = reactive({ removeImage: false, removeNetworks: false })
  await ElMessageBox({
    title: '删除容器',
    message: h({
      setup: () => () =>
        h('div', { style: 'line-height:1.7' }, [
          h('p', '确认删除' + title + '？运行中的容器会被强制停止，容器可写层会丢失，数据卷保留。'),
          h('p', containers.map((c) => c.name).join('、')),
          h(
            ElCheckbox,
            {
              modelValue: options.removeImage,
              'onUpdate:modelValue': (value: unknown) => {
                options.removeImage = value === true
              }
            },
            () => '同时删除容器实际使用的镜像（仍被引用时保留并报告失败）'
          ),
          h(
            ElCheckbox,
            {
              modelValue: options.removeNetworks,
              'onUpdate:modelValue': (value: unknown) => {
                options.removeNetworks = value === true
              }
            },
            () => '同时删除关联网络（跳过默认网络，仍被使用时保留）'
          )
        ])
    }),
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    confirmButtonClass: 'el-button--danger'
  })
  return { ...options }
}
const actionLabels: Record<DockerContainerAction, string> = {
  start: '启动',
  pause: '暂停',
  unpause: '恢复',
  restart: '重启',
  stop: '停止',
  remove: '删除'
}
const groupActionCount = (action: DockerContainerAction, group: DockerContainerGroup) =>
  group.containers.filter((container) => isActionTarget(action, container)).length
const runContainerAction = (
  action: DockerContainerAction,
  containers: DockerContainer[],
  project?: string
) => {
  if (!canOperate.value) return
  const targets = containers.filter((container) => isActionTarget(action, container))
  if (!targets.length) {
    ElMessage.warning('没有可执行此操作的容器')
    return
  }
  let options: DockerContainerActionOptions = {}
  const label = actionLabels[action] + (project ? '项目容器' : '容器')
  const title = project
    ? '项目「' + project + '」中的 ' + targets.length + ' 个容器'
    : '容器「' + targets[0].name + '」'
  return runOperation(
    label,
    'container',
    async () => {
      if (action === 'remove') options = await confirmRemoveContainers(title, targets)
      else if (project || action === 'stop' || action === 'restart') {
        await ElMessageBox.confirm(
          '确认' +
            actionLabels[action] +
            title +
            '？' +
            (project
              ? '\n包含搜索或筛选隐藏的容器：' +
                targets.map((c) => c.name).join('、') +
                '\n此操作批量控制已有容器，不重新部署 Compose。'
              : ''),
          label,
          { type: 'warning' }
        )
      }
    },
    (id) =>
      project
        ? window.electronAPI.docker.containerBatchAction(
            id,
            action,
            targets.map((c) => c.id),
            options
          )
        : window.electronAPI.docker.containerAction(id, action, targets[0].id, options)
  )
}
const isDockerContainerAction = (command: unknown): command is DockerContainerAction =>
  typeof command === 'string' &&
  ['start', 'pause', 'unpause', 'restart', 'stop', 'remove'].includes(command)
const handleContainerCommand = (command: unknown, container: DockerContainer) => {
  if (isDockerContainerAction(command)) void runContainerAction(command, [container])
}
const handleGroupCommand = (command: unknown, group: DockerContainerGroup) => {
  if (isDockerContainerAction(command))
    void runContainerAction(command, group.containers, group.name)
}
const shortId = (id: string) => id.slice(0, 12)
const stateLabel = (state: string) =>
  (
    ({
      running: '运行中',
      paused: '已暂停',
      exited: '已停止',
      created: '已创建',
      restarting: '重启中',
      removing: '删除中',
      dead: '异常'
    }) as Record<string, string>
  )[state] ||
  state ||
  'unknown'
const stateClass = (state: string) =>
  (
    ({ running: 'is-running', paused: 'is-paused', exited: 'is-stopped' }) as Record<string, string>
  )[state] || 'is-other'

const onVisibility = () => {
  visible.value = !document.hidden
}
watch(refreshInterval, schedule)
watch(
  () => [props.connectionId, props.active, connected.value, visible.value] as const,
  (next, previous) => {
    generation++
    stopTimer()
    if (previous && next[0] !== previous[0]) {
      overview.value = null
      stale.value = true
      lastUpdated.value = ''
      lastOutput.value = ''
      operationSummary.value = ''
      errorMessage.value = ''
      connected.value = true
      installing.value = cleaning.value = actionLoading.value = confirming.value = false
      expandedProjectKeys.value = new Set()
    }
    if (canRefresh.value) void loadOverview()
  }
)
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  const ssh = window.electronAPI.ssh
  const close = ssh?.onClose?.((id) => {
    if (id !== props.connectionId) return
    connected.value = false
    stale.value = true
    errorMessage.value = 'SSH 连接已断开，保留上次数据，重连后自动刷新'
  })
  const reconnect = ssh?.onReconnected?.((id) => {
    if (id !== props.connectionId) return
    if (!connected.value) connected.value = true
    else {
      generation++
      if (canRefresh.value) void loadOverview()
    }
  })
  if (close) cleanups.push(close)
  if (reconnect) cleanups.push(reconnect)
  void loadOverview()
})
onUnmounted(() => {
  disposed = true
  generation++
  stopTimer()
  document.removeEventListener('visibilitychange', onVisibility)
  cleanups.forEach((cleanup) => cleanup())
})
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

.refresh-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.refresh-toolbar select {
  margin-left: 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--text-primary);
  background: var(--bg-secondary);
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
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
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
