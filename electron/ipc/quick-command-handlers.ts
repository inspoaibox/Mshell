import { ipcMain } from 'electron'
import { quickCommandManager } from '../managers/QuickCommandManager'

/**
 * 注册快捷命令 IPC 处理器
 */
export function registerQuickCommandHandlers() {
  // 初始化
  quickCommandManager.initialize().catch(console.error)

  // 获取所有快捷命令
  ipcMain.handle('quickCommand:getAll', async () => {
    try {
      const commands = quickCommandManager.getAll()
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取单个快捷命令
  ipcMain.handle('quickCommand:get', async (_event, id: string) => {
    try {
      const command = quickCommandManager.get(id)
      if (!command) {
        return { success: false, error: '快捷命令不存在' }
      }
      return { success: true, data: command }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 创建快捷命令
  ipcMain.handle('quickCommand:create', async (_event, data: any) => {
    try {
      const commandData = {
        name: String(data.name || ''),
        command: String(data.command || ''),
        description: data.description ? String(data.description) : undefined,
        category: data.category ? String(data.category) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map((t: any) => String(t)) : []
      }

      const command = await quickCommandManager.create(commandData)
      
      return {
        success: true,
        data: {
          id: String(command.id),
          name: String(command.name),
          command: String(command.command),
          description: command.description || '',
          category: command.category || '',
          tags: [...(command.tags || [])],
          usageCount: Number(command.usageCount),
          createdAt: String(command.createdAt),
          updatedAt: String(command.updatedAt)
        }
      }
    } catch (error: any) {
      return { success: false, error: String(error.message) }
    }
  })

  // 更新快捷命令
  ipcMain.handle('quickCommand:update', async (_event, id: string, data: any) => {
    try {
      const updateData: any = {}
      
      if (data.name !== undefined) updateData.name = String(data.name)
      if (data.command !== undefined) updateData.command = String(data.command)
      if (data.description !== undefined) updateData.description = String(data.description)
      if (data.category !== undefined) updateData.category = String(data.category)
      if (Array.isArray(data.tags)) updateData.tags = data.tags.map((t: any) => String(t))

      await quickCommandManager.update(id, updateData)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除快捷命令
  ipcMain.handle('quickCommand:delete', async (_event, id: string) => {
    try {
      await quickCommandManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 增加使用次数
  ipcMain.handle('quickCommand:incrementUsage', async (_event, id: string) => {
    try {
      await quickCommandManager.incrementUsage(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按分类获取
  ipcMain.handle('quickCommand:getByCategory', async (_event, category: string) => {
    try {
      const commands = quickCommandManager.getByCategory(category)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 搜索
  ipcMain.handle('quickCommand:search', async (_event, query: string) => {
    try {
      const commands = quickCommandManager.search(query)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有分类
  ipcMain.handle('quickCommand:getAllCategories', async () => {
    try {
      const categories = quickCommandManager.getAllCategories()
      return { success: true, data: categories }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有标签
  ipcMain.handle('quickCommand:getAllTags', async () => {
    try {
      const tags = quickCommandManager.getAllTags()
      return { success: true, data: tags }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取最近使用
  ipcMain.handle('quickCommand:getRecent', async (_event, limit?: number) => {
    try {
      const commands = quickCommandManager.getRecent(limit)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取常用命令
  ipcMain.handle('quickCommand:getFrequent', async (_event, limit?: number) => {
    try {
      const commands = quickCommandManager.getFrequent(limit)
      return { success: true, data: commands }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 导出快捷命令到文件
  ipcMain.handle('quickCommand:export', async (_event, filePath: string) => {
    try {
      const commands = quickCommandManager.getAll()
      const exportData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        quickCommands: commands
      }
      const { promises: fs } = await import('fs')
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
      return { success: true, data: { count: commands.length, path: filePath } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从文件导入快捷命令
  ipcMain.handle('quickCommand:import', async (_event, filePath: string) => {
    try {
      const { promises: fs } = await import('fs')
      const content = await fs.readFile(filePath, 'utf-8')
      const importData = JSON.parse(content)
      
      // 验证数据格式
      if (!importData.quickCommands || !Array.isArray(importData.quickCommands)) {
        throw new Error('无效的快捷命令文件格式')
      }
      
      const currentCommands = quickCommandManager.getAll()
      let imported = 0
      let updated = 0
      
      for (const cmd of importData.quickCommands) {
        // 验证必需字段
        if (!cmd.name || !cmd.command) {
          continue
        }
        
        // 检查是否存在相同命令（通过 ID 或 名称 判断）
        const existing = currentCommands.find(c =>
          c.id === cmd.id || c.name === cmd.name
        )
        
        if (existing) {
          // 更新现有命令
          await quickCommandManager.update(existing.id, {
            command: cmd.command,
            description: cmd.description || '',
            category: cmd.category || '',
            tags: cmd.tags || []
          })
          updated++
        } else {
          // 创建新命令
          await quickCommandManager.create({
            name: cmd.name,
            command: cmd.command,
            description: cmd.description || '',
            category: cmd.category || '',
            tags: cmd.tags || []
          })
          imported++
        }
      }
      
      return { success: true, data: { imported, updated, total: importData.quickCommands.length } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
