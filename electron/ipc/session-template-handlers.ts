import { ipcMain } from 'electron'
import { sessionTemplateManager } from '../managers/SessionTemplateManager'

/**
 * 注册会话模板 IPC 处理器
 */
export function registerSessionTemplateHandlers() {
  // 初始化
  sessionTemplateManager.initialize().catch(console.error)

  // 获取所有模板
  ipcMain.handle('sessionTemplate:getAll', async () => {
    try {
      const templates = sessionTemplateManager.getAll()
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取单个模板
  ipcMain.handle('sessionTemplate:get', async (_event, id: string) => {
    try {
      const template = sessionTemplateManager.get(id)
      if (!template) {
        return { success: false, error: '模板不存在' }
      }
      return { success: true, data: template }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 创建模板
  ipcMain.handle('sessionTemplate:create', async (_event, data: any) => {
    try {
      const template = await sessionTemplateManager.createTemplate(data)
      return { success: true, data: template }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 更新模板
  ipcMain.handle('sessionTemplate:update', async (_event, id: string, updates: any) => {
    try {
      await sessionTemplateManager.updateTemplate(id, updates)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除模板
  ipcMain.handle('sessionTemplate:delete', async (_event, id: string) => {
    try {
      await sessionTemplateManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按标签获取模板
  ipcMain.handle('sessionTemplate:getByTag', async (_event, tag: string) => {
    try {
      const templates = sessionTemplateManager.getByTag(tag)
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按提供商获取模板
  ipcMain.handle('sessionTemplate:getByProvider', async (_event, provider: string) => {
    try {
      const templates = sessionTemplateManager.getByProvider(provider)
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 搜索模板
  ipcMain.handle('sessionTemplate:search', async (_event, query: string) => {
    try {
      const templates = sessionTemplateManager.searchTemplates(query)
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有标签
  ipcMain.handle('sessionTemplate:getAllTags', async () => {
    try {
      const tags = sessionTemplateManager.getAllTags()
      return { success: true, data: tags }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有提供商
  ipcMain.handle('sessionTemplate:getAllProviders', async () => {
    try {
      const providers = sessionTemplateManager.getAllProviders()
      return { success: true, data: providers }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从模板创建会话配置
  ipcMain.handle('sessionTemplate:createSession', async (_event, templateId: string, overrides?: any) => {
    try {
      const template = sessionTemplateManager.get(templateId)
      if (!template) {
        return { success: false, error: '模板不存在' }
      }

      const sessionConfig = sessionTemplateManager.createSessionFromTemplate(template, overrides)
      return { success: true, data: sessionConfig }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 导出模板
  ipcMain.handle('sessionTemplate:export', async (_event, filePath: string, templateIds?: string[]) => {
    try {
      await sessionTemplateManager.exportTemplates(filePath, templateIds)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 导入模板
  ipcMain.handle('sessionTemplate:import', async (_event, filePath: string) => {
    try {
      const result = await sessionTemplateManager.importTemplates(filePath)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 复制模板
  ipcMain.handle('sessionTemplate:duplicate', async (_event, id: string, newName?: string) => {
    try {
      const template = await sessionTemplateManager.duplicateTemplate(id, newName)
      return { success: true, data: template }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
