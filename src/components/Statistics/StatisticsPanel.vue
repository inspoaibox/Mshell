<template>
  <div class="statistics-panel">
    <div class="panel-header">
      <h2>统计分析</h2>
      <div class="header-actions">
        <el-button @click="loadData" :icon="Refresh" circle title="刷新数据" />
      </div>
    </div>

    <div class="stats-content">
      <!-- Summary Cards -->
      <div class="summary-grid">
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
            <div class="stat-value">¥{{ totalMonthlyCost.toFixed(2) }}</div>
            <div class="stat-sub">
              预计年度: ¥{{ (totalMonthlyCost * 12).toFixed(2) }}
              <el-tooltip content="汇率估算: 1 USD ≈ 7.2 CNY, 1 EUR ≈ 7.8 CNY" placement="top">
                <el-icon class="info-icon" style="margin-left: 4px; font-size: 12px; cursor: help;"><InfoFilled /></el-icon>
              </el-tooltip>
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
      </div>

      <div class="dashboard-grid">
        <!-- Cost Analysis -->
        <div class="dashboard-card cost-analysis">
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
                  <span>¥{{ item.cost.toFixed(2) }}</span>
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
        <div class="dashboard-card usage-analysis">
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
      </div>

      <!-- Detailed Table -->
      <div class="dashboard-card detailed-stats">
        <h3>会话详情</h3>
        <el-table :data="sessions" style="width: 100%" height="300">
          <el-table-column prop="name" label="名称" min-width="150" />
          <el-table-column prop="host" label="主机" min-width="150" />
          <el-table-column prop="provider" label="服务商" width="120">
            <template #default="{ row }">
              {{ detectProvider(row) }}
            </template>
          </el-table-column>
          <el-table-column label="费用 (月)" width="150">
            <template #default="{ row }">
              <div>{{ formatAnyCost(row) }}</div>
              <div v-if="row.billingCycle !== 'monthly'" style="font-size: 10px; color: var(--text-tertiary)">
                折合: ¥{{ getMonthlyCost(row).toFixed(1) }}/月
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="usageCount" label="连接数" width="100" sortable />
          <el-table-column prop="lastConnected" label="最后活跃" width="180">
            <template #default="{ row }">
              {{ formatDate(row.lastConnected) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Monitor, Money, Timer, Refresh, InfoFilled } from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

const sessions = ref<SessionConfig[]>([])

onMounted(() => {
  loadData()
})

const loadData = async () => {
  try {
    sessions.value = await window.electronAPI.session.getAll()
  } catch (error) {
    console.error('Failed to load sessions for stats:', error)
  }
}

const totalSessions = computed(() => sessions.value.length)

const totalUsage = computed(() => {
  return sessions.value.reduce((acc, curr) => acc + (curr.usageCount || 0), 0)
})

const maxUsage = computed(() => {
  return Math.max(...sessions.value.map(s => s.usageCount || 0), 1) // Avoid div by zero
})

// ... imports

// ... loadData

// ... totals

const detectProvider = (session: SessionConfig): string => {
  const keywords: Record<string, string[]> = {
    '阿里云 (Aliyun)': ['aliyun', '阿里云', 'ali'],
    '腾讯云 (Tencent)': ['tencent', 'qcloud', '腾讯云'],
    '华为云 (Huawei)': ['huawei', '华为云', 'hwcloud'],
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

const getMonthlyCost = (session: SessionConfig): number => {
  // Ensure we have a valid amount
  if (session.billingAmount === undefined || session.billingAmount === null || session.billingAmount === ('' as any)) return 0
  
  // Force convert to number to be safe (handle potential commas)
  let valStr = String(session.billingAmount).replace(',', '.')
  let amount = Number(valStr)
  if (isNaN(amount)) return 0

  // Convert based on currency
  const currency = (session.billingCurrency || 'CNY').toUpperCase()
  
  /* 
   * Simple Currency Conversion
   * 1 USD ≈ 7.2 CNY
   * 1 EUR ≈ 7.8 CNY
   */
  if (currency === 'USD') amount *= 7.2
  else if (currency === 'EUR') amount *= 7.8
  
  // Convert based on cycle
  // If billingCycle is missing/empty, imply 'monthly' as per typical SaaS/Cloud default
  const cycle = session.billingCycle || 'monthly'
  
  switch (cycle) {
    case 'monthly': return amount
    case 'quarterly': return amount / 3
    case 'semi-annually': return amount / 6
    case 'annually': return amount / 12
    case 'biennially': return amount / 24
    case 'triennially': return amount / 36
    case 'custom': return 0 // Cannot calculate monthly cost for custom/unknown
    default: return amount // Default to monthly if unknown string
  }
}

const totalMonthlyCost = computed(() => {
  return sessions.value.reduce((acc, curr) => acc + getMonthlyCost(curr), 0)
})

const providerCosts = computed(() => {
  const map: Record<string, number> = {}
  sessions.value.forEach(s => {
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
  return [...sessions.value]
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 5)
    .filter(s => (s.usageCount || 0) > 0)
})

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

// Re-expose loadData to parent if needed
defineExpose({ loadData })
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
  font-size: 24px;
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

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: var(--spacing-lg);
}

.dashboard-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.dashboard-card h3 {
  margin-bottom: var(--spacing-lg);
  font-size: var(--text-lg);
  font-weight: 600;
}

.chart-container {
  flex: 1;
}

.empty-chart {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-style: italic;
  min-height: 150px;
}

/* Simple Bar Chart */
.simple-bar-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
@media (max-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
