<template>
  <div class="snippet-panel">
    <!-- 左侧：分类和命令列表 -->
    <div class="snippet-sidebar">
      <!-- 头部 -->
      <div class="sidebar-header">
        <h3>命令片段</h3>
        <el-tooltip content="新建片段" placement="bottom">
          <el-button 
            type="primary" 
            :icon="Plus" 
            circle 
            size="small"
            @click="showDialog = true"
          />
        </el-tooltip>
      </div>

      <!-- 搜索栏 -->
      <div class="sidebar-search">
        <el-input
          v-model="searchQuery"
          placeholder="搜索片段..."
          :prefix-icon="Search"
          clearable
        />
      </div>

      <!-- 分类和命令列表 -->
      <div class="snippet-list">
        <!-- 全部分类 -->
        <div class="category-group">
          <div 
            class="category-header"
            :class="{ expanded: expandedCategories.has('__all__') }"
            @click="toggleCategory('__all__')"
          >
            <el-icon class="expand-icon"><CaretRight /></el-icon>
            <el-icon class="category-icon"><Files /></el-icon>
            <span class="category-name">全部</span>
            <span class="category-count">{{ snippets.length }}</span>
          </div>
          <div v-show="expandedCategories.has('__all__')" class="category-snippets">
            <div
              v-for="snippet in getSnippetsByCategory('')"
              :key="snippet.id"
              class="snippet-item"
              :class="{
                active: selectedSnippet?.id === snippet.id,
                pinned: Boolean(snippet.pinnedAt)
              }"
              @click="selectSnippet(snippet)"
            >
              <el-icon class="snippet-icon"><Document /></el-icon>
              <span class="snippet-name">{{ snippet.name }}</span>
              <el-tag v-if="snippet.shortcut" type="success" size="small" class="shortcut-tag">
                {{ snippet.shortcut }}
              </el-tag>
              <el-tooltip :content="snippet.pinnedAt ? '取消置顶' : '置顶到当前分组顶部'">
                <el-button
                  class="snippet-pin-button"
                  :class="{ active: Boolean(snippet.pinnedAt) }"
                  :icon="Top"
                  text
                  circle
                  size="small"
                  :loading="pinningSnippetId === snippet.id"
                  :aria-label="snippet.pinnedAt ? '取消置顶' : '置顶到当前分组顶部'"
                  @click.stop="togglePinned(snippet)"
                />
              </el-tooltip>
              <span class="usage-badge">{{ snippet.usageCount }}</span>
            </div>
          </div>
        </div>

        <!-- 各个分类 -->
        <div 
          v-for="cat in categories"
          :key="cat"
          class="category-group"
        >
          <div 
            class="category-header"
            :class="{ expanded: expandedCategories.has(cat) }"
            @click="toggleCategory(cat)"
          >
            <el-icon class="expand-icon"><CaretRight /></el-icon>
            <el-icon class="category-icon"><Folder /></el-icon>
            <span class="category-name">{{ cat }}</span>
            <span class="category-count">{{ getCategoryCount(cat) }}</span>
          </div>
          <div v-show="expandedCategories.has(cat)" class="category-snippets">
            <div
              v-for="snippet in getSnippetsByCategory(cat)"
              :key="snippet.id"
              class="snippet-item"
              :class="{
                active: selectedSnippet?.id === snippet.id,
                pinned: Boolean(snippet.pinnedAt)
              }"
              @click="selectSnippet(snippet)"
            >
              <el-icon class="snippet-icon"><Document /></el-icon>
              <span class="snippet-name">{{ snippet.name }}</span>
              <el-tag v-if="snippet.shortcut" type="success" size="small" class="shortcut-tag">
                {{ snippet.shortcut }}
              </el-tag>
              <el-tooltip :content="snippet.pinnedAt ? '取消置顶' : '置顶到当前分组顶部'">
                <el-button
                  class="snippet-pin-button"
                  :class="{ active: Boolean(snippet.pinnedAt) }"
                  :icon="Top"
                  text
                  circle
                  size="small"
                  :loading="pinningSnippetId === snippet.id"
                  :aria-label="snippet.pinnedAt ? '取消置顶' : '置顶到当前分组顶部'"
                  @click.stop="togglePinned(snippet)"
                />
              </el-tooltip>
              <span class="usage-badge">{{ snippet.usageCount }}</span>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="snippets.length === 0" class="empty-list">
          <el-icon :size="48"><DocumentCopy /></el-icon>
          <p>暂无片段</p>
        </div>
      </div>
    </div>

    <!-- 右侧：命令详情 -->
    <div class="snippet-detail">
      <div v-if="selectedSnippet" class="detail-content">
        <!-- 详情头部 -->
        <div class="detail-header">
          <div class="detail-title">
            <h2>{{ selectedSnippet.name }}</h2>
            <div class="detail-meta">
              <el-tag v-if="selectedSnippet.category" size="small">
                {{ selectedSnippet.category }}
              </el-tag>
              <el-tag v-if="selectedSnippet.pinnedAt" type="warning" size="small" effect="plain">
                已置顶
              </el-tag>
              <span class="meta-text">使用 {{ selectedSnippet.usageCount }} 次</span>
              <span class="meta-text">创建于 {{ formatDate(selectedSnippet.createdAt) }}</span>
            </div>
          </div>
          <div class="detail-actions">
            <el-button 
              type="primary" 
              :icon="DocumentCopy"
              @click="useSnippet(selectedSnippet)"
            >
              使用
            </el-button>
            <el-button
              :icon="Edit"
              @click="editSnippet(selectedSnippet)"
            >
              编辑
            </el-button>
            <el-button
              :type="selectedSnippet.pinnedAt ? 'warning' : 'default'"
              :icon="Top"
              :loading="pinningSnippetId === selectedSnippet.id"
              @click="togglePinned(selectedSnippet)"
            >
              {{ selectedSnippet.pinnedAt ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button 
              type="danger" 
              :icon="Delete"
              @click="deleteSnippet(selectedSnippet)"
            >
              删除
            </el-button>
          </div>
        </div>

        <!-- 描述 -->
        <div v-if="selectedSnippet.description" class="detail-section">
          <h4>描述</h4>
          <p class="description-text">{{ selectedSnippet.description }}</p>
        </div>

        <!-- 快捷命令 -->
        <div v-if="selectedSnippet.shortcut" class="detail-section">
          <h4>快捷命令</h4>
          <div class="shortcut-display">
            <el-tag type="success" size="large" effect="dark">
              🚀 {{ selectedSnippet.shortcut }}
            </el-tag>
            <span class="shortcut-hint">在终端输入此快捷命令可快速调用</span>
          </div>
        </div>

        <!-- 命令 -->
        <div class="detail-section">
          <div class="section-header">
            <h4>命令</h4>
            <el-button 
              size="small" 
              text
              :icon="DocumentCopy"
              @click="copyToClipboard(selectedSnippet.command)"
            >
              复制
            </el-button>
          </div>
          <div class="command-block">
            <pre><code>{{ selectedSnippet.command }}</code></pre>
          </div>
        </div>

        <!-- 变量 -->
        <div v-if="selectedSnippet.variables && selectedSnippet.variables.length > 0" class="detail-section">
          <h4>变量</h4>
          <div class="variables-list">
            <el-tag 
              v-for="variable in selectedSnippet.variables"
              :key="variable"
              size="large"
              type="warning"
            >
              ${ {{ variable }} }
            </el-tag>
          </div>
        </div>

        <!-- 标签 -->
        <div v-if="selectedSnippet.tags && selectedSnippet.tags.length > 0" class="detail-section">
          <h4>标签</h4>
          <div class="tags-list">
            <el-tag 
              v-for="tag in selectedSnippet.tags"
              :key="tag"
              size="large"
            >
              {{ tag }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 未选中状态 -->
      <div v-else class="detail-empty">
        <el-icon :size="80"><Document /></el-icon>
        <h3>选择一个命令片段</h3>
        <p>从左侧列表中选择命令片段查看详情</p>
      </div>
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="showDialog"
      :title="editingSnippet ? '编辑片段' : '新建片段'"
      width="600px"
      :close-on-click-modal="false"
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="名称" prop="name">
          <el-input 
            v-model="form.name" 
            placeholder="例如：查看磁盘使用情况"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="命令" prop="command">
          <el-input
            v-model="form.command"
            type="textarea"
            :rows="6"
            placeholder="例如：df -h"
          />
          <div class="form-tip">
            💡 支持变量：${变量名}，例如 ssh ${username}@${host}
          </div>
        </el-form-item>

        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="简要描述该命令的用途"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="分类">
          <el-select
            v-model="form.category"
            placeholder="选择或输入新分类"
            allow-create
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="cat in categories"
              :key="cat"
              :label="cat"
              :value="cat"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="快捷命令（可选）">
          <el-input
            v-model="form.shortcut"
            placeholder="例如：/d 或 /disk"
            maxlength="20"
            show-word-limit
          >
            <template #prepend>/</template>
          </el-input>
          <div class="form-tip">
            💡 在终端输入快捷命令（如 /d）可快速调用此片段
          </div>
        </el-form-item>

        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            placeholder="添加标签（可多选）"
            allow-create
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="tag in allTags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">
          {{ editingSnippet ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 使用片段对话框 -->
    <el-dialog 
      v-model="showUseDialog" 
      title="使用命令片段" 
      width="550px"
      :close-on-click-modal="false"
    >
      <div v-if="usingSnippet">
        <div class="use-snippet-header">
          <h3>{{ usingSnippet.name }}</h3>
          <p v-if="usingSnippet.description">{{ usingSnippet.description }}</p>
        </div>
        
        <div v-if="snippetVariables.length > 0" class="variables-form">
          <h4>填写变量</h4>
          <el-form label-position="top">
            <el-form-item
              v-for="varName in snippetVariables"
              :key="varName"
              :label="`\${${varName}}`"
            >
              <el-input 
                v-model="variableValues[varName]"
                placeholder="输入变量值"
              />
            </el-form-item>
          </el-form>
        </div>

        <div class="final-command">
          <div class="command-header">
            <h4>最终命令</h4>
            <el-button 
              size="small" 
              text
              :icon="DocumentCopy"
              @click="copyToClipboard(finalCommand)"
            >
              复制
            </el-button>
          </div>
          <div class="command-preview">
            <code>{{ finalCommand }}</code>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showUseDialog = false">取消</el-button>
        <el-button type="primary" @click="copyCommand">
          复制并关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus, Search, Edit, Delete, DocumentCopy, Document, Folder, Files, CaretRight, Top
} from '@element-plus/icons-vue'
import { sortSnippetsPinnedFirst } from '@/utils/snippet-order'

interface Snippet {
  id: string
  name: string
  command: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  shortcut?: string
  pinnedAt?: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

const snippets = ref<Snippet[]>([])
const selectedSnippet = ref<Snippet | null>(null)
const searchQuery = ref('')
const expandedCategories = ref<Set<string>>(new Set(['__all__'])) // 默认展开"全部"
const showDialog = ref(false)
const showUseDialog = ref(false)
const editingSnippet = ref<Snippet | null>(null)
const usingSnippet = ref<Snippet | null>(null)
const variableValues = ref<Record<string, string>>({})
const saving = ref(false)
const pinningSnippetId = ref<string | null>(null)
const formRef = ref()

const form = ref({
  name: '',
  command: '',
  description: '',
  category: '',
  tags: [] as string[],
  shortcut: ''
})

const rules = {
  name: [{ required: true, message: '请输入片段名称', trigger: 'blur' }],
  command: [{ required: true, message: '请输入命令', trigger: 'blur' }]
}

onMounted(() => {
  loadSnippets()
})

const loadSnippets = async () => {
  try {
    const result = await window.electronAPI.snippet.getAll()
    if (result.success) {
      const selectedId = selectedSnippet.value?.id
      snippets.value = result.data || []
      selectedSnippet.value = selectedId
        ? snippets.value.find((snippet) => snippet.id === selectedId) || null
        : sortSnippetsPinnedFirst(snippets.value)[0] || null
    } else {
      ElMessage.error(`加载失败: ${result.error}`)
    }
  } catch (error: any) {
    ElMessage.error(`加载失败: ${error.message}`)
  }
}

const categories = computed(() => {
  const cats = new Set<string>()
  snippets.value.forEach(s => {
    if (s.category) cats.add(s.category)
  })
  return Array.from(cats)
})

const allTags = computed(() => {
  const tags = new Set<string>()
  snippets.value.forEach(s => {
    s.tags?.forEach(t => tags.add(t))
  })
  return Array.from(tags)
})

const toggleCategory = (category: string) => {
  if (expandedCategories.value.has(category)) {
    expandedCategories.value.delete(category)
  } else {
    expandedCategories.value.add(category)
  }
}

const getSnippetsByCategory = (category: string) => {
  const query = searchQuery.value.trim().toLowerCase()
  const filtered = snippets.value.filter(snippet => {
    if (category && snippet.category !== category) return false
    if (!query) return true
    return snippet.name.toLowerCase().includes(query) ||
      snippet.command.toLowerCase().includes(query) ||
      snippet.description?.toLowerCase().includes(query)
  })
  return sortSnippetsPinnedFirst(filtered)
}

const snippetVariables = computed(() => {
  if (!usingSnippet.value) return []
  return usingSnippet.value.variables || []
})

const finalCommand = computed(() => {
  if (!usingSnippet.value) return ''
  let cmd = usingSnippet.value.command
  for (const [key, value] of Object.entries(variableValues.value)) {
    cmd = cmd.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value)
  }
  return cmd
})

const getCategoryCount = (category: string) => {
  return snippets.value.filter(s => s.category === category).length
}

const selectSnippet = (snippet: Snippet) => {
  selectedSnippet.value = snippet
}

const togglePinned = async (snippet: Snippet) => {
  if (pinningSnippetId.value) return
  pinningSnippetId.value = snippet.id
  const shouldPin = !snippet.pinnedAt
  try {
    const result = await window.electronAPI.snippet.setPinned(snippet.id, shouldPin)
    if (!result.success) {
      ElMessage.error(`${shouldPin ? '置顶' : '取消置顶'}失败: ${result.error}`)
      return
    }
    await loadSnippets()
    ElMessage.success(shouldPin ? '已置顶到当前分组顶部' : '已取消置顶')
  } catch (error: any) {
    ElMessage.error(`${shouldPin ? '置顶' : '取消置顶'}失败: ${error.message}`)
  } finally {
    pinningSnippetId.value = null
  }
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const editSnippet = (snippet: Snippet) => {
  editingSnippet.value = snippet
  form.value = {
    name: snippet.name,
    command: snippet.command,
    description: snippet.description || '',
    category: snippet.category || '',
    tags: snippet.tags || [],
    shortcut: snippet.shortcut || ''
  }
  showDialog.value = true
}

const deleteSnippet = async (snippet: Snippet) => {
  try {
    await ElMessageBox.confirm(`确定要删除片段 "${snippet.name}" 吗？`, '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.snippet.delete(snippet.id)
    if (result.success) {
      ElMessage.success('删除成功')
      if (selectedSnippet.value?.id === snippet.id) {
        selectedSnippet.value = null
      }
      await loadSnippets()
    } else {
      ElMessage.error(`删除失败: ${result.error}`)
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`删除失败: ${error.message}`)
    }
  }
}

const handleSave = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return

    saving.value = true
    try {
      const regex = /\$\{(\w+)\}/g
      const matches = form.value.command.matchAll(regex)
      const variables = new Set<string>()
      for (const match of matches) {
        variables.add(match[1])
      }

      // 处理快捷命令：确保以 / 开头
      let shortcut = form.value.shortcut.trim()
      if (shortcut && !shortcut.startsWith('/')) {
        shortcut = '/' + shortcut
      }

      const snippetData = {
        name: form.value.name + '',
        command: form.value.command + '',
        description: form.value.description + '',
        category: form.value.category + '',
        tags: [...form.value.tags],
        variables: [...variables],
        shortcut: shortcut || undefined
      }

      let result
      if (editingSnippet.value) {
        result = await window.electronAPI.snippet.update(editingSnippet.value.id, snippetData)
      } else {
        result = await window.electronAPI.snippet.create(snippetData)
      }

      if (result.success) {
        ElMessage.success(editingSnippet.value ? '更新成功' : '添加成功')
        showDialog.value = false
        await loadSnippets()
      } else {
        ElMessage.error(`保存失败: ${result.error}`)
      }
    } catch (error: any) {
      ElMessage.error(`保存失败: ${error.message}`)
    } finally {
      saving.value = false
    }
  })
}

const useSnippet = (snippet: Snippet) => {
  usingSnippet.value = snippet
  variableValues.value = {}
  showUseDialog.value = true
}

const copyCommand = async () => {
  try {
    await navigator.clipboard.writeText(finalCommand.value)
    ElMessage.success('命令已复制到剪贴板')
    
    if (usingSnippet.value) {
      await window.electronAPI.snippet.incrementUsage(usingSnippet.value.id)
      await loadSnippets()
    }
    
    showUseDialog.value = false
  } catch (error: any) {
    ElMessage.error(`复制失败: ${error.message}`)
  }
}

const resetForm = () => {
  form.value = {
    name: '',
    command: '',
    description: '',
    category: '',
    tags: [],
    shortcut: ''
  }
  editingSnippet.value = null
  formRef.value?.resetFields()
}
</script>

<style scoped>
.snippet-panel {
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
}

/* 左侧边栏 */
.snippet-sidebar {
  width: 320px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}

.sidebar-header {
  padding: var(--spacing-lg) var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.sidebar-search {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);
}

/* 命令列表 */
.snippet-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xs) 0;
}

/* 分类组 */
.category-group {
  margin-bottom: var(--spacing-xs);
}

.category-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
  user-select: none;
}

.category-header:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.category-header.expanded {
  color: var(--text-primary);
  font-weight: 600;
}

.expand-icon {
  font-size: var(--text-sm);
  transition: transform var(--transition-fast);
  color: var(--text-tertiary);
}

.category-header.expanded .expand-icon {
  transform: rotate(90deg);
  color: var(--primary-color);
}

.category-icon {
  font-size: var(--text-base);
  color: var(--primary-color);
}

.category-name {
  flex: 1;
  font-size: var(--text-sm);
}

.category-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
  font-weight: 500;
}

.category-header.expanded .category-count {
  background: rgba(14, 165, 233, 0.15);
  color: var(--primary-color);
}

.category-snippets {
  padding-left: 0;
}

.snippet-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  margin: 2px var(--spacing-sm) 2px 28px;
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.snippet-item:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  transform: translateX(2px);
}

.snippet-item.active {
  background: var(--bg-elevated);
  border-color: var(--primary-color);
  box-shadow: var(--shadow-sm);
}

.snippet-item.pinned {
  border-color: color-mix(in srgb, var(--warning-color) 35%, transparent);
}

.snippet-icon {
  color: var(--primary-color);
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.snippet-name {
  flex: 1;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shortcut-tag {
  flex-shrink: 0;
  font-size: var(--text-xs);
  padding: 2px 6px;
  height: 20px;
  line-height: 16px;
}

.snippet-pin-button {
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.45;
  transition:
    opacity var(--transition-fast),
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.snippet-item:hover .snippet-pin-button,
.snippet-pin-button:focus-visible,
.snippet-pin-button.active,
.snippet-pin-button.is-loading {
  opacity: 1;
}

.snippet-pin-button.active {
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
}

.usage-badge {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 8px;
  flex-shrink: 0;
  min-width: 18px;
  text-align: center;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  color: var(--text-tertiary);
  text-align: center;
}

.empty-list p {
  margin-top: var(--spacing-md);
  font-size: var(--text-sm);
}

/* 右侧详情 */
.snippet-detail {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-main);
}

.detail-content {
  padding: var(--spacing-2xl);
  width: 100%;
}

.detail-header {
  margin-bottom: var(--spacing-xl);
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--border-light);
}

.detail-title h2 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.meta-text {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.detail-actions {
  margin-top: var(--spacing-lg);
  display: flex;
  gap: var(--spacing-sm);
}

.detail-section {
  margin-bottom: var(--spacing-xl);
}

.detail-section h4 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: var(--text-xs);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.description-text {
  margin: 0;
  font-size: var(--text-base);
  color: var(--text-secondary);
  line-height: 1.6;
}

.shortcut-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.shortcut-hint {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.command-block {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  overflow-x: auto;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
}

.command-block pre {
  margin: 0;
}

.command-block code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: #2563eb;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  font-weight: 500;
}

/* 深色模式下的代码颜色 */
:global(.dark) .command-block code {
  color: #60a5fa;
}

.variables-list,
.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

/* 空状态 */
.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--spacing-2xl);
  text-align: center;
  color: var(--text-tertiary);
}

.detail-empty h3 {
  margin: var(--spacing-lg) 0 var(--spacing-sm) 0;
  font-size: var(--text-xl);
  color: var(--text-secondary);
}

.detail-empty p {
  margin: 0;
  font-size: var(--text-sm);
}

/* 对话框样式 */
.form-tip {
  margin-top: var(--spacing-sm);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.use-snippet-header h3 {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: var(--text-lg);
  color: var(--text-primary);
}

.use-snippet-header p {
  margin: 0 0 var(--spacing-lg) 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.variables-form {
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.variables-form h4 {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.final-command {
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border: 1px solid var(--primary-color);
  border-radius: var(--radius-md);
}

.command-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.command-header h4 {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--primary-color);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.command-preview {
  padding: var(--spacing-md);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
}

.command-preview code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: #2563eb;
  word-break: break-all;
  font-weight: 500;
}

/* 深色模式下的代码颜色 */
:global(.dark) .command-preview code {
  color: #60a5fa;
}

/* 响应式 */
@media (max-width: 1024px) {
  .snippet-sidebar {
    width: 280px;
  }
  
  .detail-content {
    padding: var(--spacing-lg);
  }
}

/* 动画 */
.snippet-item {
  animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1) backwards;
}

.snippet-item:nth-child(1) { animation-delay: 0.05s; }
.snippet-item:nth-child(2) { animation-delay: 0.1s; }
.snippet-item:nth-child(3) { animation-delay: 0.15s; }
.snippet-item:nth-child(4) { animation-delay: 0.2s; }
.snippet-item:nth-child(5) { animation-delay: 0.25s; }

:global(:root.app-appearance-terminal .snippet-sidebar) {
  width: 292px;
  box-shadow: none;
}

:global(:root.app-appearance-terminal .sidebar-header) {
  padding: 9px 10px;
  background: var(--bg-secondary);
}

:global(:root.app-appearance-terminal .sidebar-header h3) {
  font-family: var(--font-mono);
  font-size: var(--text-base);
}

:global(:root.app-appearance-terminal .sidebar-search) {
  padding: 8px;
}

:global(:root.app-appearance-terminal .category-header) {
  padding: 6px 8px;
  font-family: var(--font-mono);
}

:global(:root.app-appearance-terminal .category-count),
:global(:root.app-appearance-terminal .usage-badge),
:global(:root.app-appearance-terminal .shortcut-tag) {
  border-radius: var(--radius-xs);
}

:global(:root.app-appearance-terminal .snippet-item) {
  margin: 2px 6px 2px 18px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: transparent;
  animation: none;
}

:global(:root.app-appearance-terminal .snippet-item:hover) {
  transform: none;
  background: var(--bg-tertiary);
}

:global(:root.app-appearance-terminal .snippet-item.active) {
  box-shadow: inset 2px 0 0 var(--primary-color);
  background: var(--bg-elevated);
}

:global(:root.app-appearance-terminal .snippet-name),
:global(:root.app-appearance-terminal .detail-title h2),
:global(:root.app-appearance-terminal .detail-section h4) {
  font-family: var(--font-mono);
  letter-spacing: 0;
}

:global(:root.app-appearance-terminal .detail-content) {
  padding: 18px;
}

:global(:root.app-appearance-terminal .detail-header) {
  margin-bottom: 18px;
  padding-bottom: 12px;
}

:global(:root.app-appearance-terminal .detail-title h2) {
  font-size: var(--text-xl);
}

:global(:root.app-appearance-terminal .detail-section) {
  margin-bottom: 18px;
}

:global(:root.app-appearance-terminal .command-block),
:global(:root.app-appearance-terminal .command-preview),
:global(:root.app-appearance-terminal .variables-form),
:global(:root.app-appearance-terminal .final-command) {
  padding: 10px;
}
</style>
