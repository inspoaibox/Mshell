import { ipcMain } from 'electron'
import { snippetManager } from '../managers/SnippetManager'

/**
 * 注册命令片段 IPC 处理器
 */
export function registerSnippetHandlers() {
  // 初始化
  snippetManager.initialize().catch(console.error)

  // 获取所有片段
  ipcMain.handle('snippet:getAll', async () => {
    try {
      const snippets = snippetManager.getAll()
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取单个片段
  ipcMain.handle('snippet:get', async (_event, id: string) => {
    try {
      const snippet = snippetManager.get(id)
      if (!snippet) {
        return { success: false, error: '片段不存在' }
      }
      return { success: true, data: snippet }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 创建片段
  ipcMain.handle('snippet:create', async (_event, data: any) => {
    try {
      console.log('=== IPC CREATE START ===')
      console.log('Received:', data)
      
      // 只提取需要的字段
      const snippetData = {
        name: String(data.name || ''),
        command: String(data.command || ''),
        description: String(data.description || ''),
        category: String(data.category || ''),
        tags: Array.isArray(data.tags) ? data.tags.map((t: any) => String(t)) : [],
        variables: Array.isArray(data.variables) ? data.variables.map((v: any) => String(v)) : [],
        shortcut: data.shortcut ? String(data.shortcut) : undefined
      }

      console.log('Clean data:', snippetData)

      const snippet = await snippetManager.create(snippetData)
      
      console.log('Created snippet:', snippet)

      // 返回纯对象
      const result = {
        success: true,
        data: {
          id: String(snippet.id),
          name: String(snippet.name),
          command: String(snippet.command),
          description: String(snippet.description),
          category: String(snippet.category),
          tags: [...snippet.tags],
          variables: [...snippet.variables],
          shortcut: snippet.shortcut,
          usageCount: Number(snippet.usageCount),
          createdAt: String(snippet.createdAt),
          updatedAt: String(snippet.updatedAt)
        }
      }
      
      console.log('Returning:', result)
      console.log('=== IPC CREATE END ===')
      
      return result
    } catch (error: any) {
      console.error('=== IPC CREATE ERROR ===', error)
      return { success: false, error: String(error.message) }
    }
  })

  // 更新片段
  ipcMain.handle('snippet:update', async (_event, id: string, data: any) => {
    try {
      const updateData: any = {}
      
      if (data.name !== undefined) updateData.name = String(data.name)
      if (data.command !== undefined) updateData.command = String(data.command)
      if (data.description !== undefined) updateData.description = String(data.description)
      if (data.category !== undefined) updateData.category = String(data.category)
      if (Array.isArray(data.tags)) updateData.tags = data.tags.map((t: any) => String(t))
      if (Array.isArray(data.variables)) updateData.variables = data.variables.map((v: any) => String(v))
      if (data.shortcut !== undefined) updateData.shortcut = data.shortcut ? String(data.shortcut) : undefined

      await snippetManager.update(id, updateData)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除片段
  ipcMain.handle('snippet:delete', async (_event, id: string) => {
    try {
      await snippetManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 增加使用次数
  ipcMain.handle('snippet:incrementUsage', async (_event, id: string) => {
    try {
      await snippetManager.incrementUsage(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按分类获取
  ipcMain.handle('snippet:getByCategory', async (_event, category: string) => {
    try {
      const snippets = snippetManager.getByCategory(category)
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按标签获取
  ipcMain.handle('snippet:getByTag', async (_event, tag: string) => {
    try {
      const snippets = snippetManager.getByTag(tag)
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 搜索
  ipcMain.handle('snippet:search', async (_event, query: string) => {
    try {
      const snippets = snippetManager.search(query)
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 替换变量
  ipcMain.handle('snippet:replaceVariables', async (_event, command: string, values: Record<string, string>) => {
    try {
      const result = snippetManager.replaceVariables(command, values)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 提取变量
  ipcMain.handle('snippet:extractVariables', async (_event, command: string) => {
    try {
      const variables = snippetManager.extractVariables(command)
      return { success: true, data: variables }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取预定义变量列表
  ipcMain.handle('snippet:getPredefinedVariables', async () => {
    try {
      const variables = snippetManager.getPredefinedVariables()
      return { success: true, data: variables }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按快捷命令搜索
  ipcMain.handle('snippet:searchByShortcut', async (_event, prefix: string) => {
    try {
      const snippets = snippetManager.searchByShortcut(prefix)
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按快捷命令获取
  ipcMain.handle('snippet:getByShortcut', async (_event, shortcut: string) => {
    try {
      const snippet = snippetManager.getByShortcut(shortcut)
      if (!snippet) {
        return { success: false, error: '未找到快捷命令' }
      }
      return { success: true, data: snippet }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有有快捷命令的片段
  ipcMain.handle('snippet:getAllWithShortcut', async () => {
    try {
      const snippets = snippetManager.getAllWithShortcut()
      return { success: true, data: snippets }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
