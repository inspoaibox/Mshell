import { describe, expect, it } from 'vitest'
import { buildMcpDatabaseQuery, validateMcpDatabaseQuery } from '../mcp-database-query'
import { validateOracleQuery } from '../mcp-extended-database-query'

describe('MCP extended database queries', () => {
  it('builds bounded MongoDB find requests without putting query data on the command line', () => {
    const query = JSON.stringify({
      operation: 'find',
      collection: 'logs',
      filter: { level: 'error', createdAt: { $gte: '2026-09-01' } },
      sort: { createdAt: -1 },
      limit: 500
    })
    const plan = buildMcpDatabaseQuery({
      engine: 'mongodb',
      database: 'app',
      query,
      maxRows: 100
    })
    expect(plan.command).toContain("'mongosh' '--quiet' '--norc'")
    expect(plan.command).not.toContain('createdAt')
    expect(plan.stdin).toContain('getCollection(request.collection).find')
    expect(plan.stdin).toContain('"limit":100')
    expect(plan.format).toBe('json')
  })

  it.each([
    { operation: 'aggregate', collection: 'logs', pipeline: [{ $out: 'copied' }] },
    { operation: 'aggregate', collection: 'logs', pipeline: [{ $merge: 'copied' }] },
    { operation: 'find', collection: 'logs', filter: { $where: 'sleep(1000)' } },
    { operation: 'find', collection: '../logs', filter: {} }
  ])('rejects unsafe MongoDB requests: %j', (request) => {
    expect(() =>
      buildMcpDatabaseQuery({
        engine: 'mongodb',
        database: 'app',
        query: JSON.stringify(request)
      })
    ).toThrow()
  })

  it('builds Redis read commands through stdin and keeps key names out of the command line', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'redis',
      database: '0',
      query: JSON.stringify({ command: 'HGETALL', args: ['customer:private-key'] })
    })
    expect(plan.command).toContain("'redis-cli' '--json'")
    expect(plan.command).not.toContain('customer:private-key')
    expect(plan.stdin).toBe('"HGETALL" "customer:private-key"\n')
    expect(plan.format).toBe('json')
  })

  it.each(['SET', 'DEL', 'FLUSHALL', 'EVAL', 'CONFIG', 'SHUTDOWN'])(
    'rejects Redis write or administrative command %s',
    (command) => {
      expect(() =>
        buildMcpDatabaseQuery({
          engine: 'redis',
          database: '0',
          query: JSON.stringify({ command, args: ['key', 'value'] })
        })
      ).toThrow(/只读白名单/)
    }
  )

  it('caps Redis scan hints at maxRows', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'redis',
      database: '0',
      query: JSON.stringify({ command: 'SCAN', args: ['0', 'COUNT', '5000'] }),
      maxRows: 125
    })
    expect(plan.stdin).toBe('"SCAN" "0" "COUNT" "125"\n')
  })

  it('validates SQL Server SELECTs and enforces row count, timeout and rollback', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'sqlserver',
      database: 'app',
      host: '127.0.0.1',
      port: 1433,
      username: 'reader',
      query: 'SELECT COUNT(*) AS total FROM dbo.logs',
      maxRows: 75,
      timeoutMs: 5000
    })
    expect(plan.command).toContain("'sqlcmd' '-b'")
    expect(plan.command).toContain("'-S' '127.0.0.1,1433'")
    expect(plan.stdin).toContain('SET ROWCOUNT 75;')
    expect(plan.stdin).toContain('BEGIN TRANSACTION;')
    expect(plan.stdin).toContain('ROLLBACK TRANSACTION;')
    expect(plan.command).not.toContain('COUNT')
  })

  it.each([
    'SELECT NEXT VALUE FOR dbo.order_seq',
    "SELECT * FROM OPENROWSET('provider', 'connection', 'query')",
    'SELECT * FROM dbo.logs WITH (UPDLOCK)',
    'SELECT * INTO copied FROM dbo.logs',
    'DELETE FROM dbo.logs'
  ])('rejects unsafe SQL Server query: %s', (query) => {
    expect(() => validateMcpDatabaseQuery(query, 'sqlserver')).toThrow()
  })

  it('builds Oracle wallet queries with client and transaction protections', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'oracle',
      database: 'ORCL',
      query: 'SELECT COUNT(*) AS total FROM audit_logs',
      maxRows: 50
    })
    expect(plan.command).toContain("'sqlplus' '-S' '-L' '/nolog'")
    expect(plan.command).not.toContain('audit_logs')
    expect(plan.command).toContain("'ORACLE_SID=ORCL'")
    expect(plan.stdin).toContain('CONNECT /')
    expect(plan.stdin).toContain('SET TRANSACTION READ ONLY;')
    expect(plan.stdin).toContain('FETCH FIRST 50 ROWS ONLY')
    expect(plan.stdin).toContain('ROLLBACK;')
  })

  it('supports discovered Oracle peer execution without embedding credentials', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'oracle',
      database: 'ORCL',
      systemUser: 'oracle',
      query: 'SELECT SYSDATE FROM dual'
    })
    expect(plan.command).toContain("'runuser' '-u' 'oracle' '--' 'timeout'")
    expect(plan.command).toContain("'ORACLE_SID=ORCL'")
    expect(plan.stdin).toContain('CONNECT / AS SYSDBA')
  })

  it('accepts Oracle CTEs and built-in functions', () => {
    expect(
      validateOracleQuery(
        'WITH recent AS (SELECT created_at FROM audit_logs) SELECT COUNT(*), TO_CHAR(MAX(created_at)) FROM recent'
      )
    ).toContain('WITH recent')
  })

  it.each([
    'DELETE FROM audit_logs',
    'SELECT nextval() FROM dual',
    'SELECT custom_schema.read_secret() FROM dual',
    'SELECT "custom_function"() FROM dual',
    'SELECT 1 FROM dual\nSET TERMOUT OFF',
    'SELECT 1 FROM dual; DELETE FROM audit_logs'
  ])('rejects unsafe Oracle query: %s', (query) => {
    expect(() => validateOracleQuery(query)).toThrow()
  })

  it('uses container-local authentication without putting credential values in plans', () => {
    const mongo = buildMcpDatabaseQuery({
      engine: 'mongodb',
      container: 'mongo-db',
      database: 'app',
      query: JSON.stringify({ operation: 'count', collection: 'logs' })
    })
    const redis = buildMcpDatabaseQuery({
      engine: 'redis',
      container: 'redis-db',
      database: '0',
      query: JSON.stringify({ command: 'DBSIZE' })
    })
    const sqlserver = buildMcpDatabaseQuery({
      engine: 'sqlserver',
      container: 'mssql-db',
      database: 'app',
      username: 'sa',
      query: 'SELECT COUNT(*) FROM dbo.logs'
    })
    const oracle = buildMcpDatabaseQuery({
      engine: 'oracle',
      container: 'oracle-db',
      database: 'ORCL',
      query: 'SELECT COUNT(*) FROM audit_logs'
    })
    expect(mongo.command).toContain('MONGO_INITDB_ROOT_PASSWORD')
    expect(redis.command).toContain('REDIS_PASSWORD')
    expect(sqlserver.command).toContain('MSSQL_SA_PASSWORD')
    expect(oracle.command).toContain("'docker' 'exec' '-i' 'oracle-db'")
    for (const plan of [mongo, redis, sqlserver, oracle]) {
      expect(plan.command).not.toContain('audit_logs')
      expect(plan.command).not.toContain('dbo.logs')
    }
  })
})
