import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

/**
 * 基础管理器类 - 提供通用的 CRUD 操作
 */
export abstract class BaseManager<T extends { id: string }> {
  protected dataPath: string
  protected data: Map<string, T>
  protected initialized: boolean = false

  constructor(fileName: string) {
    const userDataPath = app.getPath('userData')
    this.dataPath = join(userDataPath, fileName)
    this.data = new Map()
  }

  /**
   * 初始化并加载数据
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.load()
      this.initialized = true
    } catch (error) {
      console.error(`Failed to initialize ${this.constructor.name}:`, error)
      this.data = new Map()
      this.initialized = true
    }
  }

  /**
   * 从文件加载数据
   */
  protected async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.dataPath, 'utf-8')
      const parsed = JSON.parse(content)
      
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          this.data.set(item.id, this.deserialize(item))
        }
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        await this.save()
      } else {
        throw error
      }
    }
  }

  /**
   * 保存数据到文件
   */
  protected async save(): Promise<void> {
    try {
      const dir = join(this.dataPath, '..')
      await fs.mkdir(dir, { recursive: true })

      const dataArray = Array.from(this.data.values()).map(item => this.serialize(item))
      await fs.writeFile(this.dataPath, JSON.stringify(dataArray, null, 2), 'utf-8')
    } catch (error) {
      console.error(`Failed to save ${this.constructor.name}:`, error)
      throw new Error('Failed to save data')
    }
  }

  /**
   * 获取所有数据
   */
  getAll(): T[] {
    return Array.from(this.data.values())
  }

  /**
   * 获取单个数据
   */
  get(id: string): T | undefined {
    return this.data.get(id)
  }

  /**
   * 创建数据
   */
  async create(item: T): Promise<T> {
    this.data.set(item.id, item)
    await this.save()
    return item
  }

  /**
   * 更新数据
   */
  async update(id: string, updates: Partial<T>): Promise<void> {
    const item = this.data.get(id)
    if (!item) {
      throw new Error(`Item not found: ${id}`)
    }

    const updated = { ...item, ...updates, id }
    this.data.set(id, updated)
    await this.save()
  }

  /**
   * 删除数据
   */
  async delete(id: string): Promise<void> {
    if (!this.data.has(id)) {
      throw new Error(`Item not found: ${id}`)
    }

    this.data.delete(id)
    await this.save()
  }

  /**
   * 搜索数据
   */
  search(query: string, fields: (keyof T)[]): T[] {
    if (!query || query.trim() === '') {
      return this.getAll()
    }

    const lowerQuery = query.toLowerCase().trim()
    return Array.from(this.data.values()).filter(item => {
      return fields.some(field => {
        const value = item[field]
        if (typeof value === 'string') {
          return value.toLowerCase().includes(lowerQuery)
        }
        return false
      })
    })
  }

  /**
   * 序列化数据（子类可重写）
   */
  protected serialize(item: T): any {
    return item
  }

  /**
   * 反序列化数据（子类可重写）
   */
  protected deserialize(data: any): T {
    return data
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    this.data.clear()
    await this.save()
  }

  /**
   * 获取数据数量
   */
  count(): number {
    return this.data.size
  }

  /**
   * 检查是否存在
   */
  exists(id: string): boolean {
    return this.data.has(id)
  }
}
