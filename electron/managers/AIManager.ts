/**
 * AI Manager
 * 管理 AI 渠道、模型、请求处理、缓存和配置持久化
 */

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type {
  AIChannel,
  AIModel,
  AIConfig,
  AIRequest,
  CacheEntry,
  AIAction,
  AIProviderAdapter,
  AIProviderType
} from '../../src/types/ai'
import { OpenAIAdapter } from './ai-providers/OpenAIAdapter'
import { AnthropicAdapter } from './ai-providers/AnthropicAdapter'
import { GeminiAdapter } from './ai-providers/GeminiAdapter'
import { OpenAICompatibleAdapter } from './ai-providers/OpenAICompatibleAdapter'
import { languageDetector } from '../utils/language-detector'
import { buildPrompt, removeCodeBlockMarkers, PROMPT_TEMPLATES } from '../utils/prompt-templates'
import { logger } from '../utils/logger'

/**
 * 配置文件数据结构
 */
interface ConfigFileData {
  channels: AIChannel[]
  models: AIModel[]
  config: AIConfig
  defaultModelId?: string
}

export class AIManager {
  private channels: Map<string, AIChannel> = new Map()
  private models: Map<string, AIModel> = new Map()
  private config: AIConfig
  private requests: Map<string, AIRequest> = new Map()
  private cache: Map<string, CacheEntry> = new Map()
  private configPath: string
  private adapters: Map<AIProviderType, AIProviderAdapter> = new Map()
  private mainWindow: Electron.BrowserWindow | null = null

  // 缓存配置
  private readonly MAX_CACHE_SIZE = 10
  private readonly CACHE_TTL = 60 * 60 * 1000 // 1 小时

  constructor() {
    this.configPath = join(app.getPath('userData'), 'ai-config.json')
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      prompts: {
        explain: PROMPT_TEMPLATES.explain.template,
        optimize: PROMPT_TEMPLATES.optimize.template,
        write: PROMPT_TEMPLATES.write.template
      }
    }

    // 初始化 Provider Adapters
    this.adapters.set('openai', new OpenAIAdapter())
    this.adapters.set('anthropic', new AnthropicAdapter())
    this.adapters.set('gemini', new GeminiAdapter())
    this.adapters.set('openai-compatible', new OpenAICompatibleAdapter())
  }

  /**
   * 设置主窗口引用（用于发送事件）
   */
  setMainWindow(window: Electron.BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 初始化 AI Manager
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig()
      logger.logInfo('system', 'AI Manager initialized')
    } catch (error) {
      logger.logError('system', 'Failed to initialize AI Manager', error as Error)
      throw error
    }
  }

  // ==================== 渠道管理 ====================

  /**
   * 添加渠道
   */
  async addChannel(data: Omit<AIChannel, 'id' | 'createdAt' | 'updatedAt'>): Promise<AIChannel> {
    try {
      const channel: AIChannel = {
        id: uuidv4(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      this.channels.set(channel.id, channel)
      await this.saveConfig()

      logger.logInfo('system', `AI channel added: ${channel.name}`)
      return channel
    } catch (error) {
      logger.logError('system', 'Failed to add AI channel', error as Error)
      throw new Error('添加渠道失败')
    }
  }

  /**
   * 更新渠道
   */
  async updateChannel(id: string, updates: Partial<AIChannel>): Promise<void> {
    try {
      const channel = this.channels.get(id)
      if (!channel) {
        throw new Error('渠道不存在')
      }

      const updated = {
        ...channel,
        ...updates,
        id: channel.id, // 不允许修改 ID
        createdAt: channel.createdAt, // 不允许修改创建时间
        updatedAt: new Date()
      }

      this.channels.set(id, updated)
      await this.saveConfig()

      logger.logInfo('system', `AI channel updated: ${id}`)
    } catch (error) {
      logger.logError('system', 'Failed to update AI channel', error as Error)
      throw new Error('更新渠道失败')
    }
  }

  /**
   * 删除渠道
   */
  async deleteChannel(id: string): Promise<void> {
    try {
      const channel = this.channels.get(id)
      if (!channel) {
        throw new Error('渠道不存在')
      }

      // 删除关联的模型
      const relatedModels = Array.from(this.models.values()).filter(m => m.channelId === id)
      for (const model of relatedModels) {
        this.models.delete(model.id)
      }

      // 如果默认模型属于该渠道，清除默认模型设置
      if (this.config.defaultModelId) {
        const defaultModel = this.models.get(this.config.defaultModelId)
        if (defaultModel && defaultModel.channelId === id) {
          this.config.defaultModelId = undefined
        }
      }

      this.channels.delete(id)
      await this.saveConfig()

      logger.logInfo('system', `AI channel deleted: ${id}`)
    } catch (error) {
      logger.logError('system', 'Failed to delete AI channel', error as Error)
      throw new Error('删除渠道失败')
    }
  }

  /**
   * 验证渠道
   */
  async verifyChannel(id: string): Promise<boolean> {
    try {
      const channel = this.channels.get(id)
      if (!channel) {
        throw new Error('渠道不存在')
      }

      const adapter = this.adapters.get(channel.type)
      if (!adapter) {
        throw new Error('不支持的渠道类型')
      }

      const isValid = await adapter.verifyApiKey(channel.apiKey, channel.apiEndpoint)
      return isValid
    } catch (error) {
      logger.logError('system', 'Failed to verify AI channel', error as Error)
      throw error
    }
  }

  /**
   * 获取渠道
   */
  getChannel(id: string): AIChannel | undefined {
    return this.channels.get(id)
  }

  /**
   * 获取所有渠道
   */
  getAllChannels(): AIChannel[] {
    return Array.from(this.channels.values())
  }

  // ==================== 模型管理 ====================

  /**
   * 获取模型列表
   */
  async fetchModels(channelId: string): Promise<AIModel[]> {
    try {
      const channel = this.channels.get(channelId)
      if (!channel) {
        throw new Error('渠道不存在')
      }

      const adapter = this.adapters.get(channel.type)
      if (!adapter) {
        throw new Error('不支持的渠道类型')
      }

      const models = await adapter.fetchModels(channel.apiKey, channel.apiEndpoint)

      // 设置 channelId
      for (const model of models) {
        model.channelId = channelId
        this.models.set(model.id, model)
      }

      await this.saveConfig()

      logger.logInfo('system', `Fetched ${models.length} models for channel: ${channelId}`)
      return models
    } catch (error) {
      logger.logError('system', 'Failed to fetch models', error as Error)
      throw error
    }
  }

  /**
   * 添加模型（手动）
   */
  async addModel(data: Omit<AIModel, 'id' | 'createdAt'>): Promise<AIModel> {
    try {
      const model: AIModel = {
        id: uuidv4(),
        ...data,
        type: 'manual',
        createdAt: new Date()
      }

      this.models.set(model.id, model)
      await this.saveConfig()

      logger.logInfo('system', `AI model added: ${model.displayName}`)
      return model
    } catch (error) {
      logger.logError('system', 'Failed to add AI model', error as Error)
      throw new Error('添加模型失败')
    }
  }

  /**
   * 删除模型
   */
  async deleteModel(id: string): Promise<void> {
    try {
      const model = this.models.get(id)
      if (!model) {
        throw new Error('模型不存在')
      }

      // 允许删除所有类型的模型（包括自动获取的模型）
      // 用户可能不需要某些自动获取的模型

      // 如果是默认模型，清除默认模型设置
      if (this.config.defaultModelId === id) {
        this.config.defaultModelId = undefined
      }

      this.models.delete(id)
      await this.saveConfig()

      logger.logInfo('system', `AI model deleted: ${id}`)
    } catch (error) {
      logger.logError('system', 'Failed to delete AI model', error as Error)
      throw error
    }
  }

  /**
   * 获取模型
   */
  getModel(id: string): AIModel | undefined {
    return this.models.get(id)
  }

  /**
   * 获取所有模型
   */
  getAllModels(): AIModel[] {
    return Array.from(this.models.values())
  }

  /**
   * 获取渠道的所有模型
   */
  getModelsByChannel(channelId: string): AIModel[] {
    return Array.from(this.models.values()).filter(m => m.channelId === channelId)
  }

  // ==================== 默认模型管理 ====================

  /**
   * 设置默认模型
   */
  async setDefaultModel(modelId: string): Promise<void> {
    try {
      const model = this.models.get(modelId)
      if (!model) {
        throw new Error('模型不存在')
      }

      this.config.defaultModelId = modelId
      await this.saveConfig()

      logger.logInfo('system', `Default model set: ${modelId}`)
    } catch (error) {
      logger.logError('system', 'Failed to set default model', error as Error)
      throw new Error('设置默认模型失败')
    }
  }

  /**
   * 获取默认模型
   */
  getDefaultModel(): AIModel | undefined {
    if (!this.config.defaultModelId) {
      return undefined
    }
    return this.models.get(this.config.defaultModelId)
  }

  // ==================== AI 请求处理 ====================

  /**
   * 发送 AI 请求
   */
  async request(action: AIAction, content: string, language?: string): Promise<string> {
    const requestId = uuidv4()

    try {
      // 检查默认模型
      const defaultModel = this.getDefaultModel()
      if (!defaultModel) {
        throw new Error('请先配置默认模型')
      }

      // 检查渠道
      const channel = this.channels.get(defaultModel.channelId)
      if (!channel) {
        throw new Error('模型所属渠道不存在')
      }

      if (!channel.enabled) {
        throw new Error('AI 渠道已禁用，请在设置中启用')
      }

      // 检查内容长度
      if (content.length > 10000) {
        throw new Error('内容过长，请减少选中的文本')
      }

      // 检测语言（如果未提供）
      if (!language) {
        const detection = languageDetector.detect(content)
        language = detection.language
      }

      // 检查缓存
      const cacheKey = this.getCacheKey(action, content, defaultModel.id)
      const cached = this.getFromCache(cacheKey)
      if (cached) {
        logger.logInfo('system', `AI request served from cache: ${requestId}`)
        return cached
      }

      // 构建提示词
      const prompt = buildPrompt(action, content, language)

      // 创建请求记录
      const request: AIRequest = {
        id: requestId,
        action,
        content,
        language,
        modelId: defaultModel.id,
        status: 'processing',
        createdAt: new Date()
      }
      this.requests.set(requestId, request)

      // 发送进度事件
      this.sendEvent('ai:progress', requestId, 0)

      // 获取 adapter
      const adapter = this.adapters.get(channel.type)
      if (!adapter) {
        throw new Error('不支持的渠道类型')
      }

      // 发送请求
      let response = ''

      if (adapter.streamRequest) {
        // 使用流式请求
        response = await adapter.streamRequest({
          apiKey: channel.apiKey,
          endpoint: channel.apiEndpoint,
          modelId: defaultModel.modelId,
          prompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout
        }, (chunk) => {
          // 发送数据块
          this.sendEvent('ai:stream-chunk', requestId, chunk)
        })
      } else {
        // 降级为普通请求
        response = await adapter.sendRequest({
          apiKey: channel.apiKey,
          endpoint: channel.apiEndpoint,
          modelId: defaultModel.modelId,
          prompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout
        })
      }

      // 对于撰写和优化操作，移除代码块标记
      if (action === 'write' || action === 'optimize') {
        response = removeCodeBlockMarkers(response)
      }

      // 更新请求记录
      request.status = 'completed'
      request.response = response
      request.completedAt = new Date()

      // 保存到缓存
      this.saveToCache(cacheKey, response)

      // 发送完成事件
      this.sendEvent('ai:complete', requestId, response)

      logger.logInfo('system', `AI request completed: ${requestId}`)
      return response
    } catch (error: any) {
      // 更新请求记录
      const request = this.requests.get(requestId)
      if (request) {
        request.status = 'failed'
        request.error = error.message
        request.completedAt = new Date()
      }

      // 发送错误事件
      this.sendEvent('ai:error', requestId, error.message)

      logger.logError('system', 'AI request failed', error)
      throw error
    }
  }

  /**
   * 使用指定模型发送 AI 请求
   */
  async requestWithModel(action: AIAction, content: string, modelId: string, language?: string): Promise<string> {
    const requestId = uuidv4()

    try {
      // 查找指定模型
      const model = this.models.get(modelId)
      if (!model) {
        throw new Error('指定的模型不存在')
      }

      // 检查渠道
      const channel = this.channels.get(model.channelId)
      if (!channel) {
        throw new Error('模型所属渠道不存在')
      }

      if (!channel.enabled) {
        throw new Error('AI 渠道已禁用，请在设置中启用')
      }

      // 检查内容长度
      if (content.length > 10000) {
        throw new Error('内容过长，请减少选中的文本')
      }

      // 检测语言（如果未提供）
      if (!language) {
        const detection = languageDetector.detect(content)
        language = detection.language
      }

      // 检查缓存
      const cacheKey = this.getCacheKey(action, content, model.id)
      const cached = this.getFromCache(cacheKey)
      if (cached) {
        logger.logInfo('system', `AI request served from cache: ${requestId}`)
        return cached
      }

      // 构建提示词
      const prompt = buildPrompt(action, content, language)

      // 创建请求记录
      const request: AIRequest = {
        id: requestId,
        action,
        content,
        language,
        modelId: model.id,
        status: 'processing',
        createdAt: new Date()
      }
      this.requests.set(requestId, request)

      // 发送进度事件
      this.sendEvent('ai:progress', requestId, 0)

      // 获取 adapter
      const adapter = this.adapters.get(channel.type)
      if (!adapter) {
        throw new Error('不支持的渠道类型')
      }

      // 发送请求
      let response = ''

      if (adapter.streamRequest) {
        // 使用流式请求
        response = await adapter.streamRequest({
          apiKey: channel.apiKey,
          endpoint: channel.apiEndpoint,
          modelId: model.modelId,
          prompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout
        }, (chunk) => {
          // 发送数据块
          this.sendEvent('ai:stream-chunk', requestId, chunk)
        })
      } else {
        // 降级为普通请求
        response = await adapter.sendRequest({
          apiKey: channel.apiKey,
          endpoint: channel.apiEndpoint,
          modelId: model.modelId,
          prompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout
        })
      }

      // 对于撰写和优化操作，移除代码块标记
      if (action === 'write' || action === 'optimize') {
        response = removeCodeBlockMarkers(response)
      }

      // 更新请求记录
      request.status = 'completed'
      request.response = response
      request.completedAt = new Date()

      // 保存到缓存
      this.saveToCache(cacheKey, response)

      // 发送完成事件
      this.sendEvent('ai:complete', requestId, response)

      logger.logInfo('system', `AI request with model completed: ${requestId}`)
      return response
    } catch (error: any) {
      // 更新请求记录
      const request = this.requests.get(requestId)
      if (request) {
        request.status = 'failed'
        request.error = error.message
        request.completedAt = new Date()
      }

      // 发送错误事件
      this.sendEvent('ai:error', requestId, error.message)

      logger.logError('system', 'AI request with model failed', error)
      throw error
    }
  }

  /**
   * 取消请求
   */
  async cancelRequest(requestId: string): Promise<void> {
    try {
      const request = this.requests.get(requestId)
      if (!request) {
        throw new Error('请求不存在')
      }

      if (request.status !== 'processing') {
        throw new Error('请求已完成或已取消')
      }

      const model = this.models.get(request.modelId)
      if (!model) {
        throw new Error('模型不存在')
      }

      const channel = this.channels.get(model.channelId)
      if (!channel) {
        throw new Error('渠道不存在')
      }

      const adapter = this.adapters.get(channel.type)
      if (!adapter) {
        throw new Error('不支持的渠道类型')
      }

      await adapter.cancelRequest(requestId)

      request.status = 'cancelled'
      request.completedAt = new Date()

      // 发送取消事件
      this.sendEvent('ai:cancelled', requestId)

      logger.logInfo('system', `AI request cancelled: ${requestId}`)
    } catch (error) {
      logger.logError('system', 'Failed to cancel AI request', error as Error)
      throw error
    }
  }

  // ==================== 配置管理 ====================

  /**
   * 更新配置
   */
  async updateConfig(updates: Partial<AIConfig>): Promise<void> {
    try {
      // 验证参数范围
      if (updates.temperature !== undefined) {
        if (updates.temperature < 0 || updates.temperature > 2) {
          throw new Error('Temperature 必须在 0.0 - 2.0 之间')
        }
      }

      if (updates.maxTokens !== undefined) {
        if (updates.maxTokens < 100 || updates.maxTokens > 100000) {
          throw new Error('Max Tokens 必须在 100 - 100000 之间')
        }
      }

      if (updates.timeout !== undefined) {
        if (updates.timeout < 5000 || updates.timeout > 120000) {
          throw new Error('Timeout 必须在 5000 - 120000 ms 之间')
        }
      }

      this.config = { ...this.config, ...updates }
      await this.saveConfig()

      logger.logInfo('system', 'AI config updated')
    } catch (error) {
      logger.logError('system', 'Failed to update AI config', error as Error)
      throw error
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AIConfig {
    return { ...this.config }
  }

  /**
   * 批量更新所有配置
   */
  async updateAll(data: { channels: AIChannel[], models: AIModel[], config: AIConfig, defaultModelId?: string }): Promise<void> {
    try {
      // 1. 更新 Config
      if (data.config) {
        // Merge loaded config with defaults to ensure all fields exist
        this.config = {
          ...this.config,
          ...data.config,
          prompts: {
            ...this.config.prompts,
            ...(data.config.prompts || {})
          }
        }
      }
      if (data.defaultModelId !== undefined) {
        this.config.defaultModelId = data.defaultModelId
      }

      // 2. 更新 Channels
      // 注意：这里是全量替换，所以前端必须传递完整的列表
      if (data.channels) {
        const newChannelsMap = new Map<string, AIChannel>()
        for (const ch of data.channels) {
          // 保持后端生成的字段如果前端丢失了（虽不应该发生）
          const existing = this.channels.get(ch.id)
          const channel: AIChannel = {
            ...ch,
            createdAt: existing?.createdAt ? new Date(existing.createdAt) : (ch.createdAt ? new Date(ch.createdAt) : new Date()),
            updatedAt: new Date()
          }
          newChannelsMap.set(channel.id, channel)
        }
        this.channels = newChannelsMap
      }

      // 3. 更新 Models
      if (data.models) {
        const newModelsMap = new Map<string, AIModel>()
        for (const m of data.models) {
          const existing = this.models.get(m.id)
          const model: AIModel = {
            ...m,
            createdAt: existing?.createdAt ? new Date(existing.createdAt) : (m.createdAt ? new Date(m.createdAt) : new Date())
          }
          newModelsMap.set(model.id, model)
        }
        this.models = newModelsMap
      }

      await this.saveConfig()
      logger.logInfo('system', 'AI full config updated via updateAll')

      // 通知前端更新（虽然是前端发起的，但为了保持一致性）
      this.sendEvent('ai:config-updated')

    } catch (error) {
      logger.logError('system', 'Failed to update all AI config', error as Error)
      throw error
    }
  }

  // ==================== 缓存管理 ====================

  /**
   * 生成缓存键
   */
  private getCacheKey(action: AIAction, content: string, modelId: string): string {
    const data = `${action}:${content}:${modelId}`
    return createHash('md5').update(data).digest('hex')
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): string | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      return undefined
    }

    // 检查是否过期
    const now = Date.now()
    if (now - entry.timestamp.getTime() > this.CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }

    return entry.response
  }

  /**
   * 保存到缓存
   */
  private saveToCache(key: string, response: string): void {
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime())[0][0]
      this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      key,
      response,
      timestamp: new Date()
    })
  }

  /**
   * 清理过期缓存
   */
  private cleanCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp.getTime() > this.CACHE_TTL) {
        this.cache.delete(key)
      }
    }
  }

  // ==================== 持久化 ====================

  /**
   * 重新从文件加载配置（备份恢复后使用）
   */
  async reloadConfig(): Promise<void> {
    // 清空内存中的数据
    this.channels.clear()
    this.models.clear()
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      timeout: 30000,
      prompts: {
        explain: PROMPT_TEMPLATES.explain.template,
        optimize: PROMPT_TEMPLATES.optimize.template,
        write: PROMPT_TEMPLATES.write.template
      }
    }
    // 重新从文件加载
    await this.loadConfig()
    logger.logInfo('system', 'AI config reloaded from file')
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const config: ConfigFileData = JSON.parse(data)

      // 加载渠道（解密 API Key）
      for (const channel of config.channels || []) {
        try {
          // 尝试解密 API Key
          if (safeStorage.isEncryptionAvailable()) {
            const encrypted = Buffer.from(channel.apiKey, 'base64')
            channel.apiKey = safeStorage.decryptString(encrypted)
          }
        } catch (error) {
          logger.logError('system', `Failed to decrypt API key for channel: ${channel.name}`, error as Error)
        }

        // 转换日期字符串为 Date 对象
        channel.createdAt = new Date(channel.createdAt)
        channel.updatedAt = new Date(channel.updatedAt)

        this.channels.set(channel.id, channel)
      }

      // 加载模型
      for (const model of config.models || []) {
        // 转换日期字符串为 Date 对象
        model.createdAt = new Date(model.createdAt)
        this.models.set(model.id, model)
      }

      // 加载配置
      if (config.config) {
        // 深度合并配置，保留默认的 prompts
        this.config = {
          ...this.config,
          ...config.config,
          prompts: {
            ...this.config.prompts,
            ...(config.config.prompts || {})
          }
        }
      }

      // 加载默认模型
      if (config.defaultModelId) {
        this.config.defaultModelId = config.defaultModelId
      }

      logger.logInfo('system', 'AI config loaded')
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.logError('system', 'Failed to load AI config', error)
      }
      // 文件不存在时使用默认配置
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(): Promise<void> {
    try {
      const channels = Array.from(this.channels.values()).map(channel => {
        const encrypted = { ...channel }

        // 加密 API Key
        if (safeStorage.isEncryptionAvailable()) {
          const buffer = safeStorage.encryptString(channel.apiKey)
          encrypted.apiKey = buffer.toString('base64')
        }

        return encrypted
      })

      const models = Array.from(this.models.values())

      const config: ConfigFileData = {
        channels,
        models,
        config: this.config,
        defaultModelId: this.config.defaultModelId
      }

      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8')

      logger.logInfo('system', 'AI config saved')
    } catch (error) {
      logger.logError('system', 'Failed to save AI config', error as Error)
      throw new Error('保存配置失败')
    }
  }

  // ==================== 事件发送 ====================

  /**
   * 发送事件到渲染进程
   */
  private sendEvent(event: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(event, ...args)
    }
  }

  // ==================== 聊天历史管理 ====================

  /**
   * 获取聊天历史文件路径
   */
  private getChatHistoryPath(): string {
    return join(app.getPath('userData'), 'ai-chat-history.json')
  }

  /**
   * 获取聊天历史
   */
  async getChatHistory(): Promise<any[]> {
    try {
      const historyPath = this.getChatHistoryPath()
      const data = await fs.readFile(historyPath, 'utf-8')
      return JSON.parse(data)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []
      }
      logger.logError('system', 'Failed to load chat history', error)
      return []
    }
  }

  /**
   * 保存聊天历史
   */
  async saveChatHistory(messages: any[]): Promise<void> {
    try {
      const historyPath = this.getChatHistoryPath()
      await fs.writeFile(historyPath, JSON.stringify(messages, null, 2), 'utf-8')
    } catch (error: any) {
      logger.logError('system', 'Failed to save chat history', error)
      throw new Error('保存聊天历史失败')
    }
  }

  /**
   * 清空聊天历史
   */
  async clearChatHistory(): Promise<void> {
    try {
      const historyPath = this.getChatHistoryPath()
      await fs.unlink(historyPath)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.logError('system', 'Failed to clear chat history', error)
        throw error
      }
    }
  }

  // ==================== 终端聊天历史管理 ====================

  private getTerminalHistoryDir(): string {
    return join(app.getPath('userData'), 'ai-terminal-history')
  }

  private getTerminalChatHistoryPath(connectionId: string): string {
    // 简单的文件名清理，防止路径遍历
    const safeId = connectionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.getTerminalHistoryDir(), `${safeId}.json`)
  }

  async saveTerminalChatHistory(connectionId: string, messages: any[]): Promise<void> {
    try {
      const dir = this.getTerminalHistoryDir()
      await fs.mkdir(dir, { recursive: true })

      const filePath = this.getTerminalChatHistoryPath(connectionId)
      const data = JSON.stringify(messages, null, 2)
      await fs.writeFile(filePath, data, 'utf-8')
    } catch (error) {
      logger.logError('system', `Failed to save terminal chat history for ${connectionId}`, error as Error)
      throw error
    }
  }

  async getTerminalChatHistory(connectionId: string): Promise<any[]> {
    try {
      const filePath = this.getTerminalChatHistoryPath(connectionId)
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []
      }
      logger.logError('system', `Failed to load terminal chat history for ${connectionId}`, error)
      return []
    }
  }

  async clearTerminalChatHistory(connectionId: string): Promise<void> {
    try {
      const filePath = this.getTerminalChatHistoryPath(connectionId)
      await fs.unlink(filePath)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.logError('system', `Failed to clear terminal chat history for ${connectionId}`, error)
        throw error
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.cleanCache()
    this.channels.clear()
    this.models.clear()
    this.requests.clear()
    this.cache.clear()
  }
}

// 导出单例
export const aiManager = new AIManager()
