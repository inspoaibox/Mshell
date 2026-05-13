/**
 * 终端快捷键配置管理器
 * 管理终端内的复制、粘贴、全选等快捷键
 */

export interface TerminalShortcut {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  description: string
}

export interface TerminalShortcutsConfig {
  copy: TerminalShortcut
  paste: TerminalShortcut
  selectAll: TerminalShortcut
  clear: TerminalShortcut
}

// 默认快捷键配置
const defaultShortcuts: TerminalShortcutsConfig = {
  copy: {
    key: 'C',
    ctrl: true,
    alt: false,
    shift: true,
    description: '终端复制'
  },
  paste: {
    key: 'V',
    ctrl: true,
    alt: false,
    shift: true,
    description: '终端粘贴'
  },
  selectAll: {
    key: 'A',
    ctrl: true,
    alt: false,
    shift: true,
    description: '终端全选'
  },
  clear: {
    key: 'L',
    ctrl: true,
    alt: false,
    shift: false,
    description: '清屏'
  }
}

class TerminalShortcutsManager {
  private shortcuts: TerminalShortcutsConfig
  private storageKey = 'terminal-shortcuts'
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.shortcuts = this.loadFromStorage()
  }

  /**
   * 从本地存储加载配置
   */
  private loadFromStorage(): TerminalShortcutsConfig {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        // 合并默认值，确保新增的快捷键也有默认值
        return {
          ...defaultShortcuts,
          ...parsed
        }
      }
    } catch (error) {
      console.error('[TerminalShortcuts] Failed to load from storage:', error)
    }
    return { ...defaultShortcuts }
  }

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.shortcuts))
    } catch (error) {
      console.error('[TerminalShortcuts] Failed to save to storage:', error)
    }
  }

  /**
   * 获取所有快捷键配置
   */
  getAll(): TerminalShortcutsConfig {
    return { ...this.shortcuts }
  }

  /**
   * 替换全部配置，用于从应用设置、备份或同步数据恢复
   */
  replaceAll(config: Partial<TerminalShortcutsConfig>): void {
    this.shortcuts = {
      ...defaultShortcuts,
      ...config
    }
    this.saveToStorage()
    this.notifyListeners()
  }

  /**
   * 获取单个快捷键配置
   */
  get<K extends keyof TerminalShortcutsConfig>(id: K): TerminalShortcut {
    return { ...this.shortcuts[id] }
  }

  /**
   * 更新快捷键配置
   */
  update<K extends keyof TerminalShortcutsConfig>(id: K, config: Partial<TerminalShortcut>): void {
    this.shortcuts[id] = {
      ...this.shortcuts[id],
      ...config
    }
    this.saveToStorage()
    this.notifyListeners()
  }

  /**
   * 重置单个快捷键为默认值
   */
  reset<K extends keyof TerminalShortcutsConfig>(id: K): void {
    this.shortcuts[id] = { ...defaultShortcuts[id] }
    this.saveToStorage()
    this.notifyListeners()
  }

  /**
   * 重置所有快捷键为默认值
   */
  resetAll(): void {
    this.shortcuts = { ...defaultShortcuts }
    this.saveToStorage()
    this.notifyListeners()
  }

  /**
   * 检查键盘事件是否匹配指定快捷键
   */
  matches(event: KeyboardEvent, id: keyof TerminalShortcutsConfig): boolean {
    const config = this.shortcuts[id]
    const keyMatch = event.key.toUpperCase() === config.key.toUpperCase() ||
                     event.code === `Key${config.key.toUpperCase()}`
    
    return keyMatch &&
           event.ctrlKey === config.ctrl &&
           event.altKey === config.alt &&
           event.shiftKey === config.shift
  }

  /**
   * 格式化快捷键显示字符串
   */
  format(id: keyof TerminalShortcutsConfig): string {
    const config = this.shortcuts[id]
    const parts: string[] = []
    if (config.ctrl) parts.push('Ctrl')
    if (config.alt) parts.push('Alt')
    if (config.shift) parts.push('Shift')
    parts.push(config.key.toUpperCase())
    return parts.join('+')
  }

  /**
   * 添加配置变更监听器
   */
  addListener(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback()
      } catch (error) {
        console.error('[TerminalShortcuts] Listener error:', error)
      }
    })
  }

  /**
   * 获取默认配置
   */
  getDefaults(): TerminalShortcutsConfig {
    return { ...defaultShortcuts }
  }
}

// 导出单例
export const terminalShortcutsManager = new TerminalShortcutsManager()
