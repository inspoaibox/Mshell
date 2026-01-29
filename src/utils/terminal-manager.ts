/**
 * 全局终端实例管理器
 * 解决分屏切换时终端数据丢失的问题
 */

import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'

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
      fontFamily: options.fontFamily || 'Consolas, "Courier New", monospace',
      cursorStyle: options.cursorStyle || 'block',
      cursorBlink: options.cursorBlink !== false,
      scrollback: options.scrollback || 10000,
      theme: options.theme,
      allowProposedApi: true,
      convertEol: true,
      windowsMode: true,
      altClickMovesCursor: true,
      rightClickSelectsWord: false,
      macOptionIsMeta: false,
      disableStdin: false
    })

    // 注册自定义按键处理器 (Ctrl+Shift+C/V/A)
    // 移入 Manager 统一管理，避免 View 组件重复注册导致重复触发
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // Ctrl+Shift+C: Copy
      if (event.ctrlKey && event.shiftKey && (event.key === 'C' || event.code === 'KeyC')) {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false
        }
        return false
      }

      // Ctrl+Shift+V: Paste
      if (event.ctrlKey && event.shiftKey && (event.key === 'V' || event.code === 'KeyV')) {
        event.preventDefault()
        event.stopPropagation()

        if (!event.repeat) {
          navigator.clipboard.readText().then(text => {
            if (text) {
              window.electronAPI.ssh.write(connectionId, text)
              
              // 记录粘贴的命令到历史
              recordPastedCommands(connectionId, text)
            }
          }).catch(err => {
            console.error('[TerminalManager] Clipboard read failed:', err)
          })
        }
        return false
      }

      // Ctrl+Shift+A: Select All
      if (event.ctrlKey && event.shiftKey && (event.key === 'A' || event.code === 'KeyA')) {
        terminal.selectAll()
        return false
      }

      // Ctrl+L: Clear handled by xterm/shell
      if (event.ctrlKey && (event.key === 'l' || event.key === 'L')) {
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
      handlersRegistered: false, // 改回 false，让 View 负责注册 UI 相关的事件
      unsubscribers: []
    }

    // 注册 SSH 事件监听器 (Data Layer)
    // 这样即使 UI 组件被销毁重建，数据处理也不会中断
    console.log(`[TerminalManager] Registering persistent SSH event listeners for ${connectionId}`)

    // 1. SSH Data
    const unsubData = window.electronAPI.ssh.onData((id: string, data: string) => {
      if (id === connectionId) {
        instance.terminal.write(data)
        
        // 更新流量统计（接收）
        try {
          const bytesIn = new Blob([data]).size
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
