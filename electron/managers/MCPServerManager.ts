import { createHash, timingSafeEqual, randomBytes, webcrypto } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'
import { auditLogManager, AuditAction } from './AuditLogManager'
import { sshConnectionManager, type SSHConnection } from './SSHConnectionManager'
import { sftpManager } from './SFTPManager'
import { appSettingsManager, type AgentMcpSettings } from '../utils/app-settings'
import { logger } from '../utils/logger'
import {
  MCP_READ_ONLY_QUERY_PROGRAMS,
  validateMcpReadOnlyCommand
} from '../utils/mcp-readonly-command'

// Electron's main-process Node runtime may not expose Web Crypto globally,
// while the MCP Streamable HTTP transport expects the Web Crypto global.
export function ensureMcpWebCrypto(): void {
  if (typeof globalThis.crypto !== 'undefined') return

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto
  })
}

ensureMcpWebCrypto()

const MCP_PATH = '/mcp'
const DEFAULT_MAX_READ_BYTES = 1024 * 1024
const MAX_LIST_ENTRIES = 2000
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const DEFAULT_QUERY_TIMEOUT_MS = 10_000
const MAX_QUERY_TIMEOUT_MS = 20_000
const MAX_QUERY_OUTPUT_BYTES = 64 * 1024
const MAX_QUERY_CAPTURE_BYTES = 256 * 1024
const MAX_WRITE_FILE_BYTES = 1024 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000
const MAX_COMMAND_TIMEOUT_MS = 120_000
const MAX_COMMAND_LENGTH = 8000
const MAX_COMMAND_CAPTURE_BYTES = 2 * 1024 * 1024

class MCPRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 413,
    message: string
  ) {
    super(message)
    this.name = 'MCPRequestError'
  }
}

type ActiveRequest = {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

export interface McpServerStatus {
  enabled: boolean
  running: boolean
  host: '127.0.0.1'
  port: number
  endpoint: string
  token: string
}

export interface McpOperationResult {
  success: boolean
  error?: string
}

class MCPServerManager {
  private httpServer: Server | null = null
  private activeRuntimeConfig: AgentMcpSettings | null = null
  private activeRequests = new Set<ActiveRequest>()

  async initialize(): Promise<McpOperationResult> {
    const settings = appSettingsManager.getSettings().agentMcp
    if (!settings.enabled) {
      return { success: true }
    }

    return this.applySettings(settings)
  }

  getStatus(): McpServerStatus {
    const settings = appSettingsManager.getSettings().agentMcp
    return {
      enabled: settings.enabled,
      running: this.httpServer !== null,
      host: settings.host,
      port: settings.port,
      endpoint: `http://${settings.host}:${settings.port}${MCP_PATH}`,
      token: settings.token
    }
  }

  async applySettings(settings: AgentMcpSettings): Promise<McpOperationResult> {
    if (!settings.enabled) {
      await this.stop()
      return { success: true }
    }

    if (this.httpServer && this.isDifferentRuntimeConfig(settings)) {
      await this.stop()
    }

    if (this.httpServer) {
      return { success: true }
    }

    return this.start(settings)
  }

  async setEnabled(enabled: boolean): Promise<McpOperationResult> {
    const previous = appSettingsManager.getSettings().agentMcp
    const next = { ...previous, enabled }

    await appSettingsManager.updateSettings({ agentMcp: next })
    const result = await this.applySettings(next)
    if (!result.success) {
      await appSettingsManager.updateSettings({ agentMcp: previous })
      await this.applySettings(previous)
      return result
    }

    this.broadcastSettingsChanged()
    return result
  }

  async regenerateToken(): Promise<McpOperationResult> {
    const previous = appSettingsManager.getSettings().agentMcp
    const next = {
      ...previous,
      token: randomBytes(32).toString('base64url')
    }

    await appSettingsManager.updateSettings({ agentMcp: next })
    const result = await this.applySettings(next)
    if (!result.success) {
      await appSettingsManager.updateSettings({ agentMcp: previous })
      await this.applySettings(previous)
      return result
    }

    this.broadcastSettingsChanged()
    return result
  }

  async stop(): Promise<void> {
    const activeRequests = Array.from(this.activeRequests)
    this.activeRequests.clear()

    await Promise.all(
      activeRequests.map(async ({ server, transport }) => {
        await Promise.allSettled([transport.close(), server.close()])
      })
    )

    const server = this.httpServer
    this.httpServer = null
    this.activeRuntimeConfig = null
    if (!server) return

    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections()
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections()
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    }).catch(() => undefined)
  }

  private async start(settings: AgentMcpSettings): Promise<McpOperationResult> {
    if (this.httpServer) return { success: true }

    if (!settings.token) {
      return { success: false, error: 'MCP 令牌为空，请重新生成令牌' }
    }

    const server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        let startupSettled = false
        const onError = (error: Error) => {
          if (!startupSettled) {
            startupSettled = true
            reject(error)
            return
          }

          logger.logError('system', 'MCP HTTP 服务发生错误', error)
        }
        const onListening = () => {
          if (startupSettled) return
          startupSettled = true
          resolve()
        }

        server.on('error', onError)
        server.once('listening', onListening)
        server.listen(settings.port, settings.host)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.logError(
        'system',
        `MCP 服务启动失败 ${settings.host}:${settings.port}`,
        new Error(message)
      )
      return {
        success: false,
        error: `MCP 服务启动失败：${message}`
      }
    }

    this.httpServer = server
    server.requestTimeout = MAX_COMMAND_TIMEOUT_MS + 10_000
    server.headersTimeout = 10_000
    server.maxConnections = 32
    this.activeRuntimeConfig = { ...settings }
    logger.logInfo(
      'system',
      `MCP 本机 Agent 服务已启动: http://${settings.host}:${settings.port}${MCP_PATH}`
    )
    return { success: true }
  }

  private isDifferentRuntimeConfig(settings: AgentMcpSettings): boolean {
    const current = this.activeRuntimeConfig
    return (
      !current ||
      current.host !== settings.host ||
      current.port !== settings.port ||
      current.token !== settings.token
    )
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isAllowedHost(req)) {
      this.sendJson(res, 400, { error: 'Invalid host' })
      return
    }

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')

    if (requestUrl.pathname !== MCP_PATH) {
      this.sendJson(res, 404, { error: 'Not found' })
      return
    }

    if (!this.isAuthorized(req)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      this.sendJson(res, 401, { error: 'Unauthorized' })
      return
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      this.sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    let parsedBody: unknown
    try {
      parsedBody = await this.readRequestBody(req)
    } catch (error) {
      if (error instanceof MCPRequestError) {
        this.sendJson(res, error.statusCode, { error: error.message })
        return
      }
      this.sendJson(res, 400, { error: 'Invalid request body' })
      return
    }

    const requestServer = this.createMcpServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    })
    const activeRequest = { server: requestServer, transport }
    this.activeRequests.add(activeRequest)

    const cleanup = () => {
      this.activeRequests.delete(activeRequest)
      void Promise.allSettled([transport.close(), requestServer.close()])
    }
    res.once('close', cleanup)

    try {
      await requestServer.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (error) {
      cleanup()
      const message = error instanceof Error ? error.message : String(error)
      logger.logError('system', 'MCP 请求处理失败', new Error(message))
      if (!res.headersSent) {
        this.sendJson(res, 500, { error: 'Internal server error' })
      }
    }
  }

  private async readRequestBody(req: IncomingMessage): Promise<unknown> {
    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      req.resume()
      throw new MCPRequestError(413, 'Request body too large')
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let totalBytes = 0
      let settled = false

      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      req.on('data', (chunk: Buffer | string) => {
        if (settled) return

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buffer.length
        if (totalBytes > MAX_REQUEST_BYTES) {
          rejectOnce(new MCPRequestError(413, 'Request body too large'))
          req.resume()
          return
        }
        chunks.push(buffer)
      })

      req.once('end', () => {
        if (settled) return
        settled = true

        if (chunks.length === 0) {
          resolve(undefined)
          return
        }

        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new MCPRequestError(400, 'Invalid JSON body'))
        }
      })

      req.once('error', (error) => rejectOnce(error))
    })
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      {
        name: 'mshell',
        version: app.getVersion(),
        websiteUrl: 'https://github.com/inspoaibox/Mshell'
      },
      {
        instructions:
          'MShell exposes read-only tools for SSH sessions currently connected in the desktop application, ' +
          'including restricted query-command execution. It also exposes write-capable tools that require allowWrite=true. ' +
          'Call list_ssh_sessions first and use a returned connectionId. Never infer write authorization: only use a ' +
          'write-capable tool when the user explicitly requests the change and explicitly provides allowWrite=true.'
      }
    )

    server.registerTool(
      'list_ssh_sessions',
      {
        title: 'List connected SSH sessions',
        description: 'List SSH sessions currently held by MShell. Credentials are never returned.',
        inputSchema: {}
      },
      async () => {
        const sessions = sshConnectionManager
          .getAllConnections()
          .filter((connection) => connection.status === 'connected')
          .map((connection) => ({
            connectionId: connection.id,
            status: connection.status,
            host: connection.options.host,
            port: connection.options.port,
            username: connection.options.username,
            sessionName: connection.options.sessionName || '',
            lastActivity: connection.lastActivity.toISOString()
          }))

        this.auditToolCall('list_ssh_sessions', { count: sessions.length }, true)
        return this.toToolResult(sessions)
      }
    )

    server.registerTool(
      'get_ssh_connection_status',
      {
        title: 'Get SSH connection status',
        description: 'Get safe status information for one currently connected SSH session.',
        inputSchema: {
          connectionId: z.string().min(1).max(200)
        }
      },
      async ({ connectionId }) => {
        try {
          const connection = this.requireConnectedConnection(connectionId)
          const result = {
            connectionId: connection.id,
            status: connection.status,
            host: connection.options.host,
            port: connection.options.port,
            username: connection.options.username,
            sessionName: connection.options.sessionName || '',
            lastActivity: connection.lastActivity.toISOString()
          }
          this.auditToolCall('get_ssh_connection_status', { connectionId }, true)
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError('get_ssh_connection_status', { connectionId }, error)
        }
      }
    )

    server.registerTool(
      'list_remote_files',
      {
        title: 'List remote files',
        description: 'List one directory through SFTP on a currently connected SSH session.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          path: z.string().min(1).max(4096).default('.')
        }
      },
      async ({ connectionId, path }) => {
        try {
          this.requireConnectedConnection(connectionId)
          await this.ensureSftp(connectionId)
          const files = await sftpManager.listDirectory(connectionId, path)
          const limitedFiles = files.slice(0, MAX_LIST_ENTRIES).map((file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            modifyTime: file.modifyTime.toISOString(),
            permissions: file.permissions,
            owner: file.owner,
            group: file.group
          }))
          const result = {
            connectionId,
            path,
            truncated: files.length > MAX_LIST_ENTRIES,
            files: limitedFiles
          }
          this.auditToolCall('list_remote_files', { connectionId, path }, true)
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError('list_remote_files', { connectionId, path }, error)
        }
      }
    )

    server.registerTool(
      'read_remote_file',
      {
        title: 'Read remote text file',
        description:
          'Read a UTF-8 text file through SFTP on a currently connected SSH session. ' +
          'The default and maximum size limit is 1 MiB.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          filePath: z.string().min(1).max(4096),
          maxBytes: z.number().int().min(1).max(DEFAULT_MAX_READ_BYTES).optional()
        }
      },
      async ({ connectionId, filePath, maxBytes }) => {
        try {
          this.requireConnectedConnection(connectionId)
          await this.ensureSftp(connectionId)
          const limit = maxBytes || DEFAULT_MAX_READ_BYTES
          const size = await sftpManager.getFileSize(connectionId, filePath)
          if (size > limit) {
            throw new Error(`文件大小 ${size} 字节超过读取上限 ${limit} 字节`)
          }

          const content = await sftpManager.readFileLimited(connectionId, filePath, limit)
          const result = {
            connectionId,
            filePath,
            bytes: Buffer.byteLength(content, 'utf8'),
            content
          }
          this.auditToolCall(
            'read_remote_file',
            { connectionId, filePath, bytes: result.bytes },
            true
          )
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError('read_remote_file', { connectionId, filePath }, error)
        }
      }
    )

    server.registerTool(
      'execute_readonly_command',
      {
        title: 'Execute a read-only SSH query command',
        description:
          'Execute one restricted read-only query command on a currently connected SSH session and return its output. ' +
          'Shell pipelines, redirection, command chains, script interpreters, sudo, and modifying commands are rejected. ' +
          `Supported programs: ${MCP_READ_ONLY_QUERY_PROGRAMS.join(', ')}.`,
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          command: z.string().min(1).max(2000),
          timeoutMs: z.number().int().min(1000).max(MAX_QUERY_TIMEOUT_MS).optional()
        }
      },
      async ({ connectionId, command, timeoutMs }) => {
        try {
          this.requireConnectedConnection(connectionId)
          const validatedCommand = validateMcpReadOnlyCommand(command)
          const output = await sshConnectionManager.executeCommand(
            connectionId,
            validatedCommand,
            timeoutMs || DEFAULT_QUERY_TIMEOUT_MS,
            MAX_QUERY_CAPTURE_BYTES
          )
          const outputBuffer = Buffer.from(output, 'utf8')
          const truncated = outputBuffer.length > MAX_QUERY_OUTPUT_BYTES
          const visibleOutput = truncated
            ? outputBuffer.subarray(0, MAX_QUERY_OUTPUT_BYTES).toString('utf8')
            : output
          const result = {
            connectionId,
            command: validatedCommand,
            output: visibleOutput,
            outputBytes: outputBuffer.length,
            truncated
          }
          this.auditToolCall(
            'execute_readonly_command',
            {
              connectionId,
              command: validatedCommand,
              outputBytes: outputBuffer.length,
              truncated
            },
            true
          )
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError('execute_readonly_command', { connectionId, command }, error)
        }
      }
    )

    server.registerTool(
      'write_remote_file',
      {
        title: 'Write a remote UTF-8 text file',
        description:
          'Create or overwrite one remote UTF-8 text file through SFTP. This changes the server and requires ' +
          'allowWrite=true on every call. Never infer this authorization from prior turns.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          filePath: z.string().min(1).max(4096),
          content: z.string().max(MAX_WRITE_FILE_BYTES),
          allowWrite: z.boolean().default(false)
        }
      },
      async ({ connectionId, filePath, content, allowWrite }) => {
        try {
          this.requireWriteAuthorization(allowWrite)
          this.requireConnectedConnection(connectionId)
          const bytes = Buffer.byteLength(content, 'utf8')
          if (bytes > MAX_WRITE_FILE_BYTES) {
            throw new Error(`写入内容超过上限 ${MAX_WRITE_FILE_BYTES} 字节`)
          }

          await this.ensureSftp(connectionId)
          await sftpManager.writeFile(connectionId, filePath, content)
          const result = { connectionId, filePath, bytes, written: true }
          this.auditToolCall(
            'write_remote_file',
            { connectionId, filePath, bytes, allowWrite: true },
            true
          )
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError(
            'write_remote_file',
            { connectionId, filePath, bytes: Buffer.byteLength(content, 'utf8'), allowWrite },
            error
          )
        }
      }
    )

    server.registerTool(
      'execute_command',
      {
        title: 'Execute an explicitly authorized SSH command',
        description:
          'Execute a command that may modify the remote server and return its output. This requires allowWrite=true ' +
          'on every call. Never infer this authorization from prior turns.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          command: z.string().min(1).max(MAX_COMMAND_LENGTH),
          allowWrite: z.boolean().default(false),
          timeoutMs: z.number().int().min(1000).max(MAX_COMMAND_TIMEOUT_MS).optional()
        }
      },
      async ({ connectionId, command, allowWrite, timeoutMs }) => {
        try {
          this.requireWriteAuthorization(allowWrite)
          this.requireConnectedConnection(connectionId)
          const normalizedCommand = command.trim()
          if (!normalizedCommand) throw new Error('执行命令不能为空')

          const output = await sshConnectionManager.executeCommand(
            connectionId,
            normalizedCommand,
            timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS,
            MAX_COMMAND_CAPTURE_BYTES
          )
          const outputBuffer = Buffer.from(output, 'utf8')
          const truncated = outputBuffer.length > MAX_QUERY_OUTPUT_BYTES
          const visibleOutput = truncated
            ? outputBuffer.subarray(0, MAX_QUERY_OUTPUT_BYTES).toString('utf8')
            : output
          const result = {
            connectionId,
            command: normalizedCommand,
            output: visibleOutput,
            outputBytes: outputBuffer.length,
            truncated,
            executed: true
          }
          this.auditToolCall(
            'execute_command',
            {
              connectionId,
              ...this.getCommandAuditDetails(normalizedCommand),
              outputBytes: outputBuffer.length,
              truncated,
              allowWrite: true
            },
            true
          )
          return this.toToolResult(result)
        } catch (error) {
          const timeout = timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
          const safeError =
            error instanceof Error && error.message.startsWith('Command execution timeout:')
              ? new Error(`Command execution timeout after ${timeout} ms`)
              : error
          return this.toToolError(
            'execute_command',
            { connectionId, ...this.getCommandAuditDetails(command), allowWrite },
            safeError
          )
        }
      }
    )

    return server
  }

  private requireWriteAuthorization(allowWrite: boolean): void {
    if (allowWrite !== true) {
      throw new Error('写入或修改操作需要显式传入 allowWrite=true')
    }
  }

  private getCommandAuditDetails(command: string): {
    commandSha256: string
    commandLength: number
  } {
    const normalizedCommand = command.trim()
    return {
      commandSha256: createHash('sha256').update(normalizedCommand).digest('hex'),
      commandLength: normalizedCommand.length
    }
  }

  private requireConnectedConnection(connectionId: string): SSHConnection {
    const connection = sshConnectionManager.getConnection(connectionId)
    if (!connection) {
      throw new Error(`未找到 SSH 会话：${connectionId}`)
    }
    if (connection.status !== 'connected') {
      throw new Error(`SSH 会话当前不可用，状态为：${connection.status}`)
    }
    return connection
  }

  private async ensureSftp(connectionId: string): Promise<void> {
    const connection = this.requireConnectedConnection(connectionId)
    if (sftpManager.hasSFTP(connectionId, connection.client)) return

    await sftpManager.initSFTP(connectionId, connection.client)
  }

  private toToolResult(payload: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    }
  }

  private toToolError(tool: string, details: Record<string, unknown>, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    this.auditToolCall(tool, details, false, message)
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: message
        }
      ]
    }
  }

  private auditToolCall(
    tool: string,
    details: Record<string, unknown>,
    success: boolean,
    errorMessage?: string
  ): void {
    auditLogManager.log(AuditAction.MCP_TOOL_CALL, {
      resource: tool,
      details,
      success,
      errorMessage
    })
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const authorization = req.headers.authorization
    if (typeof authorization !== 'string') return false

    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (!match) return false

    const expected = Buffer.from(appSettingsManager.getSettings().agentMcp.token)
    const received = Buffer.from(match[1])
    return expected.length === received.length && timingSafeEqual(expected, received)
  }

  private isAllowedHost(req: IncomingMessage): boolean {
    const hostHeader = req.headers.host?.toLowerCase()
    if (!hostHeader) return false

    const port = appSettingsManager.getSettings().agentMcp.port
    return new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
      '127.0.0.1',
      'localhost',
      '[::1]'
    ]).has(hostHeader)
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    if (res.headersSent) return
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  private broadcastSettingsChanged(): void {
    const settings = appSettingsManager.getSettings()
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:changed', settings)
      }
    })
  }
}

export const mcpServerManager = new MCPServerManager()
