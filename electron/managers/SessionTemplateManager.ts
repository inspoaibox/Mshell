import { BaseManager } from './BaseManager'

/**
 * 会话模板接口
 */
export interface SessionTemplate {
  id: string
  name: string
  description: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  privateKeyPath?: string
  provider?: string
  region?: string
  tags: string[]
  portForwards?: Array<{
    type: 'local' | 'remote' | 'dynamic'
    localHost: string
    localPort: number
    remoteHost: string
    remotePort: number
    autoStart: boolean
  }>
  snippets?: string[] // 关联的命令片段ID
  autoConnect?: boolean // 创建后自动连接
  createdAt: string
  updatedAt: string
}

/**
 * SessionTemplateManager - 管理会话模板
 */
export class SessionTemplateManager extends BaseManager<SessionTemplate> {
  constructor() {
    super('session-templates.json')
  }

  /**
   * 创建模板
   */
  async createTemplate(data: Omit<SessionTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionTemplate> {
    const now = new Date().toISOString()
    
    const template: SessionTemplate = {
      ...data,
      id: `template-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      createdAt: now,
      updatedAt: now
    }

    return await this.create(template)
  }

  /**
   * 更新模板
   */
  async updateTemplate(id: string, updates: Partial<SessionTemplate>): Promise<void> {
    const template = this.get(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    const updated = {
      ...updates,
      id: template.id,
      createdAt: template.createdAt,
      updatedAt: new Date().toISOString()
    }

    await this.update(id, updated)
  }

  /**
   * 按标签获取模板
   */
  getByTag(tag: string): SessionTemplate[] {
    return this.getAll().filter(t => t.tags.includes(tag))
  }

  /**
   * 按提供商获取模板
   */
  getByProvider(provider: string): SessionTemplate[] {
    return this.getAll().filter(t => t.provider === provider)
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): SessionTemplate[] {
    return this.search(query, ['name', 'description', 'host', 'username', 'provider', 'region'])
  }

  /**
   * 获取所有标签
   */
  getAllTags(): string[] {
    const tags = new Set<string>()
    for (const template of this.getAll()) {
      for (const tag of template.tags) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort()
  }

  /**
   * 获取所有提供商
   */
  getAllProviders(): string[] {
    const providers = new Set<string>()
    for (const template of this.getAll()) {
      if (template.provider) {
        providers.add(template.provider)
      }
    }
    return Array.from(providers).sort()
  }

  /**
   * 从模板创建会话配置
   */
  createSessionFromTemplate(template: SessionTemplate, overrides?: Partial<{
    name: string
    host: string
    port: number
    username: string
    password: string
    group: string
  }>): any {
    const sessionConfig = {
      name: overrides?.name || template.name,
      host: overrides?.host || template.host,
      port: overrides?.port || template.port,
      username: overrides?.username || template.username,
      authType: template.authType,
      privateKeyPath: template.privateKeyPath,
      password: overrides?.password,
      group: overrides?.group,
      provider: template.provider,
      region: template.region,
      portForwards: template.portForwards || [],
      autoConnect: template.autoConnect || false
    }

    return sessionConfig
  }

  /**
   * 导出模板
   */
  async exportTemplates(filePath: string, templateIds?: string[]): Promise<void> {
    const fs = require('fs').promises
    
    let templates = this.getAll()
    if (templateIds && templateIds.length > 0) {
      templates = templates.filter(t => templateIds.includes(t.id))
    }
    
    await fs.writeFile(filePath, JSON.stringify(templates, null, 2), 'utf-8')
  }

  /**
   * 导入模板
   */
  async importTemplates(filePath: string): Promise<{ success: number; failed: number }> {
    const fs = require('fs').promises
    
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const templates = JSON.parse(content)
      
      if (!Array.isArray(templates)) {
        throw new Error('Invalid template file format')
      }
      
      let success = 0
      let failed = 0
      
      for (const template of templates) {
        try {
          // 生成新的ID避免冲突
          const newTemplate = {
            ...template,
            id: `template-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
          
          await this.create(newTemplate)
          success++
        } catch (error) {
          console.error('Failed to import template:', error)
          failed++
        }
      }
      
      return { success, failed }
    } catch (error) {
      throw new Error('Failed to read template file')
    }
  }

  /**
   * 复制模板
   */
  async duplicateTemplate(id: string, newName?: string): Promise<SessionTemplate> {
    const template = this.get(id)
    if (!template) {
      throw new Error('模板不存在')
    }

    const duplicated = {
      ...template,
      name: newName || `${template.name} (副本)`,
      id: undefined as any,
      createdAt: undefined as any,
      updatedAt: undefined as any
    }

    return await this.createTemplate(duplicated)
  }
}

// 导出单例
export const sessionTemplateManager = new SessionTemplateManager()
