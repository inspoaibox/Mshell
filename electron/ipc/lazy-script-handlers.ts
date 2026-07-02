import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import {
  lazyScriptManager,
  type LazyScript,
  type LazyScriptRiskLevel,
  type LazyScriptRunMode,
  type LazyScriptType,
  type LazyScriptVariable
} from '../managers/LazyScriptManager'

const toStringArray = (value: any): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []

const cleanVariables = (variables: any): LazyScriptVariable[] =>
  Array.isArray(variables)
    ? variables.map((variable) => ({
        name: String(variable.name || ''),
        label: String(variable.label || variable.name || ''),
        type: variable.type,
        defaultValue:
          variable.defaultValue === undefined ? undefined : String(variable.defaultValue),
        required: Boolean(variable.required),
        options: toStringArray(variable.options)
      }))
    : []

const cleanScriptData = (data: any) => ({
  name: String(data.name || ''),
  fileName: data.fileName ? String(data.fileName) : '',
  description: data.description ? String(data.description) : '',
  category: data.category ? String(data.category) : '',
  tags: toStringArray(data.tags),
  type: data.type as LazyScriptType,
  content: String(data.content || ''),
  variables: cleanVariables(data.variables),
  riskLevel: data.riskLevel as LazyScriptRiskLevel,
  runMode: data.runMode as LazyScriptRunMode
})

const serializeScript = (script: LazyScript) => ({
  id: String(script.id),
  name: String(script.name),
  fileName: String(script.fileName || script.name || 'script.sh'),
  description: String(script.description || ''),
  category: String(script.category || ''),
  tags: [...script.tags],
  type: script.type,
  content: String(script.content),
  variables: script.variables.map((variable) => ({ ...variable })),
  riskLevel: script.riskLevel,
  runMode: script.runMode,
  usageCount: Number(script.usageCount || 0),
  createdAt: String(script.createdAt),
  updatedAt: String(script.updatedAt)
})

export function registerLazyScriptHandlers() {
  lazyScriptManager.initialize().catch(console.error)

  ipcMain.handle('lazyScript:getAll', async () => {
    try {
      return {
        success: true,
        data: lazyScriptManager.getAll().map(serializeScript)
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:get', async (_event, id: string) => {
    try {
      const script = lazyScriptManager.get(id)
      if (!script) {
        return { success: false, error: '懒人脚本不存在' }
      }
      return { success: true, data: serializeScript(script) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:create', async (_event, data: any) => {
    try {
      const script = await lazyScriptManager.create(cleanScriptData(data))
      return { success: true, data: serializeScript(script) }
    } catch (error: any) {
      return { success: false, error: String(error.message) }
    }
  })

  ipcMain.handle('lazyScript:update', async (_event, id: string, data: any) => {
    try {
      await lazyScriptManager.update(id, cleanScriptData(data))
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:delete', async (_event, id: string) => {
    try {
      await lazyScriptManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:incrementUsage', async (_event, id: string) => {
    try {
      await lazyScriptManager.incrementUsage(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:getByCategory', async (_event, category: string) => {
    try {
      return {
        success: true,
        data: lazyScriptManager.getByCategory(category).map(serializeScript)
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:getByTag', async (_event, tag: string) => {
    try {
      return {
        success: true,
        data: lazyScriptManager.getByTag(tag).map(serializeScript)
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:search', async (_event, query: string) => {
    try {
      return {
        success: true,
        data: lazyScriptManager.search(query).map(serializeScript)
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:getAllCategories', async () => {
    try {
      return { success: true, data: lazyScriptManager.getAllCategories() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:extractVariables', async (_event, content: string) => {
    try {
      return { success: true, data: lazyScriptManager.extractVariables(String(content || '')) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(
    'lazyScript:render',
    async (_event, content: string, values: Record<string, string>) => {
      try {
        return {
          success: true,
          data: lazyScriptManager.render(String(content || ''), values || {})
        }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle('lazyScript:export', async (_event, filePath: string) => {
    try {
      const scripts = lazyScriptManager.getAll().map(serializeScript)
      const exportData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        lazyScripts: scripts
      }
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
      return { success: true, data: { count: scripts.length, path: filePath } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:import', async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const importData = JSON.parse(content)
      if (!Array.isArray(importData.lazyScripts)) {
        throw new Error('无效的懒人脚本文件格式')
      }

      const currentScripts = lazyScriptManager.getAll()
      let imported = 0
      let updated = 0

      for (const script of importData.lazyScripts) {
        if (!script.name || !script.content) continue

        const existing = currentScripts.find((item) => item.id === script.id || item.name === script.name)
        const cleanData = cleanScriptData(script)

        if (existing) {
          await lazyScriptManager.update(existing.id, cleanData)
          updated++
        } else {
          const created = await lazyScriptManager.create({
            id: script.id,
            ...cleanData
          })
          if (Number.isFinite(Number(script.usageCount)) && Number(script.usageCount) > 0) {
            await lazyScriptManager.update(created.id, { usageCount: Number(script.usageCount) })
          }
          imported++
        }
      }

      return {
        success: true,
        data: { imported, updated, total: importData.lazyScripts.length }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
