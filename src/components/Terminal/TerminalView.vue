<template>
  <div
    ref="terminalContainer"
    class="terminal-container"
    :class="{ 'has-background-image': hasBackgroundImage }"
  ></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { TerminalSearchController, type TerminalSearchOptions, type TerminalSearchResult } from '@/utils/terminal-search'
import { getTheme } from '@/utils/terminal-themes'
import { terminalManager, isSensitiveInputPrompt } from '@/utils/terminal-manager'
import { terminalShortcutsManager } from '@/utils/terminal-shortcuts'
import { buildTerminalInsertPayload } from '@/utils/terminal-command-execution'
import { isSingleLineCommand } from '@/utils/autocomplete/input'
import { useAIStore } from '@/stores/ai'
import { useAppStore } from '@/stores/app'
import { ElMessage } from 'element-plus'
import {
  hasActiveTerminalBackground,
  type TerminalBackgroundConfig
} from '@/types/terminal-background'
import 'xterm/css/xterm.css'

interface TerminalOptions {
  theme?: any
  fontSize?: number
  fontFamily?: string
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  rendererType?: 'auto' | 'dom' | 'canvas' | 'webgl'
  copyOnSelect?: boolean
  background?: TerminalBackgroundConfig
}

interface Props {
  connectionId: string
  sessionName?: string
  searchVisible?: boolean
  intelligence?: { commandExplain: boolean; aiCommandSuggest: boolean }
  options?: TerminalOptions
}

const props = withDefaults(defineProps<Props>(), {
  sessionName: 'Unknown Session',
  options: () => ({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    rendererType: 'auto'
  })
})

const emit = defineEmits<{
  data: [data: string]
  resize: [cols: number, rows: number]
  input: [input: string]
  cursorPosition: [position: { x: number; y: number }]
  'ai-request': [text: string]
  'ssh-output': [output: string]
  'search-result': [result: TerminalSearchResult]
}>()

const aiStore = useAIStore()
const appStore = useAppStore()

// 计算属性：检查是否有默认模型
const hasDefaultModel = computed(() => aiStore.hasDefaultModel)
const isActiveTerminal = computed(() => appStore.activeTab === props.connectionId)
const isVisibleActiveTerminal = computed(
  () => appStore.activeView === 'sessions' && isActiveTerminal.value
)
const hasBackgroundImage = computed(() => hasActiveTerminalBackground(props.options.background))

const terminalContainer = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let searchController: TerminalSearchController | null = null
let resizeObserver: ResizeObserver | null = null
let scheduledFitTimers: ReturnType<typeof setTimeout>[] = []

const normalizeDataForRemote = (data: string) => (data === '\b' ? '\x7F' : data)

const getCurrentTerminalLine = () => {
  if (!terminal) return ''

  try {
    const buffer = terminal.buffer.active
    const lineIndex = buffer.baseY + buffer.cursorY
    return buffer.getLine(lineIndex)?.translateToString(true) || ''
  } catch {
    return ''
  }
}

const resolveTerminalTheme = (options: TerminalOptions) => {
  const theme =
    typeof options.theme === 'string' ? getTheme(options.theme) : options.theme || getTheme('dark')

  if (!hasActiveTerminalBackground(options.background)) {
    return theme
  }

  return {
    ...theme,
    background: 'rgba(0, 0, 0, 0)'
  }
}

const hasUsableTerminalSize = () => {
  if (!terminalContainer.value) return false

  const rect = terminalContainer.value.getBoundingClientRect()
  return rect.width > 20 && rect.height > 20
}

const fitAndSyncRemote = () => {
  if (!isVisibleActiveTerminal.value || !hasUsableTerminalSize()) return

  const instance = terminalManager.get(props.connectionId)
  if (instance) {
    terminalManager.fit(props.connectionId)
    terminalManager.reveal(props.connectionId)
  } else {
    fitAddon?.fit()
    if (terminal && terminal.cols > 0 && terminal.rows > 0) {
      window.electronAPI.ssh.resize(props.connectionId, terminal.cols, terminal.rows)
    }
  }
}

const clearScheduledFits = () => {
  for (const timer of scheduledFitTimers) {
    clearTimeout(timer)
  }
  scheduledFitTimers = []
}

const scheduleFitAndFocus = (delays = [50]) => {
  clearScheduledFits()

  for (const delay of delays) {
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        try {
          fitAndSyncRemote()

          if (isVisibleActiveTerminal.value && hasUsableTerminalSize()) {
            terminalManager.reveal(props.connectionId)
            if (!props.searchVisible) terminal?.focus()
          }
        } catch (e) {
          console.error('Scheduled fit error:', e)
        }
      })
    }, delay)

    scheduledFitTimers.push(timer)
  }
}

onMounted(() => {
  if (!terminalContainer.value) return

  // 加载 AI 配置
  aiStore.loadConfig().catch((err) => {
    console.error('Failed to load AI config:', err)
  })

  const theme = resolveTerminalTheme(props.options)

  // 使用全局管理器获取或创建终端实例
  const instance = terminalManager.getOrCreate(props.connectionId, terminalContainer.value, {
    ...props.options,
    theme
  })
  terminalManager.setRendererMode(props.connectionId, {
    ...props.options,
    theme
  })

  terminal = instance.terminal
  fitAddon = instance.fitAddon
  searchController = new TerminalSearchController(terminal, instance.searchAddon, result => emit('search-result', result))
  terminalManager.setSearchActive(props.connectionId, props.searchVisible === true)

  // 每次组件挂载时，更新回调引用（解决闭包陷阱问题）
  // 这样即使组件重新挂载，回调也会指向正确的 emit 函数
  console.log(`[TerminalView] onMounted: Setting callbacks for ${props.connectionId}`)
  terminalManager.setInputCallback(props.connectionId, (_data: string, lineBuffer: string) => {
    emit('input', lineBuffer)
  })

  terminalManager.setCursorCallback(props.connectionId, (position: { x: number; y: number }) => {
    emit('cursorPosition', position)
  })

  terminalManager.setDataCallback(props.connectionId, (data: string) => {
    emit('data', data)
  })

  terminalManager.setOutputCallback(props.connectionId, (data: string) => {
    emit('ssh-output', data)
  })

  instance.terminalInputHandler = (data: string) => {
    const inst = terminalManager.get(props.connectionId)
    if (!inst) return
    const term = inst.terminal
    const sensitive = inst.echoEnabled === false || isSensitiveInputPrompt(getCurrentTerminalLine())
    const shell = term.buffer.active.type === 'normal' && !sensitive
    if (sensitive) inst.echoEnabled = false
    if (!shell) inst.inputState.reset(false)
    else if (!inst.inputState.ready) inst.inputState.observePrompt(getCurrentTerminalLine())
    const snapshot = inst.inputState.snapshot()
    if (shell && snapshot.ready && snapshot.valid && (data === '\r' || data === '\n')) {
      if (props.intelligence?.commandExplain && snapshot.text.trimStart().startsWith('?')) {
        window.electronAPI.ssh.write(props.connectionId, '\x15\x0b')
        inst.inputState.replace('')
        inst.inputCallback?.('', '')
        return
      }
      if (props.intelligence?.aiCommandSuggest && snapshot.text.startsWith('#')) {
        // AI generation and confirmation own Enter; never submit the query as a shell command.
        return
      }
    }
    const submitted = shell ? inst.inputState.feed(data) : undefined
    if (submitted?.trim()) void recordCommand(submitted.trim())
    inst.inputCallback?.(data, shell && inst.inputState.canSuggest ? inst.inputState.snapshot().text : '')
    if (terminalContainer.value && inst.cursorCallback) {
      const rect = terminalContainer.value.getBoundingClientRect()
      const dims = (term as any)._core?._renderService?.dimensions
      const cellWidth = dims?.css?.cell?.width || (term.options.fontSize || 14) * 0.6
      const cellHeight = dims?.css?.cell?.height || (term.options.fontSize || 14) * 1.2
      if (rect.width > 0 && rect.height > 0) inst.cursorCallback({
        x: rect.left + 4 + term.buffer.active.cursorX * cellWidth,
        y: rect.top + 4 + term.buffer.active.cursorY * cellHeight
      })
    }
    const remoteData = normalizeDataForRemote(data)
    if (!sensitive) inst.dataCallback?.(remoteData)
    window.electronAPI.ssh.write(props.connectionId, remoteData, sensitive)
    try { window.electronAPI.connectionStats?.updateTraffic?.(props.connectionId, 0, new Blob([remoteData]).size) } catch {}
  }

  if (!instance.handlersRegistered) {
    instance.handlersRegistered = true
    terminal.onData(data => terminalManager.get(props.connectionId)?.terminalInputHandler?.(data))

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      emit('resize', cols, rows)
      window.electronAPI.ssh.resize(props.connectionId, cols, rows)
    })
  }

  // Right-click context menu for copy/paste and AI features
  if (terminalContainer.value) {
    terminalContainer.value.addEventListener('contextmenu', async (e) => {
      e.preventDefault()
      const selection = terminal?.getSelection()

      // Show context menu via Electron
      const menuItems = []

      // 基础操作
      if (selection) {
        menuItems.push({
          label: '复制',
          accelerator: terminalShortcutsManager.format('copy'),
          action: 'copy'
        })
      }

      menuItems.push({
        label: '粘贴',
        accelerator: terminalShortcutsManager.format('paste'),
        action: 'paste'
      })

      menuItems.push({ type: 'separator' })

      menuItems.push({
        label: '全选',
        accelerator: terminalShortcutsManager.format('selectAll'),
        action: 'selectAll'
      })

      menuItems.push({
        label: '清屏',
        accelerator: terminalShortcutsManager.format('clear'),
        action: 'clear'
      })

      // AI 功能菜单
      menuItems.push({ type: 'separator' })

      const aiEnabled = hasDefaultModel.value
      const aiLabel = aiEnabled ? 'AI 助手' : 'AI 助手 (未配置)'

      menuItems.push({
        label: aiLabel,
        enabled: aiEnabled,
        submenu: [
          {
            label: 'AI 撰写代码',
            action: 'ai-write',
            enabled: aiEnabled
          },
          {
            label: selection ? 'AI 解释代码' : 'AI 解释代码 (需要选中代码)',
            action: 'ai-explain',
            enabled: aiEnabled && !!selection
          },
          {
            label: selection ? 'AI 优化代码' : 'AI 优化代码 (需要选中代码)',
            action: 'ai-optimize',
            enabled: aiEnabled && !!selection
          }
        ]
      })

      // Request context menu from main process
      const result = await window.electronAPI.dialog.showContextMenu(menuItems)

      // 处理基础操作
      if (result === 'copy' && selection) {
        await navigator.clipboard.writeText(selection)
      } else if (result === 'paste') {
        const text = await navigator.clipboard.readText()
        if (text) {
          // 统一换行符：将 \r\n 和单独的 \n 都转为 \r（SSH 终端标准）
          const normalizedText = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
          // 只在远端启用了 bracketed paste mode 时才包裹序列
          const inst = terminalManager.get(props.connectionId)
          const pasteText = inst?.bracketedPasteEnabled
            ? `\x1b[200~${normalizedText}\x1b[201~`
            : normalizedText
          window.electronAPI.ssh.write(props.connectionId, pasteText)
          if (inst) {
            if (inst.echoEnabled && inst.terminal.buffer.active.type === 'normal') inst.inputState.feed(text)
            else inst.inputState.reset(false)
            inst.inputCallback?.('', inst.inputState.canSuggest ? inst.inputState.snapshot().text : '')
          }
        }
      } else if (result === 'selectAll') {
        terminal?.selectAll()
      } else if (result === 'clear') {
        terminal?.clear()
      }
      // 处理 AI 操作
      else if (result === 'ai-write') {
        await handleAIWrite(selection || '')
      } else if (result === 'ai-explain') {
        if (selection) {
          await handleAIExplain(selection)
        }
      } else if (result === 'ai-optimize') {
        if (selection) {
          await handleAIOptimize(selection)
        }
      }
    })
  }

  // Setup resize observer with debounce to prevent flickering during sidebar animations
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null
  let lastWidth = 0
  let lastHeight = 0

  resizeObserver = new ResizeObserver((entries) => {
    if (!fitAddon || !terminal || !terminalContainer.value || !isVisibleActiveTerminal.value) return

    for (const entry of entries) {
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) return

      // Skip if size hasn't changed significantly (avoid micro-adjustments during animation)
      if (Math.abs(width - lastWidth) < 5 && Math.abs(height - lastHeight) < 5) return

      lastWidth = width
      lastHeight = height
    }

    // Clear previous timeout to debounce rapid resize events
    if (resizeTimeout) {
      clearTimeout(resizeTimeout)
    }

    // Debounce fit() call - wait for sidebar animation to complete (300ms transition + buffer)
    resizeTimeout = setTimeout(() => {
      requestAnimationFrame(() => {
        try {
          fitAndSyncRemote()
        } catch (e) {
          console.error('Fit error:', e)
        }
      })
    }, 150) // Wait for animation to settle
  })

  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value)
  }

  setTimeout(() => {
    try {
      if (!isVisibleActiveTerminal.value) return
      console.log(`[TerminalView] Delayed initial fit for ${props.connectionId}`)
      fitAndSyncRemote()
      if (!props.searchVisible) terminal?.focus() // 自动聚焦
    } catch (e) {
      console.error('Initial fit error:', e)
    }
  }, 300)
})

onUnmounted(() => {
  console.log(`[TerminalView] Unmounting terminal view for ${props.connectionId}`)

  clearScheduledFits()

  // 清理回调引用
  console.log(`[TerminalView] Clearing callbacks for ${props.connectionId}`)
  const instance = terminalManager.get(props.connectionId)
  if (instance) instance.terminalInputHandler = null
  terminalManager.setInputCallback(props.connectionId, null)
  terminalManager.setCursorCallback(props.connectionId, null)
  terminalManager.setDataCallback(props.connectionId, null)
  terminalManager.setOutputCallback(props.connectionId, null)

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  searchController?.dispose()
  searchController = null
  terminalManager.setSearchActive(props.connectionId, false)
  terminal = null
  fitAddon = null

  console.log(`[TerminalView] Unmount completed for ${props.connectionId}`)
})

// 记录命令到历史
const recordCommand = async (command: string) => {
  try {
    // 过滤掉 # 开头的命令（AI 查询命令）
    if (command.startsWith('#')) {
      console.log('[TerminalView] Skipping AI query command:', command)
      return
    }


    await window.electronAPI.commandHistory?.add?.({
      command,
      sessionId: props.connectionId,
      sessionName: props.sessionName || 'Unknown Session',
      duration: undefined
    })

    try {
      await window.electronAPI.connectionStats?.incrementCommand?.(props.connectionId)
    } catch (error) {
      // 忽略统计错误
    }
  } catch (error) {
    console.error('Failed to record command:', error)
  }
}

// AI 操作处理函数
const handleAIWrite = async (description: string) => {
  if (!hasDefaultModel.value) {
    ElMessage.warning('请先在设置中配置 AI 默认模型')
    return
  }

  if (!description) {
    ElMessage.warning('请输入描述')
    return
  }

  const template =
    aiStore.config.prompts?.write ||
    `Write code based on this description: {content}\n\nLanguage: {language}\n\nReturn only the code without explanations or markdown code blocks.`
  const prompt = template.replace('{content}', description).replace(/{language}/g, 'unknown')
  emit('ai-request', prompt)
}

const handleAIExplain = async (code: string) => {
  if (!hasDefaultModel.value) {
    ElMessage.warning('请先在设置中配置 AI 默认模型')
    return
  }

  if (!code) {
    ElMessage.warning('请先选中要解释的代码')
    return
  }

  const template =
    aiStore.config.prompts?.explain ||
    `请作为一名资深开发人员，详细分析并解释以下代码片段的主要功能和目的。\n\n\`\`\`{language}\n{content}\n\`\`\``
  const prompt = template.replace('{content}', code).replace(/{language}/g, 'unknown')
  emit('ai-request', prompt)
}

const handleAIOptimize = async (code: string) => {
  if (!hasDefaultModel.value) {
    ElMessage.warning('请先在设置中配置 AI 默认模型')
    return
  }

  if (!code) {
    ElMessage.warning('请先选中要优化的代码')
    return
  }

  const template =
    aiStore.config.prompts?.optimize ||
    `Optimize this code:\n\n\`\`\`{language}\n{content}\n\`\`\`\n\nReturn only the optimized code without explanations or markdown code blocks.`
  const prompt = template.replace('{content}', code).replace(/{language}/g, 'unknown')
  emit('ai-request', prompt)
}

// Watch for option changes
watch(
  () => props.options,
  (newOptions) => {
    if (!terminal) return

    if (newOptions.fontSize) {
      terminal.options.fontSize = newOptions.fontSize
    }
    if (newOptions.fontFamily) {
      terminal.options.fontFamily = newOptions.fontFamily
    }
    if (newOptions.cursorStyle) {
      terminal.options.cursorStyle = newOptions.cursorStyle
    }
    if (newOptions.cursorBlink !== undefined) {
      terminal.options.cursorBlink = newOptions.cursorBlink
    }
    if (newOptions.scrollback) {
      terminal.options.scrollback = newOptions.scrollback
    }
    if (newOptions.theme) {
      const theme = resolveTerminalTheme(newOptions)
      terminal.options.theme = theme
      terminalManager.setRendererMode(props.connectionId, {
        ...newOptions,
        theme
      })
    } else {
      terminalManager.setRendererMode(props.connectionId, newOptions)
    }

    // 更新选中自动复制设置
    if (newOptions.copyOnSelect !== undefined) {
      terminalManager.setCopyOnSelect(props.connectionId, newOptions.copyOnSelect)
    }

    // Refit after options change
    if (fitAddon && isVisibleActiveTerminal.value) {
      scheduleFitAndFocus([50, 200])
    }
  },
  { deep: true }
)

watch(isVisibleActiveTerminal, async (visible) => {
  if (!visible) return

  await nextTick()
  scheduleFitAndFocus([50, 200, 400])
})

// Expose methods for parent components
watch(() => props.searchVisible, visible => {
  terminalManager.setSearchActive(props.connectionId, visible === true)
  if (!visible) searchController?.clear()
})

defineExpose({
  write: (data: string) => {
    if (terminal) {
      terminal.write(data)
    }
  },
  clear: () => {
    if (terminal) {
      terminal.clear()
    }
  },
  focus: () => {
    if (terminal && isVisibleActiveTerminal.value) {
      terminal.focus()
    }
  },
  fit: () => {
    fitAndSyncRemote()
  },
  // 更新当前命令缓冲（用于自动补全后同步状态）
  updateCommandBuffer: (newCommand: string) => terminalManager.get(props.connectionId)?.inputState.replace(newCommand),
  getCurrentCommand: () => terminalManager.get(props.connectionId)?.inputState.snapshot().text || '',
  getInputSnapshot: () => terminalManager.get(props.connectionId)?.inputState.snapshot(),
  canUseIntelligence: () => {
    const inst = terminalManager.get(props.connectionId)
    return !!inst && isVisibleActiveTerminal.value && inst.echoEnabled && inst.terminal.buffer.active.type === 'normal' && inst.inputState.canSuggest
  },
  replaceIntelligenceInput: (text: string, expected: string, execute = false) => {
    const inst = terminalManager.get(props.connectionId)
    if (!inst || !isVisibleActiveTerminal.value || !inst.echoEnabled || inst.terminal.buffer.active.type !== 'normal' ||
      !inst.inputState.canSuggest || inst.inputState.snapshot().text !== expected || (text && !isSingleLineCommand(text))) return false
    const erase = '\x15\x0b'
    if (execute) { inst.inputState.reset(false); void recordCommand(text) }
    else inst.inputState.replace(text)
    window.electronAPI.ssh.write(props.connectionId, erase + buildTerminalInsertPayload(text, inst.bracketedPasteEnabled) + (execute ? '\r' : ''))
    inst.inputCallback?.('', '')
    return true
  },
  search: (term: string, options?: TerminalSearchOptions) => searchController?.search(term, options),
  findNext: () => searchController?.next(),
  findPrevious: () => searchController?.previous()
})
</script>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto;
}

.terminal-container.has-background-image,
.terminal-container.has-background-image :deep(.xterm),
.terminal-container.has-background-image :deep(.xterm-screen),
.terminal-container.has-background-image :deep(.xterm-viewport),
.terminal-container.has-background-image :deep(.xterm-scroll-area) {
  background: transparent !important;
}

.terminal-container.has-background-image :deep(.xterm-screen canvas) {
  background: transparent !important;
}

/* 搜索高亮样式 */
.terminal-container :deep(.xterm-search-result) {
  background-color: rgba(255, 255, 0, 0.8) !important;
  color: #000 !important;
  border-bottom: 2px solid yellow !important;
}

.terminal-container :deep(.xterm-search-result-active) {
  background-color: rgba(255, 140, 0, 1) !important;
  color: #fff !important;
  border: 2px solid red !important;
  font-weight: bold;
}
</style>
