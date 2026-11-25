/**
 * IPMI / Redfish IPC 处理器
 */

import { ipcMain } from 'electron'
import { ipmiManager, IPMIConnectionConfig, IPMIPowerAction } from '../managers/IPMIManager'

export function registerIPMIHandlers(): void {
  ipcMain.handle('ipmi:connect', async (_event, config: IPMIConnectionConfig) => {
    return ipmiManager.connect(config)
  })

  ipcMain.handle('ipmi:getInfo', async (_event, connectionId: string) => {
    return ipmiManager.getInfo(connectionId)
  })

  ipcMain.handle('ipmi:power', async (_event, connectionId: string, action: IPMIPowerAction) => {
    return ipmiManager.power(connectionId, action)
  })

  ipcMain.handle('ipmi:disconnect', async (_event, connectionId: string) => {
    return ipmiManager.disconnect(connectionId)
  })

  ipcMain.handle('ipmi:getStatus', async (_event, connectionId: string) => {
    const status = ipmiManager.getStatus(connectionId)
    if (!status) return { success: false, error: 'IPMI 连接不存在' }
    return {
      success: true,
      data: {
        id: status.info.id,
        host: status.info.host,
        port: status.info.port,
        transport: status.info.transport,
        status: status.info.status,
        startTime: status.startTime
      }
    }
  })
}
