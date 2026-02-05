<template>
  <div 
    v-if="visible && ghostText" 
    class="ghost-text-overlay"
    :style="overlayStyle"
  >
    <span class="ghost-text">{{ ghostText }}</span>
    <span class="ghost-hint">Tab</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  visible: boolean
  ghostText: string
  cursorPosition: { x: number; y: number }
  fontSize?: number
  fontFamily?: string
}

const props = withDefaults(defineProps<Props>(), {
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace'
})

const overlayStyle = computed(() => ({
  left: `${props.cursorPosition.x}px`,
  top: `${props.cursorPosition.y}px`,
  fontSize: `${props.fontSize}px`,
  fontFamily: props.fontFamily,
  lineHeight: '20px'
}))
</script>

<style scoped>
.ghost-text-overlay {
  position: fixed;
  pointer-events: none;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ghost-text {
  color: rgba(148, 163, 184, 0.5);
  font-family: inherit;
  white-space: pre;
}

.ghost-hint {
  background: rgba(14, 165, 233, 0.2);
  color: rgba(14, 165, 233, 0.7);
  font-size: var(--text-xs);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: system-ui, sans-serif;
}

/* 深色模式 */
:global(.dark) .ghost-text {
  color: rgba(148, 163, 184, 0.4);
}
</style>
