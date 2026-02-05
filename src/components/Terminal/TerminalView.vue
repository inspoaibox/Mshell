<template>
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { getTheme } from '@/utils/terminal-themes'
import { terminalManager } from '@/utils/terminal-manager'
import { terminalShortcutsManager } from '@/utils/terminal-shortcuts'
import { useAIStore } from '@/stores/ai'
import { ElMessage } from 'element-plus'
import 'xterm/css/xterm.css'

interface TerminalOptions {
  theme?: any
  fontSize?: number
  fontFamily?: string
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  rendererType?: 'dom' | 'canvas' | 'webgl'
}

interface Props {
  connectionId: string
  sessionName?: string
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
    rendererType: 'webgl'
  })
})

const emit = defineEmits<{
  data: [data: string]
  resize: [cols: number, rows: number]
  input: [input: string]
  cursorPosition: [position: { x: number; y: number }]
  'ai-request': [text: string]
  'ssh-output': [output: string]
}>()

const aiStore = useAIStore()

// 计算属性：检查是否有默认模型
const hasDefaultModel = computed(() => aiStore.hasDefaultModel)

const terminalContainer = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let searchAddon: any = null
let resizeObserver: ResizeObserver | null = null
let currentLineBuffer = '' // 当前行的输入缓冲
let currentCommand = ''
let commandStartTime: number | null = null

onMounted(() => {
  if (!terminalContainer.value) return

  // 加载 AI 配置
  aiStore.loadConfig().catch(err => {
    console.error('Failed to load AI config:', err)
  })

  const theme = typeof props.options.theme === 'string'
    ? getTheme(props.options.theme)
    : (props.options.theme || getTheme('dark'))

  // 使用全局管理器获取或创建终端实例
  const instance = terminalManager.getOrCreate(
    props.connectionId,
    terminalContainer.value,
    {
      ...props.options,
      theme
    }
  )

  terminal = instance.terminal
  fitAddon = instance.fitAddon
  searchAddon = instance.searchAddon

  // 每次组件挂载时，更新回调引用（解决闭包陷阱问题）
  // 这样即使组件重新挂载，回调也会指向正确的 emit 函数
  console.log(`[TerminalView] onMounted: Setting callbacks for ${props.connectionId}`)
  terminalManager.setInputCallback(props.connectionId, (data: string, lineBuffer: string) => {
    console.log(`[TerminalView] inputCallback called: lineBuffer="${lineBuffer}"`)
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

  // 只在第一次创建时注册事件处理器
  // 事件处理器内部通过回调引用调用，而不是直接捕获 emit
  if (!instance.handlersRegistered) {
    instance.handlersRegistered = true
    console.log(`[TerminalView] Registering event handlers for ${props.connectionId}`)

    // Handle terminal input
    terminal.onData((data) => {
      // 获取终端实例
      const inst = terminalManager.get(props.connectionId)
      
      // 调试日志：检查回调状态
      console.log(`[TerminalView:onData] connectionId=${props.connectionId}, data="${data.replace(/[\r\n]/g, '\\n')}", inputCallback=${inst?.inputCallback ? 'SET' : 'NULL'}`)
      
      // 更新当前行缓冲（用于自动补全）
      if (data === '\r' || data === '\n') {
        // 回车键 - 命令执行
        if (currentCommand.trim()) {
          commandStartTime = Date.now()
          // 记录命令到历史
          recordCommand(currentCommand.trim())
        }
        currentCommand = ''
        currentLineBuffer = ''
      } else if (data === '\x7F' || data === '\b') {
        // 退格键
        currentCommand = currentCommand.slice(0, -1)
        currentLineBuffer = currentLineBuffer.slice(0, -1)
      } else if (data === '\x03') {
        // Ctrl+C - 取消命令
        currentCommand = ''
        currentLineBuffer = ''
        commandStartTime = null
      } else if (data === '\x15') {
        // Ctrl+U - 清除整行
        currentCommand = ''
        currentLineBuffer = ''
      } else if (data.charCodeAt(0) >= 32) {
        // 可打印字符（包括中文等 Unicode 字符）
        // 排除控制字符 (0-31) 和 DEL (127)
        if (data.charCodeAt(0) !== 127) {
          currentCommand += data
          currentLineBuffer += data
        }
      }
      
      // 通过回调引用发射输入事件（解决闭包陷阱）
      console.log(`[TerminalView:onData] currentLineBuffer="${currentLineBuffer}", will call inputCallback: ${!!(currentLineBuffer && inst?.inputCallback)}`)
      if (currentLineBuffer && inst?.inputCallback) {
        inst.inputCallback(data, currentLineBuffer)
        
        // 发射光标位置（用于定位补全弹窗）
        if (terminal && terminalContainer.value && inst.cursorCallback) {
          try {
            const rect = terminalContainer.value.getBoundingClientRect()
            
            // 确保容器有有效尺寸
            if (rect.width <= 0 || rect.height <= 0) {
              console.warn('[TerminalView] Container has invalid size, skipping cursor position update')
              return
            }
            
            // 获取终端的实际单元格尺寸
            // xterm.js 内部使用 _core._renderService.dimensions
            const core = (terminal as any)._core
            let cellWidth = 9
            let cellHeight = 20
            
            if (core?._renderService?.dimensions) {
              const dims = core._renderService.dimensions
              cellWidth = dims.css.cell.width || dims.actualCellWidth || cellWidth
              cellHeight = dims.css.cell.height || dims.actualCellHeight || cellHeight
            } else {
              // 回退：使用字体大小估算
              const fontSize = terminal.options.fontSize || 14
              cellWidth = fontSize * 0.6
              cellHeight = fontSize * 1.2
            }
            
            // 获取光标位置
            const cursorX = terminal.buffer.active.cursorX
            const cursorY = terminal.buffer.active.cursorY
            
            // 计算光标在视口中的绝对位置
            const padding = 4 // 终端内边距（xterm 默认较小）
            
            // 计算位置
            const x = rect.left + padding + cursorX * cellWidth
            const y = rect.top + padding + cursorY * cellHeight
            
            // 验证位置是否合理（在屏幕范围内）
            if (x >= 0 && y >= 0 && x < window.innerWidth + 100 && y < window.innerHeight + 100) {
              inst.cursorCallback({ x, y })
            } else {
              console.warn('[TerminalView] Cursor position out of bounds:', { x, y, cursorX, cursorY })
            }
          } catch (e) {
            console.error('[TerminalView] Error calculating cursor position:', e)
          }
        }
      }
      
      // 通过回调引用发射数据事件
      if (inst?.dataCallback) {
        inst.dataCallback(data)
      }
      
      window.electronAPI.ssh.write(props.connectionId, data)
      
      try {
        const bytesOut = new Blob([data]).size
        window.electronAPI.connectionStats?.updateTraffic?.(props.connectionId, 0, bytesOut)
      } catch (error) {
        // 忽略统计错误
      }
    })

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
          // 使用 bracketed paste mode 包裹粘贴内容
          // 这样 vim/nano 等编辑器能正确识别粘贴的文本
          const bracketedText = `\x1b[200~${text}\x1b[201~`
          window.electronAPI.ssh.write(props.connectionId, bracketedText)
          recordPastedCommands(text)
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
    if (!fitAddon || !terminal || !terminalContainer.value) return
    
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
            fitAddon?.fit()
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
        console.log(`[TerminalView] Delayed initial fit for ${props.connectionId}`)
        fitAddon?.fit()
        terminal?.focus() // 自动聚焦
    } catch (e) {
        console.error('Initial fit error:', e)
    }
  }, 300)
})

onUnmounted(() => {
  console.log(`[TerminalView] Unmounting terminal view for ${props.connectionId}`)
  
  // 清理回调引用
  console.log(`[TerminalView] Clearing callbacks for ${props.connectionId}`)
  terminalManager.setInputCallback(props.connectionId, null)
  terminalManager.setCursorCallback(props.connectionId, null)
  terminalManager.setDataCallback(props.connectionId, null)
  terminalManager.setOutputCallback(props.connectionId, null)
  
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  
  terminal = null
  fitAddon = null
  searchAddon = null
  
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
    
    const duration = commandStartTime ? Date.now() - commandStartTime : undefined
    
    await window.electronAPI.commandHistory?.add?.({
      command,
      sessionId: props.connectionId,
      sessionName: props.sessionName || 'Unknown Session',
      duration
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

// 记录粘贴的命令到历史
const recordPastedCommands = async (text: string) => {
  try {
    // 按换行符分割命令
    const lines = text.split(/\r?\n/)
    
    for (const line of lines) {
      const command = line.trim()
      
      // 只记录非空命令
      if (command) {
        await window.electronAPI.commandHistory?.add?.({
          command,
          sessionId: props.connectionId,
          sessionName: props.sessionName || 'Unknown Session',
          duration: undefined 
        })
      }
    }
  } catch (error) {
    console.error('Failed to record pasted commands:', error)
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

  const template = aiStore.config.prompts?.write || `Write code based on this description: {content}\n\nLanguage: {language}\n\nReturn only the code without explanations or markdown code blocks.`
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

  const template = aiStore.config.prompts?.explain || `请作为一名资深开发人员，详细分析并解释以下代码片段的主要功能和目的。\n\n\`\`\`{language}\n{content}\n\`\`\``
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

  const template = aiStore.config.prompts?.optimize || `Optimize this code:\n\n\`\`\`{language}\n{content}\n\`\`\`\n\nReturn only the optimized code without explanations or markdown code blocks.`
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
    if (newOptions.theme) {
      terminal.options.theme = typeof newOptions.theme === 'string'
        ? getTheme(newOptions.theme)
        : newOptions.theme
    }
    
    // 更新选中自动复制设置
    if (newOptions.copyOnSelect !== undefined) {
      terminalManager.setCopyOnSelect(props.connectionId, newOptions.copyOnSelect)
    }

    // Refit after options change
    if (fitAddon) {
      fitAddon.fit()
    }
  },
  { deep: true }
)

// Expose methods for parent components
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
    if (terminal) {
      terminal.focus()
    }
  },
  // 更新当前命令缓冲（用于自动补全后同步状态）
  updateCommandBuffer: (newCommand: string) => {
    currentCommand = newCommand
    currentLineBuffer = newCommand
  },
  // 获取当前命令
  getCurrentCommand: () => {
    return currentCommand
  },
  search: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => {
    console.log(`[TerminalView] Searching for: "${term}"`, options)
    if (searchAddon) {
      try {
        // 清除之前的搜索高亮
        searchAddon.clearDecorations()
        
        if (!term) return

        // 从头开始搜索
        const found = searchAddon.findNext(term, {
            caseSensitive: options?.caseSensitive,
            regex: options?.regex,
            incremental: false
        })
        console.log(`[TerminalView] Search result found: ${found}`)
      } catch (e) {
        console.error('[TerminalView] Search error:', e)
      }
    } else {
        console.warn('[TerminalView] SearchAddon not initialized')
    }
  },
  findNext: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => {
    if (searchAddon) {
      searchAddon.findNext(term, {
        caseSensitive: options?.caseSensitive,
        regex: options?.regex
      })
    }
  },
  findPrevious: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => {
    if (searchAddon) {
      searchAddon.findPrevious(term, {
        caseSensitive: options?.caseSensitive,
        regex: options?.regex
      })
    }
  },
  fit: () => {
    if (fitAddon) {
      fitAddon.fit()
    }
  }
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
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto;
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
