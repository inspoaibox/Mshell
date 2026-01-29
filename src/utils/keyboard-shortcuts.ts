/**
 * 快捷键管理器
 */

export interface ShortcutConfig {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  description: string
  action: () => void
}

export class KeyboardShortcutManager {
  private shortcuts: Map<string, ShortcutConfig>
  private enabled: boolean

  constructor() {
    this.shortcuts = new Map()
    this.enabled = true
    this.setupListener()
  }

  /**
   * 注册快捷键
   */
  register(id: string, config: ShortcutConfig): void {
    this.shortcuts.set(id, config)
  }

  /**
   * 注销快捷键
   */
  unregister(id: string): void {
    this.shortcuts.delete(id)
  }

  /**
   * 获取所有快捷键
   */
  getAll(): Map<string, ShortcutConfig> {
    return new Map(this.shortcuts)
  }

  /**
   * 启用快捷键
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * 禁用快捷键
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * 生成快捷键字符串
   */
  private getShortcutString(config: ShortcutConfig): string {
    const parts: string[] = []
    if (config.ctrl) parts.push('Ctrl')
    if (config.alt) parts.push('Alt')
    if (config.shift) parts.push('Shift')
    if (config.meta) parts.push('Meta')
    parts.push(config.key.toUpperCase())
    return parts.join('+')
  }

  /**
   * 检查事件是否匹配快捷键
   */
  private matchesShortcut(event: KeyboardEvent, config: ShortcutConfig): boolean {
    const keyMatch = event.key.toLowerCase() === config.key.toLowerCase()
    const ctrlMatch = !!config.ctrl === (event.ctrlKey || event.metaKey) // 支持 Mac Command 键
    const altMatch = !!config.alt === event.altKey
    const shiftMatch = !!config.shift === event.shiftKey

    return keyMatch && ctrlMatch && altMatch && shiftMatch
  }

  /**
   * 设置键盘监听
   */
  private setupListener(): void {
    document.addEventListener('keydown', (event) => {
      if (!this.enabled) return

      // 如果焦点在输入框，需要特殊处理
      const target = event.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || 
                     target.tagName === 'TEXTAREA' || 
                     target.isContentEditable

      // 检查是否是 xterm 终端
      const isTerminal = target.closest('.xterm') !== null

      for (const [id, config] of this.shortcuts) {
        if (this.matchesShortcut(event, config)) {
          const shortcutString = this.getShortcutString(config)
          
          // 在终端中，只允许特定的快捷键
          if (isTerminal) {
            const allowInTerminal = [
              'Ctrl+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
              'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5',
              'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9',
              'Ctrl+Alt+L'
            ]
            
            if (!allowInTerminal.includes(shortcutString)) {
              continue // 跳过这个快捷键，让终端处理
            }
          }
          
          // 在普通输入框中，允许大部分导航快捷键
          if (isInput && !isTerminal) {
            const allowInInput = [
              'Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab',
              'Ctrl+,', 'Ctrl+Alt+L',
              'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5',
              'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9'
            ]
            
            if (!allowInInput.includes(shortcutString)) {
              continue // 跳过这个快捷键，让输入框处理
            }
          }

          // 执行快捷键
          event.preventDefault()
          event.stopPropagation()
          
          console.log(`[KeyboardShortcut] Triggered: ${id} (${shortcutString})`)
          
          try {
            config.action()
          } catch (error) {
            console.error(`[KeyboardShortcut] Error executing ${id}:`, error)
          }
          
          break
        }
      }
    }, true) // 使用捕获阶段，确保优先处理
  }

  /**
   * 格式化快捷键显示
   */
  formatShortcut(config: ShortcutConfig): string {
    return this.getShortcutString(config)
  }
}

// 导出单例
export const keyboardShortcutManager = new KeyboardShortcutManager()
