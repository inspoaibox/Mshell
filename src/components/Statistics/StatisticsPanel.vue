<template>
  <div class="statistics-panel">
    <div class="panel-header">
      <h2>统计分析</h2>
      <div class="header-actions">
        <el-segmented v-model="timeRange" :options="timeRangeOptions" size="default" />
        <el-select v-model="displayCurrency" size="small" style="width: 100px; margin-left: 12px;">
          <el-option label="人民币 ¥" value="CNY" />
          <el-option label="美元 $" value="USD" />
        </el-select>
        <el-button @click="refreshData" :icon="Refresh" circle title="刷新数据" />
        <el-button @click="showSettingsDialog = true" :icon="Setting" circle title="显示设置" />
      </div>
    </div>

    <div class="stats-content">
      <!-- Summary Cards -->
      <div v-if="visibleComponents.summaryCards" class="summary-grid">
        <div class="stat-card">
          <div class="stat-icon bg-primary">
            <el-icon><Monitor /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-label">总会话数</div>
            <div class="stat-value">{{ totalSessions }}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon bg-success">
            <el-icon><Money /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-label">月度费用 (估算)</div>
            <div class="stat-value">{{ formatCurrency(totalMonthlyCost) }}</div>
            <div class="stat-sub">
              预计年度: {{ formatCurrency(totalMonthlyCost * 12) }}
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon bg-warning">
            <el-icon><Timer /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-label">累计连接次数</div>
            <div class="stat-value">{{ totalUsage }}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon bg-info">
            <el-icon><Clock /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-label">总连接时长</div>
            <div class="stat-value">{{ formatDuration(totalConnectionTime) }}</div>
            <div class="stat-sub">
              平均: {{ formatDuration(averageConnectionTime) }}
            </div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <!-- Region Distribution -->
        <div v-if="visibleComponents.regionDistribution" class="dashboard-card region-analysis">
          <h3>主机地区分布</h3>
          <div class="chart-container" v-if="regionStats.length > 0">
            <div class="simple-bar-chart">
              <div 
                v-for="item in regionStats" 
                :key="item.region" 
                class="bar-item"
              >
                <div class="bar-label">
                  <span>
                    <span v-if="getRegionFlag(item.region)" v-html="getRegionFlag(item.region)" class="region-flag"></span>
                    {{ item.region || '未知地区' }}
                  </span>
                  <span>{{ item.count }} 次</span>
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.count, totalSessions) + '%', backgroundColor: getRegionColor(item.region) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无地区数据，请编辑会话添加地区信息
          </div>
        </div>

        <!-- Provider Statistics -->
        <div v-if="visibleComponents.providerStats" class="dashboard-card provider-analysis">
          <h3>服务商统计</h3>
          <div class="chart-container" v-if="providerStats.length > 0">
            <div class="provider-list">
              <div 
                v-for="item in providerStats" 
                :key="item.provider" 
                class="provider-item"
              >
                <div class="provider-header">
                  <span class="provider-name">{{ item.provider }}</span>
                  <span class="provider-count">{{ item.count }} 次</span>
                </div>
                <div class="provider-cost">
                  月度费用: {{ formatCurrency(item.cost) }}
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.count, totalSessions) + '%', backgroundColor: getColor(item.provider) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无服务商数据
          </div>
        </div>

        <!-- Cost Analysis -->
        <div v-if="visibleComponents.costAnalysis" class="dashboard-card cost-analysis">
          <h3>服务商费用占比</h3>
          <div class="chart-container" v-if="providerCosts.length > 0">
            <div class="simple-bar-chart">
              <div 
                v-for="item in providerCosts" 
                :key="item.provider" 
                class="bar-item"
              >
                <div class="bar-label">
                  <span>{{ item.provider || '未分类' }}</span>
                  <span>{{ formatCurrency(item.cost) }}</span>
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.cost, totalMonthlyCost) + '%', backgroundColor: getColor(item.provider) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无费用数据，请编辑会话添加计费信息
          </div>
        </div>

        <!-- Usage Analysis -->
        <div v-if="visibleComponents.usageAnalysis" class="dashboard-card usage-analysis">
          <h3>最常使用会话</h3>
          <div class="chart-container" v-if="topUsedSessions.length > 0">
             <div class="simple-bar-chart">
              <div 
                v-for="item in topUsedSessions" 
                :key="item.id" 
                class="bar-item"
              >
                <div class="bar-label">
                  <span class="truncate">{{ item.name }}</span>
                  <span>{{ item.usageCount || 0 }} 次</span>
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.usageCount || 0, maxUsage) + '%', backgroundColor: 'var(--primary-color)' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无使用数据
          </div>
        </div>

        <!-- Connection Time Analysis -->
        <div v-if="visibleComponents.connectionTime" class="dashboard-card time-analysis">
          <h3>连接时长统计</h3>
          <div class="chart-container" v-if="topConnectionTime.length > 0">
            <div class="simple-bar-chart">
              <div 
                v-for="item in topConnectionTime" 
                :key="item.sessionId" 
                class="bar-item"
              >
                <div class="bar-label">
                  <span class="truncate">{{ item.sessionName }}</span>
                  <span>{{ formatDuration(item.totalTime) }}</span>
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.totalTime, maxConnectionTime) + '%', backgroundColor: '#4ECDC4' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无连接时长数据
          </div>
        </div>

        <!-- Command Statistics -->
        <div v-if="visibleComponents.commandStats" class="dashboard-card command-analysis">
          <h3>最常用命令</h3>
          <div class="chart-container" v-if="topCommands.length > 0">
            <div class="simple-bar-chart">
              <div 
                v-for="item in topCommands" 
                :key="item.command" 
                class="bar-item"
              >
                <div class="bar-label">
                  <span class="truncate command-text">{{ item.command }}</span>
                  <span>{{ item.count }} 次</span>
                </div>
                <div class="bar-track">
                  <div 
                    class="bar-fill" 
                    :style="{ width: getPercentage(item.count, maxCommandCount) + '%', backgroundColor: '#FFE66D' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无命令统计数据
          </div>
        </div>

        <!-- Traffic Statistics -->
        <div v-if="visibleComponents.trafficStats" class="dashboard-card traffic-analysis">
          <h3>流量统计</h3>
          <div class="chart-container" v-if="trafficStats.totalBytes > 0">
            <div class="traffic-summary">
              <div class="traffic-item">
                <div class="traffic-label">上传流量</div>
                <div class="traffic-value">{{ formatBytes(trafficStats.totalBytesOut) }}</div>
              </div>
              <div class="traffic-item">
                <div class="traffic-label">下载流量</div>
                <div class="traffic-value">{{ formatBytes(trafficStats.totalBytesIn) }}</div>
              </div>
              <div class="traffic-item">
                <div class="traffic-label">总流量</div>
                <div class="traffic-value highlight">{{ formatBytes(trafficStats.totalBytes) }}</div>
              </div>
            </div>
            <div class="traffic-bar">
              <div 
                class="traffic-segment upload" 
                :style="{ width: getPercentage(trafficStats.totalBytesOut, trafficStats.totalBytes) + '%' }"
                :title="`上传: ${formatBytes(trafficStats.totalBytesOut)}`"
              ></div>
              <div 
                class="traffic-segment download" 
                :style="{ width: getPercentage(trafficStats.totalBytesIn, trafficStats.totalBytes) + '%' }"
                :title="`下载: ${formatBytes(trafficStats.totalBytesIn)}`"
              ></div>
            </div>
          </div>
          <div v-else class="empty-chart">
            暂无流量数据
          </div>
        </div>
      </div>

      <!-- Detailed Table -->
      <div v-if="visibleComponents.detailedTable" class="dashboard-card detailed-stats">
        <h3>会话详情</h3>
        <el-table :data="appStore.sessions" style="width: 100%" height="300">
          <el-table-column prop="name" label="名称" min-width="150" />
          <el-table-column prop="host" label="主机" min-width="150" />
          <el-table-column prop="provider" label="服务商" width="120">
            <template #default="{ row }">
              {{ detectProvider(row) }}
            </template>
          </el-table-column>
          <el-table-column prop="region" label="地区" width="120">
            <template #default="{ row }">
              <span v-if="getRegionFlag(row.region)" v-html="getRegionFlag(row.region)" class="region-flag-small"></span>
              {{ row.region || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="费用 (月)" width="150">
            <template #default="{ row }">
              <div>{{ formatAnyCost(row) }}</div>
              <div v-if="row.billingCycle !== 'monthly'" style="font-size: var(--text-xs); color: var(--text-tertiary)">
                折合: {{ formatCurrency(getMonthlyCost(row)) }}/月
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="usageCount" label="连接次" width="100" sortable />
          <el-table-column prop="lastConnected" label="最后活跃" width="180">
            <template #default="{ row }">
              {{ formatDate(row.lastConnected) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 显示设置对话框 -->
    <el-dialog
      v-model="showSettingsDialog"
      title="统计组件显示设置"
      width="500px"
    >
      <div class="settings-content">
        <p class="settings-hint">选择要显示的统计组件</p>
        <el-form label-position="left" label-width="140px">
          <el-form-item label="概览卡片">
            <el-switch v-model="visibleComponents.summaryCards" />
          </el-form-item>
          <el-form-item label="主机地区分布">
            <el-switch v-model="visibleComponents.regionDistribution" />
          </el-form-item>
          <el-form-item label="服务商统计">
            <el-switch v-model="visibleComponents.providerStats" />
          </el-form-item>
          <el-form-item label="服务商费用占比">
            <el-switch v-model="visibleComponents.costAnalysis" />
          </el-form-item>
          <el-form-item label="最常使用会话">
            <el-switch v-model="visibleComponents.usageAnalysis" />
          </el-form-item>
          <el-form-item label="连接时长统计">
            <el-switch v-model="visibleComponents.connectionTime" />
          </el-form-item>
          <el-form-item label="最常用命令">
            <el-switch v-model="visibleComponents.commandStats" />
          </el-form-item>
          <el-form-item label="流量统计">
            <el-switch v-model="visibleComponents.trafficStats" />
          </el-form-item>
          <el-form-item label="会话详情表格">
            <el-switch v-model="visibleComponents.detailedTable" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="resetVisibility">全部显示</el-button>
        <el-button type="primary" @click="saveVisibilitySettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Monitor, Money, Timer, Refresh, Clock, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import * as FlagIcons from 'country-flag-icons/string/3x2'
import type { SessionConfig } from '@/types/session'

// 使用 store - 不需要重复加载数据！
const appStore = useAppStore()

const displayCurrency = ref<'CNY' | 'USD'>('CNY')
const timeRange = ref('all')
const timeRangeOptions = [
  { label: '今日', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '全部', value: 'all' }
]

const connectionStats = ref<any[]>([])
const commandStats = ref<any[]>([])

// 显示设置
const showSettingsDialog = ref(false)
const visibleComponents = ref({
  summaryCards: true,
  regionDistribution: true,
  providerStats: true,
  costAnalysis: true,
  usageAnalysis: true,
  connectionTime: true,
  commandStats: true,
  trafficStats: true,
  detailedTable: true
})

// 从 localStorage 加载显示设置
const loadVisibilitySettings = () => {
  const saved = localStorage.getItem('statistics-visibility')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      visibleComponents.value = { ...visibleComponents.value, ...parsed }
    } catch (e) {
      console.error('Failed to load visibility settings:', e)
    }
  }
}

// 保存显示设置
const saveVisibilitySettings = () => {
  localStorage.setItem('statistics-visibility', JSON.stringify(visibleComponents.value))
  ElMessage.success('显示设置已保存')
  showSettingsDialog.value = false
}

// 重置为全部显示
const resetVisibility = () => {
  visibleComponents.value = {
    summaryCards: true,
    regionDistribution: true,
    providerStats: true,
    costAnalysis: true,
    usageAnalysis: true,
    connectionTime: true,
    commandStats: true,
    trafficStats: true,
    detailedTable: true
  }
}

// 流量统计 - 从过滤后的连接统计中计算
const trafficStats = computed(() => {
  const stats = {
    totalBytesIn: 0,
    totalBytesOut: 0,
    totalBytes: 0
  }
  
  filteredConnectionStats.value.forEach(conn => {
    stats.totalBytesIn += conn.bytesIn || 0
    stats.totalBytesOut += conn.bytesOut || 0
  })
  
  stats.totalBytes = stats.totalBytesIn + stats.totalBytesOut
  return stats
})

// 根据时间范围过滤数据
const getTimeRangeFilter = () => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  
  switch (timeRange.value) {
    case 'today':
      return (date: Date | string) => new Date(date) >= today
    case 'week':
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return (date: Date | string) => new Date(date) >= weekAgo
    case 'month':
      const monthAgo = new Date(today)
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return (date: Date | string) => new Date(date) >= monthAgo
    default:
      return () => true
  }
}

// 过滤后的连接统计
const filteredConnectionStats = computed(() => {
  const filter = getTimeRangeFilter()
  return connectionStats.value.filter(stat => 
    stat.connectedAt && filter(stat.connectedAt)
  )
})

// 过滤后的命令统计 - 命令统计不需要时间过滤，因为是聚合数据
const filteredCommandStats = computed(() => {
  // 命令统计返回的是聚合后的 { command, count } 数据，没有时间字段
  // 直接返回所有数据
  return commandStats.value
})

// 直接从 store 计算统计数据
const totalSessions = computed(() => appStore.sessions.length)

// 累计连接次数 - 使用过滤后的连接统计数据
const totalUsage = computed(() => {
  return filteredConnectionStats.value.length
})

// 总连接时长（秒）- 使用过滤后的数据
const totalConnectionTime = computed(() => {
  return filteredConnectionStats.value.reduce((acc, stat) => acc + (stat.duration || 0), 0)
})

// 平均连接时长
const averageConnectionTime = computed(() => {
  const count = filteredConnectionStats.value.length
  return count > 0 ? totalConnectionTime.value / count : 0
})

// 格式化时长
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}小时`
  return `${(seconds / 86400).toFixed(1)}天`
}

// 格式化流量
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const totalMonthlyCost = computed(() => {
  return appStore.sessions.reduce((acc, curr) => acc + getMonthlyCost(curr), 0)
})

const getMonthlyCost = (session: any): number => {
  if (!session.billingAmount) return 0
  let amount = Number(session.billingAmount)
  if (isNaN(amount)) return 0
  
  const currency = (session.billingCurrency || 'CNY').toUpperCase()
  if (currency === 'USD') amount *= 7.2
  else if (currency === 'EUR') amount *= 7.8
  
  const cycle = session.billingCycle || 'monthly'
  switch (cycle) {
    case 'monthly': return amount
    case 'quarterly': return amount / 3
    case 'semi-annually': return amount / 6
    case 'annually': return amount / 12
    case 'biennially': return amount / 24
    case 'triennially': return amount / 36
    case 'custom': return 0
    default: return amount
  }
}

const maxUsage = computed(() => {
  return Math.max(...appStore.sessions.map(s => s.usageCount || 0), 1)
})

const detectProvider = (session: any): string => {
  const keywords: Record<string, string[]> = {
    '阿里云(Aliyun)': ['aliyun', '阿里云', 'ali'],
    '腾讯云(Tencent)': ['tencent', 'qcloud', '腾讯云'],
    '华为云(Huawei)': ['huawei', '华为云', 'hwcloud'],
    'AWS': ['aws', 'amazon'],
    'Azure': ['azure', 'microsoft'],
    'Google Cloud': ['gcp', 'google cloud'],
    'Vultr': ['vultr'],
    'DigitalOcean': ['digitalocean', 'do'],
    'Linode': ['linode', 'akamai'],
    'Bandwagon': ['bandwagon', 'bwh'],
    'Cloudflare': ['cloudflare'],
    'Oracle': ['oracle'],
    'DMIT': ['dmit'],
    'FiberState': ['fiberstate', 'fs'],
    'RackNerd': ['racknerd', 'rn'],
    'CloudCone': ['cloudcone', 'cc']
  }

  // helper to check against keywords
  const findCanonical = (str: string): string | null => {
    const lower = str.toLowerCase()
    for (const [provider, keys] of Object.entries(keywords)) {
      if (keys.some(k => lower.includes(k))) {
        return provider
      }
    }
    return null
  }

  // 1. Explicit provider field - Strictly use user input
  if (session.provider && session.provider.trim()) {
    return session.provider
  }
  
  // 2. Infer from Name or Host if provider is empty
  const text = `${session.name || ''} ${session.host || ''}`
  return findCanonical(text) || '未分类'
}

const providerCosts = computed(() => {
  const map: Record<string, number> = {}
  appStore.sessions.forEach(s => {
    const cost = getMonthlyCost(s)
    if (cost > 0) {
      const provider = detectProvider(s)
      map[provider] = (map[provider] || 0) + cost
    }
  })
  
  return Object.entries(map)
    .map(([provider, cost]) => ({ provider, cost }))
    .sort((a, b) => b.cost - a.cost)
})

const topUsedSessions = computed(() => {
  return [...appStore.sessions]
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 5)
    .filter(s => (s.usageCount || 0) > 0)
})

// 连接时长统计 - 使用过滤后的数据
const topConnectionTime = computed(() => {
  const sessionTimeMap = new Map<string, { sessionId: string; sessionName: string; totalTime: number }>()
  
  filteredConnectionStats.value.forEach(stat => {
    const existing = sessionTimeMap.get(stat.sessionId)
    if (existing) {
      existing.totalTime += stat.duration || 0
    } else {
      sessionTimeMap.set(stat.sessionId, {
        sessionId: stat.sessionId,
        sessionName: stat.sessionName,
        totalTime: stat.duration || 0
      })
    }
  })
  
  return Array.from(sessionTimeMap.values())
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 5)
})

const maxConnectionTime = computed(() => {
  return Math.max(...topConnectionTime.value.map(s => s.totalTime), 1)
})

// 命令统计 - 使用过滤后的数据
const topCommands = computed(() => {
  return filteredCommandStats.value
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
})

const maxCommandCount = computed(() => {
  return Math.max(...topCommands.value.map(c => c.count), 1)
})

// 刷新数据
const refreshData = async () => {
  await appStore.loadSessions()
  await loadStatistics()
}

// 加载统计数据
const loadStatistics = async () => {
  try {
    // 加载命令历史统计
    const commandResult = await window.electronAPI.commandHistory?.getMostUsed?.(10)
    if (commandResult?.success && commandResult.data) {
      commandStats.value = commandResult.data
    }

    // 加载连接统计
    const statsResult = await window.electronAPI.connectionStats?.getAll?.()
    if (statsResult?.success && statsResult.data) {
      connectionStats.value = statsResult.data
    }
    
    // 加载流量统计 - 不需要单独加载，从连接统计中计算
    // 流量统计会在 computed 中根据过滤后的连接统计计算
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

onMounted(() => {
  loadVisibilitySettings()
  loadStatistics()
})

const regionStats = computed(() => {
  const map: Record<string, number> = {}
  appStore.sessions.forEach(s => {
    const region = s.region || '未知地区'
    map[region] = (map[region] || 0) + 1
  })
  
  return Object.entries(map)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count)
})

const providerStats = computed(() => {
  const map: Record<string, { count: number; cost: number }> = {}
  appStore.sessions.forEach(s => {
    const provider = detectProvider(s)
    if (!map[provider]) {
      map[provider] = { count: 0, cost: 0 }
    }
    map[provider].count++
    map[provider].cost += getMonthlyCost(s)
  })
  
  return Object.entries(map)
    .map(([provider, data]) => ({ provider, ...data }))
    .sort((a, b) => b.count - a.count)
})

// 货币格式化
const formatCurrency = (amount: number): string => {
  if (displayCurrency.value === 'USD') {
    const usdAmount = amount / 7.2 // CNY to USD
    return `$${usdAmount.toFixed(2)}`
  }
  return `¥${amount.toFixed(2)}`
}

// 获取地区国旗
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

// 地区颜色
const getRegionColor = (region: string) => {
  const colors: Record<string, string> = {
    '香港': '#FF6B6B',
    '美国': '#4ECDC4',
    '日本': '#FFE66D',
    '新加坡': '#95E1D3',
    '韩国': '#F38181',
    '中国': '#AA96DA',
    '德国': '#FCBAD3',
    '英国': '#A8D8EA',
    '法国': '#FFAAA7',
    '俄罗斯': '#C7CEEA'
  }
  return colors[region] || getColor(region)
}

const getPercentage = (val: number, total: number) => {
  if (total === 0) return 0
  return Math.min(100, (val / total) * 100)
}

const getColor = (provider: string) => {
  // Simple hash for color
  let hash = 0
  for (let i = 0; i < provider.length; i++) {
    hash = provider.charCodeAt(i) + ((hash << 5) - hash)
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}

const formatAnyCost = (session: SessionConfig) => {
  if (!session.billingAmount) return '-'
  return `${session.billingAmount} ${session.billingCurrency}/${convertCycle(session.billingCycle)}`
}

const convertCycle = (cycle?: string) => {
  switch(cycle) {
    case 'monthly': return '月'
    case 'quarterly': return '季'
    case 'semi-annually': return '半年'
    case 'annually': return '年'
    case 'biennially': return '两年'
    case 'triennially': return '三年'
    case 'custom': return '自定义'
    default: return ''
  }
}

const formatDate = (date?: Date | string) => {
  if (!date) return '-'
  return new Date(date).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Re-expose loadData to parent if needed (now just calls store method)
defineExpose({ loadData: refreshData })

// 监听时间范围变化
watch(timeRange, () => {
  loadStatistics()
})
</script>

<style scoped>
.statistics-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: var(--spacing-lg);
  overflow-y: auto;
  gap: var(--spacing-lg);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* Summary Grid */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--spacing-lg);
}

.stat-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: all var(--transition-fast);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-3xl);
  color: white;
}

.bg-primary { background: var(--primary-color); }
.bg-success { background: var(--success-color); }
.bg-warning { background: var(--warning-color); }

.stat-info {
  flex: 1;
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.stat-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* Dashboard Grid - 改进布局 */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-lg);
}

/* 让某些卡片占据两列 */
.dashboard-card.detailed-stats {
  grid-column: 1 / -1;
}

/* 确保所有卡片有最小高度 */
.dashboard-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.dashboard-card h3 {
  margin-bottom: var(--spacing-lg);
  font-size: var(--text-lg);
  font-weight: 600;
  flex-shrink: 0;
}

.chart-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.empty-chart {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-style: italic;
  min-height: 200px;
}

/* Simple Bar Chart - 改进滚动 */
.simple-bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.simple-bar-chart::-webkit-scrollbar {
  width: 6px;
}

.simple-bar-chart::-webkit-scrollbar-track {
  background: var(--bg-tertiary);
  border-radius: 3px;
}

.simple-bar-chart::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.simple-bar-chart::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

.bar-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bar-label {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.bar-track {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 1s ease-out;
}

/* Responsive */
@media (max-width: 1200px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
  
  .header-actions {
    flex-wrap: wrap;
  }
}

/* Region Flag */
.region-flag {
  display: inline-block;
  width: 20px;
  height: 15px;
  margin-right: 6px;
  border-radius: 2px;
  overflow: hidden;
  vertical-align: middle;
}

.region-flag :deep(svg) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.region-flag-small {
  display: inline-block;
  width: 16px;
  height: 12px;
  margin-right: 4px;
  border-radius: 2px;
  overflow: hidden;
  vertical-align: middle;
}

.region-flag-small :deep(svg) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Provider List */
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.provider-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.provider-item:hover {
  background: var(--bg-elevated);
  transform: translateX(4px);
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.provider-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.provider-count {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 500;
}

.provider-cost {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* Command Text */
.command-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: var(--text-xs);
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
}

/* Traffic Statistics */
.traffic-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.traffic-item {
  text-align: center;
  padding: var(--spacing-md);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
}

.traffic-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.traffic-value {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.traffic-value.highlight {
  color: var(--primary-color);
  font-size: var(--text-xl);
}

.traffic-bar {
  height: 40px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
}

.traffic-segment {
  height: 100%;
  transition: width 1s ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: var(--text-xs);
  font-weight: 600;
}

.traffic-segment.upload {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.traffic-segment.download {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.bg-info {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* 设置对话框样式 */
.settings-content {
  padding: var(--spacing-md) 0;
}

.settings-hint {
  margin: 0 0 var(--spacing-lg) 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.settings-content :deep(.el-form-item) {
  margin-bottom: var(--spacing-md);
}

.settings-content :deep(.el-form-item__label) {
  color: var(--text-primary);
  font-weight: 500;
}


</style>
