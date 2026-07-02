type ApiResult<T = void> = {
  success: boolean
  data?: T
  error?: string
  message?: string
  latency?: number
  wsPort?: number
  userMessage?: string
  code?: string
  details?: any
}

type DeleteBatchResult = {
  success: string[]
  failed: Array<{ path: string; error: string }>
}

type TransferBatchResult = DeleteBatchResult & {
  paused: string[]
}

type UploadTransferRequest = {
  localPath: string
  remotePath: string
  taskId?: string
  resumeFromExisting?: boolean
}

type DownloadTransferRequest = {
  remotePath: string
  localPath: string
  taskId?: string
  resumeFromExisting?: boolean
}

export interface ElectronAPI {
  session: {
    getAll: () => Promise<import('./session').SessionConfig[]>
    search: (query: string) => Promise<import('./session').SessionConfig[]>
    get: (id: string) => Promise<import('./session').SessionConfig>
    create: (
      config: Partial<import('./session').SessionConfig>
    ) => Promise<ApiResult<import('./session').SessionConfig>>
    update: (id: string, updates: Partial<import('./session').SessionConfig>) => Promise<ApiResult>
    delete: (id: string) => Promise<ApiResult>
    export: (filePath: string) => Promise<ApiResult>
    import: (filePath: string) => Promise<ApiResult<import('./session').SessionConfig[]>>
    getAllGroups: () => Promise<import('./session').SessionGroup[]>
    createGroup: (name: string, description?: string) => Promise<import('./session').SessionGroup>
    addToGroup: (sessionId: string, groupId: string) => Promise<ApiResult>
    renameGroup: (id: string, name: string) => Promise<ApiResult>
    deleteGroup: (id: string) => Promise<ApiResult>
  }
  connectionStats: {
    updateTraffic: (connectionId: string, bytesIn: number, bytesOut: number) => Promise<ApiResult>
    incrementCommand: (connectionId: string) => Promise<ApiResult>
    start: (connectionId: string, sessionName?: string) => Promise<ApiResult<string>>
    stop: (connectionId: string) => Promise<ApiResult>
    end: (connectionId: string) => Promise<ApiResult>
    getBySession: (connectionId: string) => Promise<ApiResult<any>>
    getAll: () => Promise<ApiResult<any[]>>
    getTotalDuration: (sessionId?: string) => Promise<ApiResult<number>>
    getTotalTraffic: (sessionId?: string) => Promise<ApiResult<any>>
    getAverageDuration: (sessionId?: string) => Promise<ApiResult<number>>
    getRecent: (limit?: number) => Promise<ApiResult<any[]>>
    getToday: () => Promise<ApiResult<any[]>>
    getWeek: () => Promise<ApiResult<any[]>>
    getMonth: () => Promise<ApiResult<any[]>>
    getSummary: () => Promise<ApiResult<any>>
    cleanup: () => Promise<ApiResult>
  }
  portForward: {
    getAll: (
      connectionId: string
    ) => Promise<{ success: boolean; forwards?: any[]; error?: string }>
    add: (
      connectionId: string,
      config: any
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    start: (
      connectionId: string,
      forwardId: string
    ) => Promise<{ success: boolean; error?: string }>
    stop: (connectionId: string, forwardId: string) => Promise<{ success: boolean; error?: string }>
    delete: (
      connectionId: string,
      forwardId: string
    ) => Promise<{ success: boolean; error?: string }>
    update: (forwardId: string, updates: any) => Promise<{ success: boolean; error?: string }>
    getTrafficStats: (
      forwardId: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    getAllTrafficStats: () => Promise<{ success: boolean; data?: any; error?: string }>
    resetTrafficStats: (forwardId: string) => Promise<{ success: boolean; error?: string }>
    createTemplate: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
    getAllTemplates: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    getTemplate: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    updateTemplate: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
    deleteTemplate: (id: string) => Promise<{ success: boolean; error?: string }>
    getTemplatesByTag: (tag: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    searchTemplates: (query: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    createFromTemplate: (
      templateId: string,
      connectionId: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    autoStart: (connectionId: string) => Promise<{ success: boolean; error?: string }>
  }
  commandHistory: {
    add: (entry: any) => Promise<ApiResult<any>>
    getAll: (limit?: number) => Promise<ApiResult<any[]>>
    getBySession: (sessionId: string) => Promise<ApiResult<any[]>>
    clear: () => Promise<ApiResult>
    search: (query: string, sessionId?: string) => Promise<ApiResult<any[]>>
    getFavorites: () => Promise<ApiResult<any[]>>
    toggleFavorite: (id: string) => Promise<ApiResult>
    getMostUsed: (limit?: number) => Promise<ApiResult<any[]>>
    getRecentUnique: (
      limit: number
    ) => Promise<ApiResult<string[]>>
    getToday: () => Promise<ApiResult<any[]>>
    getByTimeRange: (startDate: string, endDate: string) => Promise<ApiResult<any[]>>
    export: (filePath: string) => Promise<ApiResult>
    clearSession: (sessionId: string) => Promise<ApiResult>
    clearAll: (keepFavorites?: boolean) => Promise<ApiResult>
    getStatistics: () => Promise<ApiResult<any>>
    delete: (id: string) => Promise<ApiResult>
  }
  ssh: {
    executeCommand: (
      sessionId: string,
      command: string,
      timeout?: number
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    getCurrentDirectory: (
      sessionId: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    cancelReconnect: (sessionId: string) => Promise<void>
    connect: (
      id: string,
      config: any
    ) => Promise<{
      success: boolean
      error?: string
      userMessage?: string
      code?: string
      details?: any
    }>
    disconnect: (id: string) => Promise<void>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    getConnection: (id: string) => Promise<any>
    getAllConnections: () => Promise<any[]>
    setReconnectConfig: (
      id: string,
      maxAttempts: number,
      interval: number
    ) => Promise<ApiResult>
    testProxy: (proxyConfig: any) => Promise<ApiResult<any>>
    testProxyJump: (proxyJumpConfig: any, underlyingProxy?: any) => Promise<ApiResult<any>>
    // 事件监听器返回取消订阅函数
    onData: (callback: (id: string, data: string) => void) => () => void
    onError: (callback: (id: string, error: string) => void) => () => void
    onClose: (callback: (id: string) => void) => () => void
    onReconnecting: (
      callback: (id: string, attempt: number, maxAttempts: number) => void
    ) => () => void
    onReconnected: (callback: (id: string) => void) => () => void
    onReconnectFailed: (callback: (id: string, reason: string) => void) => () => void
  }
  sftp: {
    init: (connectionId: string) => Promise<{ success: boolean; error?: string }>
    listDirectory: (
      connectionId: string,
      path: string
    ) => Promise<{ success: boolean; files?: any[]; error?: string }>
    createDirectory: (
      connectionId: string,
      path: string
    ) => Promise<{ success: boolean; error?: string }>
    deleteFile: (
      connectionId: string,
      path: string
    ) => Promise<{ success: boolean; error?: string }>
    renameFile: (
      connectionId: string,
      oldPath: string,
      newPath: string
    ) => Promise<{ success: boolean; error?: string }>
    uploadFile: (
      connectionId: string,
      localPath: string,
      remotePath: string,
      options?: { resumeFromExisting?: boolean }
    ) => Promise<{ success: boolean; error?: string }>
    downloadFile: (
      connectionId: string,
      remotePath: string,
      localPath: string,
      options?: { resumeFromExisting?: boolean }
    ) => Promise<{ success: boolean; error?: string }>
    readFile: (
      connectionId: string,
      filePath: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    readFileBuffer: (
      connectionId: string,
      filePath: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    writeFile: (
      connectionId: string,
      filePath: string,
      content: string
    ) => Promise<{ success: boolean; error?: string }>
    createFile: (
      connectionId: string,
      filePath: string
    ) => Promise<{ success: boolean; error?: string }>
    copyFile: (
      connectionId: string,
      sourcePath: string,
      targetPath: string
    ) => Promise<{ success: boolean; error?: string }>
    chmod: (
      connectionId: string,
      path: string,
      mode: number
    ) => Promise<{ success: boolean; error?: string }>
    getAllTasks: () => Promise<{ success: boolean; tasks?: any[]; error?: string }>
    cancelTask: (taskId: string) => Promise<{ success: boolean; error?: string }>
    pauseTransfer: (taskId: string) => Promise<{ success: boolean; error?: string }>
    resumeTransfer: (
      connectionId: string,
      taskId: string
    ) => Promise<{ success: boolean; error?: string }>
    getIncompleteTransfers: (
      connectionId?: string
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getTransferRecord: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>
    getAllTransferRecords: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    deleteTransferRecord: (taskId: string) => Promise<{ success: boolean; error?: string }>
    cleanupCompletedRecords: () => Promise<{ success: boolean; error?: string }>
    uploadFiles: (
      connectionId: string,
      files: UploadTransferRequest[]
    ) => Promise<{
      success: boolean
      results?: TransferBatchResult
      error?: string
    }>
    downloadFiles: (
      connectionId: string,
      files: DownloadTransferRequest[]
    ) => Promise<{
      success: boolean
      results?: TransferBatchResult
      error?: string
    }>
    deleteFiles: (
      connectionId: string,
      filePaths: string[]
    ) => Promise<{ success: boolean; results?: DeleteBatchResult; error?: string }>
    deleteDirectories: (
      connectionId: string,
      dirPaths: string[]
    ) => Promise<{ success: boolean; results?: DeleteBatchResult; error?: string }>
    startDrag: (
      connectionId: string,
      remotePath: string,
      fileName: string
    ) => Promise<ApiResult<{ localPath: string }>>
    changePermissions: (
      connectionId: string,
      path: string,
      mode: number
    ) => Promise<{ success: boolean; error?: string }>
    compress: (
      connectionId: string,
      sourcePath: string,
      archivePath: string
    ) => Promise<{ success: boolean; error?: string }>
    compressMultiple: (
      connectionId: string,
      sourcePaths: string[],
      archivePath: string
    ) => Promise<{ success: boolean; error?: string }>
    extract: (
      connectionId: string,
      archivePath: string,
      targetDir: string
    ) => Promise<{ success: boolean; error?: string }>
    onProgress: (callback: (taskId: string, progress: any) => void) => () => void
    onComplete: (callback: (taskId: string) => void) => () => void
    onError: (callback: (taskId: string, error: string) => void) => () => void
    connect: (
      connectionId: string,
      options: any
    ) => Promise<{
      success: boolean
      error?: string
      userMessage?: string
      code?: string
      details?: any
    }>
    list: (path: string) => Promise<any[]>
    getHomeDir: () => Promise<string>
  }
  fs: {
    readDirectory: (path: string) => Promise<{ success: boolean; files?: any[]; error?: string }>
    createDirectory: (path: string) => Promise<{ success: boolean; error?: string }>
    deleteFile: (path: string) => Promise<{ success: boolean; error?: string }>
    rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>
    stat: (path: string) => Promise<{ success: boolean; stats?: any; error?: string }>
    writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
    compress: (
      sourcePath: string,
      archivePath: string
    ) => Promise<{ success: boolean; error?: string }>
    compressMultiple: (
      sourcePaths: string[],
      archivePath: string
    ) => Promise<{ success: boolean; error?: string }>
    extract: (archivePath: string, targetDir: string) => Promise<{ success: boolean; error?: string }>
  }
  settings: {
    get: () => Promise<any>
    update: (updates: any) => Promise<void>
    reset: () => Promise<void>
    onChange: (callback: (settings: any) => void) => () => void
  }
  terminalBackground: {
    selectImage: () => Promise<
      ApiResult<{
        source: 'local'
        image: string
        fileName: string
      } | null>
    >
  }
  backup: {
    getConfig: () => Promise<any>
    updateConfig: (updates: any) => Promise<any>
    create: (password: string, filePath?: string) => Promise<any>
    restore: (filePath: string, password: string) => Promise<any>
    apply: (backupData: any, options: any) => Promise<any>
    list: () => Promise<any>
    delete: (filePath: string) => Promise<any>
    selectSavePath: (defaultPath?: string) => Promise<any>
    selectOpenPath: () => Promise<any>
    selectDirectory: () => Promise<any>
  }
  snippet: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    get: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
    incrementUsage: (id: string) => Promise<{ success: boolean; error?: string }>
    search: (query: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    searchByShortcut: (
      prefix: string
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getByShortcut: (shortcut: string) => Promise<{ success: boolean; data?: any; error?: string }>
    getAllWithShortcut: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    replaceVariables: (
      command: string,
      values: Record<string, string>
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    extractVariables: (
      command: string
    ) => Promise<{ success: boolean; data?: string[]; error?: string }>
    getPredefinedVariables: () => Promise<{ success: boolean; data?: any[]; error?: string }>
  }
  dialog: {
    showContextMenu: (items: any[]) => Promise<string>
    openFile: (options: any) => Promise<string | null>
    openDirectory: (options?: any) => Promise<string | null>
    saveFile: (options?: any) => Promise<string | null>
  }
  process?: {
    env: {
      USERPROFILE?: string
      HOME?: string
    }
  }
  onShortcut: (name: string, callback: (...args: any[]) => void) => () => void
  app: {
    getVersion: () => Promise<string>
    getDownloadsPath: () => Promise<string>
  }
  logs: {
    get: (filter?: any) => Promise<any[]>
    clear: () => Promise<ApiResult>
    enableSession: (sessionId: string) => Promise<ApiResult>
    disableSession: (sessionId: string) => Promise<ApiResult>
  }
  log?: {
    getLogs: (filter?: any) => Promise<any[]>
    clearLogs: () => Promise<ApiResult>
    enableSessionLogging: (sessionId: string) => Promise<ApiResult>
    disableSessionLogging: (sessionId: string) => Promise<ApiResult>
  }
  knownHosts: {
    verify: (host: string, port: number, keyType: string, key: string) => Promise<ApiResult<any>>
    add: (host: string, port: number, keyType: string, key: string) => Promise<ApiResult>
    getAll: () => Promise<ApiResult<any[]>>
    remove: (host: string, port: number) => Promise<ApiResult>
  }
  serverMonitor?: {
    start: (sessionId: string, config?: any) => Promise<{ success: boolean; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    getMetrics: (sessionId: string) => Promise<{ success: boolean; data?: any; error?: string }>
    getMonitoredSessions: () => Promise<{ success: boolean; data?: string[]; error?: string }>
    updateConfig: (sessionId: string, config: any) => Promise<{ success: boolean; error?: string }>
    onMetrics: (callback: (sessionId: string, metrics: any) => void) => void
    onError: (callback: (sessionId: string, error: any) => void) => void
  }
  sshKey: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    get: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    generate: (options: any) => Promise<{ success: boolean; data?: any; error?: string }>
    add: (keyData: any) => Promise<{ success: boolean; data?: any; error?: string }>
    import: (
      name: string,
      privateKeyPath: string,
      passphrase?: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    export: (id: string, exportPath: string) => Promise<{ success: boolean; error?: string }>
    update: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
    readPrivateKey: (id: string) => Promise<{ success: boolean; data?: string; error?: string }>
    getStatistics: () => Promise<{ success: boolean; data?: any; error?: string }>
    selectPrivateKeyFile: () => Promise<{
      success: boolean
      data?: string
      canceled?: boolean
      error?: string
    }>
    selectPrivateKeyFiles: () => Promise<{
      success: boolean
      data?: string[]
      canceled?: boolean
      error?: string
    }>
    importBatch: (
      files: string[]
    ) => Promise<{ success: boolean; data?: Array<{ success: boolean; name: string; error?: string }>; error?: string }>
    selectExportPath: (
      defaultName: string
    ) => Promise<{ success: boolean; data?: string; canceled?: boolean; error?: string }>
  }
  auditLog?: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    get: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    query: (filter: any) => Promise<{ success: boolean; data?: any[]; error?: string }>
    filter: (filter: any) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getByTimeRange: (
      startDate: string,
      endDate: string
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getByLevel: (level: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getByAction: (action: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getBySession: (sessionId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getBySuccess: (success: boolean) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getStatistics: (
      startDate?: string,
      endDate?: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    getToday: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    getWeek: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    getMonth: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    export: (filter?: any) => Promise<{ success: boolean; data?: string; error?: string }>
    exportToCSV: (filter?: any) => Promise<{ success: boolean; data?: string; error?: string }>
    clear: () => Promise<{ success: boolean; error?: string }>
    clearAll: () => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
  }
  sessionLock?: {
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>
    updateConfig: (updates: any) => Promise<{ success: boolean; error?: string }>
    setPassword: (password: string) => Promise<{ success: boolean; error?: string }>
    verifyPassword: (
      password: string
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>
    hasPassword: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    removePassword: () => Promise<{ success: boolean; error?: string }>
    lock: () => Promise<{ success: boolean; error?: string }>
    unlock: (password?: string) => Promise<{ success: boolean; error?: string }>
    isLocked: () => Promise<{ success: boolean; data?: boolean; error?: string }>
    updateActivity: () => Promise<{ success: boolean; error?: string }>
    getStatus: () => Promise<{ success: boolean; data?: any; error?: string }>
    onLocked: (callback: () => void) => void
    onUnlocked: (callback: () => void) => void
  }
  taskScheduler?: {
    getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    get: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
    update: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
    enable: (id: string) => Promise<{ success: boolean; error?: string }>
    disable: (id: string) => Promise<{ success: boolean; error?: string }>
    execute: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    getExecutions: (
      taskId: string,
      limit?: number
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getAllExecutions: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    clearExecutions: (taskId: string) => Promise<{ success: boolean; error?: string }>
    search: (query: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getByTag: (tag: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getStatistics: () => Promise<{ success: boolean; data?: any; error?: string }>
    onTaskStarted: (callback: (data: any) => void) => void
    onTaskCompleted: (callback: (data: any) => void) => void
    onTaskFailed: (callback: (data: any) => void) => void
    onTaskNotify: (callback: (data: any) => void) => void
  }
  ai: {
    // 渠道管理
    addChannel: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
    updateChannel: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
    deleteChannel: (id: string) => Promise<{ success: boolean; error?: string }>
    verifyChannel: (id: string) => Promise<{ success: boolean; data?: boolean; error?: string }>
    getAllChannels: () => Promise<{ success: boolean; data?: any[]; error?: string }>

    // 模型管理
    fetchModels: (channelId: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    addModel: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
    deleteModel: (id: string) => Promise<{ success: boolean; error?: string }>
    getAllModels: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>

    // AI 请求
    request: (
      action: string,
      content: string,
      language?: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    requestWithModel: (
      action: string,
      content: string,
      modelId: string,
      language?: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
    cancelRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>

    // 配置管理
    updateConfig: (updates: any) => Promise<{ success: boolean; error?: string }>
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>

    // 事件监听
    onProgress: (callback: (requestId: string, progress: number) => void) => void
    onStreamChunk: (callback: (requestId: string, chunk: string) => void) => () => void
    onComplete: (callback: (requestId: string, response: string) => void) => void
    onError: (callback: (requestId: string, error: string) => void) => void
    onCancelled: (callback: (requestId: string) => void) => void

    // 聊天历史管理
    // 聊天历史管理
    getChatHistory: () => Promise<{ success: boolean; data?: any[]; error?: string }>
    saveChatHistory: (messages: any[]) => Promise<{ success: boolean; error?: string }>
    clearChatHistory: () => Promise<{ success: boolean; error?: string }>

    // 终端聊天历史管理
    getTerminalChatHistory: (
      connectionId: string
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    saveTerminalChatHistory: (
      connectionId: string,
      messages: any[]
    ) => Promise<{ success: boolean; error?: string }>
    clearTerminalChatHistory: (
      connectionId: string
    ) => Promise<{ success: boolean; error?: string }>
  }
  sessionTemplate: {
    getAll: () => Promise<ApiResult<any[]>>
    get: (id: string) => Promise<ApiResult<any>>
    create: (data: any) => Promise<ApiResult<any>>
    update: (id: string, updates: any) => Promise<ApiResult>
    delete: (id: string) => Promise<ApiResult>
    getByTag: (tag: string) => Promise<ApiResult<any[]>>
    getByProvider: (provider: string) => Promise<ApiResult<any[]>>
    search: (query: string) => Promise<ApiResult<any[]>>
    getAllTags: () => Promise<ApiResult<string[]>>
    getAllProviders: () => Promise<ApiResult<string[]>>
    createSession: (templateId: string, overrides?: any) => Promise<ApiResult<any>>
    export: (filePath: string, templateIds?: string[]) => Promise<ApiResult>
    import: (filePath: string) => Promise<ApiResult<any>>
    duplicate: (id: string, newName?: string) => Promise<ApiResult<any>>
  }
  workflow: {
    getAll: () => Promise<ApiResult<any[]>>
    get: (id: string) => Promise<ApiResult<any>>
    create: (data: any) => Promise<ApiResult<any>>
    update: (id: string, updates: any) => Promise<ApiResult>
    delete: (id: string) => Promise<ApiResult>
    execute: (id: string, variables?: any) => Promise<ApiResult<any>>
    getExecutions: (workflowId: string, limit?: number) => Promise<ApiResult<any[]>>
    search: (query: string) => Promise<ApiResult<any[]>>
    getByTag: (tag: string) => Promise<ApiResult<any[]>>
    getStatistics: () => Promise<ApiResult<any>>
    onStarted: (callback: (data: any) => void) => () => void
    onCompleted: (callback: (data: any) => void) => () => void
    onFailed: (callback: (data: any) => void) => () => void
  }
  rdp: {
    connect: (config: any) => Promise<ApiResult<any>>
    disconnect: (connectionId: string) => Promise<ApiResult>
    getStatus: (connectionId: string) => Promise<ApiResult<any>>
    getAllConnections: () => Promise<ApiResult<any[]>>
    onConnected: (callback: (connectionId: string) => void) => () => void
    onDisconnected: (callback: (connectionId: string, code: number | null) => void) => () => void
    onError: (callback: (connectionId: string, error: string) => void) => () => void
  }
  vnc: {
    connect: (config: any) => Promise<ApiResult<any>>
    disconnect: (connectionId: string) => Promise<ApiResult>
    getStatus: (connectionId: string) => Promise<ApiResult<any>>
    getAllConnections: () => Promise<ApiResult<any[]>>
    onConnected: (callback: (connectionId: string) => void) => () => void
    onDisconnected: (callback: (connectionId: string) => void) => () => void
    onError: (callback: (connectionId: string, error: string) => void) => () => void
  }
  quickCommand: {
    getAll: () => Promise<ApiResult<any[]>>
    get: (id: string) => Promise<ApiResult<any>>
    create: (data: any) => Promise<ApiResult<any>>
    update: (id: string, updates: any) => Promise<ApiResult>
    delete: (id: string) => Promise<ApiResult>
    incrementUsage: (id: string) => Promise<ApiResult>
    getByCategory: (category: string) => Promise<ApiResult<any[]>>
    search: (query: string) => Promise<ApiResult<any[]>>
    getAllCategories: () => Promise<ApiResult<string[]>>
    getAllTags: () => Promise<ApiResult<string[]>>
    getRecent: (limit?: number) => Promise<ApiResult<any[]>>
    getFrequent: (limit?: number) => Promise<ApiResult<any[]>>
    export: (filePath: string) => Promise<ApiResult<any>>
    import: (filePath: string) => Promise<ApiResult<any>>
  }
  lazyScript: {
    getAll: () => Promise<ApiResult<any[]>>
    get: (id: string) => Promise<ApiResult<any>>
    create: (data: any) => Promise<ApiResult<any>>
    update: (id: string, updates: any) => Promise<ApiResult>
    delete: (id: string) => Promise<ApiResult>
    incrementUsage: (id: string) => Promise<ApiResult>
    getByCategory: (category: string) => Promise<ApiResult<any[]>>
    getByTag: (tag: string) => Promise<ApiResult<any[]>>
    search: (query: string) => Promise<ApiResult<any[]>>
    getAllCategories: () => Promise<ApiResult<string[]>>
    extractVariables: (content: string) => Promise<ApiResult<string[]>>
    render: (content: string, values: Record<string, string>) => Promise<ApiResult<string>>
    export: (filePath: string) => Promise<ApiResult<any>>
    import: (filePath: string) => Promise<ApiResult<any>>
  }

  // 更新操作
  update?: {
    check: () => Promise<{ success: boolean; error?: string }>
    download: () => Promise<{ success: boolean; error?: string }>
    install: () => Promise<{ success: boolean }>
    getVersion: () => Promise<{ success: boolean; data?: { version: string; name: string } }>
    onChecking: (callback: () => void) => void
    onAvailable: (
      callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void
    ) => void
    onNotAvailable: (callback: (info: { version: string }) => void) => void
    onProgress: (
      callback: (progress: {
        percent: number
        bytesPerSecond: number
        transferred: number
        total: number
      }) => void
    ) => void
    onDownloaded: (callback: (info: { version: string; releaseNotes?: string }) => void) => void
    onError: (callback: (error: { message: string }) => void) => void
  }
  sync?: {
    getConfig: () => Promise<{ success: boolean; data?: any; error?: string }>
    updateConfig: (updates: any) => Promise<{ success: boolean; error?: string }>
    setEncryptionPassword: (password: string) => Promise<{ success: boolean; error?: string }>
    verifyGitHubToken: (token: string) => Promise<{ success: boolean; data?: any; error?: string }>
    findExistingGist: (token: string) => Promise<{ success: boolean; data?: any; error?: string }>
    uploadToGitHub: () => Promise<{ success: boolean; data?: any; error?: string }>
    downloadFromGitHub: () => Promise<{ success: boolean; data?: any; error?: string }>
    disconnectGitHub: () => Promise<{ success: boolean; error?: string }>
    verifyGitLabToken: (
      token: string,
      instanceUrl?: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    findExistingSnippet: (
      token: string,
      instanceUrl?: string
    ) => Promise<{ success: boolean; data?: any; error?: string }>
    uploadToGitLab: () => Promise<{ success: boolean; data?: any; error?: string }>
    downloadFromGitLab: () => Promise<{ success: boolean; data?: any; error?: string }>
    disconnectGitLab: () => Promise<{ success: boolean; error?: string }>
    sync: () => Promise<{ success: boolean; data?: any; error?: string }>
    getStatus: () => Promise<{ success: boolean; data?: any; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
