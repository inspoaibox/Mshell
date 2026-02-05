<template>
  <div class="theme-selector">
    <div class="selector-header">
      <h3>主题设置</h3>
      <div class="header-actions">
        <button @click="showEditor = true" class="btn-icon" title="创建主题">
          �?
        </button>
        <button @click="handleImport" class="btn-icon" title="导入主题">
          📥
        </button>
      </div>
    </div>

    <div class="theme-list">
      <!-- 内置主题 -->
      <div class="theme-category">
        <h4>内置主题</h4>
        <div class="theme-grid">
          <div
            v-for="theme in builtInThemes"
            :key="theme.id"
            :class="['theme-card', { active: currentThemeId === theme.id }]"
            @click="selectTheme(theme.id)"
          >
            <div class="theme-preview" :style="getPreviewStyle(theme)">
              <div class="preview-dot" :style="{ background: theme.colors.primary }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.successColor }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.warningColor }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.errorColor }"></div>
            </div>
            <div class="theme-info">
              <div class="theme-name">{{ theme.name }}</div>
              <div class="theme-type">{{ theme.type === 'dark' ? '深色' : '浅色' }}</div>
            </div>
            <div v-if="currentThemeId === theme.id" class="theme-check">�?/div>
          </div>
        </div>
      </div>

      <!-- 自定义主�?-->
      <div v-if="customThemes.length > 0" class="theme-category">
        <h4>自定义主�?/h4>
        <div class="theme-grid">
          <div
            v-for="theme in customThemes"
            :key="theme.id"
            :class="['theme-card', { active: currentThemeId === theme.id }]"
            @click="selectTheme(theme.id)"
          >
            <div class="theme-preview" :style="getPreviewStyle(theme)">
              <div class="preview-dot" :style="{ background: theme.colors.primary }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.successColor }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.warningColor }"></div>
              <div class="preview-dot" :style="{ background: theme.colors.errorColor }"></div>
            </div>
            <div class="theme-info">
              <div class="theme-name">{{ theme.name }}</div>
              <div class="theme-type">{{ theme.type === 'dark' ? '深色' : '浅色' }}</div>
            </div>
            <div class="theme-actions">
              <button @click.stop="editTheme(theme)" class="btn-icon-sm" title="编辑">
                ✏️
              </button>
              <button @click.stop="exportTheme(theme.id)" class="btn-icon-sm" title="导出">
                📤
              </button>
              <button @click.stop="deleteTheme(theme.id)" class="btn-icon-sm" title="删除">
                🗑�?
              </button>
            </div>
            <div v-if="currentThemeId === theme.id" class="theme-check">�?/div>
          </div>
        </div>
      </div>
    </div>

    <!-- 主题编辑�?-->
    <div v-if="showEditor" class="editor-overlay">
      <div class="editor-container">
        <ThemeEditor
          :theme="editingTheme"
          @save="handleSave"
          @close="showEditor = false"
        />
      </div>
    </div>

    <!-- 隐藏的文件输�?-->
    <input
      ref="fileInput"
      type="file"
      accept=".json"
      style="display: none"
      @change="handleFileSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { themeManager, builtInThemes, type Theme } from '@/utils/theme-manager'
import ThemeEditor from './ThemeEditor.vue'

const currentThemeId = ref('')
const customThemes = ref<Theme[]>([])
const showEditor = ref(false)
const editingTheme = ref<Theme | undefined>()
const fileInput = ref<HTMLInputElement>()

// 加载主题
const loadThemes = () => {
  const current = themeManager.getCurrentTheme()
  currentThemeId.value = current.id
  customThemes.value = themeManager.getAllThemes().filter(t => t.id.startsWith('custom-'))
}

// 选择主题
const selectTheme = (themeId: string) => {
  themeManager.setTheme(themeId)
  currentThemeId.value = themeId
}

// 获取预览样式
const getPreviewStyle = (theme: Theme) => ({
  background: theme.colors.bgPrimary,
  borderColor: theme.colors.borderColor
})

// 编辑主题
const editTheme = (theme: Theme) => {
  editingTheme.value = theme
  showEditor.value = true
}

// 保存主题
const handleSave = (themeData: Omit<Theme, 'id'>) => {
  if (editingTheme.value) {
    // 更新现有主题
    themeManager.updateCustomTheme(editingTheme.value.id, themeData)
  } else {
    // 创建新主�?
    const newTheme = themeManager.createCustomTheme(themeData)
    themeManager.setTheme(newTheme.id)
  }
  
  loadThemes()
  showEditor.value = false
  editingTheme.value = undefined
}

// 导出主题
const exportTheme = async (themeId: string) => {
  try {
    const themeJson = themeManager.exportTheme(themeId)
    const theme = themeManager.getAllThemes().find(t => t.id === themeId)
    
    // 创建下载
    const blob = new Blob([themeJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${theme?.name || 'theme'}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to export theme:', error)
    alert('导出主题失败')
  }
}

// 导入主题
const handleImport = () => {
  fileInput.value?.click()
}

const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  
  if (!file) return
  
  try {
    const text = await file.text()
    const theme = themeManager.importTheme(text)
    loadThemes()
    alert(`主题 "${theme.name}" 导入成功`)
  } catch (error) {
    console.error('Failed to import theme:', error)
    alert('导入主题失败�? + (error as Error).message)
  }
  
  // 清空文件输入
  target.value = ''
}

// 删除主题
const deleteTheme = (themeId: string) => {
  if (confirm('确定要删除这个主题吗�?)) {
    themeManager.deleteCustomTheme(themeId)
    loadThemes()
  }
}

onMounted(() => {
  loadThemes()
})
</script>

<style scoped>
.theme-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.selector-header h3 {
  margin: 0;
  font-size: var(--text-xl);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--text-lg);
  transition: all 0.2s;
}

.btn-icon:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.theme-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.theme-category {
  margin-bottom: 32px;
}

.theme-category h4 {
  margin: 0 0 16px 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.theme-card {
  position: relative;
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.theme-card:hover {
  border-color: var(--primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.theme-card.active {
  border-color: var(--primary-color);
  background: var(--bg-hover);
}

.theme-preview {
  height: 80px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
}

.preview-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.theme-info {
  margin-bottom: 8px;
}

.theme-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.theme-type {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.theme-actions {
  display: flex;
  gap: 4px;
}

.btn-icon-sm {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: var(--text-sm);
  transition: all 0.2s;
}

.btn-icon-sm:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.theme-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-base);
  font-weight: bold;
}

.editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.editor-container {
  width: 90%;
  max-width: 800px;
  height: 90%;
  max-height: 800px;
  background: var(--bg-primary);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
</style>
