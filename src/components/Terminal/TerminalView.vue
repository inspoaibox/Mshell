<template>
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { getTheme } from '@/utils/terminal-themes'
import { terminalManager } from '@/utils/terminal-manager'
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
    fontFamily: 'Consolas, "Courier New", monospace',
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
}>()

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

  // 这里的事件监听是累加的，所以必须放在 handlersRegistered 检查内
  // 只在第一次创建时注册事件处理器
  if (!instance.handlersRegistered) {
    instance.handlersRegistered = true
    console.log(`[TerminalView] Registering event handlers for ${props.connectionId}`)

    // Handle terminal input
    terminal.onData((data) => {
      console.log(`[TerminalView] onData triggered for ${props.connectionId}, data:`, data)
      
      // 调试模式：记录按键数据（可选）
      if (import.meta.env.DEV) {
        // 在开发模式下，记录特殊按键的十六进制表示
        const hasSpecialChars = /[\x00-\x1F\x7F-\xFF]/.test(data)
        if (hasSpecialChars) {
          const hex = Array.from(data)
            .map(c => '0x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join(' ')
          console.debug('[Terminal Key]', { raw: data, hex, length: data.length })
        }
      }
      
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
      } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
        // 可打印字符
        currentCommand += data
        currentLineBuffer += data
      }
      
      // 发射输入事件（用于自动补全）
      if (currentLineBuffer) {
        emit('input', currentLineBuffer)
        
        // 发射光标位置（用于定位补全弹窗）
        if (terminal && terminalContainer.value) {
          const cursorX = terminal.buffer.active.cursorX
          const cursorY = terminal.buffer.active.cursorY
          const rect = terminalContainer.value.getBoundingClientRect()
          
          // 计算光标的屏幕坐标（粗略估算）
          const charWidth = 9 // 大约的字符宽度
          const lineHeight = 20 // 大约的行高
          
          emit('cursorPosition', {
            x: rect.left + cursorX * charWidth,
            y: rect.top + cursorY * lineHeight
          })
        }
      }
      
      emit('data', data)
      // Also send via IPC
      window.electronAPI.ssh.write(props.connectionId, data)
      
      // 更新流量统计（发送）
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
      // Also send via IPC
      window.electronAPI.ssh.resize(props.connectionId, cols, rows)
    })

    // SSH events are now managed by TerminalManager
    // This ensures data flow persists even if this View component is destroyed/recreated (e.g. during split)
  }

  // Right-click context menu for copy/paste (每次挂载都需要重新绑定到新容器)
  if (terminalContainer.value) {
    terminalContainer.value.addEventListener('contextmenu', async (e) => {
      e.preventDefault()
      const selection = terminal?.getSelection()
      
      // Show context menu via Electron
      const menuItems = []
      
      if (selection) {
        menuItems.push({
          label: '复制',
          accelerator: 'Ctrl+Shift+C',
          action: 'copy'
        })
      }
      
      menuItems.push({
        label: '粘贴',
        accelerator: 'Ctrl+Shift+V',
        action: 'paste'
      })
      
      menuItems.push({ type: 'separator' })
      
      menuItems.push({
        label: '全选',
        accelerator: 'Ctrl+Shift+A',
        action: 'selectAll'
      })
      
      menuItems.push({
        label: '清屏',
        accelerator: 'Ctrl+L',
        action: 'clear'
      })
      
      // Request context menu from main process
      const result = await window.electronAPI.dialog.showContextMenu(menuItems)
      
      if (result === 'copy' && selection) {
        await navigator.clipboard.writeText(selection)
      } else if (result === 'paste') {
        const text = await navigator.clipboard.readText()
        if (text) {
          // Send directly via IPC instead of using terminal.paste()
          window.electronAPI.ssh.write(props.connectionId, text)
          
          // 记录粘贴的命令到历史
          recordPastedCommands(text)
        }
      } else if (result === 'selectAll') {
        terminal?.selectAll()
      } else if (result === 'clear') {
        terminal?.clear()
      }
    })
  }

  // Setup resize observer
  resizeObserver = new ResizeObserver((entries) => {
    if (!fitAddon || !terminal || !terminalContainer.value) return
    
    // 检查容器尺寸是否有效
    for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width <= 0 || height <= 0) return
    }

    // 使用 requestAnimationFrame 避免 "ResizeObserver loop limit exceeded" 错误
    // 并确保在下一帧布局稳定后执行 fit
    requestAnimationFrame(() => {
        try {
            fitAddon?.fit()
        } catch (e) {
            console.error('Fit error:', e)
        }
    })
  })
  
  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value)
  }

  // 强制延迟执行一次 fit，解决初始化时尺寸计算不准的问题
  // 300ms 足够等待 Grid 布局动画完成
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
  
  // 只断开 ResizeObserver，不销毁终端实例
  // 终端实例由 terminalManager 管理，在连接真正关闭时才销毁
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  
  // 清空引用，但不销毁实例
  terminal = null
  fitAddon = null
  searchAddon = null
  
  console.log(`[TerminalView] Unmount completed for ${props.connectionId}`)
})

// 记录命令到历史
const recordCommand = async (command: string) => {
  try {
    const duration = commandStartTime ? Date.now() - commandStartTime : undefined
    
    await window.electronAPI.commandHistory?.add?.({
      command,
      sessionId: props.connectionId,
      sessionName: props.sessionName || 'Unknown Session',
      duration
    })
    
    // 增加命令计数统计
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
          duration: undefined // 粘贴的命令没有执行时长
        })
      }
    }
  } catch (error) {
    console.error('Failed to record pasted commands:', error)
  }
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
