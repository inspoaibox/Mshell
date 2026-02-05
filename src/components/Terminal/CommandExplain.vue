<template>
  <transition name="fade-slide">
    <div v-if="visible" class="command-explain" :style="positionStyle">
      <div class="explain-header">
        <span class="explain-icon">📖</span>
        <span class="explain-title">命令解释</span>
        <el-button 
          type="info" 
          link 
          :icon="Close" 
          @click="handleClose"
          class="close-btn"
        />
      </div>
      
      <div class="explain-content">
        <div class="command-display">
          <code>{{ command }}</code>
        </div>
        
        <!-- 加载中 -->
        <div v-if="loading" class="loading-state">
          <span class="loading-text">正在分析命令...</span>
        </div>
        
        <!-- 本地解释 -->
        <template v-else-if="localExplanation">
          <div class="explanation-summary">
            {{ localExplanation.summary }}
          </div>
          
          <div v-if="localExplanation.parts.length > 1" class="explanation-parts">
            <div class="parts-title">命令分解：</div>
            <div 
              v-for="(part, index) in localExplanation.parts" 
              :key="index"
              class="part-item"
            >
              <code class="part-code">{{ part.part }}</code>
              <span class="part-desc">{{ part.description }}</span>
            </div>
          </div>
        </template>
        
        <!-- AI 解释 -->
        <template v-else-if="aiExplanation">
          <div class="ai-explanation" v-html="formattedAIExplanation"></div>
        </template>
        
        <!-- 无解释 -->
        <div v-else class="no-explanation">
          <span>暂无此命令的解释</span>
          <el-button 
            v-if="!aiRequested"
            size="small" 
            type="primary" 
            @click="requestAIExplanation"
          >
            使用 AI 解释
          </el-button>
        </div>
      </div>
      
      <div class="explain-actions">
        <span class="action-hint">
          <kbd>Esc</kbd> 关闭
        </span>
        <el-button 
          v-if="localExplanation && !aiExplanation && !aiRequested"
          size="small"
          type="primary"
          link
          @click="requestAIExplanation"
        >
          获取更详细的 AI 解释
        </el-button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { getLocalCommandExplanation, type CommandExplanation } from '@/utils/command-intelligence'

interface Props {
  visible: boolean
  command: string
  position: { x: number; y: number }
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  'ai-explain': [command: string]
}>()

const localExplanation = ref<CommandExplanation | null>(null)
const aiExplanation = ref('')
const loading = ref(false)
const aiRequested = ref(false)

const positionStyle = computed(() => {
  const { x, y } = props.position
  
  // 如果位置无效，隐藏弹窗
  if (x <= 0 && y <= 0) {
    return {
      left: '-9999px',
      top: '-9999px',
      visibility: 'hidden'
    }
  }
  
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  
  const POPUP_WIDTH = 450
  const POPUP_HEIGHT = 350
  const CURSOR_OFFSET = 30  // 增加偏移量，避免遮挡光标输入区域
  const MARGIN = 10
  
  let left = x
  let top = y + CURSOR_OFFSET
  let maxHeight: number | null = null
  let showAbove = false
  
  // 检查右边界
  if (left + POPUP_WIDTH > viewportWidth - MARGIN) {
    left = Math.max(MARGIN, viewportWidth - POPUP_WIDTH - MARGIN)
  }
  
  // 计算上下可用空间
  const spaceBelow = viewportHeight - y - CURSOR_OFFSET - MARGIN
  const spaceAbove = y - CURSOR_OFFSET - MARGIN
  
  // 检查底部边界
  if (spaceBelow < POPUP_HEIGHT) {
    if (spaceAbove > spaceBelow) {
      // 上方空间更大
      showAbove = true
      if (spaceAbove >= POPUP_HEIGHT) {
        top = y - POPUP_HEIGHT - CURSOR_OFFSET
      } else {
        top = MARGIN
        maxHeight = spaceAbove
      }
    } else {
      // 下方空间更大或相等，限制高度
      maxHeight = spaceBelow
    }
  }
  
  // 确保不超出左边界
  if (left < MARGIN) {
    left = MARGIN
  }
  
  const style: Record<string, string> = {
    left: `${left}px`,
    top: `${top}px`,
    '--slide-direction': showAbove ? '10px' : '-10px'
  }
  
  if (maxHeight !== null && maxHeight > 0) {
    style.maxHeight = `${maxHeight}px`
  }
  
  return style
})

const formattedAIExplanation = computed(() => {
  if (!aiExplanation.value) return ''
  // 简单的 markdown 转换
  return aiExplanation.value
    .replace(/\n/g, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
})

// 监听命令变化
watch(() => props.command, (newCommand) => {
  if (newCommand && props.visible) {
    // 先尝试本地解释
    localExplanation.value = getLocalCommandExplanation(newCommand)
    aiExplanation.value = ''
    aiRequested.value = false
  }
}, { immediate: true })

watch(() => props.visible, (newVal) => {
  if (!newVal) {
    localExplanation.value = null
    aiExplanation.value = ''
    aiRequested.value = false
  }
})

const handleClose = () => {
  emit('close')
}

const requestAIExplanation = async () => {
  if (!props.command) return
  
  aiRequested.value = true
  loading.value = true
  
  try {
    // 检查 AI API 是否可用
    if (!window.electronAPI?.ai?.request) {
      aiExplanation.value = 'AI 功能未配置'
      return
    }
    
    const prompt = `请详细解释以下 Linux/Unix 命令的作用和用法：

命令：${props.command}

请包含：
1. 命令的主要功能
2. 各个参数/选项的含义
3. 使用示例
4. 注意事项（如有）

请用简洁清晰的中文回答。`

    const result = await window.electronAPI.ai.request('explain', prompt)
    
    if (result?.success && result.data) {
      aiExplanation.value = result.data
    } else {
      aiExplanation.value = result?.error || '获取解释失败'
    }
  } catch (error: any) {
    aiExplanation.value = error?.message || 'AI 请求失败'
  } finally {
    loading.value = false
  }
}

// 暴露方法
defineExpose({
  setAIExplanation: (text: string) => {
    aiExplanation.value = text
    aiRequested.value = true
    loading.value = false
  }
})
</script>

<style scoped>
.command-explain {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(14, 165, 233, 0.2);
  min-width: 400px;
  max-width: 500px;
  max-height: 400px;
  z-index: 2000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.explain-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(139, 92, 246, 0.1));
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.explain-icon {
  font-size: var(--text-lg);
}

.explain-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--primary-color);
  flex: 1;
}

.close-btn {
  opacity: 0.6;
}
.close-btn:hover {
  opacity: 1;
}

.explain-content {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
}

.command-display {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.command-display code {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: var(--text-sm);
  color: var(--success-color);
}

.explanation-summary {
  font-size: var(--text-base);
  color: var(--text-primary);
  margin-bottom: 12px;
  line-height: 1.5;
}

.explanation-parts {
  background: var(--bg-tertiary);
  border-radius: 6px;
  padding: 10px;
}

.parts-title {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.part-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.part-item:last-child {
  border-bottom: none;
}

.part-code {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: var(--text-sm);
  color: var(--primary-color);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.part-desc {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
}

.ai-explanation {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.6;
}

.ai-explanation :deep(code) {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: var(--text-sm);
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--primary-color);
}

.ai-explanation :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

.loading-state {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.loading-text {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.no-explanation {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.explain-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.action-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.action-hint kbd {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: inherit;
  font-size: var(--text-xs);
  margin: 0 2px;
}

/* 动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
