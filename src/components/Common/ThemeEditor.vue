<template>
  <div class="theme-editor">
    <div class="editor-header">
      <h3>{{ isEditing ? '编辑主题' : '创建主题' }}</h3>
      <button @click="$emit('close')" class="btn-close">✖️</button>
    </div>

    <div class="editor-content">
      <!-- 基本信息 -->
      <div class="form-section">
        <h4>基本信息</h4>
        <div class="form-group">
          <label>主题名称</label>
          <input v-model="themeData.name" type="text" placeholder="输入主题名称" />
        </div>
        <div class="form-group">
          <label>主题类型</label>
          <select v-model="themeData.type">
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </div>
      </div>

      <!-- 颜色配置 -->
      <div class="form-section">
        <h4>主色调</h4>
        <div class="color-grid">
          <div class="color-item">
            <label>主色</label>
            <input v-model="themeData.colors.primary" type="color" />
            <input v-model="themeData.colors.primary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>悬停色</label>
            <input v-model="themeData.colors.primaryHover" type="color" />
            <input v-model="themeData.colors.primaryHover" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>激活色</label>
            <input v-model="themeData.colors.primaryActive" type="color" />
            <input v-model="themeData.colors.primaryActive" type="text" class="color-input" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h4>背景色</h4>
        <div class="color-grid">
          <div class="color-item">
            <label>主背景</label>
            <input v-model="themeData.colors.bgPrimary" type="color" />
            <input v-model="themeData.colors.bgPrimary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>次背景</label>
            <input v-model="themeData.colors.bgSecondary" type="color" />
            <input v-model="themeData.colors.bgSecondary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>三级背景</label>
            <input v-model="themeData.colors.bgTertiary" type="color" />
            <input v-model="themeData.colors.bgTertiary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>悬停背景</label>
            <input v-model="themeData.colors.bgHover" type="color" />
            <input v-model="themeData.colors.bgHover" type="text" class="color-input" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h4>文本色</h4>
        <div class="color-grid">
          <div class="color-item">
            <label>主文本</label>
            <input v-model="themeData.colors.textPrimary" type="color" />
            <input v-model="themeData.colors.textPrimary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>次文本</label>
            <input v-model="themeData.colors.textSecondary" type="color" />
            <input v-model="themeData.colors.textSecondary" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>三级文本</label>
            <input v-model="themeData.colors.textTertiary" type="color" />
            <input v-model="themeData.colors.textTertiary" type="text" class="color-input" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h4>状态色</h4>
        <div class="color-grid">
          <div class="color-item">
            <label>成功</label>
            <input v-model="themeData.colors.successColor" type="color" />
            <input v-model="themeData.colors.successColor" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>警告</label>
            <input v-model="themeData.colors.warningColor" type="color" />
            <input v-model="themeData.colors.warningColor" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>错误</label>
            <input v-model="themeData.colors.errorColor" type="color" />
            <input v-model="themeData.colors.errorColor" type="text" class="color-input" />
          </div>
          <div class="color-item">
            <label>信息</label>
            <input v-model="themeData.colors.infoColor" type="color" />
            <input v-model="themeData.colors.infoColor" type="text" class="color-input" />
          </div>
        </div>
      </div>

      <!-- 预览 -->
      <div class="form-section">
        <h4>预览</h4>
        <div class="theme-preview" :style="previewStyle">
          <div class="preview-card">
            <div class="preview-header">
              <span>预览窗口</span>
              <button class="preview-btn">按钮</button>
            </div>
            <div class="preview-content">
              <p class="preview-text-primary">主要文本</p>
              <p class="preview-text-secondary">次要文本</p>
              <p class="preview-text-tertiary">三级文本</p>
            </div>
            <div class="preview-status">
              <span class="status-success">✓ 成功</span>
              <span class="status-warning">⚠ 警告</span>
              <span class="status-error">✗ 错误</span>
              <span class="status-info">ℹ 信息</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="editor-footer">
      <button @click="$emit('close')" class="btn-secondary">取消</button>
      <button @click="handleSave" class="btn-primary">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Theme } from '@/utils/theme-manager'

interface Props {
  theme?: Theme
}

const props = defineProps<Props>()
const emit = defineEmits<{
  save: [theme: Omit<Theme, 'id'>]
  close: []
}>()

const isEditing = computed(() => !!props.theme)

// 初始化主题数据
const themeData = ref<Omit<Theme, 'id'>>({
  name: props.theme?.name || '新主题',
  type: props.theme?.type || 'dark',
  colors: props.theme?.colors || {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryActive: '#1d4ed8',
    bgPrimary: '#1e1e1e',
    bgSecondary: '#252526',
    bgTertiary: '#2d2d30',
    bgHover: '#2a2d2e',
    bgElevated: '#323233',
    textPrimary: '#cccccc',
    textSecondary: '#9d9d9d',
    textTertiary: '#6e6e6e',
    borderColor: '#3e3e42',
    borderColorHover: '#4e4e52',
    successColor: '#10b981',
    warningColor: '#f59e0b',
    errorColor: '#ef4444',
    infoColor: '#3b82f6',
    terminalBackground: '#1e1e1e',
    terminalForeground: '#cccccc',
    terminalCursor: '#ffffff',
    terminalSelection: 'rgba(255, 255, 255, 0.3)',
    ansiBlack: '#000000',
    ansiRed: '#cd3131',
    ansiGreen: '#0dbc79',
    ansiYellow: '#e5e510',
    ansiBlue: '#2472c8',
    ansiMagenta: '#bc3fbc',
    ansiCyan: '#11a8cd',
    ansiWhite: '#e5e5e5',
    ansiBrightBlack: '#666666',
    ansiBrightRed: '#f14c4c',
    ansiBrightGreen: '#23d18b',
    ansiBrightYellow: '#f5f543',
    ansiBrightBlue: '#3b8eea',
    ansiBrightMagenta: '#d670d6',
    ansiBrightCyan: '#29b8db',
    ansiBrightWhite: '#ffffff'
  }
})

// 预览样式
const previewStyle = computed(() => ({
  '--preview-bg-primary': themeData.value.colors.bgPrimary,
  '--preview-bg-secondary': themeData.value.colors.bgSecondary,
  '--preview-text-primary': themeData.value.colors.textPrimary,
  '--preview-text-secondary': themeData.value.colors.textSecondary,
  '--preview-text-tertiary': themeData.value.colors.textTertiary,
  '--preview-primary': themeData.value.colors.primary,
  '--preview-success': themeData.value.colors.successColor,
  '--preview-warning': themeData.value.colors.warningColor,
  '--preview-error': themeData.value.colors.errorColor,
  '--preview-info': themeData.value.colors.infoColor
}))

const handleSave = () => {
  emit('save', themeData.value)
}
</script>

<style scoped>
.theme-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.editor-header h3 {
  margin: 0;
  font-size: 18px;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.btn-close:hover {
  background: var(--bg-hover);
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.form-section {
  margin-bottom: 24px;
}

.form-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.form-group input[type="text"],
.form-group select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 14px;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.color-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.color-item label {
  font-size: 12px;
  color: var(--text-secondary);
}

.color-item input[type="color"] {
  width: 100%;
  height: 40px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
}

.color-input {
  padding: 6px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: monospace;
}

.theme-preview {
  padding: 20px;
  background: var(--preview-bg-primary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.preview-card {
  background: var(--preview-bg-secondary);
  border-radius: 6px;
  padding: 16px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  color: var(--preview-text-primary);
}

.preview-btn {
  padding: 6px 12px;
  background: var(--preview-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.preview-content {
  margin-bottom: 12px;
}

.preview-text-primary {
  color: var(--preview-text-primary);
  margin: 4px 0;
}

.preview-text-secondary {
  color: var(--preview-text-secondary);
  margin: 4px 0;
}

.preview-text-tertiary {
  color: var(--preview-text-tertiary);
  margin: 4px 0;
}

.preview-status {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-status span {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.status-success {
  background: var(--preview-success);
  color: white;
}

.status-warning {
  background: var(--preview-warning);
  color: white;
}

.status-error {
  background: var(--preview-error);
  color: white;
}

.status-info {
  background: var(--preview-info);
  color: white;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}
</style>
