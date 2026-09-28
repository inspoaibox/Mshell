import { createHash, timingSafeEqual, randomBytes, randomUUID, webcrypto } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'
import { auditLogManager, AuditAction } from './AuditLogManager'
import { sshConnectionManager, type SSHConnection } from './SSHConnectionManager'
import { sftpManager } from './SFTPManager'
import {
  appSettingsManager,
  type AgentMcpPermissionMode,
  type AgentMcpSettings
} from '../utils/app-settings'
import { logger } from '../utils/logger'
import {
  buildMcpDatabaseDiscoveryCommand,
  buildMcpDatabaseQuery,
  classifyMcpDatabaseError,
  parseMcpDatabaseDiscovery
} from '../utils/mcp-database-query'
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
const DATABASE_DISCOVERY_TIMEOUT_MS = 45_000
const MAX_QUERY_OUTPUT_BYTES = 64 * 1024
const MAX_QUERY_CAPTURE_BYTES = 256 * 1024
const MAX_WRITE_FILE_BYTES = 1024 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000
const MAX_COMMAND_TIMEOUT_MS = 120_000
const MAX_COMMAND_LENGTH = 8000
const MAX_COMMAND_CAPTURE_BYTES = 2 * 1024 * 1024
const MCP_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

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
  permissionMode: AgentMcpPermissionMode
  allowWriteEnabled: boolean
  running: boolean
  host: '127.0.0.1'
  port: number
  endpoint: string
  token: string
}

export interface McpApprovalRequest {
  approvalId: string
  tool: 'write_remote_file' | 'execute_command'
  connectionId: string
  summary: string
  requestedAt: string
  expiresAt: string
}

interface PendingApproval {
  resolve: (approved: boolean) => void
  timeout: NodeJS.Timeout
}

export interface McpOperationResult {
  success: boolean
  error?: string
}

class MCPServerManager {
  private httpServer: Server | null = null
  private activeRuntimeConfig: AgentMcpSettings | null = null
  private activeRequests = new Set<ActiveRequest>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private approvalQueue: Promise<void> = Promise.resolve()

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
      permissionMode: settings.permissionMode,
      allowWriteEnabled: settings.allowWriteEnabled,
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

  async setWriteEnabled(allowWriteEnabled: boolean): Promise<McpOperationResult> {
    return this.setPermissionMode(allowWriteEnabled ? 'execute' : 'query')
  }

  async setPermissionMode(permissionMode: AgentMcpPermissionMode): Promise<McpOperationResult> {
    if (!['query', 'confirm', 'execute'].includes(permissionMode)) {
      return { success: false, error: 'Agent 权限模式无效' }
    }
    const current = appSettingsManager.getSettings().agentMcp
    await appSettingsManager.updateSettings({
      agentMcp: {
        ...current,
        permissionMode,
        allowWriteEnabled: permissionMode === 'execute'
      }
    })
    this.rejectPendingApprovals()
    auditLogManager.log(AuditAction.SETTINGS_UPDATE, {
      resource: 'agent-mcp-permission',
      details: { permissionMode },
      success: true
    })
    this.broadcastSettingsChanged()
    return { success: true }
  }

  resolveApproval(approvalId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(approvalId)
    if (!pending) return false
    clearTimeout(pending.timeout)
    this.pendingApprovals.delete(approvalId)
    pending.resolve(approved)
    return true
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
    this.rejectPendingApprovals()
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
          'including system/log commands and database discovery/query tools for read-only MySQL, MariaDB, PostgreSQL, SQLite, MongoDB, Redis, SQL Server and Oracle access. ' +
          'Call discover_database_targets before query_database unless the user already supplied the exact engine, container or host, database, username and systemUser. ' +
          'If discovery returns multiple candidates, ask the user to select the target; never infer it from an active connection, a similar name or list order. ' +
          'Write-capable tools follow the MShell Agent permission mode: query denies them, confirm waits for in-app approval, and execute runs them directly. Call list_ssh_sessions first and use a returned connectionId. Never use a ' +
          'write-capable tool unless the user explicitly requests the change.'
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
          'For database data and schema queries, use query_database instead. ' +
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
      'discover_database_targets',
      {
        title: 'Discover database targets through SSH',
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        description:
          'Discover database clients, recognized host and container targets, safely enumerable database names, and application containers without returning passwords or secret environment variables. ' +
          'Call this before query_database unless the user already provided the exact target. ' +
          'When requiresSelection is true or more than one relevant target exists, present the candidates and ask the user which site/program/database to use. ' +
          'Do not select a database from current activity, naming similarity, defaults, or list order.',
        inputSchema: {
          connectionId: z.string().min(1).max(200)
        }
      },
      async ({ connectionId }) => {
        try {
          this.requireConnectedConnection(connectionId)
          const output = await sshConnectionManager.executeCommand(
            connectionId,
            buildMcpDatabaseDiscoveryCommand(),
            DATABASE_DISCOVERY_TIMEOUT_MS,
            MAX_QUERY_CAPTURE_BYTES
          )
          const discovery = parseMcpDatabaseDiscovery(output)
          this.auditToolCall(
            'discover_database_targets',
            {
              connectionId,
              targetCount: discovery.targets.length,
              applicationCount: discovery.applications.length,
              requiresSelection: discovery.requiresSelection
            },
            true
          )
          return this.toToolResult(discovery)
        } catch (error) {
          return this.toToolError(
            'discover_database_targets',
            { connectionId },
            new Error('数据库目标发现失败：请确认远程 Shell 和 Docker 查询权限后重试。')
          )
        }
      }
    )

    server.registerTool(
      'query_database',
      {
        title: 'Query a database through SSH',
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        description:
          'Run one read-only SELECT/WITH query, or MySQL/MariaDB SHOW/DESCRIBE, on any accessible business or log table. ' +
          'Unless the user supplied the exact target, call discover_database_targets first and use its exact engine, container, host, port, database, username and systemUser. ' +
          'If multiple databases or applications are found, ask the user to choose; never guess from active sessions or names. ' +
          'Database queries are available in query, confirm and execute modes. Supports MySQL 5.7.8+, MariaDB 10.1+, PostgreSQL, SQLite, MongoDB, Redis, SQL Server and Oracle, including Docker containers. ' +
          'MongoDB query is a JSON object with operation=find|aggregate|count|distinct|listCollections plus collection/filter/projection/sort/pipeline/field/skip/limit as applicable. ' +
          'Redis query is a JSON object with command and args; only the built-in read-only command allowlist is accepted. SQL engines use one read-only SQL statement. ' +
          'Requires the database CLI and GNU timeout on the remote host or inside the container. ' +
          'Use a database read-only account with credentials already configured remotely (.my.cnf, .pgpass or peer authentication); never pass passwords. ' +
          'For PostgreSQL containers, use the database and username chosen when the container was initialized; do not assume postgres/postgres. ' +
          'database is a database name, or an absolute remote SQLite path. Only known read-only functions are accepted. ' +
          'SELECT results are capped at maxRows; use ORDER BY with LIMIT/OFFSET for further pages. ' +
          'Use information_schema, PostgreSQL catalogs or sqlite_master for schema discovery. ' +
          'Database writes are never accepted by query_database; an explicitly requested database modification must use execute_command and is controlled by confirm or execute mode.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          engine: z.enum([
            'mysql',
            'mariadb',
            'postgresql',
            'sqlite',
            'mongodb',
            'redis',
            'sqlserver',
            'oracle'
          ]),
          database: z.string().min(1).max(4096),
          query: z.string().min(1).max(20_000),
          host: z.string().min(1).max(255).optional(),
          port: z.number().int().min(1).max(65535).optional(),
          username: z.string().min(1).max(128).optional(),
          systemUser: z.string().min(1).max(128).optional(),
          container: z.string().min(1).max(200).optional(),
          maxRows: z.number().int().min(1).max(2000).optional(),
          timeoutMs: z.number().int().min(1000).max(120_000).optional()
        }
      },
      async ({ connectionId, ...input }) => {
        const details = {
          connectionId,
          engine: input.engine,
          querySha256: createHash('sha256').update(input.query).digest('hex'),
          queryLength: input.query.length
        }
        let started = false
        try {
          this.requireConnectedConnection(connectionId)
          const plan = buildMcpDatabaseQuery(input)
          started = true
          const output = await sshConnectionManager.executeCommand(
            connectionId,
            plan.command,
            plan.timeoutMs + 5000,
            MAX_QUERY_CAPTURE_BYTES,
            plan.stdin
          )
          const bytes = Buffer.from(output, 'utf8')
          const truncated = bytes.length > MAX_QUERY_OUTPUT_BYTES
          this.auditToolCall(
            'query_database',
            { ...details, outputBytes: bytes.length, truncated },
            true
          )
          return this.toToolResult({
            connectionId,
            engine: input.engine,
            database: input.database,
            format: plan.format,
            maxRows: plan.maxRows,
            output: truncated ? bytes.subarray(0, MAX_QUERY_OUTPUT_BYTES).toString('utf8') : output,
            outputBytes: bytes.length,
            truncated
          })
        } catch (error) {
          // Database stderr can echo SQL literals and credentials from client configuration.
          if (!started) return this.toToolError('query_database', details, error)
          const failure = classifyMcpDatabaseError(error, input)
          return this.toToolError(
            'query_database',
            { ...details, errorCode: failure.errorCode },
            new Error(JSON.stringify(failure))
          )
        }
      }
    )

    server.registerTool(
      'write_remote_file',
      {
        title: 'Write a remote UTF-8 text file',
        description:
          'Create or overwrite one remote UTF-8 text file through SFTP. Query mode denies it, confirm mode waits for MShell approval, and execute mode runs it directly.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          filePath: z.string().min(1).max(4096),
          content: z.string().max(MAX_WRITE_FILE_BYTES)
        }
      },
      async ({ connectionId, filePath, content }) => {
        try {
          const bytes = Buffer.byteLength(content, 'utf8')
          if (bytes > MAX_WRITE_FILE_BYTES) {
            throw new Error(`写入内容超过上限 ${MAX_WRITE_FILE_BYTES} 字节`)
          }
          this.requireConnectedConnection(connectionId)
          const permissionMode = await this.requireWriteAccess('write_remote_file', {
            connectionId,
            filePath,
            bytes,
            contentPreview: content.slice(0, 1200),
            contentTruncated: content.length > 1200,
            contentSha256: createHash('sha256').update(content).digest('hex')
          })

          await this.ensureSftp(connectionId)
          await sftpManager.writeFile(connectionId, filePath, content)
          const result = { connectionId, filePath, bytes, written: true }
          this.auditToolCall(
            'write_remote_file',
            { connectionId, filePath, bytes, permissionMode },
            true
          )
          return this.toToolResult(result)
        } catch (error) {
          return this.toToolError(
            'write_remote_file',
            { connectionId, filePath, bytes: Buffer.byteLength(content, 'utf8') },
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
          'Execute a command that may modify the remote server and return its output. Query mode denies it, confirm mode waits for MShell approval, and execute mode runs it directly.',
        inputSchema: {
          connectionId: z.string().min(1).max(200),
          command: z.string().min(1).max(MAX_COMMAND_LENGTH),
          timeoutMs: z.number().int().min(1000).max(MAX_COMMAND_TIMEOUT_MS).optional()
        }
      },
      async ({ connectionId, command, timeoutMs }) => {
        try {
          const normalizedCommand = command.trim()
          if (!normalizedCommand) throw new Error('执行命令不能为空')
          this.requireConnectedConnection(connectionId)
          const permissionMode = await this.requireWriteAccess('execute_command', {
            connectionId,
            command: normalizedCommand,
            timeoutMs: timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
          })

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
              permissionMode
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
            { connectionId, ...this.getCommandAuditDetails(command) },
            safeError
          )
        }
      }
    )

    return server
  }

  private async requireWriteAccess(
    tool: McpApprovalRequest['tool'],
    details: Record<string, unknown>
  ): Promise<AgentMcpPermissionMode> {
    const permissionMode = appSettingsManager.getSettings().agentMcp.permissionMode
    if (permissionMode === 'query') {
      throw new Error('Agent 当前为“查询”模式，写入和修改操作已被服务端拒绝')
    }
    if (permissionMode === 'execute') return permissionMode

    const approved = await this.enqueueApproval(tool, details)
    if (!approved) throw new Error('Agent 写操作未获得 MShell 用户批准')
    return permissionMode
  }

  private enqueueApproval(
    tool: McpApprovalRequest['tool'],
    details: Record<string, unknown>
  ): Promise<boolean> {
    const pending = this.approvalQueue.then(() => this.dispatchApproval(tool, details))
    this.approvalQueue = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  private dispatchApproval(
    tool: McpApprovalRequest['tool'],
    details: Record<string, unknown>
  ): Promise<boolean> {
    const currentMode = appSettingsManager.getSettings().agentMcp.permissionMode
    if (currentMode === 'query') return Promise.resolve(false)
    if (currentMode === 'execute') return Promise.resolve(true)

    const window =
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window || window.isDestroyed()) return Promise.resolve(false)

    const approvalId = randomUUID()
    const requestedAt = new Date()
    const request: McpApprovalRequest = {
      approvalId,
      tool,
      connectionId: String(details.connectionId || ''),
      summary:
        tool === 'execute_command'
          ? `执行远程命令：\n${String(details.command || '')}`
          : [
              `写入远程文件：${String(details.filePath || '')}`,
              `内容大小：${Number(details.bytes) || 0} 字节`,
              `SHA-256：${String(details.contentSha256 || '')}`,
              `内容预览${details.contentTruncated ? '（已截断）' : ''}：`,
              String(details.contentPreview || '')
            ].join('\n'),
      requestedAt: requestedAt.toISOString(),
      expiresAt: new Date(requestedAt.getTime() + MCP_APPROVAL_TIMEOUT_MS).toISOString()
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalId)
        resolve(false)
      }, MCP_APPROVAL_TIMEOUT_MS)
      this.pendingApprovals.set(approvalId, { resolve, timeout })
      window.webContents.send('mcp:approval-request', request)
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
  }

  private rejectPendingApprovals(): void {
    for (const [approvalId, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout)
      this.pendingApprovals.delete(approvalId)
      pending.resolve(false)
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
