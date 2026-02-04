/**
 * 全局终端实例管理器
 * 解决分屏切换时终端数据丢失的问题
 */

import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { terminalShortcutsManager } from './terminal-shortcuts'

// 输入回调类型
export type InputCallback = (data: string, lineBuffer: string) => void

interface TerminalInstance {
  terminal: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  webLinksAddon: WebLinksAddon
  webglAddon?: WebglAddon
  container: HTMLElement | null
  connectionId: string
  handlersRegistered: boolean // 跟踪事件处理器是否已注册
  unsubscribers: Array<() => void> // 存储取消订阅函数，销毁时调用
  // 可更新的回调引用 - 解决闭包陷阱问题
  inputCallback: InputCallback | null
  cursorCallback: ((position: { x: number; y: number }) => void) | null
  dataCallback: ((data: string) => void) | null
  outputCallback: ((data: string) => void) | null // SSH 输出回调（用于错误检测等）
  copyOnSelect: boolean // 选中自动复制
  selectionDisposable?: { dispose: () => void } // 选中事件监听器
}

class TerminalManager {
  private instances = new Map<string, TerminalInstance>()

  /**
   * 获取或创建终端实例
   */
  getOrCreate(
    connectionId: string,
    container: HTMLElement | null,
    options: any
  ): TerminalInstance {
    // 如果已存在，直接返回
    if (this.instances.has(connectionId)) {
      const instance = this.instances.get(connectionId)!

      // 如果容器变了，重新挂载
      if (container && instance.container !== container) {
        console.log(`[TerminalManager] Remounting terminal ${connectionId} to new container`)
        instance.terminal.open(container)
        instance.container = container
        instance.fitAddon.fit()
      }

      return instance
    }

    // 创建新实例
    console.log(`[TerminalManager] Creating new terminal instance for ${connectionId}`)

    const terminal = new Terminal({
      fontSize: options.fontSize || 14,
      fontFamily: options.fontFamily || "'JetBrains Mono', monospace",
      cursorStyle: options.cursorStyle || 'block',
      cursorBlink: options.cursorBlink !== false,
      scrollback: options.scrollback || 10000,
      theme: options.theme,
      allowProposedApi: true,
      convertEol: true,
      windowsMode: typeof window !== 'undefined' && navigator.platform.indexOf('Win') > -1,
      altClickMovesCursor: true,
      rightClickSelectsWord: false,
      macOptionIsMeta: false,
      disableStdin: false
    })

    // 注册自定义按键处理器 (使用可配置的快捷键)
    // 移入 Manager 统一管理，避免 View 组件重复注册导致重复触发
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // 终端复制 (默认 Ctrl+Shift+C)
      if (terminalShortcutsManager.matches(event, 'copy')) {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false
        }
        return false
      }

      // 终端粘贴 (默认 Ctrl+Shift+V)
      if (terminalShortcutsManager.matches(event, 'paste')) {
        event.preventDefault()
        event.stopPropagation()

        if (!event.repeat) {
          navigator.clipboard.readText().then(text => {
            if (text) {
              // 使用 bracketed paste mode 包裹粘贴内容
              // 这样 vim/nano 等编辑器能正确识别粘贴的文本
              // 开始序列: \x1b[200~  结束序列: \x1b[201~
              const bracketedText = `\x1b[200~${text}\x1b[201~`
              window.electronAPI.ssh.write(connectionId, bracketedText)
              
              // 记录粘贴的命令到历史
              recordPastedCommands(connectionId, text)
            }
          }).catch(err => {
            console.error('[TerminalManager] Clipboard read failed:', err)
          })
        }
        return false
      }

      // 终端全选 (默认 Ctrl+Shift+A)
      if (terminalShortcutsManager.matches(event, 'selectAll')) {
        terminal.selectAll()
        return false
      }

      // 清屏 (默认 Ctrl+L) - 让 shell 处理
      if (terminalShortcutsManager.matches(event, 'clear')) {
        return true
      }

      // 特殊按键放行
      const specialKeys = ['Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Insert', 'Tab', 'Enter', 'Escape']

      if (specialKeys.includes(event.key)) return true

      // 功能键 F1-F12 放行
      if (event.key.startsWith('F') && event.key.length <= 3) {
        const fNum = parseInt(event.key.substring(1))
        if (fNum >= 1 && fNum <= 12) return true
      }

      return true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault()
      window.open(uri, '_blank')
    })
    terminal.loadAddon(webLinksAddon)

    let webglAddon: WebglAddon | undefined
    if (options.rendererType === 'webgl') {
      try {
        webglAddon = new WebglAddon()
        terminal.loadAddon(webglAddon)
      } catch (error) {
        console.warn('WebGL renderer not available:', error)
      }
    }

    if (container) {
      terminal.open(container)
      fitAddon.fit()
    }

    const instance: TerminalInstance = {
      terminal,
      fitAddon,
      searchAddon,
      webLinksAddon,
      webglAddon,
      container,
      connectionId,
      handlersRegistered: false,
      unsubscribers: [],
      // 初始化可更新的回调引用
      inputCallback: null,
      cursorCallback: null,
      dataCallback: null,
      outputCallback: null,
      copyOnSelect: options.copyOnSelect || false
    }

    // 设置选中自动复制
    if (options.copyOnSelect) {
      this.setupCopyOnSelect(instance)
    }

    // 注册 SSH 事件监听器 (Data Layer)
    // 这样即使 UI 组件被销毁重建，数据处理也不会中断
    console.log(`[TerminalManager] Registering persistent SSH event listeners for ${connectionId}`)

    // 1. SSH Data
    const unsubData = window.electronAPI.ssh.onData((id: string, data: string | Uint8Array) => {
      if (id === connectionId) {
        instance.terminal.write(data)
        
        // 调用输出回调（用于错误检测等）
        if (instance.outputCallback) {
          // 将数据转换为字符串
          let strData: string
          if (typeof data === 'string') {
            strData = data
          } else {
            // 处理各种二进制数据类型（Uint8Array, ArrayBuffer, Buffer 等）
            // 注意：Electron IPC 可能会改变数据类型，所以需要更健壮的检测
            try {
              // 尝试将数据转换为 Uint8Array 并解码
              let uint8Data: Uint8Array
              const anyData = data as any
              
              if (data instanceof Uint8Array) {
                uint8Data = data
              } else if (ArrayBuffer.isView(anyData)) {
                uint8Data = new Uint8Array(anyData.buffer, anyData.byteOffset, anyData.byteLength)
              } else if (anyData instanceof ArrayBuffer) {
                uint8Data = new Uint8Array(anyData)
              } else if (Array.isArray(anyData)) {
                uint8Data = new Uint8Array(anyData)
              } else if (typeof anyData === 'object' && anyData !== null) {
                // 处理类数组对象（如 {0: 76, 1: 105, ...}）
                const values = Object.values(anyData).filter(v => typeof v === 'number') as number[]
                if (values.length > 0) {
                  uint8Data = new Uint8Array(values)
                } else {
                  uint8Data = new Uint8Array(0)
                }
              } else {
                uint8Data = new Uint8Array(0)
              }
              strData = new TextDecoder('utf-8').decode(uint8Data)
            } catch (e) {
              // 解码失败，使用空字符串
              console.warn('[TerminalManager] Failed to decode SSH data:', e)
              strData = ''
            }
          }
          
          // 只有非空数据才调用回调
          if (strData) {
            instance.outputCallback(strData)
          }
        }
        
        // 更新流量统计（接收）
        try {
          const dataForBlob = typeof data === 'string' ? data : new Uint8Array(data as Uint8Array)
          const bytesIn = new Blob([dataForBlob]).size
          const api = (window as any).electronAPI
          api.connectionStats?.updateTraffic?.(connectionId, bytesIn, 0)
        } catch (error) {
          // 忽略统计错误
        }
      }
    })
    instance.unsubscribers.push(unsubData)

    // 2. SSH Error
    const unsubError = window.electronAPI.ssh.onError((id: string, error: string) => {
      if (id === connectionId) {
        instance.terminal.write(`\r\n\x1b[31mError: ${error}\x1b[0m\r\n`)
      }
    })
    instance.unsubscribers.push(unsubError)

    // 3. SSH Close
    const unsubClose = window.electronAPI.ssh.onClose((id: string) => {
      if (id === connectionId) {
        instance.terminal.write('\r\n\x1b[33mConnection closed\x1b[0m\r\n')
      }
    })
    instance.unsubscribers.push(unsubClose)

    // 4. Reconnecting
    const unsubReconnecting = window.electronAPI.ssh.onReconnecting((id: string, attempt: number, maxAttempts: number) => {
      if (id === connectionId) {
        instance.terminal.write(`\r\n\x1b[33m正在重连... (尝试 ${attempt}/${maxAttempts})\x1b[0m\r\n`)
      }
    })
    instance.unsubscribers.push(unsubReconnecting)

    // 5. Reconnected
    const unsubReconnected = window.electronAPI.ssh.onReconnected((id: string) => {
      if (id === connectionId) {
        instance.terminal.write('\r\n\x1b[32m重连成功！\x1b[0m\r\n')
      }
    })
    instance.unsubscribers.push(unsubReconnected)

    // 6. Reconnect Failed
    const unsubReconnectFailed = window.electronAPI.ssh.onReconnectFailed((id: string, reason: string) => {
      if (id === connectionId) {
        instance.terminal.write(`\r\n\x1b[31m重连失败: ${reason}\x1b[0m\r\n`)
      }
    })
    instance.unsubscribers.push(unsubReconnectFailed)

    this.instances.set(connectionId, instance)
    return instance
  }

  /**
   * 获取终端实例
   */
  get(connectionId: string): TerminalInstance | undefined {
    return this.instances.get(connectionId)
  }

  /**
   * 设置输入回调 - 每次组件挂载时调用，更新回调引用
   * 这样可以解决闭包陷阱问题
   */
  setInputCallback(connectionId: string, callback: InputCallback | null): void {
    const instance = this.instances.get(connectionId)
    if (instance) {
      instance.inputCallback = callback
    }
  }

  /**
   * 设置光标位置回调
   */
  setCursorCallback(connectionId: string, callback: ((position: { x: number; y: number }) => void) | null): void {
    const instance = this.instances.get(connectionId)
    if (instance) {
      instance.cursorCallback = callback
    }
  }

  /**
   * 设置数据回调（用于广播等功能）
   */
  setDataCallback(connectionId: string, callback: ((data: string) => void) | null): void {
    const instance = this.instances.get(connectionId)
    if (instance) {
      instance.dataCallback = callback
    }
  }

  /**
   * 设置输出回调（用于错误检测等功能）
   */
  setOutputCallback(connectionId: string, callback: ((data: string) => void) | null): void {
    const instance = this.instances.get(connectionId)
    if (instance) {
      console.log(`[TerminalManager] setOutputCallback for ${connectionId}, callback: ${callback ? 'set' : 'null'}`)
      instance.outputCallback = callback
    } else {
      console.warn(`[TerminalManager] setOutputCallback: instance not found for ${connectionId}`)
    }
  }

  /**
   * 设置选中自动复制功能
   */
  private setupCopyOnSelect(instance: TerminalInstance): void {
    // 先清理旧的监听器
    if (instance.selectionDisposable) {
      instance.selectionDisposable.dispose()
    }

    // 监听选中变化事件
    instance.selectionDisposable = instance.terminal.onSelectionChange(() => {
      if (instance.copyOnSelect) {
        const selection = instance.terminal.getSelection()
        if (selection && selection.trim()) {
          navigator.clipboard.writeText(selection).then(() => {
            console.log(`[TerminalManager] Auto-copied selection: ${selection.substring(0, 50)}...`)
          }).catch(err => {
            console.error('[TerminalManager] Failed to auto-copy selection:', err)
          })
        }
      }
    })
  }

  /**
   * 设置或更新选中自动复制选项
   */
  setCopyOnSelect(connectionId: string, enabled: boolean): void {
    const instance = this.instances.get(connectionId)
    if (instance) {
      instance.copyOnSelect = enabled
      if (enabled && !instance.selectionDisposable) {
        this.setupCopyOnSelect(instance)
      }
      console.log(`[TerminalManager] setCopyOnSelect for ${connectionId}: ${enabled}`)
    }
  }

  /**
   * 更新所有终端的选中自动复制设置
   */
  updateAllCopyOnSelect(enabled: boolean): void {
    for (const [connectionId, instance] of this.instances) {
      instance.copyOnSelect = enabled
      if (enabled && !instance.selectionDisposable) {
        this.setupCopyOnSelect(instance)
      }
      console.log(`[TerminalManager] Updated copyOnSelect for ${connectionId}: ${enabled}`)
    }
  }

  /**
   * 从终端 buffer 中解析当前工作目录
   * 通过读取最后几行并匹配提示符格式来获取
   */
  getCurrentWorkingDirectory(connectionId: string): string | null {
    const instance = this.instances.get(connectionId)
    if (!instance || !instance.terminal) return null

    const terminal = instance.terminal
    const buffer = terminal.buffer.active

    // 从最后一行往前搜索，找到包含提示符的行
    const linesToCheck = 20
    const currentLine = buffer.cursorY + buffer.viewportY

    console.log(`[TerminalManager] getCurrentWorkingDirectory: checking lines from ${currentLine}, viewportY=${buffer.viewportY}, cursorY=${buffer.cursorY}`)

    for (let i = currentLine; i >= Math.max(0, currentLine - linesToCheck); i--) {
      const line = buffer.getLine(i)
      if (!line) continue

      const lineText = line.translateToString(true)
      if (!lineText.trim()) continue

      console.log(`[TerminalManager] Line ${i}: "${lineText}"`)

      // 尝试匹配常见的提示符格式
      // 格式1: user@host:path$ 或 user@host:path#
      // 例如: root@VM-16-9-debian:~/gin-vue-weapp#
      // 注意：路径可能包含 - . _ 等字符，使用更宽松的匹配
      const match1 = lineText.match(/[\w-]+@[\w.-]+:([~\/][^\s#$]*)[#$]\s*$/)
      if (match1 && match1[1]) {
        const cwd = match1[1].trim()
        console.log(`[TerminalManager] Detected cwd from prompt (format1): ${cwd}`)
        return cwd
      }

      // 格式1b: 提示符可能在行中间（前面有其他输出）
      // 例如: "some output root@VM-16-9-debian:~/gin-vue-weapp#"
      const match1b = lineText.match(/([\w-]+@[\w.-]+):([~\/][^\s#$]*)[#$]\s*$/)
      if (match1b && match1b[2]) {
        const cwd = match1b[2].trim()
        console.log(`[TerminalManager] Detected cwd from prompt (format1b): ${cwd}`)
        return cwd
      }

      // 格式2: [user@host path]$ 
      const match2 = lineText.match(/\[[\w-]+@[\w.-]+\s+([~\/][^\]]*)\][#$]\s*$/)
      if (match2 && match2[1]) {
        const cwd = match2[1].trim()
        console.log(`[TerminalManager] Detected cwd from prompt (format2): ${cwd}`)
        return cwd
      }

      // 格式3: path$ 或 path# (简化的提示符)
      const match3 = lineText.match(/^([~\/][\w\/._-]*)[#$%>]\s*$/)
      if (match3 && match3[1]) {
        const cwd = match3[1].trim()
        console.log(`[TerminalManager] Detected cwd from prompt (format3): ${cwd}`)
        return cwd
      }

      // 格式4: PS1 可能只显示最后一级目录名
      // 例如: "gin-vue-weapp#" - 这种情况无法获取完整路径，跳过
    }

    console.log(`[TerminalManager] getCurrentWorkingDirectory: no match found`)
    return null
  }

  /**
   * 销毁终端实例
   */
  destroy(connectionId: string): void {
    const instance = this.instances.get(connectionId)
    if (!instance) return

    console.log(`[TerminalManager] Destroying terminal instance ${connectionId}`)

    try {
      // 调用所有取消订阅函数，移除 IPC 事件监听器
      if (instance.unsubscribers) {
        for (const unsubscribe of instance.unsubscribers) {
          try {
            unsubscribe()
          } catch (e) {
            console.warn('Error unsubscribing:', e)
          }
        }
        instance.unsubscribers = []
      }

      // 清理选中事件监听器
      if (instance.selectionDisposable) {
        instance.selectionDisposable.dispose()
      }

      instance.searchAddon?.dispose()
      instance.fitAddon?.dispose()
      instance.webglAddon?.dispose()
      instance.terminal?.dispose()
    } catch (error) {
      console.error('Error disposing terminal:', error)
    }

    this.instances.delete(connectionId)
  }

  /**
   * 调整终端大小
   */
  fit(connectionId: string): void {
    const instance = this.instances.get(connectionId)
    if (instance?.fitAddon) {
      instance.fitAddon.fit()
    }
  }

  /**
   * 获取所有实例ID
   */
  getAllIds(): string[] {
    return Array.from(this.instances.keys())
  }

  /**
   * 清理所有实例
   */
  destroyAll(): void {
    for (const connectionId of this.instances.keys()) {
      this.destroy(connectionId)
    }
  }
}

/**
 * 记录粘贴的命令到历史
 * 解析粘贴文本中的命令（按换行符分割）并记录
 */
async function recordPastedCommands(connectionId: string, text: string): Promise<void> {
  try {
    // 获取终端实例以获取会话名称
    const instance = terminalManager.get(connectionId)
    if (!instance) return

    // 按换行符分割命令
    const lines = text.split(/\r?\n/)
    
    for (const line of lines) {
      const command = line.trim()
      
      // 只记录非空命令
      if (command) {
        // 使用类型断言访问 commandHistory API
        const api = (window as any).electronAPI
        await api.commandHistory?.add?.({
          command,
          sessionId: connectionId,
          sessionName: 'Terminal Session', // 可以从实例中获取更准确的名称
          duration: undefined // 粘贴的命令没有执行时长
        })
      }
    }
  } catch (error) {
    console.error('[TerminalManager] Failed to record pasted commands:', error)
  }
}

// 导出单例
export const terminalManager = new TerminalManager()
