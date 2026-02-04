import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // SSH operations
  ssh: {
    connect: (id: string, options: any) => ipcRenderer.invoke('ssh:connect', id, options),
    disconnect: (id: string) => ipcRenderer.invoke('ssh:disconnect', id),
    write: (id: string, data: string) => ipcRenderer.send('ssh:write', id, data),
    executeCommand: (id: string, command: string, timeout?: number) =>
      ipcRenderer.invoke('ssh:executeCommand', id, command, timeout),
    getCurrentDirectory: (id: string) =>
      ipcRenderer.invoke('ssh:getCurrentDirectory', id),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('ssh:resize', id, cols, rows),
    getConnection: (id: string) => ipcRenderer.invoke('ssh:getConnection', id),
    getAllConnections: () => ipcRenderer.invoke('ssh:getAllConnections'),
    cancelReconnect: (id: string) => ipcRenderer.invoke('ssh:cancelReconnect', id),
    setReconnectConfig: (id: string, maxAttempts: number, interval: number) =>
      ipcRenderer.invoke('ssh:setReconnectConfig', id, maxAttempts, interval),
    // 返回取消订阅函数，防止内存泄漏
    onData: (callback: (id: string, data: string) => void) => {
      ipcRenderer.on('ssh:data', (_event, id, data) => callback(id, data))
      return () => { } // No-op for now to test stability
    },
    onError: (callback: (id: string, error: string) => void) => {
      ipcRenderer.on('ssh:error', (_event, id, error) => callback(id, error))
      return () => { }
    },
    onClose: (callback: (id: string) => void) => {
      ipcRenderer.on('ssh:close', (_event, id) => callback(id))
      return () => { }
    },
    onReconnecting: (callback: (id: string, attempt: number, maxAttempts: number) => void) => {
      ipcRenderer.on('ssh:reconnecting', (_event, id, attempt, maxAttempts) => callback(id, attempt, maxAttempts))
      return () => { }
    },
    onReconnected: (callback: (id: string) => void) => {
      ipcRenderer.on('ssh:reconnected', (_event, id) => callback(id))
      return () => { }
    },
    onReconnectFailed: (callback: (id: string, reason: string) => void) => {
      ipcRenderer.on('ssh:reconnect-failed', (_event, id, reason) => callback(id, reason))
      return () => { }
    }
  },

  // Session operations
  session: {
    getAll: () => ipcRenderer.invoke('session:getAll'),
    search: (query: string) => ipcRenderer.invoke('session:search', query),
    get: (id: string) => ipcRenderer.invoke('session:get', id),
    create: (config: any) => ipcRenderer.invoke('session:create', config),
    update: (id: string, updates: any) => ipcRenderer.invoke('session:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    export: (filePath: string) => ipcRenderer.invoke('session:export', filePath),
    import: (filePath: string) => ipcRenderer.invoke('session:import', filePath),
    createGroup: (name: string, description?: string) => ipcRenderer.invoke('session:createGroup', name, description),
    getAllGroups: () => ipcRenderer.invoke('session:getAllGroups'),
    addToGroup: (sessionId: string, groupId: string) => ipcRenderer.invoke('session:addToGroup', sessionId, groupId),
    renameGroup: (groupId: string, newName: string) => ipcRenderer.invoke('session:renameGroup', groupId, newName),
    deleteGroup: (groupId: string) => ipcRenderer.invoke('session:deleteGroup', groupId)
  },

  // SFTP operations
  sftp: {
    init: (connectionId: string) => ipcRenderer.invoke('sftp:init', connectionId),
    listDirectory: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:listDirectory', connectionId, path),
    uploadFile: (connectionId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:uploadFile', connectionId, localPath, remotePath),
    downloadFile: (connectionId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke('sftp:downloadFile', connectionId, remotePath, localPath),
    createDirectory: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:createDirectory', connectionId, path),
    deleteFile: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:deleteFile', connectionId, path),
    renameFile: (connectionId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('sftp:renameFile', connectionId, oldPath, newPath),
    changePermissions: (connectionId: string, path: string, mode: number) =>
      ipcRenderer.invoke('sftp:changePermissions', connectionId, path, mode),
    getAllTasks: () => ipcRenderer.invoke('sftp:getAllTasks'),
    cancelTask: (taskId: string) => ipcRenderer.invoke('sftp:cancelTask', taskId),
    uploadFiles: (connectionId: string, files: Array<{ localPath: string; remotePath: string }>) =>
      ipcRenderer.invoke('sftp:uploadFiles', connectionId, files),
    downloadFiles: (connectionId: string, files: Array<{ remotePath: string; localPath: string }>) =>
      ipcRenderer.invoke('sftp:downloadFiles', connectionId, files),
    deleteFiles: (connectionId: string, filePaths: string[]) =>
      ipcRenderer.invoke('sftp:deleteFiles', connectionId, filePaths),
    deleteDirectories: (connectionId: string, dirPaths: string[]) =>
      ipcRenderer.invoke('sftp:deleteDirectories', connectionId, dirPaths),
    pauseTransfer: (taskId: string) =>
      ipcRenderer.invoke('sftp:pauseTransfer', taskId),
    resumeTransfer: (connectionId: string, taskId: string) =>
      ipcRenderer.invoke('sftp:resumeTransfer', connectionId, taskId),
    getIncompleteTransfers: (connectionId?: string) =>
      ipcRenderer.invoke('sftp:getIncompleteTransfers', connectionId),
    getTransferRecord: (taskId: string) =>
      ipcRenderer.invoke('sftp:getTransferRecord', taskId),
    getAllTransferRecords: () =>
      ipcRenderer.invoke('sftp:getAllTransferRecords'),
    deleteTransferRecord: (taskId: string) =>
      ipcRenderer.invoke('sftp:deleteTransferRecord', taskId),
    cleanupCompletedRecords: () =>
      ipcRenderer.invoke('sftp:cleanupCompletedRecords'),
    readFile: (connectionId: string, filePath: string) =>
      ipcRenderer.invoke('sftp:readFile', connectionId, filePath),
    readFileBuffer: (connectionId: string, filePath: string) =>
      ipcRenderer.invoke('sftp:readFileBuffer', connectionId, filePath),
    writeFile: (connectionId: string, filePath: string, content: string) =>
      ipcRenderer.invoke('sftp:writeFile', connectionId, filePath, content),
    createFile: (connectionId: string, filePath: string) =>
      ipcRenderer.invoke('sftp:createFile', connectionId, filePath),
    copyFile: (connectionId: string, sourcePath: string, targetPath: string) =>
      ipcRenderer.invoke('sftp:copyFile', connectionId, sourcePath, targetPath),
    chmod: (connectionId: string, path: string, mode: number) =>
      ipcRenderer.invoke('sftp:chmod', connectionId, path, mode),
    onProgress: (callback: (taskId: string, progress: any) => void) => {
      ipcRenderer.on('sftp:progress', (_event, taskId, progress) => callback(taskId, progress))
    },
    onComplete: (callback: (taskId: string) => void) => {
      ipcRenderer.on('sftp:complete', (_event, taskId) => callback(taskId))
    },
    onError: (callback: (taskId: string, error: string) => void) => {
      ipcRenderer.on('sftp:error', (_event, taskId, error) => callback(taskId, error))
    }
  },

  // Settings operations
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates: any) => ipcRenderer.invoke('settings:update', updates),
    reset: () => ipcRenderer.invoke('settings:reset'),
    onChange: (callback: (settings: any) => void) => {
      ipcRenderer.on('settings:changed', (_event, settings) => callback(settings))
    }
  },

  // Log operations
  logs: {
    get: (filter?: any) => ipcRenderer.invoke('logs:get', filter),
    enableSession: (sessionId: string) => ipcRenderer.invoke('logs:enableSession', sessionId),
    disableSession: (sessionId: string) => ipcRenderer.invoke('logs:disableSession', sessionId)
  },

  // Known hosts operations
  knownHosts: {
    verify: (host: string, port: number, keyType: string, key: string) =>
      ipcRenderer.invoke('ssh:verifyHost', host, port, keyType, key),
    add: (host: string, port: number, keyType: string, key: string) =>
      ipcRenderer.invoke('ssh:addHost', host, port, keyType, key),
    getAll: () => ipcRenderer.invoke('ssh:getKnownHosts'),
    remove: (host: string, port: number) => ipcRenderer.invoke('ssh:removeHost', host, port)
  },

  // Shortcut events
  onShortcut: (event: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(`shortcut:${event}`, (_event, ...args) => callback(...args))
  },

  // Dialog operations
  dialog: {
    openFile: (options?: any) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options?: any) => ipcRenderer.invoke('dialog:saveFile', options),
    openDirectory: (options?: any) => ipcRenderer.invoke('dialog:openDirectory', options),
    showContextMenu: (menuItems: any[]) => ipcRenderer.invoke('dialog:showContextMenu', menuItems)
  },

  // Local file system operations
  fs: {
    readDirectory: (dirPath: string) => ipcRenderer.invoke('fs:readDirectory', dirPath),
    createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath)
  },

  // Port forward operations
  portForward: {
    getAll: (connectionId: string) => ipcRenderer.invoke('portForward:getAll', connectionId),
    add: (connectionId: string, config: any) =>
      ipcRenderer.invoke('portForward:add', connectionId, config),
    start: (connectionId: string, forwardId: string) =>
      ipcRenderer.invoke('portForward:start', connectionId, forwardId),
    stop: (connectionId: string, forwardId: string) =>
      ipcRenderer.invoke('portForward:stop', connectionId, forwardId),
    delete: (connectionId: string, forwardId: string) =>
      ipcRenderer.invoke('portForward:delete', connectionId, forwardId),
    update: (forwardId: string, updates: any) =>
      ipcRenderer.invoke('portForward:update', forwardId, updates),
    getTrafficStats: (forwardId: string) =>
      ipcRenderer.invoke('portForward:getTrafficStats', forwardId),
    getAllTrafficStats: () =>
      ipcRenderer.invoke('portForward:getAllTrafficStats'),
    resetTrafficStats: (forwardId: string) =>
      ipcRenderer.invoke('portForward:resetTrafficStats', forwardId),
    createTemplate: (data: any) =>
      ipcRenderer.invoke('portForward:createTemplate', data),
    getAllTemplates: () =>
      ipcRenderer.invoke('portForward:getAllTemplates'),
    getTemplate: (id: string) =>
      ipcRenderer.invoke('portForward:getTemplate', id),
    updateTemplate: (id: string, updates: any) =>
      ipcRenderer.invoke('portForward:updateTemplate', id, updates),
    deleteTemplate: (id: string) =>
      ipcRenderer.invoke('portForward:deleteTemplate', id),
    getTemplatesByTag: (tag: string) =>
      ipcRenderer.invoke('portForward:getTemplatesByTag', tag),
    searchTemplates: (query: string) =>
      ipcRenderer.invoke('portForward:searchTemplates', query),
    createFromTemplate: (templateId: string, connectionId: string) =>
      ipcRenderer.invoke('portForward:createFromTemplate', templateId, connectionId),
    autoStart: (connectionId: string) =>
      ipcRenderer.invoke('portForward:autoStart', connectionId)
  },

  // Snippet operations
  snippet: {
    getAll: () => ipcRenderer.invoke('snippet:getAll'),
    get: (id: string) => ipcRenderer.invoke('snippet:get', id),
    create: (data: any) => ipcRenderer.invoke('snippet:create', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('snippet:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('snippet:delete', id),
    incrementUsage: (id: string) => ipcRenderer.invoke('snippet:incrementUsage', id),
    getByCategory: (category: string) => ipcRenderer.invoke('snippet:getByCategory', category),
    getByTag: (tag: string) => ipcRenderer.invoke('snippet:getByTag', tag),
    search: (query: string) => ipcRenderer.invoke('snippet:search', query),
    searchByShortcut: (prefix: string) => ipcRenderer.invoke('snippet:searchByShortcut', prefix),
    getByShortcut: (shortcut: string) => ipcRenderer.invoke('snippet:getByShortcut', shortcut),
    getAllWithShortcut: () => ipcRenderer.invoke('snippet:getAllWithShortcut'),
    export: (filePath: string) => ipcRenderer.invoke('snippet:export', filePath),
    import: (filePath: string) => ipcRenderer.invoke('snippet:import', filePath),
    replaceVariables: (command: string, values: Record<string, string>) =>
      ipcRenderer.invoke('snippet:replaceVariables', command, values),
    extractVariables: (command: string) => ipcRenderer.invoke('snippet:extractVariables', command),
    getPredefinedVariables: () => ipcRenderer.invoke('snippet:getPredefinedVariables')
  },

  // Command History operations
  commandHistory: {
    add: (data: any) => ipcRenderer.invoke('commandHistory:add', data),
    getAll: (limit?: number) => ipcRenderer.invoke('commandHistory:getAll', limit),
    getBySession: (sessionId: string) => ipcRenderer.invoke('commandHistory:getBySession', sessionId),
    search: (query: string, sessionId?: string) => ipcRenderer.invoke('commandHistory:search', query, sessionId),
    getFavorites: () => ipcRenderer.invoke('commandHistory:getFavorites'),
    toggleFavorite: (id: string) => ipcRenderer.invoke('commandHistory:toggleFavorite', id),
    getMostUsed: (limit?: number) => ipcRenderer.invoke('commandHistory:getMostUsed', limit),
    getRecentUnique: (limit?: number) => ipcRenderer.invoke('commandHistory:getRecentUnique', limit),
    getToday: () => ipcRenderer.invoke('commandHistory:getToday'),
    getByTimeRange: (startDate: string, endDate: string) => ipcRenderer.invoke('commandHistory:getByTimeRange', startDate, endDate),
    export: (filePath: string) => ipcRenderer.invoke('commandHistory:export', filePath),
    clearSession: (sessionId: string) => ipcRenderer.invoke('commandHistory:clearSession', sessionId),
    clearAll: (keepFavorites?: boolean) => ipcRenderer.invoke('commandHistory:clearAll', keepFavorites),
    getStatistics: () => ipcRenderer.invoke('commandHistory:getStatistics'),
    delete: (id: string) => ipcRenderer.invoke('commandHistory:delete', id)
  },

  // Connection Statistics operations
  connectionStats: {
    start: (sessionId: string, sessionName: string) => ipcRenderer.invoke('connectionStats:start', sessionId, sessionName),
    end: (sessionId: string) => ipcRenderer.invoke('connectionStats:end', sessionId),
    updateTraffic: (sessionId: string, bytesIn: number, bytesOut: number) => ipcRenderer.invoke('connectionStats:updateTraffic', sessionId, bytesIn, bytesOut),
    incrementCommand: (sessionId: string) => ipcRenderer.invoke('connectionStats:incrementCommand', sessionId),
    getBySession: (sessionId: string) => ipcRenderer.invoke('connectionStats:getBySession', sessionId),
    getAll: () => ipcRenderer.invoke('connectionStats:getAll'),
    getTotalDuration: (sessionId?: string) => ipcRenderer.invoke('connectionStats:getTotalDuration', sessionId),
    getTotalTraffic: (sessionId?: string) => ipcRenderer.invoke('connectionStats:getTotalTraffic', sessionId),
    getAverageDuration: (sessionId?: string) => ipcRenderer.invoke('connectionStats:getAverageDuration', sessionId),
    getRecent: (limit?: number) => ipcRenderer.invoke('connectionStats:getRecent', limit),
    getToday: () => ipcRenderer.invoke('connectionStats:getToday'),
    getWeek: () => ipcRenderer.invoke('connectionStats:getWeek'),
    getMonth: () => ipcRenderer.invoke('connectionStats:getMonth'),
    getSummary: () => ipcRenderer.invoke('connectionStats:getSummary'),
    cleanup: () => ipcRenderer.invoke('connectionStats:cleanup')
  },

  // Session Template operations
  sessionTemplate: {
    getAll: () => ipcRenderer.invoke('sessionTemplate:getAll'),
    get: (id: string) => ipcRenderer.invoke('sessionTemplate:get', id),
    create: (data: any) => ipcRenderer.invoke('sessionTemplate:create', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('sessionTemplate:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('sessionTemplate:delete', id),
    getByTag: (tag: string) => ipcRenderer.invoke('sessionTemplate:getByTag', tag),
    getByProvider: (provider: string) => ipcRenderer.invoke('sessionTemplate:getByProvider', provider),
    search: (query: string) => ipcRenderer.invoke('sessionTemplate:search', query),
    getAllTags: () => ipcRenderer.invoke('sessionTemplate:getAllTags'),
    getAllProviders: () => ipcRenderer.invoke('sessionTemplate:getAllProviders'),
    createSession: (templateId: string, overrides?: any) => ipcRenderer.invoke('sessionTemplate:createSession', templateId, overrides),
    export: (filePath: string, templateIds?: string[]) => ipcRenderer.invoke('sessionTemplate:export', filePath, templateIds),
    import: (filePath: string) => ipcRenderer.invoke('sessionTemplate:import', filePath),
    duplicate: (id: string, newName?: string) => ipcRenderer.invoke('sessionTemplate:duplicate', id, newName)
  },

  // Backup operations
  backup: {
    getConfig: () => ipcRenderer.invoke('backup:getConfig'),
    updateConfig: (updates: any) => ipcRenderer.invoke('backup:updateConfig', updates),
    create: (password: string, filePath?: string) => ipcRenderer.invoke('backup:create', password, filePath),
    restore: (filePath: string, password: string) => ipcRenderer.invoke('backup:restore', filePath, password),
    apply: (backupData: any, options: any) => ipcRenderer.invoke('backup:apply', backupData, options),
    list: () => ipcRenderer.invoke('backup:list'),
    delete: (filePath: string) => ipcRenderer.invoke('backup:delete', filePath),
    selectSavePath: (defaultPath?: string) => ipcRenderer.invoke('backup:selectSavePath', defaultPath),
    selectOpenPath: () => ipcRenderer.invoke('backup:selectOpenPath'),
    selectDirectory: () => ipcRenderer.invoke('backup:selectDirectory')
  },

  // Log operations
  log: {
    getLogs: (filter?: any) => ipcRenderer.invoke('log:getLogs', filter),
    enableSessionLogging: (sessionId: string) => ipcRenderer.invoke('log:enableSessionLogging', sessionId),
    disableSessionLogging: (sessionId: string) => ipcRenderer.invoke('log:disableSessionLogging', sessionId)
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },

  // Server Monitor operations
  serverMonitor: {
    start: (sessionId: string, config?: any) => ipcRenderer.invoke('serverMonitor:start', sessionId, config),
    stop: (sessionId: string) => ipcRenderer.invoke('serverMonitor:stop', sessionId),
    getMetrics: (sessionId: string) => ipcRenderer.invoke('serverMonitor:getMetrics', sessionId),
    getMonitoredSessions: () => ipcRenderer.invoke('serverMonitor:getMonitoredSessions'),
    updateConfig: (sessionId: string, config: any) => ipcRenderer.invoke('serverMonitor:updateConfig', sessionId, config),
    onMetrics: (callback: (sessionId: string, metrics: any) => void) => {
      ipcRenderer.on('serverMonitor:metrics', (_event, sessionId, metrics) => callback(sessionId, metrics))
    },
    onError: (callback: (sessionId: string, error: any) => void) => {
      ipcRenderer.on('serverMonitor:error', (_event, sessionId, error) => callback(sessionId, error))
    }
  },

  // SSH Key operations
  sshKey: {
    getAll: () => ipcRenderer.invoke('sshKey:getAll'),
    get: (id: string) => ipcRenderer.invoke('sshKey:get', id),
    generate: (options: any) => ipcRenderer.invoke('sshKey:generate', options),
    add: (keyData: any) => ipcRenderer.invoke('sshKey:add', keyData),
    import: (name: string, privateKeyPath: string, passphrase?: string) => ipcRenderer.invoke('sshKey:import', name, privateKeyPath, passphrase),
    importBatch: (files: string[]) => ipcRenderer.invoke('sshKey:importBatch', files),
    export: (id: string, exportPath: string) => ipcRenderer.invoke('sshKey:export', id, exportPath),
    update: (id: string, updates: any) => ipcRenderer.invoke('sshKey:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('sshKey:delete', id),
    readPrivateKey: (id: string) => ipcRenderer.invoke('sshKey:readPrivateKey', id),
    getStatistics: () => ipcRenderer.invoke('sshKey:getStatistics'),
    selectPrivateKeyFile: () => ipcRenderer.invoke('sshKey:selectPrivateKeyFile'),
    selectPrivateKeyFiles: () => ipcRenderer.invoke('sshKey:selectPrivateKeyFiles'),
    selectExportPath: (defaultName: string) => ipcRenderer.invoke('sshKey:selectExportPath', defaultName)
  },

  // Audit Log operations
  auditLog: {
    getAll: () => ipcRenderer.invoke('auditLog:getAll'),
    get: (id: string) => ipcRenderer.invoke('auditLog:get', id),
    query: (filter: any) => ipcRenderer.invoke('auditLog:filter', filter),
    filter: (filter: any) => ipcRenderer.invoke('auditLog:filter', filter),
    getByTimeRange: (startDate: string, endDate: string) => ipcRenderer.invoke('auditLog:getByTimeRange', startDate, endDate),
    getByLevel: (level: string) => ipcRenderer.invoke('auditLog:getByLevel', level),
    getByAction: (action: string) => ipcRenderer.invoke('auditLog:getByAction', action),
    getBySession: (sessionId: string) => ipcRenderer.invoke('auditLog:getBySession', sessionId),
    getBySuccess: (success: boolean) => ipcRenderer.invoke('auditLog:getBySuccess', success),
    getStatistics: (startDate?: string, endDate?: string) => ipcRenderer.invoke('auditLog:getStatistics', startDate, endDate),
    getToday: () => ipcRenderer.invoke('auditLog:getToday'),
    getWeek: () => ipcRenderer.invoke('auditLog:getWeek'),
    getMonth: () => ipcRenderer.invoke('auditLog:getMonth'),
    export: (filter?: any) => ipcRenderer.invoke('auditLog:export', filter),
    exportToCSV: (filter?: any) => ipcRenderer.invoke('auditLog:exportToCSV', filter),
    clear: () => ipcRenderer.invoke('auditLog:clearAll'),
    clearAll: () => ipcRenderer.invoke('auditLog:clearAll'),
    delete: (id: string) => ipcRenderer.invoke('auditLog:delete', id)
  },

  // Session Lock operations
  sessionLock: {
    getConfig: () => ipcRenderer.invoke('sessionLock:getConfig'),
    updateConfig: (updates: any) => ipcRenderer.invoke('sessionLock:updateConfig', updates),
    setPassword: (password: string) => ipcRenderer.invoke('sessionLock:setPassword', password),
    verifyPassword: (password: string) => ipcRenderer.invoke('sessionLock:verifyPassword', password),
    hasPassword: () => ipcRenderer.invoke('sessionLock:hasPassword'),
    removePassword: () => ipcRenderer.invoke('sessionLock:removePassword'),
    lock: () => ipcRenderer.invoke('sessionLock:lock'),
    unlock: (password?: string) => ipcRenderer.invoke('sessionLock:unlock', password),
    isLocked: () => ipcRenderer.invoke('sessionLock:isLocked'),
    updateActivity: () => ipcRenderer.invoke('sessionLock:updateActivity'),
    getStatus: () => ipcRenderer.invoke('sessionLock:getStatus'),
    onLocked: (callback: () => void) => {
      ipcRenderer.on('session:locked', (_event) => callback())
    },
    onUnlocked: (callback: () => void) => {
      ipcRenderer.on('session:unlocked', (_event) => callback())
    }
  },

  // Task Scheduler operations
  taskScheduler: {
    getAll: () => ipcRenderer.invoke('taskScheduler:getAll'),
    get: (id: string) => ipcRenderer.invoke('taskScheduler:get', id),
    create: (data: any) => ipcRenderer.invoke('taskScheduler:create', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('taskScheduler:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('taskScheduler:delete', id),
    enable: (id: string) => ipcRenderer.invoke('taskScheduler:enable', id),
    disable: (id: string) => ipcRenderer.invoke('taskScheduler:disable', id),
    execute: (id: string) => ipcRenderer.invoke('taskScheduler:execute', id),
    getExecutions: (taskId: string, limit?: number) => ipcRenderer.invoke('taskScheduler:getExecutions', taskId, limit),
    getAllExecutions: () => ipcRenderer.invoke('taskScheduler:getAllExecutions'),
    clearExecutions: (taskId: string) => ipcRenderer.invoke('taskScheduler:clearExecutions', taskId),
    search: (query: string) => ipcRenderer.invoke('taskScheduler:search', query),
    getByTag: (tag: string) => ipcRenderer.invoke('taskScheduler:getByTag', tag),
    getStatistics: () => ipcRenderer.invoke('taskScheduler:getStatistics'),
    onTaskStarted: (callback: (data: any) => void) => {
      ipcRenderer.on('taskScheduler:task-started', (_event, data) => callback(data))
    },
    onTaskCompleted: (callback: (data: any) => void) => {
      ipcRenderer.on('taskScheduler:task-completed', (_event, data) => callback(data))
    },
    onTaskFailed: (callback: (data: any) => void) => {
      ipcRenderer.on('taskScheduler:task-failed', (_event, data) => callback(data))
    },
    onTaskNotify: (callback: (data: any) => void) => {
      ipcRenderer.on('taskScheduler:task-notify', (_event, data) => callback(data))
    }
  },

  // Workflow operations
  workflow: {
    getAll: () => ipcRenderer.invoke('workflow:getAll'),
    get: (id: string) => ipcRenderer.invoke('workflow:get', id),
    create: (data: any) => ipcRenderer.invoke('workflow:create', data),
    update: (id: string, updates: any) => ipcRenderer.invoke('workflow:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('workflow:delete', id),
    execute: (id: string, variables?: any) => ipcRenderer.invoke('workflow:execute', id, variables),
    getExecutions: (workflowId: string, limit?: number) => ipcRenderer.invoke('workflow:getExecutions', workflowId, limit),
    search: (query: string) => ipcRenderer.invoke('workflow:search', query),
    getByTag: (tag: string) => ipcRenderer.invoke('workflow:getByTag', tag),
    getStatistics: () => ipcRenderer.invoke('workflow:getStatistics'),
    onStarted: (callback: (data: any) => void) => {
      ipcRenderer.on('workflow:started', (_event, data) => callback(data))
    },
    onCompleted: (callback: (data: any) => void) => {
      ipcRenderer.on('workflow:completed', (_event, data) => callback(data))
    },
    onFailed: (callback: (data: any) => void) => {
      ipcRenderer.on('workflow:failed', (_event, data) => callback(data))
    }
  },

  // AI operations
  ai: {
    // 渠道管理
    addChannel: (data: any) => ipcRenderer.invoke('ai:addChannel', data),
    updateChannel: (id: string, updates: any) => ipcRenderer.invoke('ai:updateChannel', id, updates),
    deleteChannel: (id: string) => ipcRenderer.invoke('ai:deleteChannel', id),
    verifyChannel: (id: string) => ipcRenderer.invoke('ai:verifyChannel', id),
    getAllChannels: () => ipcRenderer.invoke('ai:getAllChannels'),

    // 模型管理
    fetchModels: (channelId: string) => ipcRenderer.invoke('ai:fetchModels', channelId),
    addModel: (data: any) => ipcRenderer.invoke('ai:addModel', data),
    deleteModel: (id: string) => ipcRenderer.invoke('ai:deleteModel', id),
    getAllModels: () => ipcRenderer.invoke('ai:getAllModels'),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke('ai:setDefaultModel', modelId),

    // AI 请求
    request: (action: string, content: string, language?: string) =>
      ipcRenderer.invoke('ai:request', action, content, language),
    requestWithModel: (action: string, content: string, modelId: string, language?: string) =>
      ipcRenderer.invoke('ai:requestWithModel', action, content, modelId, language),
    cancelRequest: (requestId: string) => ipcRenderer.invoke('ai:cancelRequest', requestId),

    // 配置管理
    updateConfig: (updates: any) => ipcRenderer.invoke('ai:updateConfig', updates),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),

    // 事件监听
    onProgress: (callback: (requestId: string, progress: number) => void) => {
      ipcRenderer.on('ai:progress', (_event, requestId, progress) => callback(requestId, progress))
    },
    onStreamChunk: (callback: (requestId: string, chunk: string) => void) => {
      const listener = (_event: any, requestId: string, chunk: string) => callback(requestId, chunk)
      ipcRenderer.on('ai:stream-chunk', listener)
      return () => {
        ipcRenderer.removeListener('ai:stream-chunk', listener)
      }
    },
    onComplete: (callback: (requestId: string, response: string) => void) => {
      ipcRenderer.on('ai:complete', (_event, requestId, response) => callback(requestId, response))
    },
    onError: (callback: (requestId: string, error: string) => void) => {
      ipcRenderer.on('ai:error', (_event, requestId, error) => callback(requestId, error))
    },
    onCancelled: (callback: (requestId: string) => void) => {
      ipcRenderer.on('ai:cancelled', (_event, requestId) => callback(requestId))
    },

    // 聊天历史管理（全局）
    getChatHistory: () => ipcRenderer.invoke('ai:getChatHistory'),
    saveChatHistory: (messages: any[]) => ipcRenderer.invoke('ai:saveChatHistory', messages),
    clearChatHistory: () => ipcRenderer.invoke('ai:clearChatHistory'),

    // 聊天历史管理（终端）
    getTerminalChatHistory: (connectionId: string) => ipcRenderer.invoke('ai:getTerminalChatHistory', connectionId),
    saveTerminalChatHistory: (connectionId: string, messages: any[]) => ipcRenderer.invoke('ai:saveTerminalChatHistory', connectionId, messages),
    clearTerminalChatHistory: (connectionId: string) => ipcRenderer.invoke('ai:clearTerminalChatHistory', connectionId)
  },

  // RDP operations
  rdp: {
    connect: (config: any) => ipcRenderer.invoke('rdp:connect', config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('rdp:disconnect', connectionId),
    getStatus: (connectionId: string) => ipcRenderer.invoke('rdp:getStatus', connectionId),
    getAllConnections: () => ipcRenderer.invoke('rdp:getAllConnections'),
    onConnected: (callback: (connectionId: string) => void) => {
      ipcRenderer.on('rdp:connected', (_event, connectionId) => callback(connectionId))
    },
    onDisconnected: (callback: (connectionId: string, code: number | null) => void) => {
      ipcRenderer.on('rdp:disconnected', (_event, connectionId, code) => callback(connectionId, code))
    },
    onError: (callback: (connectionId: string, error: string) => void) => {
      ipcRenderer.on('rdp:error', (_event, connectionId, error) => callback(connectionId, error))
    }
  },

  // VNC operations
  vnc: {
    connect: (config: any) => ipcRenderer.invoke('vnc:connect', config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('vnc:disconnect', connectionId),
    getStatus: (connectionId: string) => ipcRenderer.invoke('vnc:getStatus', connectionId),
    getAllConnections: () => ipcRenderer.invoke('vnc:getAllConnections'),
    onConnected: (callback: (connectionId: string) => void) => {
      ipcRenderer.on('vnc:connected', (_event, connectionId) => callback(connectionId))
    },
    onDisconnected: (callback: (connectionId: string) => void) => {
      ipcRenderer.on('vnc:disconnected', (_event, connectionId) => callback(connectionId))
    },
    onError: (callback: (connectionId: string, error: string) => void) => {
      ipcRenderer.on('vnc:error', (_event, connectionId, error) => callback(connectionId, error))
    }
  }
})

// Type definitions for the exposed API
export interface ElectronAPI {
  ssh: {
    connect: (id: string, options: any) => Promise<void>
    disconnect: (id: string) => Promise<void>
    write: (id: string, data: string) => void
    executeCommand: (id: string, command: string, timeout?: number) => Promise<{ success: boolean; data?: string; error?: string }>
    resize: (id: string, cols: number, rows: number) => void
    getConnection: (id: string) => Promise<any>
    getAllConnections: () => Promise<any[]>
    onData: (callback: (id: string, data: string) => void) => void
    onError: (callback: (id: string, error: string) => void) => void
    onClose: (callback: (id: string) => void) => void
  }
  session: {
    getAll: () => Promise<any[]>
    get: (id: string) => Promise<any>
    create: (config: any) => Promise<any>
    update: (id: string, updates: any) => Promise<void>
    delete: (id: string) => Promise<void>
    export: (filePath: string) => Promise<void>
    import: (filePath: string) => Promise<any[]>
  }
  sftp: {
    init: (connectionId: string) => Promise<void>
    listDirectory: (connectionId: string, path: string) => Promise<any[]>
    uploadFile: (connectionId: string, localPath: string, remotePath: string) => Promise<void>
    downloadFile: (connectionId: string, remotePath: string, localPath: string) => Promise<void>
    onProgress: (callback: (taskId: string, progress: any) => void) => void
  }
  settings: {
    get: () => Promise<any>
    update: (updates: any) => Promise<void>
    reset: () => Promise<void>
    onChange: (callback: (settings: any) => void) => void
  }
  app: {
    getVersion: () => Promise<string>
  }
}


