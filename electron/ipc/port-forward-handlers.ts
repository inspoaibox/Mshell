import { ipcMain } from 'electron'
import { portForwardManager } from '../managers/PortForwardManager'
import { sshConnectionManager } from '../managers/SSHConnectionManager'
import { v4 as uuidv4 } from 'uuid'

interface PortForwardConfig {
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  description?: string
  autoStart?: boolean
}

/**
 * 注册端口转发 IPC 处理器
 */
export function registerPortForwardHandlers() {
  // 获取所有转发
  ipcMain.handle('portForward:getAll', async (_event, connectionId: string) => {
    try {
      const forwards = portForwardManager.getAllForwards(connectionId)
      return { success: true, forwards }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 添加转发
  ipcMain.handle(
    'portForward:add',
    async (_event, connectionId: string, config: PortForwardConfig) => {
      try {
        const connection = sshConnectionManager.getConnection(connectionId)
        if (!connection) {
          return { success: false, error: 'Connection not found' }
        }

        const id = uuidv4()

        // 不自动启动，只添加配置
        const forward = {
          id,
          connectionId,
          type: config.type,
          localHost: config.localHost,
          localPort: config.localPort,
          remoteHost: config.remoteHost,
          remotePort: config.remotePort,
          status: 'inactive' as const,
          description: config.description
        }

        // 存储转发配置
        portForwardManager.addForward(forward)

        return { success: true, id }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 启动转发
  ipcMain.handle('portForward:start', async (_event, connectionId: string, forwardId: string) => {
    try {
      const connection = sshConnectionManager.getConnection(connectionId)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      const forward = portForwardManager.getForward(forwardId)
      if (!forward) {
        return { success: false, error: 'Forward not found' }
      }

      if (forward.type === 'local') {
        await portForwardManager.setupLocalForward(
          forwardId,
          connectionId,
          connection.client,
          forward.localHost,
          forward.localPort,
          forward.remoteHost,
          forward.remotePort
        )
      } else if (forward.type === 'remote') {
        await portForwardManager.setupRemoteForward(
          forwardId,
          connectionId,
          connection.client,
          forward.remoteHost,
          forward.remotePort,
          forward.localHost,
          forward.localPort
        )
      } else if (forward.type === 'dynamic') {
        await portForwardManager.setupDynamicForward(
          forwardId,
          connectionId,
          connection.client,
          forward.localHost,
          forward.localPort
        )
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 停止转发
  ipcMain.handle('portForward:stop', async (_event, _connectionId: string, forwardId: string) => {
    try {
      await portForwardManager.stopForward(forwardId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除转发
  ipcMain.handle(
    'portForward:delete',
    async (_event, _connectionId: string, forwardId: string) => {
      try {
        await portForwardManager.deleteForward(forwardId)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 更新转发配置
  ipcMain.handle('portForward:update', async (_event, forwardId: string, updates: any) => {
    try {
      await portForwardManager.updateForward(forwardId, updates)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取流量统计
  ipcMain.handle('portForward:getTrafficStats', async (_event, forwardId: string) => {
    try {
      const stats = portForwardManager.getTrafficStats(forwardId)
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有流量统计
  ipcMain.handle('portForward:getAllTrafficStats', async () => {
    try {
      const stats = portForwardManager.getAllTrafficStats()
      return { success: true, data: stats }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 重置流量统计
  ipcMain.handle('portForward:resetTrafficStats', async (_event, forwardId: string) => {
    try {
      portForwardManager.resetTrafficStats(forwardId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ========== 模板管理 ==========

  // 创建模板
  ipcMain.handle('portForward:createTemplate', async (_event, data: any) => {
    try {
      const template = await portForwardManager.createTemplate(data)
      return { success: true, data: template }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有模板
  ipcMain.handle('portForward:getAllTemplates', async () => {
    try {
      const templates = portForwardManager.getAllTemplates()
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取模板
  ipcMain.handle('portForward:getTemplate', async (_event, id: string) => {
    try {
      const template = portForwardManager.getTemplate(id)
      return { success: true, data: template }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 更新模板
  ipcMain.handle('portForward:updateTemplate', async (_event, id: string, updates: any) => {
    try {
      await portForwardManager.updateTemplate(id, updates)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除模板
  ipcMain.handle('portForward:deleteTemplate', async (_event, id: string) => {
    try {
      await portForwardManager.deleteTemplate(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 按标签获取模板
  ipcMain.handle('portForward:getTemplatesByTag', async (_event, tag: string) => {
    try {
      const templates = portForwardManager.getTemplatesByTag(tag)
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 搜索模板
  ipcMain.handle('portForward:searchTemplates', async (_event, query: string) => {
    try {
      const templates = portForwardManager.searchTemplates(query)
      return { success: true, data: templates }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从模板创建转发
  ipcMain.handle('portForward:createFromTemplate', async (_event, templateId: string, connectionId: string) => {
    try {
      const forward = await portForwardManager.createForwardFromTemplate(templateId, connectionId)
      return { success: true, data: forward }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 自动启动转发
  ipcMain.handle('portForward:autoStart', async (_event, connectionId: string) => {
    try {
      const connection = sshConnectionManager.getConnection(connectionId)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      await portForwardManager.autoStartForwards(connectionId, connection.client)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
