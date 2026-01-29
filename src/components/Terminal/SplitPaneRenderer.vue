<template>
  <div class="split-pane-renderer">
    <!-- 单个面板 -->
    <div
      v-if="node.type === 'single'"
      :class="['terminal-pane', { active: isActive }]"
      @click="$emit('paneClick', node.id)"
    >
      <div class="pane-header">
        <span class="pane-title">终端 {{ node.terminalId }}</span>
        <button
          @click.stop="$emit('paneClose', node.id)"
          class="btn-close"
          title="关闭"
        >
          ✖
        </button>
      </div>
      <div class="pane-content" :id="`terminal-pane-${node.terminalId}`">
        <!-- 内容将通过 Teleport 传送过来 -->
      </div>
    </div>

    <!-- 分屏面板 -->
    <SplitPane
      v-else-if="node.type === 'split' && node.children"
      :direction="node.direction!"
      :initial-size="node.children[0].size || 50"
      @resize="(size) => $emit('resize', node.children![0].id, size)"
    >
      <template #first>
        <SplitPaneRenderer
          :node="node.children[0]"
          :active-pane-id="activePaneId"
          @pane-click="$emit('paneClick', $event)"
          @pane-close="$emit('paneClose', $event)"
          @resize="(paneId, size) => $emit('resize', paneId, size)"
        />
      </template>

      <template #second>
        <SplitPaneRenderer
          :node="node.children[1]"
          :active-pane-id="activePaneId"
          @pane-click="$emit('paneClick', $event)"
          @pane-close="$emit('paneClose', $event)"
          @resize="(paneId, size) => $emit('resize', paneId, size)"
        />
      </template>
    </SplitPane>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SplitNode } from '@/utils/split-layout-manager'
import SplitPane from './SplitPane.vue'

interface Props {
  node: SplitNode
  activePaneId: string
}

const props = defineProps<Props>()

defineEmits<{
  paneClick: [paneId: string]
  paneClose: [paneId: string]
  resize: [paneId: string, size: number]
}>()

const isActive = computed(() => props.node.id === props.activePaneId)
</script>

<style scoped>
.split-pane-renderer {
  width: 100%;
  height: 100%;
}

.terminal-pane {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.terminal-pane.active {
  border-color: var(--primary-color);
}

.pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.pane-title {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.2s;
}

.btn-close:hover {
  background: var(--error-color);
  color: white;
}

.pane-content {
  flex: 1;
  overflow: hidden;
}
</style>
