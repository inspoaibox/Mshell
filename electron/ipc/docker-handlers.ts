import { ipcMain } from 'electron'
import {
  dockerManager,
  type DockerContainerAction,
  type DockerContainerActionOptions
} from '../managers/DockerManager'

const allowedActions = new Set<DockerContainerAction>([
  'start',
  'pause',
  'unpause',
  'restart',
  'stop',
  'remove'
])

export function registerDockerHandlers() {
  ipcMain.handle('docker:getOverview', async (_event, connectionId: string) => {
    try {
      const overview = await dockerManager.getOverview(connectionId)
      return { success: true, data: overview }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('docker:install', async (_event, connectionId: string) => {
    try {
      const output = await dockerManager.install(connectionId)
      return { success: true, data: output }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('docker:cleanupUnused', async (_event, connectionId: string) => {
    try {
      const output = await dockerManager.cleanupUnused(connectionId)
      return { success: true, data: output }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(
    'docker:containerAction',
    async (
      _event,
      connectionId: string,
      action: DockerContainerAction,
      containerId: string,
      options?: DockerContainerActionOptions
    ) => {
      try {
        if (!allowedActions.has(action)) {
          return { success: false, error: '不支持的 Docker 操作' }
        }
        if (!containerId || !/^[a-fA-F0-9]{12,64}$/.test(containerId)) {
          return { success: false, error: '无效的容器 ID' }
        }

        const safeOptions: DockerContainerActionOptions = action === 'remove'
          ? {
              removeImage: Boolean(options?.removeImage),
              removeNetworks: Boolean(options?.removeNetworks)
            }
          : {}

        const output = await dockerManager.executeContainerAction(
          connectionId,
          action,
          containerId,
          safeOptions
        )
        return { success: true, data: output }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'docker:containerBatchAction',
    async (
      _event,
      connectionId: string,
      action: DockerContainerAction,
      containerIds: string[],
      options?: DockerContainerActionOptions
    ) => {
      try {
        if (!allowedActions.has(action)) {
          return { success: false, error: '不支持的 Docker 操作' }
        }
        if (!Array.isArray(containerIds) || containerIds.length === 0) {
          return { success: false, error: '未选择容器' }
        }
        if (containerIds.some(containerId => !/^[a-fA-F0-9]{12,64}$/.test(containerId))) {
          return { success: false, error: '无效的容器 ID' }
        }

        const safeOptions: DockerContainerActionOptions = action === 'remove'
          ? {
              removeImage: Boolean(options?.removeImage),
              removeNetworks: Boolean(options?.removeNetworks)
            }
          : {}

        const output = await dockerManager.executeContainerBatchAction(
          connectionId,
          action,
          containerIds,
          safeOptions
        )
        return { success: true, data: output }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )
}
