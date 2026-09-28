import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const settingsPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'mshell', 'settings.json')
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const mcp = settings.agentMcp

if (!mcp?.enabled || !mcp?.token || !mcp?.port) {
  throw new Error('MShell MCP is not enabled or has no usable local configuration')
}

const client = new Client({ name: 'mshell-live-smoke', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.port}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${mcp.token}` } }
})

const textFrom = (result) =>
  (result.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')

const call = async (name, args = {}) => client.callTool({ name, arguments: args })

try {
  await client.connect(transport)
  const tools = await client.listTools()
  const sessionsResult = await call('list_ssh_sessions')
  const sessionsText = textFrom(sessionsResult)
  let sessions = []
  try {
    sessions = JSON.parse(sessionsText)
  } catch {
    // A failed tool call is reported below without exposing unrelated data.
  }

  const report = {
    connected: true,
    permissionMode: mcp.permissionMode,
    toolNames: tools.tools.map((tool) => tool.name),
    sessionCount: Array.isArray(sessions) ? sessions.length : null,
    listSessionsError: sessionsResult.isError === true ? sessionsText : null
  }

  const connectionArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  const connectionId = connectionArg || (Array.isArray(sessions) ? sessions[0]?.connectionId : undefined)
  if (connectionId) {
    const statusResult = await call('get_ssh_connection_status', { connectionId })
    const queryResult = await call('execute_readonly_command', { connectionId, command: 'pwd' })
    report.selectedConnectionId = connectionId
    report.statusCallSucceeded = statusResult.isError !== true
    report.readonlyCallSucceeded = queryResult.isError !== true
    report.readonlyCallError = queryResult.isError === true ? textFrom(queryResult) : null

    if (process.argv.includes('--discover')) {
      const discoveryResult = await call('discover_database_targets', { connectionId })
      const discoveryText = textFrom(discoveryResult)
      report.databaseDiscoverySucceeded = discoveryResult.isError !== true
      if (discoveryResult.isError !== true) {
        const discovery = JSON.parse(discoveryText)
        report.databaseTargetCount = discovery.targets?.length || 0
        report.databaseApplicationCount = discovery.applications?.length || 0
        report.databaseRequiresSelection = discovery.requiresSelection === true
        report.databaseEngines = [...new Set((discovery.targets || []).map((target) => target.engine))].sort()
        report.databaseAuthStatuses = (discovery.targets || []).reduce((statuses, target) => {
          const status = target.authStatus || 'unknown'
          statuses[status] = (statuses[status] || 0) + 1
          return statuses
        }, {})
        if (process.argv.includes('--db-query')) {
          const target = (discovery.targets || []).find(
            (candidate) =>
              candidate.queryReady === true &&
              ['mysql', 'mariadb', 'postgresql', 'sqlite', 'sqlserver', 'oracle'].includes(candidate.engine)
          )
          if (target) {
            const queryArgs = {
              connectionId,
              engine: target.engine,
              database: target.database,
              query: 'SELECT 1 AS mshell_smoke',
              maxRows: 1,
              ...Object.fromEntries(
                ['container', 'host', 'port', 'username', 'systemUser']
                  .filter((key) => target[key] !== undefined)
                  .map((key) => [key, target[key]])
              )
            }
            const databaseQueryResult = await call('query_database', queryArgs)
            report.databaseHealthQueryAttempted = true
            report.databaseHealthQueryEngine = target.engine
            report.databaseHealthQuerySucceeded = databaseQueryResult.isError !== true
            if (databaseQueryResult.isError !== true) {
              const databaseQuery = JSON.parse(textFrom(databaseQueryResult))
              report.databaseHealthQueryFormat = databaseQuery.format
              report.databaseHealthQueryReturnedOutput = Boolean(databaseQuery.output)
            } else {
              report.databaseHealthQueryError = textFrom(databaseQueryResult)
            }
          } else {
            report.databaseHealthQueryAttempted = false
          }
        }
      } else {
        report.databaseDiscoveryError = discoveryText
      }
    }

    if (process.argv.includes('--boundaries')) {
      const blockedCommandResult = await call('execute_readonly_command', {
        connectionId,
        command: `touch /tmp/mshell-mcp-readonly-should-not-run-${Date.now()}`
      })
      const blockedDatabaseResult = await call('query_database', {
        connectionId,
        engine: 'postgresql',
        database: 'postgres',
        query: 'DROP TABLE mshell_mcp_should_never_exist'
      })
      report.readonlyMutationBlocked = blockedCommandResult.isError === true
      report.readonlyMutationError = textFrom(blockedCommandResult)
      report.databaseMutationBlocked = blockedDatabaseResult.isError === true
      report.databaseMutationError = textFrom(blockedDatabaseResult)
    }

    if (process.argv.includes('--write')) {
      const marker = `mshell-mcp-smoke-${Date.now()}`
      const filePath = `/tmp/${marker}.txt`
      const writeResult = await call('write_remote_file', { connectionId, filePath, content: marker })
      const readResult = await call('read_remote_file', { connectionId, filePath })
      report.writeAttempted = true
      report.writeSucceeded = writeResult.isError !== true
      report.writeError = writeResult.isError === true ? textFrom(writeResult) : null
      report.readBackSucceeded = writeResult.isError !== true && readResult.isError !== true && textFrom(readResult).includes(marker)

      if (writeResult.isError !== true) {
        const cleanupResult = await call('execute_command', {
          connectionId,
          command: `rm -f -- ${filePath}`,
          timeoutMs: 10000
        })
        report.cleanupSucceeded = cleanupResult.isError !== true
        report.cleanupError = cleanupResult.isError === true ? textFrom(cleanupResult) : null
      }
    }
  }

  console.log(JSON.stringify(report, null, 2))
} finally {
  await transport.close().catch(() => {})
}
