<template>
  <div class="split-terminal-container">
    <!-- 工具栏 -->
    <div class="split-toolbar">
      <div class="toolbar-left">
        <span class="pane-count">{{ terminals.length }} 个面板</span>
      </div>
      <div class="toolbar-right">
        <button
          @click="addTerminal"
          class="btn-tool"
          title="添加分屏 (Ctrl+Shift+K)"
          :disabled="terminals.length >= maxPanes"
        >
          ➕ 添加分屏
        </button>
        <button
          @click="closeActivePane"
          class="btn-tool"
          title="关闭当前面板 (Ctrl+Shift+W)"
          :disabled="terminals.length <= 1"
        >
          ✖ 关闭
        </button>
      </div>
    </div>

    <!-- Grid 分屏内容 -->
    <div class="split-content grid-layout" :style="gridStyle">
      <div 
        v-for="id in terminals" 
        :key="id"
        class="terminal-pane-wrapper" 
        :class="{ active: id === activeTerminalId }"
        @click="activeTerminalId = id"
      >
        <!-- 头部 -->
        <div class="pane-header">
           <span class="pane-title">终端 {{ id.slice(-6) }}</span>
           <button class="btn-close-pane" @click.stop="closePane(id)" v-if="terminals.length > 1">×</button>
        </div>
        
        <!-- 终端挂载点 -->
        <div class="pane-body">
          <TerminalView 
            :connection-id="id"
            class="h-full w-full"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { terminalManager } from '@/utils/terminal-manager'
import TerminalView from './TerminalView.vue'

interface Props {
  sessionId: string
  maxPanes?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxPanes: 9
})

const emit = defineEmits<{
  terminalCreate: [terminalId: string]
  terminalClose: [terminalId: string]
  terminalFocus: [terminalId: string]
}>()

const terminals = ref<string[]>([])
const activeTerminalId = ref<string>('')

// 初始化第一个终端
const initialId = `terminal-${Date.now()}`
terminals.value.push(initialId)
activeTerminalId.value = initialId

// 计算 Grid 样式
const gridStyle = computed(() => {
  const count = terminals.value.length
  if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }

  // 自动计算行列：尽可能接近正方形，优先增加列数
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: '4px'
  }
})

// 添加分屏
const addTerminal = () => {
  if (terminals.value.length >= props.maxPanes) return
  
  const newId = `terminal-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  
  // 预创建实例 (保留之前的修复)
  terminalManager.getOrCreate(newId, null, {})
  
  terminals.value.push(newId)
  activeTerminalId.value = newId
  emit('terminalCreate', newId)
}

// 关闭特定面板
const closePane = (id: string) => {
  if (terminals.value.length <= 1) return

  const index = terminals.value.indexOf(id)
  if (index > -1) {
    terminals.value.splice(index, 1)
    
    // 如果关闭的是当前激活的，切换激活状态
    if (activeTerminalId.value === id) {
      activeTerminalId.value = terminals.value[Math.max(0, index - 1)]
    }
    
    emit('terminalClose', id)
    terminalManager.destroy(id)
  }
}

// 关闭活动面板
const closeActivePane = () => {
  if (activeTerminalId.value) {
    closePane(activeTerminalId.value)
  }
}

// 供父组件调用的重置
const resetLayout = () => {
  // 只保留第一个，关闭其他
  const toClose = terminals.value.slice(1)
  terminals.value = [terminals.value[0]]
  activeTerminalId.value = terminals.value[0]
  
  toClose.forEach(id => {
    emit('terminalClose', id)
    terminalManager.destroy(id)
  })
}

// 快捷键
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.ctrlKey && event.shiftKey) {
    if (event.code === 'KeyK') { // Add
        event.preventDefault()
        addTerminal()
    } else if (event.code === 'KeyW') { // Close
        event.preventDefault()
        closeActivePane()
    }
  }
}

onMounted(() => {
  // 确保第一个终端也触发创建事件（虽然通常父组件处理了 init）
  // 但对于一致性，我们可以调用一次 pre-create
  terminalManager.getOrCreate(initialId, null, {})
  emit('terminalCreate', initialId)
  
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  // 清理所有终端
  terminals.value.forEach(id => terminalManager.destroy(id))
})

defineExpose({
  addTerminal,
  closeActivePane,
  resetLayout
})
</script>

<style scoped>
.split-terminal-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.split-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-tool {
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.btn-tool:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.btn-tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.split-content {
  flex: 1;
  overflow: hidden;
  padding: 4px; /* Grid gap padding */
  background: var(--bg-tertiary);
}

.grid-layout {
  height: 100%;
  width: 100%;
}

.terminal-pane-wrapper {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 4px;
}

.terminal-pane-wrapper.active {
  border-color: var(--primary-color);
}

.pane-header {
  height: 24px;
  background: var(--bg-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--border-color);
}

.pane-title {
  color: var(--text-secondary);
}

.btn-close-pane {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.btn-close-pane:hover {
  color: var(--error-color);
}

.pane-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}
</style>
