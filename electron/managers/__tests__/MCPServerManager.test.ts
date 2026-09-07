import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settings = {
    enabled: true,
    allowWriteEnabled: false,
    host: '127.0.0.1' as const,
    port: 47821,
    token: 'test-mcp-token-that-is-long-enough-for-auth'
  }

  return {
    settings,
    auditLog: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(undefined),
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
  BrowserWindow: { getAllWindows: () => [] }
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
      agentMcp: expect.objectContaining({ allowWriteEnabled: true })
    })
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
        writeEnabled: true
      })
    )
    expect(commandAudit?.[1].details).not.toHaveProperty('command')
    expect(mocks.auditLog).toHaveBeenCalled()
  })
})
