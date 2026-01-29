import { v4 as uuidv4 } from 'uuid'
import { BaseManager } from './BaseManager'

/**
 * 命令片段接口 - 只包含可序列化的基本类型
 */
export interface Snippet {
  id: string
  name: string
  command: string
  description: string
  category: string
  tags: string[]
  variables: string[]  // 只存储变量名数组
  shortcut?: string    // 快捷命令，如 "/d"
  usageCount: number
  createdAt: string    // ISO 字符串
  updatedAt: string    // ISO 字符串
}

/**
 * SnippetManager - 管理命令片段
 */
export class SnippetManager extends BaseManager<Snippet> {
  constructor() {
    super('snippets.json')
  }

  /**
   * 创建片段
   */
  async create(data: {
    name: string
    command: string
    description?: string
    category?: string
    tags?: string[]
    variables?: string[]
    shortcut?: string
  }): Promise<Snippet> {
    const now = new Date().toISOString()
    
    // 验证快捷命令唯一性
    if (data.shortcut) {
      const existing = this.getByShortcut(data.shortcut)
      if (existing) {
        throw new Error(`快捷命令 "${data.shortcut}" 已被使用`)
      }
    }
    
    const snippet: Snippet = {
      id: uuidv4(),
      name: data.name,
      command: data.command,
      description: data.description || '',
      category: data.category || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      variables: Array.isArray(data.variables) ? data.variables : [],
      shortcut: data.shortcut,
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    }

    return super.create(snippet)
  }

  /**
   * 更新片段
   */
  async update(id: string, data: Partial<Snippet>): Promise<void> {
    const snippet = this.get(id)
    if (!snippet) {
      throw new Error('片段不存在')
    }

    // 验证快捷命令唯一性（如果修改了快捷命令）
    if (data.shortcut && data.shortcut !== snippet.shortcut) {
      const existing = this.getByShortcut(data.shortcut)
      if (existing && existing.id !== id) {
        throw new Error(`快捷命令 "${data.shortcut}" 已被使用`)
      }
    }

    const updates = {
      ...data,
      id: snippet.id,
      createdAt: snippet.createdAt,
      updatedAt: new Date().toISOString()
    }

    await super.update(id, updates)
  }

  /**
   * 增加使用次数
   */
  async incrementUsage(id: string): Promise<void> {
    const snippet = this.get(id)
    if (snippet) {
      await this.update(id, {
        usageCount: snippet.usageCount + 1
      })
    }
  }

  /**
   * 按分类获取
   */
  getByCategory(category: string): Snippet[] {
    return this.getAll().filter(s => s.category === category)
  }

  /**
   * 按标签获取
   */
  getByTag(tag: string): Snippet[] {
    return this.getAll().filter(s => s.tags.includes(tag))
  }

  /**
   * 搜索片段
   */
  search(query: string): Snippet[] {
    return super.search(query, ['name', 'command', 'description', 'category'])
  }

  /**
   * 按快捷命令获取
   */
  getByShortcut(shortcut: string): Snippet | undefined {
    return this.getAll().find(s => s.shortcut === shortcut)
  }

  /**
   * 搜索快捷命令（支持前缀匹配）
   */
  searchByShortcut(prefix: string): Snippet[] {
    if (!prefix) return []
    
    return this.getAll()
      .filter(s => s.shortcut && s.shortcut.startsWith(prefix))
      .sort((a, b) => {
        // 优先显示使用次数多的
        if (b.usageCount !== a.usageCount) {
          return b.usageCount - a.usageCount
        }
        // 其次按快捷命令长度排序（短的优先）
        return (a.shortcut?.length || 0) - (b.shortcut?.length || 0)
      })
      .slice(0, 10) // 限制返回数量
  }

  /**
   * 获取所有有快捷命令的片段
   */
  getAllWithShortcut(): Snippet[] {
    return this.getAll().filter(s => s.shortcut)
  }

  /**
   * 替换命令中的变量
   */
  replaceVariables(command: string, values: Record<string, string>): string {
    let result = command
    
    // 替换 ${variable} 格式的变量
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g')
      result = result.replace(regex, value)
    }
    
    // 替换 $variable 格式的变量
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\$${key}\\b`, 'g')
      result = result.replace(regex, value)
    }
    
    return result
  }

  /**
   * 提取命令中的变量
   */
  extractVariables(command: string): string[] {
    const variables = new Set<string>()
    
    // 匹配 ${variable} 格式
    const braceMatches = command.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)
    for (const match of braceMatches) {
      variables.add(match[1])
    }
    
    // 匹配 $variable 格式
    const dollarMatches = command.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)\b/g)
    for (const match of dollarMatches) {
      variables.add(match[1])
    }
    
    return Array.from(variables)
  }

  /**
   * 获取预定义变量列表
   */
  getPredefinedVariables() {
    return [
      { name: 'HOST', description: '当前会话的主机地址' },
      { name: 'USER', description: '当前会话的用户名' },
      { name: 'USERNAME', description: '当前会话的用户名（同USER）' },
      { name: 'PORT', description: '当前会话的端口' },
      { name: 'SESSION', description: '当前会话名称' },
      { name: 'DATE', description: '当前日期 (YYYY-MM-DD)' },
      { name: 'TIME', description: '当前时间 (HH:MM:SS)' },
      { name: 'TIMESTAMP', description: '当前时间戳（毫秒）' },
      { name: 'HOME', description: '用户主目录' }
    ]
  }
}

// 导出单例
export const snippetManager = new SnippetManager()
