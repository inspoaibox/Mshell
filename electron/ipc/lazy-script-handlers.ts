import { BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { sshConnectionManager } from '../managers/SSHConnectionManager'
import { buildScriptDeployment, parseScriptDeploymentPath } from '../../src/utils/lazy-script-template'
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

const ensureLazyScriptManagerInitialized = () => lazyScriptManager.initialize()

export function registerLazyScriptHandlers() {
  const deployments = new Map<string, AbortController>()
  ipcMain.handle('lazyScript:cancelDeployment', (event, token: string) => {
    deployments.get(`${event.sender.id}:${token}`)?.abort()
  })
  ipcMain.handle(
    'lazyScript:deploy',
    async (event, id: string, token: string, fileName: string, content: string, copyTo?: string) => {
      const key = `${event.sender.id}:${token}`
      if (
        !/^[a-f0-9-]{16,64}$/i.test(token) ||
        typeof content !== 'string' ||
        content.length > 2 * 1024 * 1024 ||
        deployments.has(key)
      )
        return { success: false, error: '无效或重复的部署请求' }
      if (sshConnectionManager.getConnection(id)?.status !== 'connected')
        return { success: false, error: 'SSH 未连接' }
      const controller = new AbortController()
      deployments.set(key, controller)
      const cancel = () => controller.abort()
      event.sender.once('destroyed', cancel)
      try {
        const result = await sshConnectionManager.executeCommandDetailed(
          id,
          buildScriptDeployment(content, fileName, copyTo, true),
          30000,
          1024 * 1024,
          undefined,
          controller.signal
        )
        if (result.exitCode !== 0)
          return { success: false, error: result.stderr || `部署失败，退出码 ${result.exitCode}` }
        const path = parseScriptDeploymentPath(result.stdout, fileName)
        const savedPath = copyTo === undefined ? undefined : path.slice(0, path.lastIndexOf('/') + 1) + copyTo
        return { success: true, data: { path, ...(savedPath ? { savedPath } : {}) } }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '部署失败' }
      } finally {
        deployments.delete(key)
        event.sender.removeListener('destroyed', cancel)
      }
    }
  )
  lazyScriptManager.onChanged(() => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send('lazyScript:changed')
    })
  })
  lazyScriptManager.initialize().catch(console.error)

  ipcMain.handle('lazyScript:getAll', async () => {
    try {
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
      const script = await lazyScriptManager.create(cleanScriptData(data))
      return { success: true, data: serializeScript(script) }
    } catch (error: any) {
      return { success: false, error: String(error.message) }
    }
  })

  ipcMain.handle('lazyScript:update', async (_event, id: string, data: any) => {
    try {
      await ensureLazyScriptManagerInitialized()
      await lazyScriptManager.update(id, cleanScriptData(data))
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:delete', async (_event, id: string) => {
    try {
      await ensureLazyScriptManagerInitialized()
      await lazyScriptManager.delete(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:incrementUsage', async (_event, id: string) => {
    try {
      await ensureLazyScriptManagerInitialized()
      await lazyScriptManager.incrementUsage(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('lazyScript:getByCategory', async (_event, category: string) => {
    try {
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
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
    async (_event, content: string, values: Record<string, string | string[]>) => {
      try {
        await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
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
      await ensureLazyScriptManagerInitialized()
      const content = await fs.readFile(filePath, 'utf-8')
      const importData = JSON.parse(content)
      if (!Array.isArray(importData.lazyScripts)) {
        throw new Error('无效的懒人脚本文件格式')
      }

      let imported = 0
      let updated = 0

      for (const script of importData.lazyScripts) {
        if (!script.name || !script.content) continue

        const existing = lazyScriptManager
          .getAll()
          .find((item) => item.id === script.id || item.name === script.name)
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
