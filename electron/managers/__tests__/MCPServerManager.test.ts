import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const settings = {
    enabled: true,
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
    hasSFTP: vi.fn(),
    initSFTP: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.10' },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../AuditLogManager', () => ({
  AuditAction: { MCP_TOOL_CALL: 'mcp-tool-call' },
  auditLogManager: { log: mocks.auditLog }
}))

vi.mock('../SSHConnectionManager', () => ({
  sshConnectionManager: {
    getAllConnections: mocks.getAllConnections,
    getConnection: mocks.getConnection
  }
}))

vi.mock('../SFTPManager', () => ({
  sftpManager: {
    hasSFTP: mocks.hasSFTP,
    initSFTP: mocks.initSFTP
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

import { mcpServerManager } from '../MCPServerManager'

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
    vi.clearAllMocks()
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

    await expect(mcpServerManager.applySettings({ ...mocks.settings })).resolves.toEqual({
      success: true
    })

    const unauthorized = await postMcp(port, { jsonrpc: '2.0', id: 1, method: 'initialize' }, false)
    expect(unauthorized.status).toBe(401)

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
      'read_remote_file'
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
    expect(mocks.auditLog).toHaveBeenCalled()
  })
})
