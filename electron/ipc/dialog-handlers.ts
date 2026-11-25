import { ipcMain, dialog, Menu } from 'electron'

export function registerDialogHandlers() {
  // Open file dialog
  ipcMain.handle('dialog:openFile', async (_event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [],
      ...options
    })

    if (result.canceled) {
      return null
    }

    return result.filePaths[0]
  })

  // Open multiple files dialog: returns all selected paths, null when cancelled
  ipcMain.handle('dialog:openFiles', async (_event, options) => {
    const { properties: extraProperties, ...rest } = options || {}
    const properties = Array.from(
      new Set<string>([
        'openFile',
        'multiSelections',
        ...(Array.isArray(extraProperties) ? extraProperties : [])
      ])
    ) as Electron.OpenDialogOptions['properties']
    const result = await dialog.showOpenDialog({
      filters: rest?.filters || [],
      ...rest,
      properties
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths
  })

  // Save file dialog
  ipcMain.handle('dialog:saveFile', async (_event, options) => {
    const result = await dialog.showSaveDialog({
      filters: options?.filters || [],
      ...options
    })

    if (result.canceled) {
      return null
    }

    return result.filePath
  })

  // Open directory dialog
  ipcMain.handle('dialog:openDirectory', async (_event, options) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      ...options
    })

    if (result.canceled) {
      return null
    }

    return result.filePaths[0]
  })

  // Show context menu
  ipcMain.handle('dialog:showContextMenu', async (_event, menuItems) => {
    return new Promise((resolve) => {
      let isResolved = false
      const safeResolve = (value: any) => {
        if (!isResolved) {
          isResolved = true
          resolve(value)
        }
      }

      const buildTemplate = (items: any[]): Electron.MenuItemConstructorOptions[] => {
        return items.map((item: any) => {
          if (item.type === 'separator') {
            return { type: 'separator' }
          }

          const menuItem: Electron.MenuItemConstructorOptions = {
            label: item.label,
            enabled: item.enabled !== false,
            accelerator: item.accelerator
          }

          if (item.submenu && Array.isArray(item.submenu)) {
            menuItem.submenu = buildTemplate(item.submenu)
          } else {
            menuItem.click = () => safeResolve(item.action)
          }

          return menuItem
        })
      }

      const template = buildTemplate(menuItems)

      const menu = Menu.buildFromTemplate(template as any)
      menu.popup({
        callback: () => {
          // 延迟 resolve null，确保 click 事件优先触发
          setTimeout(() => {
            safeResolve(null)
          }, 100)
        }
      })
    })
  })
}
