/**
 * 主题配置接口
 */
export interface Theme {
  id: string
  name: string
  type: 'light' | 'dark'
  colors: {
    // 主色调
    primary: string
    primaryHover: string
    primaryActive: string
    
    // 背景色
    bgPrimary: string
    bgSecondary: string
    bgTertiary: string
    bgHover: string
    bgElevated: string
    
    // 文本色
    textPrimary: string
    textSecondary: string
    textTertiary: string
    
    // 边框色
    borderColor: string
    borderColorHover: string
    
    // 状态色
    successColor: string
    warningColor: string
    errorColor: string
    infoColor: string
    
    // 终端色
    terminalBackground: string
    terminalForeground: string
    terminalCursor: string
    terminalSelection: string
    
    // ANSI 颜色
    ansiBlack: string
    ansiRed: string
    ansiGreen: string
    ansiYellow: string
    ansiBlue: string
    ansiMagenta: string
    ansiCyan: string
    ansiWhite: string
    ansiBrightBlack: string
    ansiBrightRed: string
    ansiBrightGreen: string
    ansiBrightYellow: string
    ansiBrightBlue: string
    ansiBrightMagenta: string
    ansiBrightCyan: string
    ansiBrightWhite: string
  }
  shadows?: {
    sm: string
    md: string
    lg: string
  }
  borderRadius?: {
    sm: string
    md: string
    lg: string
  }
}

/**
 * 内置主题
 */
export const builtInThemes: Theme[] = [
  {
    id: 'default-dark',
    name: '默认深色',
    type: 'dark',
    colors: {
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      primaryActive: '#1d4ed8',
      
      bgPrimary: '#1e1e1e',
      bgSecondary: '#252526',
      bgTertiary: '#2d2d30',
      bgHover: '#2a2d2e',
      bgElevated: '#323233',
      
      textPrimary: '#cccccc',
      textSecondary: '#9d9d9d',
      textTertiary: '#6e6e6e',
      
      borderColor: '#3e3e42',
      borderColorHover: '#4e4e52',
      
      successColor: '#10b981',
      warningColor: '#f59e0b',
      errorColor: '#ef4444',
      infoColor: '#3b82f6',
      
      terminalBackground: '#1e1e1e',
      terminalForeground: '#cccccc',
      terminalCursor: '#ffffff',
      terminalSelection: 'rgba(255, 255, 255, 0.3)',
      
      ansiBlack: '#000000',
      ansiRed: '#cd3131',
      ansiGreen: '#0dbc79',
      ansiYellow: '#e5e510',
      ansiBlue: '#2472c8',
      ansiMagenta: '#bc3fbc',
      ansiCyan: '#11a8cd',
      ansiWhite: '#e5e5e5',
      ansiBrightBlack: '#666666',
      ansiBrightRed: '#f14c4c',
      ansiBrightGreen: '#23d18b',
      ansiBrightYellow: '#f5f543',
      ansiBrightBlue: '#3b8eea',
      ansiBrightMagenta: '#d670d6',
      ansiBrightCyan: '#29b8db',
      ansiBrightWhite: '#ffffff'
    }
  },
  {
    id: 'default-light',
    name: '默认浅色',
    type: 'light',
    colors: {
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      primaryActive: '#1d4ed8',
      
      bgPrimary: '#ffffff',
      bgSecondary: '#f5f5f5',
      bgTertiary: '#e5e5e5',
      bgHover: '#f0f0f0',
      bgElevated: '#fafafa',
      
      textPrimary: '#1e1e1e',
      textSecondary: '#6e6e6e',
      textTertiary: '#9d9d9d',
      
      borderColor: '#d4d4d4',
      borderColorHover: '#b4b4b4',
      
      successColor: '#10b981',
      warningColor: '#f59e0b',
      errorColor: '#ef4444',
      infoColor: '#3b82f6',
      
      terminalBackground: '#ffffff',
      terminalForeground: '#1e1e1e',
      terminalCursor: '#000000',
      terminalSelection: 'rgba(0, 0, 0, 0.2)',
      
      ansiBlack: '#000000',
      ansiRed: '#cd3131',
      ansiGreen: '#00bc00',
      ansiYellow: '#949800',
      ansiBlue: '#0451a5',
      ansiMagenta: '#bc05bc',
      ansiCyan: '#0598bc',
      ansiWhite: '#555555',
      ansiBrightBlack: '#666666',
      ansiBrightRed: '#cd3131',
      ansiBrightGreen: '#14ce14',
      ansiBrightYellow: '#b5ba00',
      ansiBrightBlue: '#0451a5',
      ansiBrightMagenta: '#bc05bc',
      ansiBrightCyan: '#0598bc',
      ansiBrightWhite: '#a5a5a5'
    }
  },
  {
    id: 'monokai',
    name: 'Monokai',
    type: 'dark',
    colors: {
      primary: '#f92672',
      primaryHover: '#ff3d7f',
      primaryActive: '#e6195b',
      
      bgPrimary: '#272822',
      bgSecondary: '#2e2e2a',
      bgTertiary: '#3e3d32',
      bgHover: '#34342e',
      bgElevated: '#3e3d32',
      
      textPrimary: '#f8f8f2',
      textSecondary: '#a6a69c',
      textTertiary: '#75715e',
      
      borderColor: '#49483e',
      borderColorHover: '#5e5d52',
      
      successColor: '#a6e22e',
      warningColor: '#e6db74',
      errorColor: '#f92672',
      infoColor: '#66d9ef',
      
      terminalBackground: '#272822',
      terminalForeground: '#f8f8f2',
      terminalCursor: '#f8f8f0',
      terminalSelection: 'rgba(255, 255, 255, 0.2)',
      
      ansiBlack: '#272822',
      ansiRed: '#f92672',
      ansiGreen: '#a6e22e',
      ansiYellow: '#e6db74',
      ansiBlue: '#66d9ef',
      ansiMagenta: '#ae81ff',
      ansiCyan: '#a1efe4',
      ansiWhite: '#f8f8f2',
      ansiBrightBlack: '#75715e',
      ansiBrightRed: '#f92672',
      ansiBrightGreen: '#a6e22e',
      ansiBrightYellow: '#e6db74',
      ansiBrightBlue: '#66d9ef',
      ansiBrightMagenta: '#ae81ff',
      ansiBrightCyan: '#a1efe4',
      ansiBrightWhite: '#f9f8f5'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      primary: '#bd93f9',
      primaryHover: '#caa9ff',
      primaryActive: '#a77de6',
      
      bgPrimary: '#282a36',
      bgSecondary: '#2f3241',
      bgTertiary: '#383a4a',
      bgHover: '#343746',
      bgElevated: '#3d3f4e',
      
      textPrimary: '#f8f8f2',
      textSecondary: '#a6a6a6',
      textTertiary: '#6272a4',
      
      borderColor: '#44475a',
      borderColorHover: '#565869',
      
      successColor: '#50fa7b',
      warningColor: '#f1fa8c',
      errorColor: '#ff5555',
      infoColor: '#8be9fd',
      
      terminalBackground: '#282a36',
      terminalForeground: '#f8f8f2',
      terminalCursor: '#f8f8f2',
      terminalSelection: 'rgba(68, 71, 90, 0.5)',
      
      ansiBlack: '#21222c',
      ansiRed: '#ff5555',
      ansiGreen: '#50fa7b',
      ansiYellow: '#f1fa8c',
      ansiBlue: '#bd93f9',
      ansiMagenta: '#ff79c6',
      ansiCyan: '#8be9fd',
      ansiWhite: '#f8f8f2',
      ansiBrightBlack: '#6272a4',
      ansiBrightRed: '#ff6e6e',
      ansiBrightGreen: '#69ff94',
      ansiBrightYellow: '#ffffa5',
      ansiBrightBlue: '#d6acff',
      ansiBrightMagenta: '#ff92df',
      ansiBrightCyan: '#a4ffff',
      ansiBrightWhite: '#ffffff'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      primary: '#88c0d0',
      primaryHover: '#9fcfe0',
      primaryActive: '#71b1c0',
      
      bgPrimary: '#2e3440',
      bgSecondary: '#3b4252',
      bgTertiary: '#434c5e',
      bgHover: '#3f4758',
      bgElevated: '#4c566a',
      
      textPrimary: '#eceff4',
      textSecondary: '#d8dee9',
      textTertiary: '#81a1c1',
      
      borderColor: '#4c566a',
      borderColorHover: '#5e6b7f',
      
      successColor: '#a3be8c',
      warningColor: '#ebcb8b',
      errorColor: '#bf616a',
      infoColor: '#88c0d0',
      
      terminalBackground: '#2e3440',
      terminalForeground: '#eceff4',
      terminalCursor: '#eceff4',
      terminalSelection: 'rgba(76, 86, 106, 0.5)',
      
      ansiBlack: '#3b4252',
      ansiRed: '#bf616a',
      ansiGreen: '#a3be8c',
      ansiYellow: '#ebcb8b',
      ansiBlue: '#81a1c1',
      ansiMagenta: '#b48ead',
      ansiCyan: '#88c0d0',
      ansiWhite: '#e5e9f0',
      ansiBrightBlack: '#4c566a',
      ansiBrightRed: '#bf616a',
      ansiBrightGreen: '#a3be8c',
      ansiBrightYellow: '#ebcb8b',
      ansiBrightBlue: '#81a1c1',
      ansiBrightMagenta: '#b48ead',
      ansiBrightCyan: '#8fbcbb',
      ansiBrightWhite: '#eceff4'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    type: 'dark',
    colors: {
      primary: '#268bd2',
      primaryHover: '#3a9ee5',
      primaryActive: '#1a77bf',
      
      bgPrimary: '#002b36',
      bgSecondary: '#073642',
      bgTertiary: '#0e4451',
      bgHover: '#0a3c47',
      bgElevated: '#11505f',
      
      textPrimary: '#839496',
      textSecondary: '#657b83',
      textTertiary: '#586e75',
      
      borderColor: '#073642',
      borderColorHover: '#0e4451',
      
      successColor: '#859900',
      warningColor: '#b58900',
      errorColor: '#dc322f',
      infoColor: '#268bd2',
      
      terminalBackground: '#002b36',
      terminalForeground: '#839496',
      terminalCursor: '#839496',
      terminalSelection: 'rgba(7, 54, 66, 0.5)',
      
      ansiBlack: '#073642',
      ansiRed: '#dc322f',
      ansiGreen: '#859900',
      ansiYellow: '#b58900',
      ansiBlue: '#268bd2',
      ansiMagenta: '#d33682',
      ansiCyan: '#2aa198',
      ansiWhite: '#eee8d5',
      ansiBrightBlack: '#002b36',
      ansiBrightRed: '#cb4b16',
      ansiBrightGreen: '#586e75',
      ansiBrightYellow: '#657b83',
      ansiBrightBlue: '#839496',
      ansiBrightMagenta: '#6c71c4',
      ansiBrightCyan: '#93a1a1',
      ansiBrightWhite: '#fdf6e3'
    }
  }
]

/**
 * 主题管理器类
 */
export class ThemeManager {
  private currentTheme: Theme
  private customThemes: Theme[] = []

  constructor() {
    this.currentTheme = builtInThemes[0]
    this.loadCustomThemes()
  }

  /**
   * 获取所有主题
   */
  getAllThemes(): Theme[] {
    return [...builtInThemes, ...this.customThemes]
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme(): Theme {
    return this.currentTheme
  }

  /**
   * 设置主题
   */
  setTheme(themeId: string): void {
    const theme = this.getAllThemes().find(t => t.id === themeId)
    if (theme) {
      this.currentTheme = theme
      this.applyTheme(theme)
      this.saveCurrentTheme(themeId)
    }
  }

  /**
   * 应用主题到 DOM
   */
  private applyTheme(theme: Theme): void {
    const root = document.documentElement
    
    // 应用颜色变量
    Object.entries(theme.colors).forEach(([key, value]) => {
      const cssVar = key.replace(/([A-Z])/g, '-$1').toLowerCase()
      root.style.setProperty(`--${cssVar}`, value)
    })

    // 应用阴影
    if (theme.shadows) {
      Object.entries(theme.shadows).forEach(([key, value]) => {
        root.style.setProperty(`--shadow-${key}`, value)
      })
    }

    // 应用圆角
    if (theme.borderRadius) {
      Object.entries(theme.borderRadius).forEach(([key, value]) => {
        root.style.setProperty(`--radius-${key}`, value)
      })
    }

    // 设置主题类型
    root.setAttribute('data-theme', theme.type)
  }

  /**
   * 创建自定义主题
   */
  createCustomTheme(theme: Omit<Theme, 'id'>): Theme {
    const customTheme: Theme = {
      ...theme,
      id: `custom-${Date.now()}`
    }
    
    this.customThemes.push(customTheme)
    this.saveCustomThemes()
    
    return customTheme
  }

  /**
   * 更新自定义主题
   */
  updateCustomTheme(themeId: string, updates: Partial<Theme>): void {
    const index = this.customThemes.findIndex(t => t.id === themeId)
    if (index !== -1) {
      this.customThemes[index] = {
        ...this.customThemes[index],
        ...updates,
        id: themeId // 保持 ID 不变
      }
      this.saveCustomThemes()
      
      // 如果是当前主题，重新应用
      if (this.currentTheme.id === themeId) {
        this.applyTheme(this.customThemes[index])
      }
    }
  }

  /**
   * 删除自定义主题
   */
  deleteCustomTheme(themeId: string): void {
    const index = this.customThemes.findIndex(t => t.id === themeId)
    if (index !== -1) {
      this.customThemes.splice(index, 1)
      this.saveCustomThemes()
      
      // 如果删除的是当前主题，切换到默认主题
      if (this.currentTheme.id === themeId) {
        this.setTheme(builtInThemes[0].id)
      }
    }
  }

  /**
   * 导出主题
   */
  exportTheme(themeId: string): string {
    const theme = this.getAllThemes().find(t => t.id === themeId)
    if (!theme) {
      throw new Error('Theme not found')
    }
    return JSON.stringify(theme, null, 2)
  }

  /**
   * 导入主题
   */
  importTheme(themeJson: string): Theme {
    try {
      const theme = JSON.parse(themeJson) as Theme
      
      // 验证主题格式
      if (!theme.name || !theme.type || !theme.colors) {
        throw new Error('Invalid theme format')
      }
      
      // 生成新 ID
      const customTheme: Theme = {
        ...theme,
        id: `custom-${Date.now()}`
      }
      
      this.customThemes.push(customTheme)
      this.saveCustomThemes()
      
      return customTheme
    } catch (error) {
      throw new Error('Failed to import theme: ' + (error as Error).message)
    }
  }

  /**
   * 保存自定义主题到本地存储
   */
  private saveCustomThemes(): void {
    try {
      localStorage.setItem('custom-themes', JSON.stringify(this.customThemes))
    } catch (error) {
      console.error('Failed to save custom themes:', error)
    }
  }

  /**
   * 加载自定义主题
   */
  private loadCustomThemes(): void {
    try {
      const saved = localStorage.getItem('custom-themes')
      if (saved) {
        this.customThemes = JSON.parse(saved)
      }
    } catch (error) {
      console.error('Failed to load custom themes:', error)
      this.customThemes = []
    }
  }

  /**
   * 保存当前主题 ID
   */
  private saveCurrentTheme(themeId: string): void {
    try {
      localStorage.setItem('current-theme', themeId)
    } catch (error) {
      console.error('Failed to save current theme:', error)
    }
  }

  /**
   * 加载并应用保存的主题
   */
  loadSavedTheme(): void {
    try {
      const saved = localStorage.getItem('current-theme')
      if (saved) {
        this.setTheme(saved)
      } else {
        this.applyTheme(this.currentTheme)
      }
    } catch (error) {
      console.error('Failed to load saved theme:', error)
      this.applyTheme(this.currentTheme)
    }
  }
}

// 导出单例
export const themeManager = new ThemeManager()
