import { v4 as uuidv4 } from 'uuid'
import { BaseManager } from './BaseManager'

/**
 * 快捷命令接口
 */
export interface QuickCommand {
  id: string
  name: string
  command: string
  description?: string
  category?: string
  tags?: string[]
  usageCount: number
  createdAt: string
  updatedAt: string
}

/**
 * QuickCommandManager - 管理快捷命令
 */
export class QuickCommandManager extends BaseManager<QuickCommand> {
  constructor() {
    super('quick-commands.json')
  }

  /**
   * 创建快捷命令
   */
  async create(data: {
    name: string
    command: string
    description?: string
    category?: string
    tags?: string[]
    id?: string // 备份恢复时可传入原始 ID
  }): Promise<QuickCommand> {
    const now = new Date().toISOString()
    
    const quickCommand: QuickCommand = {
      id: (data as any).id || uuidv4(),
      name: data.name,
      command: data.command,
      description: data.description || '',
      category: data.category || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    }

    return super.create(quickCommand)
  }

  /**
   * 更新快捷命令
   */
  async update(id: string, data: Partial<QuickCommand>): Promise<void> {
    const cmd = this.get(id)
    if (!cmd) {
      throw new Error('快捷命令不存在')
    }

    const updates = {
      ...data,
      id: cmd.id,
      createdAt: cmd.createdAt,
      updatedAt: new Date().toISOString()
    }

    await super.update(id, updates)
  }

  /**
   * 增加使用次数
   */
  async incrementUsage(id: string): Promise<void> {
    const cmd = this.get(id)
    if (cmd) {
      await this.update(id, {
        usageCount: cmd.usageCount + 1
      })
    }
  }

  /**
   * 按分类获取
   */
  getByCategory(category: string): QuickCommand[] {
    return this.getAll().filter(c => c.category === category)
  }

  /**
   * 按标签获取
   */
  getByTag(tag: string): QuickCommand[] {
    return this.getAll().filter(c => c.tags?.includes(tag))
  }

  /**
   * 搜索快捷命令
   */
  search(query: string): QuickCommand[] {
    return super.search(query, ['name', 'command', 'description', 'category'])
  }

  /**
   * 获取所有分类
   */
  getAllCategories(): string[] {
    const categories = new Set<string>()
    this.getAll().forEach(cmd => {
      if (cmd.category) categories.add(cmd.category)
    })
    return Array.from(categories)
  }

  /**
   * 获取所有标签
   */
  getAllTags(): string[] {
    const tags = new Set<string>()
    this.getAll().forEach(cmd => {
      cmd.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags)
  }

  /**
   * 获取最近使用的命令
   */
  getRecent(limit: number = 10): QuickCommand[] {
    return this.getAll()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit)
  }

  /**
   * 获取常用命令（按使用次数排序）
   */
  getFrequent(limit: number = 10): QuickCommand[] {
    return this.getAll()
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit)
  }
}

// 导出单例
export const quickCommandManager = new QuickCommandManager()
