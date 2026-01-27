<template>
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { getTheme } from '@/utils/terminal-themes'
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
  options?: TerminalOptions
}

const props = withDefaults(defineProps<Props>(), {
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
}>()

const terminalContainer = ref<HTMLElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let webglAddon: WebglAddon | null = null
let searchAddon: SearchAddon | null = null
let webLinksAddon: WebLinksAddon | null = null
let resizeObserver: ResizeObserver | null = null


onMounted(() => {
  if (!terminalContainer.value) return

  const theme = typeof props.options.theme === 'string'
    ? getTheme(props.options.theme)
    : (props.options.theme || getTheme('dark'))

  // Initialize terminal
  terminal = new Terminal({
    fontSize: props.options.fontSize,
    fontFamily: props.options.fontFamily,
    cursorStyle: props.options.cursorStyle,
    cursorBlink: props.options.cursorBlink,
    scrollback: props.options.scrollback,
    theme: theme,
    allowProposedApi: true,
    convertEol: true,
    // 关键：正确处理按键映射
    windowsMode: true, // Windows环境下启用
    altClickMovesCursor: true,
    rightClickSelectsWord: false,
    // 确保正确处理特殊按键
    macOptionIsMeta: false,
    // 启用本地回显模式以更好地处理按键
    disableStdin: false
  })

  // Load addons
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  searchAddon = new SearchAddon()
  terminal.loadAddon(searchAddon)

  webLinksAddon = new WebLinksAddon((event, uri) => {
    event.preventDefault()
    // Open in default external browser
    window.open(uri, '_blank')
  })
  terminal.loadAddon(webLinksAddon)

  // Try to load WebGL renderer with fallback
  if (props.options.rendererType === 'webgl') {
    try {
      webglAddon = new WebglAddon()
      terminal.loadAddon(webglAddon)
    } catch (error) {
      console.warn('WebGL renderer not available, falling back to canvas:', error)
    }
  }

  // Open terminal
  terminal.open(terminalContainer.value)

  // Fit terminal to container
  fitAddon.fit()

  // Enable right-click paste and selection copy
  terminal.attachCustomKeyEventHandler((event) => {
    // 只处理 keydown 事件，忽略 keyup 和重复事件
    if (event.type !== 'keydown') {
      return true
    }
    
    // Ctrl+Shift+C: Copy
    if (event.ctrlKey && event.shiftKey && event.key === 'C') {
      event.preventDefault()
      const selection = terminal?.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      }
      return false
    }
    
    // Ctrl+Shift+V: Paste
    if (event.ctrlKey && event.shiftKey && event.key === 'V') {
      event.preventDefault()
      // 防止重复触发
      if (!event.repeat) {
        navigator.clipboard.readText().then(text => {
          if (text) {
            // Send directly via IPC instead of using terminal.paste()
            window.electronAPI.ssh.write(props.connectionId, text)
          }
        })
      }
      return false
    }
    
    // Ctrl+Shift+A: Select All
    if (event.ctrlKey && event.shiftKey && event.key === 'A') {
      event.preventDefault()
      terminal?.selectAll()
      return false
    }
    
    // Ctrl+L: Clear screen (让终端自己处理，不拦截)
    if (event.ctrlKey && event.key === 'l') {
      // 让xterm.js正常处理，它会发送清屏命令到SSH
      return true
    }
    
    // 确保特殊按键正确传递到SSH服务器
    // Delete, Backspace, Home, End, PageUp, PageDown等
    // 这些按键应该由xterm.js自动处理并转换为正确的ANSI序列
    // 我们只需要确保不拦截它们
    const specialKeys = ['Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown', 
                         'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                         'Insert', 'Tab', 'Enter', 'Escape']
    
    if (specialKeys.includes(event.key)) {
      // 让xterm.js处理这些特殊按键
      return true
    }
    
    // 功能键 F1-F12
    if (event.key.startsWith('F') && event.key.length <= 3) {
      const fNum = parseInt(event.key.substring(1))
      if (fNum >= 1 && fNum <= 12) {
        // 让xterm.js处理功能键
        return true
      }
    }
    
    return true
  })

  // Right-click context menu for copy/paste
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
      }
    } else if (result === 'selectAll') {
      terminal?.selectAll()
    } else if (result === 'clear') {
      terminal?.clear()
    }
  })

  // Handle terminal input
  terminal.onData((data) => {
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
    
    emit('data', data)
    // Also send via IPC
    window.electronAPI.ssh.write(props.connectionId, data)
  })

  // Handle terminal resize
  terminal.onResize(({ cols, rows }) => {
    emit('resize', cols, rows)
    // Also send via IPC
    window.electronAPI.ssh.resize(props.connectionId, cols, rows)
  })

  // Setup resize observer
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon && terminal) {
      fitAddon.fit()
    }
  })
  resizeObserver.observe(terminalContainer.value)

  // Listen for SSH data
  window.electronAPI.ssh.onData((id: string, data: string) => {
    if (id === props.connectionId && terminal) {
      terminal.write(data)
    }
  })

  // Listen for SSH errors
  window.electronAPI.ssh.onError((id: string, error: string) => {
    if (id === props.connectionId && terminal) {
      terminal.write(`\r\n\x1b[31mError: ${error}\x1b[0m\r\n`)
    }
  })

  // Listen for SSH close
  window.electronAPI.ssh.onClose((id: string) => {
    if (id === props.connectionId && terminal) {
      terminal.write('\r\n\x1b[33mConnection closed\x1b[0m\r\n')
    }
  })
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (terminal) {
    terminal.dispose()
  }
})

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
    if (searchAddon) {
      searchAddon.findNext(term, {
        caseSensitive: options?.caseSensitive,
        regex: options?.regex
      })
    }
  },
  findNext: (term: string) => {
    if (searchAddon) {
      searchAddon.findNext(term)
    }
  },
  findPrevious: (term: string) => {
    if (searchAddon) {
      searchAddon.findPrevious(term)
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
</style>
