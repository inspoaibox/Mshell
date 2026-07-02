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
      <div class="sidebar-brand">
        <span class="brand-name">MShell</span>
        <span class="brand-subtitle">SSH Console</span>
      </div>
    </div>
    
    <!-- 主导航 -->
    <nav class="sidebar-nav">
      <div class="nav-section-title">Workspace</div>
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
          <span class="nav-label">{{ item.label }}</span>
          <div class="nav-indicator"></div>
        </div>
      </el-tooltip>
    </nav>

    <div class="spacer"></div>

    <!-- 底部导航 -->
    <nav class="sidebar-nav sidebar-nav-bottom">
      <div class="nav-section-title">System</div>
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
          <span class="nav-label">{{ item.label }}</span>
          <div class="nav-indicator"></div>
        </div>
      </el-tooltip>
    </nav>

    <!-- 版本信息 -->
    <div class="sidebar-footer">
      <el-tooltip
        :content="`关于 MShell · ${appVersion}`"
        placement="right"
        :offset="12"
        :show-after="300"
      >
        <button class="about-button" type="button" aria-label="关于 MShell" @click="handleAboutClick">
          <el-icon class="about-icon" :size="18">
            <InfoFilled />
          </el-icon>
          <span class="about-label">关于 · {{ appVersion }}</span>
        </button>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Connection,
  FolderOpened,
  Share,
  Document,
  Tickets,
  Setting,
  DataAnalysis,
  Key,
  Files,
  Timer,
  MagicStick,
  InfoFilled
} from '@element-plus/icons-vue'
import logoImg from '@/assets/logo.png'

const activeMenu = ref('sessions')
const appVersion = ref('v0.2.8')

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
  { index: 'lazy-scripts', label: '懒人脚本', icon: MagicStick },
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
  aboutSelect: []
  version: [v: string]
}>()

const handleMenuSelect = (index: string) => {
  activeMenu.value = index
  emit('menuSelect', index)
}

const handleAboutClick = () => {
  activeMenu.value = 'settings'
  emit('aboutSelect')
}
</script>

<style scoped>
.sidebar {
  width: 52px;
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
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.logo-wrapper {
  position: relative;
}

.sidebar-brand,
.nav-section-title,
.nav-label,
.about-label {
  display: none;
}

.logo-icon {
  width: 34px;
  height: 34px;
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
  width: 38px;
  height: 38px;
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

/* 底部关于入口 */
.sidebar-footer {
  padding: var(--spacing-sm);
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--border-light);
  flex-shrink: 0;
}

.about-button {
  width: 34px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.about-button:hover {
  color: var(--primary-color);
  border-color: var(--border-medium);
  background: var(--bg-hover);
}

.about-icon {
  flex: 0 0 auto;
}

/* 响应式 */
@media (max-height: 600px) {
  .sidebar-header {
    height: 48px;
  }
  
  .logo-icon {
    width: 30px;
    height: 30px;
  }
  
  .logo-image {
    border-radius: var(--radius-md);
  }
  
  .nav-item {
    width: 36px;
    height: 36px;
  }
}

:global(:root.app-appearance-terminal .sidebar) {
  width: 46px;
  background: var(--bg-secondary);
  box-shadow: none;
}

:global(:root.app-appearance-terminal .sidebar-header) {
  height: 40px;
  padding: 5px;
}

:global(:root.app-appearance-terminal .logo-icon) {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

:global(:root.app-appearance-terminal .logo-image) {
  border-radius: var(--radius-sm);
}

:global(:root.app-appearance-terminal .logo-icon:hover) {
  transform: none;
}

:global(:root.app-appearance-terminal .logo-glow) {
  display: none;
}

:global(:root.app-appearance-terminal .sidebar-nav) {
  gap: 2px;
  padding: 8px 5px;
}

:global(:root.app-appearance-terminal .nav-item) {
  width: 34px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

:global(:root.app-appearance-terminal .nav-item::before) {
  border-radius: var(--radius-sm);
}

:global(:root.app-appearance-terminal .nav-item:hover) {
  color: var(--text-primary);
  border-color: var(--border-medium);
}

:global(:root.app-appearance-terminal .nav-item.is-active) {
  color: var(--primary-color);
  background: var(--bg-tertiary);
  border-color: var(--border-medium);
}

:global(:root.app-appearance-terminal .nav-icon),
:global(:root.app-appearance-terminal .nav-item:hover .nav-icon),
:global(:root.app-appearance-terminal .nav-item.is-active .nav-icon) {
  transform: none;
}

:global(:root.app-appearance-terminal .nav-indicator) {
  width: 2px;
  height: 0;
  background: var(--primary-color);
  border-radius: 0;
}

:global(:root.app-appearance-terminal .nav-item.is-active .nav-indicator) {
  height: 20px;
}

:global(:root.app-appearance-terminal .sidebar-footer) {
  padding: 6px 4px;
}

:global(:root.app-appearance-terminal .about-button) {
  width: 34px;
  height: 28px;
  padding: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-tertiary);
}

:global(:root.app-appearance-terminal .about-button:hover) {
  background: var(--bg-tertiary);
  border-color: var(--border-medium);
  color: var(--primary-color);
}

:global(:root.app-appearance-minimal .sidebar) {
  width: 176px !important;
  background: var(--minimal-shell-bg) !important;
  border-right: 1px solid var(--border-strong);
  box-shadow: none;
  overflow-x: hidden;
}

:global(:root.app-appearance-minimal .sidebar-header) {
  height: 58px;
  padding: 9px 12px;
  justify-content: flex-start;
  gap: 10px;
  border-bottom: 1px solid var(--border-strong);
}

:global(:root.app-appearance-minimal .logo-icon) {
  width: 30px;
  height: 30px;
  border-radius: 1px;
  flex: 0 0 30px;
}

:global(:root.app-appearance-minimal .logo-image) {
  border-radius: 1px;
  filter: grayscale(0.2) contrast(1.08);
}

:global(:root.app-appearance-minimal .logo-icon:hover) {
  transform: none;
}

:global(:root.app-appearance-minimal .logo-glow) {
  display: none;
}

:global(:root.app-appearance-minimal .sidebar-brand) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
  font-family: var(--font-mono);
}

:global(:root.app-appearance-minimal .brand-name) {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.15;
}

:global(:root.app-appearance-minimal .brand-subtitle) {
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.1;
  text-transform: uppercase;
}

:global(:root.app-appearance-minimal .sidebar-nav) {
  gap: 2px;
  padding: 8px 8px 4px;
}

:global(:root.app-appearance-minimal .nav-section-title) {
  display: block;
  padding: 10px 6px 5px;
  color: var(--text-disabled);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
}

:global(:root.app-appearance-minimal .nav-item) {
  width: 100%;
  height: 34px;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 9px;
  border-radius: 0;
  border: 1px solid transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

:global(:root.app-appearance-minimal .nav-item::before) {
  content: '>';
  position: static;
  inset: auto;
  display: inline-block;
  width: 10px;
  flex: 0 0 10px;
  border-radius: 0;
  background: transparent;
  color: var(--primary-color);
  font-family: var(--font-mono);
  font-size: 12px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

:global(:root.app-appearance-minimal .nav-item:hover::before),
:global(:root.app-appearance-minimal .nav-item.is-active::before) {
  opacity: 1;
}

:global(:root.app-appearance-minimal .nav-item:hover) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

:global(:root.app-appearance-minimal .nav-item.is-active) {
  color: var(--primary-color);
  background: var(--minimal-shell-active);
  border-color: var(--border-medium);
  box-shadow: inset 3px 0 0 var(--primary-color);
}

:global(:root.app-appearance-minimal .nav-icon),
:global(:root.app-appearance-minimal .nav-item:hover .nav-icon),
:global(:root.app-appearance-minimal .nav-item.is-active .nav-icon) {
  transform: none;
  flex: 0 0 18px;
}

:global(:root.app-appearance-minimal .nav-label) {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: currentColor;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(:root.app-appearance-minimal .nav-indicator) {
  display: none;
}

:global(:root.app-appearance-minimal .sidebar-footer) {
  padding: 8px;
  border-top: 1px solid var(--border-strong);
}

:global(:root.app-appearance-minimal .about-button) {
  width: 100%;
  height: 34px;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 9px;
  border-radius: 0;
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

:global(:root.app-appearance-minimal .about-button:hover) {
  background: var(--bg-tertiary);
  border-color: var(--border-medium);
  color: var(--primary-color);
}

:global(:root.app-appearance-minimal .about-label) {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
