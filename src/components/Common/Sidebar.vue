<template>
  <div class="sidebar">
    <!-- Logo区域 -->
    <div class="sidebar-header">
      <div class="logo-wrapper">
        <div class="logo-icon has-image">
          <img :src="logoImg" alt="Logo" class="logo-image" />
          <div class="logo-glow"></div>
        </div>
      </div>
    </div>
    
    <!-- 主导航 -->
    <nav class="sidebar-nav">
      <el-tooltip 
        v-for="item in mainMenuItems" 
        :key="item.index"
        :content="item.label" 
        placement="right" 
        :offset="12"
        :show-after="300"
      >
        <div 
          class="nav-item"
          :class="{ 'is-active': activeMenu === item.index }"
          @click="handleMenuSelect(item.index)"
        >
          <el-icon class="nav-icon" :size="20">
            <component :is="item.icon" />
          </el-icon>
          <div class="nav-indicator"></div>
        </div>
      </el-tooltip>
    </nav>

    <div class="spacer"></div>

    <!-- 底部导航 -->
    <nav class="sidebar-nav sidebar-nav-bottom">
      <el-tooltip 
        v-for="item in bottomMenuItems" 
        :key="item.index"
        :content="item.label" 
        placement="right" 
        :offset="12"
        :show-after="300"
      >
        <div 
          class="nav-item"
          :class="{ 'is-active': activeMenu === item.index }"
          @click="handleMenuSelect(item.index)"
        >
          <el-icon class="nav-icon" :size="20">
            <component :is="item.icon" />
          </el-icon>
          <div class="nav-indicator"></div>
        </div>
      </el-tooltip>
    </nav>

    <!-- 版本信息 -->
    <div class="sidebar-footer">
      <div class="version-badge">{{ appVersion }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Connection, FolderOpened, Share, Document, Tickets, Setting, DataAnalysis, Key, Files, Timer } from '@element-plus/icons-vue'
import logoImg from '@/assets/logo.png'

const activeMenu = ref('sessions')
const appVersion = ref('v0.1.3')

onMounted(async () => {
  if (window.electronAPI.app && window.electronAPI.app.getVersion) {
    try {
      const version = await window.electronAPI.app.getVersion()
      appVersion.value = `v${version}`
    } catch (e) {
      console.error('Failed to get app version:', e)
    }
  }
})

const mainMenuItems = [
  { index: 'sessions', label: '会话管理', icon: Connection },
  { index: 'templates', label: '会话模板', icon: Document },
  { index: 'sftp', label: '文件传输', icon: FolderOpened },
  { index: 'port-forward', label: '端口转发', icon: Share },
  { index: 'snippets', label: '命令片段', icon: Document },
  { index: 'statistics', label: '统计分析', icon: DataAnalysis },
  { index: 'tasks', label: '任务调度', icon: Timer },
  { index: 'workflows', label: '工作流', icon: Files }
]

const bottomMenuItems = [
  { index: 'keys', label: 'SSH密钥', icon: Key },
  { index: 'logs', label: '日志记录', icon: Tickets },
  { index: 'settings', label: '设置', icon: Setting }
]

const emit = defineEmits<{
  menuSelect: [index: string]
  version: [v: string]
}>()

const handleMenuSelect = (index: string) => {
  activeMenu.value = index
  emit('menuSelect', index)
}
</script>

<style scoped>
.sidebar {
  width: 72px;
  height: 100%;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  transition: background-color var(--transition-normal), border-color var(--transition-normal);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10;
  box-shadow: var(--shadow-lg);
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 隐藏滚动条但保持滚动功能 */
.sidebar::-webkit-scrollbar {
  width: 4px;
}

.sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 2px;
}

.sidebar::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* Logo区域 */
.sidebar-header {
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.logo-wrapper {
  position: relative;
}

.logo-icon {
  width: 44px;
  height: 44px;
  background: transparent;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.logo-icon.has-image {
  background: transparent;
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: var(--radius-lg);
  z-index: 2;
}

.logo-icon:hover {
  transform: scale(1.05) rotate(-5deg);
  /* box-shadow: var(--shadow-glow); */
}

/* Optional: keep glow behind if desired, but image might cover it */
.logo-glow {
  position: absolute;
  inset: -4px;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border-radius: var(--radius-lg);
  opacity: 0;
  filter: blur(12px);
  transition: opacity var(--transition-normal);
  z-index: 0;
}

.logo-icon:hover .logo-glow {
  opacity: 0.6;
}

/* 导航区域 */
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md) var(--spacing-sm);
  flex-shrink: 0;
}

.sidebar-nav-bottom {
  padding-bottom: var(--spacing-sm);
  flex-shrink: 0;
}

.nav-item {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  color: var(--text-tertiary);
  cursor: pointer;
  position: relative;
  transition: all var(--transition-fast);
  background: transparent;
}

.nav-item::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius-lg);
  background: var(--bg-hover);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.nav-item:hover::before {
  opacity: 1;
}

.nav-item:hover {
  color: var(--text-primary);
}

.nav-item.is-active {
  color: var(--primary-color);
  background: rgba(14, 165, 233, 0.12);
}

.nav-item.is-active::before {
  opacity: 0;
}

.nav-icon {
  position: relative;
  z-index: 1;
  transition: transform var(--transition-fast);
}

.nav-item:hover .nav-icon {
  transform: scale(1.1);
}

.nav-item.is-active .nav-icon {
  transform: scale(1.05);
}

/* 激活指示器 */
.nav-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 0;
  background: linear-gradient(180deg, var(--primary-color), var(--accent-color));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  transition: height var(--transition-normal);
}

.nav-item.is-active .nav-indicator {
  height: 24px;
}

/* 间隔 */
.spacer {
  flex: 1;
  min-height: var(--spacing-md);
}

/* 底部版本信息 */
.sidebar-footer {
  padding: var(--spacing-sm);
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--border-light);
  flex-shrink: 0;
}

.version-badge {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-weight: 500;
  letter-spacing: 0.5px;
}

/* 响应式 */
@media (max-height: 600px) {
  .sidebar-header {
    height: 60px;
  }
  
  .logo-icon {
    width: 36px;
    height: 36px;
  }
  
  .logo-image {
    border-radius: var(--radius-md);
  }
  
  .nav-item {
    width: 48px;
    height: 48px;
  }
}
</style>
