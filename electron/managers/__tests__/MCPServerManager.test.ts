import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settings = {
    enabled: true,
    permissionMode: 'query' as 'query' | 'confirm' | 'execute',
    allowWriteEnabled: false,
    host: '127.0.0.1' as const,
    port: 47821,
    token: 'test-mcp-token-that-is-long-enough-for-auth'
  }

  return {
    settings,
    auditLog: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    getFocusedWindow: vi.fn(),
    getAllConnections: vi.fn(),
    getConnection: vi.fn(),
    executeCommand: vi.fn(),
    hasSFTP: vi.fn(),
    initSFTP: vi.fn(),
    writeFile: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.16' },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: mocks.getFocusedWindow }
}))

vi.mock('../AuditLogManager', () => ({
  AuditAction: { MCP_TOOL_CALL: 'mcp-tool-call' },
  auditLogManager: { log: mocks.auditLog }
}))

vi.mock('../SSHConnectionManager', () => ({
  sshConnectionManager: {
    getAllConnections: mocks.getAllConnections,
    getConnection: mocks.getConnection,
    executeCommand: mocks.executeCommand
  }
}))

vi.mock('../SFTPManager', () => ({
  sftpManager: {
    hasSFTP: mocks.hasSFTP,
    initSFTP: mocks.initSFTP,
    writeFile: mocks.writeFile
  }
}))

vi.mock('../../utils/app-settings', () => ({
  appSettingsManager: {
    getSettings: () => ({ agentMcp: mocks.settings }),
    updateSettings: mocks.updateSettings
  }
}))

vi.mock('../../utils/logger', () => ({
  logger: { logInfo: vi.fn(), logError: vi.fn() }
}))

import { ensureMcpWebCrypto, mcpServerManager } from '../MCPServerManager'

async function getAvailablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 47821
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

async function postMcp(port: number, body: Record<string, unknown>, authorized = true) {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json'
  }
  if (authorized) {
    headers.Authorization = `Bearer ${mocks.settings.token}`
  }

  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}

async function readMcpPayload(response: Response): Promise<any> {
  const text = await response.text()
  if (response.headers.get('content-type')?.includes('application/json')) {
    return JSON.parse(text)
  }

  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data:'))
  if (!dataLine) {
    throw new Error(`MCP response did not contain a data event: ${text}`)
  }
  return JSON.parse(dataLine.slice('data:'.length).trim())
}

describe('MCPServerManager', () => {
  afterEach(async () => {
    await mcpServerManager.stop()
    mocks.settings.permissionMode = 'query'
    mocks.settings.allowWriteEnabled = false
    vi.clearAllMocks()
  })

  it('provides Web Crypto when the Electron main process does not expose it globally', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: undefined
      })

      ensureMcpWebCrypto()

      expect(globalThis.crypto).toBeDefined()
      expect(globalThis.crypto.randomUUID).toBeTypeOf('function')
    } finally {
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto)
      } else {
        delete (globalThis as { crypto?: Crypto }).crypto
      }
    }
  })

  it('persists the server-side write access switch', async () => {
    await expect(mcpServerManager.setWriteEnabled(true)).resolves.toEqual({ success: true })
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      agentMcp: expect.objectContaining({ permissionMode: 'execute', allowWriteEnabled: true })
    })
  })

  it('persists query, confirm and execute permission modes', async () => {
    for (const permissionMode of ['query', 'confirm', 'execute'] as const) {
      await expect(mcpServerManager.setPermissionMode(permissionMode)).resolves.toEqual({
        success: true
      })
      expect(mocks.updateSettings).toHaveBeenLastCalledWith({
        agentMcp: expect.objectContaining({
          permissionMode,
          allowWriteEnabled: permissionMode === 'execute'
        })
      })
    }
  })

  it('waits for an in-app approval in confirm mode before executing a write tool', async () => {
    const port = await getAvailablePort()
    mocks.settings.port = port
    mocks.settings.permissionMode = 'confirm'
    mocks.getConnection.mockReturnValue({ id: 'connected-session', status: 'connected' })
    mocks.executeCommand.mockResolvedValue('approved\n')
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() }
    }
    mocks.getFocusedWindow.mockReturnValue(window)
    await mcpServerManager.applySettings({ ...mocks.settings })

    const responsePromise = postMcp(port, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: { connectionId: 'connected-session', command: 'systemctl restart nginx' }
      }
    })
    await vi.waitFor(() => expect(window.webContents.send).toHaveBeenCalledOnce())
    expect(mocks.executeCommand).not.toHaveBeenCalled()
    const [eventName, approval] = window.webContents.send.mock.calls[0]
    expect(eventName).toBe('mcp:approval-request')
    expect(approval).toMatchObject({
      tool: 'execute_command',
      connectionId: 'connected-session'
    })
    expect(approval.summary).toContain('systemctl restart nginx')
    expect(mcpServerManager.resolveApproval(approval.approvalId, true)).toBe(true)

    const payload = await readMcpPayload(await responsePromise)
    expect(payload.result.isError).toBeUndefined()
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'connected-session',
      'systemctl restart nginx',
      20_000,
      2 * 1024 * 1024
    )

    const deniedResponsePromise = postMcp(port, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: { connectionId: 'connected-session', command: 'systemctl restart sshd' }
      }
    })
    await vi.waitFor(() => expect(window.webContents.send).toHaveBeenCalledTimes(2))
    const deniedApproval = window.webContents.send.mock.calls[1][1]
    expect(mcpServerManager.resolveApproval(deniedApproval.approvalId, false)).toBe(true)
    const deniedPayload = await readMcpPayload(await deniedResponsePromise)
    expect(deniedPayload.result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)

    const modeSwitchResponsePromise = postMcp(port, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: { connectionId: 'connected-session', command: 'systemctl restart docker' }
      }
    })
    await vi.waitFor(() => expect(window.webContents.send).toHaveBeenCalledTimes(3))
    await expect(mcpServerManager.setPermissionMode('query')).resolves.toEqual({ success: true })
    const modeSwitchPayload = await readMcpPayload(await modeSwitchResponsePromise)
    expect(modeSwitchPayload.result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
  })

  it('discovers database targets before querying and does not expose credentials', async () => {
    const port = await getAvailablePort()
    mocks.settings.port = port
    mocks.getConnection.mockReturnValue({ id: 'db-session', status: 'connected' })
    mocks.executeCommand.mockResolvedValue(`
HOST_CLIENT|postgresql
TARGET|postgresql|postgres|postgres:15|5432/tcp|root|orders|verified:no
TARGET|postgresql|postgres|postgres:15|5432/tcp|root|analytics|verified:no
APPLICATION|shop-api|example/shop:latest|3000/tcp
APPLICATION|worker|example/worker:latest|
`)
    await mcpServerManager.applySettings({ ...mocks.settings })
    const response = await postMcp(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'discover_database_targets', arguments: { connectionId: 'db-session' } }
    })
    const payload = await readMcpPayload(response)
    const result = JSON.parse(payload.result.content[0].text)
    expect(result.requiresSelection).toBe(true)
    expect(result.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ database: 'orders', container: 'postgres', queryReady: true }),
        expect.objectContaining({ database: 'analytics', container: 'postgres', queryReady: true })
      ])
    )
    expect(result.guidance).toContain('必须让用户确认')
    expect(JSON.stringify(result)).not.toMatch(/password|secret/i)
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'db-session',
      expect.stringContaining('__MSHELL_DATABASE_DISCOVERY_V1__'),
      45_000,
      256 * 1024
    )
    expect(mocks.auditLog).toHaveBeenCalledWith(
      'mcp-tool-call',
      expect.objectContaining({
        resource: 'discover_database_targets',
        details: expect.objectContaining({
          targetCount: 3,
          applicationCount: 2,
          requiresSelection: true
        })
      })
    )
  })

  it('queries databases with writes disabled, caps output and never audits SQL or database errors', async () => {
    const port = await getAvailablePort()
    mocks.settings.port = port
    mocks.getConnection.mockReturnValue({ id: 'db-session', status: 'connected' })
    mocks.executeCommand.mockResolvedValue('id,name\n1,Alice\n')
    await mcpServerManager.applySettings({ ...mocks.settings })
    const call = async (query: string, extra = {}) =>
      readMcpPayload(
        await postMcp(port, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'query_database',
            arguments: {
              connectionId: 'db-session',
              engine: 'postgresql',
              database: 'app',
              query,
              ...extra
            }
          }
        })
      )

    const response = await call("SELECT * FROM users WHERE name = 'private-value'", {
      container: 'postgres-db'
    })
    expect(response.result.isError).toBeUndefined()
    expect(JSON.parse(response.result.content[0].text)).toMatchObject({
      engine: 'postgresql',
      format: 'csv',
      maxRows: 200,
      output: 'id,name\n1,Alice\n',
      truncated: false
    })
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'db-session',
      expect.stringContaining("'docker' 'exec' '-i' 'postgres-db'"),
      25_000,
      256 * 1024,
      expect.stringContaining('BEGIN READ ONLY;')
    )
    expect(mocks.executeCommand.mock.calls[0][1]).not.toContain('private-value')

    const denied = await call('DELETE FROM users')
    expect(denied.result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)
    mocks.settings.allowWriteEnabled = true
    mocks.settings.permissionMode = 'execute'
    expect((await call('DELETE FROM users')).result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1)

    mocks.executeCommand.mockResolvedValueOnce('x'.repeat(70 * 1024))
    const large = JSON.parse((await call('SELECT * FROM logs')).result.content[0].text)
    expect(large.output).toHaveLength(64 * 1024)
    expect(large.truncated).toBe(true)

    mocks.executeCommand.mockRejectedValueOnce(
      new Error('Command failed with code 1: private-value password=secret')
    )
    const failed = await call("SELECT 'private-value'")
    expect(failed.result.isError).toBe(true)
    expect(JSON.parse(failed.result.content[0].text)).toMatchObject({
      errorCode: 'QUERY_FAILED',
      retryable: false
    })
    expect(JSON.stringify(failed)).not.toContain('private-value')
    expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain('private-value')
    expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain('password=secret')
    expect(mocks.auditLog.mock.calls[0][1].details).toMatchObject({
      querySha256: expect.any(String),
      queryLength: expect.any(Number)
    })
    const failedAudit = mocks.auditLog.mock.calls.find(
      ([, entry]) =>
        entry.resource === 'query_database' &&
        entry.success === false &&
        entry.details.errorCode === 'QUERY_FAILED'
    )
    expect(failedAudit?.[1].details).toMatchObject({ errorCode: 'QUERY_FAILED' })

    mocks.getConnection.mockReturnValue({ status: 'disconnected' })
    expect((await call('SELECT 1')).result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(3)
  })

  it('accepts structured Redis queries through the MCP schema', async () => {
    const port = await getAvailablePort()
    mocks.settings.port = port
    mocks.getConnection.mockReturnValue({ id: 'db-session', status: 'connected' })
    mocks.executeCommand.mockResolvedValue('["value"]\n')
    await mcpServerManager.applySettings({ ...mocks.settings })
    const response = await postMcp(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'query_database',
        arguments: {
          connectionId: 'db-session',
          engine: 'redis',
          database: '0',
          query: JSON.stringify({ command: 'MGET', args: ['a', 'b'] })
        }
      }
    })
    const payload = await readMcpPayload(response)
    expect(payload.result.isError).toBeUndefined()
    expect(JSON.parse(payload.result.content[0].text)).toMatchObject({
      engine: 'redis',
      database: '0',
      format: 'json'
    })
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'db-session',
      expect.stringContaining("'redis-cli' '--json'"),
      25_000,
      256 * 1024,
      '"MGET" "a" "b"\n'
    )
  })

  it('requires a bearer token and only lists currently connected SSH sessions', async () => {
    const port = await getAvailablePort()
    mocks.settings.port = port
    mocks.getAllConnections.mockReturnValue([
      {
        id: 'connected-session',
        status: 'connected',
        options: { host: 'server.example', port: 22, username: 'root', sessionName: 'Production' },
        lastActivity: new Date('2026-09-03T00:00:00.000Z')
      },
      {
        id: 'reconnecting-session',
        status: 'reconnecting',
        options: { host: 'offline.example', port: 22, username: 'root', sessionName: 'Offline' },
        lastActivity: new Date('2026-09-03T00:00:00.000Z')
      }
    ])
    mocks.getConnection.mockReturnValue({
      id: 'connected-session',
      status: 'connected',
      client: {},
      options: { host: 'server.example', port: 22, username: 'root', sessionName: 'Production' },
      lastActivity: new Date('2026-09-03T00:00:00.000Z')
    })
    mocks.executeCommand.mockResolvedValue('Linux server 6.8.0 x86_64\n')

    await expect(mcpServerManager.applySettings({ ...mocks.settings })).resolves.toEqual({
      success: true
    })

    const unauthorized = await postMcp(port, { jsonrpc: '2.0', id: 1, method: 'initialize' }, false)
    expect(unauthorized.status).toBe(401)

    const bareToken = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: mocks.settings.token,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1.1, method: 'initialize' })
    })
    expect(bareToken.status).toBe(401)

    const tooLarge = await postMcp(port, {
      jsonrpc: '2.0',
      id: 1.5,
      method: 'initialize',
      params: { payload: 'x'.repeat(2 * 1024 * 1024) }
    })
    expect(tooLarge.status).toBe(413)

    const initialize = await postMcp(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mshell-test', version: '1.0.0' }
      }
    })
    expect(initialize.status).toBe(200)
    await readMcpPayload(initialize)

    const tools = await postMcp(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {}
    })
    expect(tools.status).toBe(200)
    const toolResult = await readMcpPayload(tools)
    expect(toolResult.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'list_ssh_sessions',
      'get_ssh_connection_status',
      'list_remote_files',
      'read_remote_file',
      'execute_readonly_command',
      'discover_database_targets',
      'query_database',
      'write_remote_file',
      'execute_command'
    ])

    const sessionsResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'list_ssh_sessions', arguments: {} }
    })
    expect(sessionsResponse.status).toBe(200)
    const sessionsPayload = await readMcpPayload(sessionsResponse)
    const sessions = JSON.parse(sessionsPayload.result.content[0].text)
    expect(sessions).toEqual([
      expect.objectContaining({ connectionId: 'connected-session', status: 'connected' })
    ])

    const queryResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'execute_readonly_command',
        arguments: { connectionId: 'connected-session', command: 'uname -a' }
      }
    })
    const queryPayload = await readMcpPayload(queryResponse)
    const queryResult = JSON.parse(queryPayload.result.content[0].text)
    expect(queryResult).toEqual({
      connectionId: 'connected-session',
      command: 'uname -a',
      output: 'Linux server 6.8.0 x86_64\n',
      outputBytes: 26,
      truncated: false
    })
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'connected-session',
      'uname -a',
      10_000,
      256 * 1024
    )

    mocks.executeCommand.mockResolvedValueOnce('x'.repeat(100 * 1024))
    const largeQueryResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 55,
      method: 'tools/call',
      params: {
        name: 'execute_readonly_command',
        arguments: { connectionId: 'connected-session', command: 'journalctl -n 10000' }
      }
    })
    const largeQueryPayload = await readMcpPayload(largeQueryResponse)
    expect(largeQueryPayload.error).toBeUndefined()
    const largeQueryResult = JSON.parse(largeQueryPayload.result.content[0].text)
    expect(largeQueryResult.output).toHaveLength(64 * 1024)
    expect(largeQueryResult.outputBytes).toBe(100 * 1024)
    expect(largeQueryResult.truncated).toBe(true)

    const rejectedResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'execute_readonly_command',
        arguments: { connectionId: 'connected-session', command: 'rm -rf /tmp/example' }
      }
    })
    const rejectedPayload = await readMcpPayload(rejectedResponse)
    expect(rejectedPayload.result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2)

    const deniedWriteResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'write_remote_file',
        arguments: {
          connectionId: 'connected-session',
          filePath: '/tmp/mshell.txt',
          content: 'hello\n',
          allowWrite: true
        }
      }
    })
    const deniedWritePayload = await readMcpPayload(deniedWriteResponse)
    expect(deniedWritePayload.result.isError).toBe(true)
    expect(mocks.writeFile).not.toHaveBeenCalled()

    mocks.settings.allowWriteEnabled = true
    mocks.settings.permissionMode = 'execute'
    mocks.hasSFTP.mockReturnValue(true)
    mocks.writeFile.mockResolvedValue(undefined)
    const writeResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'write_remote_file',
        arguments: {
          connectionId: 'connected-session',
          filePath: '/tmp/mshell.txt',
          content: 'hello\n'
        }
      }
    })
    const writePayload = await readMcpPayload(writeResponse)
    expect(JSON.parse(writePayload.result.content[0].text)).toEqual({
      connectionId: 'connected-session',
      filePath: '/tmp/mshell.txt',
      bytes: 6,
      written: true
    })
    expect(mocks.writeFile).toHaveBeenCalledWith('connected-session', '/tmp/mshell.txt', 'hello\n')

    mocks.settings.allowWriteEnabled = false
    mocks.settings.permissionMode = 'query'
    const deniedCommandResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          connectionId: 'connected-session',
          command: 'touch /tmp/mshell-command',
          allowWrite: true
        }
      }
    })
    const deniedCommandPayload = await readMcpPayload(deniedCommandResponse)
    expect(deniedCommandPayload.result.isError).toBe(true)
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2)

    mocks.settings.allowWriteEnabled = true
    mocks.settings.permissionMode = 'execute'
    mocks.executeCommand.mockResolvedValueOnce('updated\n')
    const commandResponse = await postMcp(port, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'execute_command',
        arguments: {
          connectionId: 'connected-session',
          command: 'touch /tmp/mshell-command'
        }
      }
    })
    const commandPayload = await readMcpPayload(commandResponse)
    expect(JSON.parse(commandPayload.result.content[0].text)).toEqual({
      connectionId: 'connected-session',
      command: 'touch /tmp/mshell-command',
      output: 'updated\n',
      outputBytes: 8,
      truncated: false,
      executed: true
    })
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      'connected-session',
      'touch /tmp/mshell-command',
      20_000,
      2 * 1024 * 1024
    )
    const commandAudit = mocks.auditLog.mock.calls.find(
      ([, entry]) => entry.resource === 'execute_command' && entry.success === true
    )
    expect(commandAudit?.[1].details).toEqual(
      expect.objectContaining({
        commandSha256: expect.any(String),
        commandLength: 'touch /tmp/mshell-command'.length,
        permissionMode: 'execute'
      })
    )
    expect(commandAudit?.[1].details).not.toHaveProperty('command')
    expect(mocks.auditLog).toHaveBeenCalled()
  })
})
