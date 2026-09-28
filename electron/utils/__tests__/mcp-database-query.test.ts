import { describe, expect, it } from 'vitest'
import {
  buildMcpDatabaseQuery,
  buildMcpDatabaseDiscoveryCommand,
  classifyMcpDatabaseError,
  parseMcpDatabaseDiscovery,
  validateMcpDatabaseQuery,
  type McpDatabaseEngine
} from '../mcp-database-query'

describe('MCP database queries', () => {
  it('discovers multiple database and application targets without exposing environment dumps', () => {
    const discovery = parseMcpDatabaseDiscovery(`
HOST_CLIENT|postgresql
HOST_CLIENT|mysql
HOST_CLIENT|sqlite
HOST_TARGET|postgresql|127.0.0.1|5432|report_reader|postgres|verified:yes|postgres
HOST_TARGET|postgresql|127.0.0.1|5432|report_reader|reports|verified:no|postgres
HOST_TARGET|mysql|||app_reader|customers|verified:no
HOST_TARGET|sqlite||||/srv/app/data.sqlite|verified:no
TARGET|postgresql|postgres|postgres:15|5432/tcp|root|postgres|verified:yes
TARGET|postgresql|postgres|postgres:15|5432/tcp|root|orders|verified:no
TARGET|postgresql|postgres|postgres:15|5432/tcp|root|analytics|verified:no
APPLICATION|shop-api|example/shop:latest|0.0.0.0:3000->3000/tcp
APPLICATION|worker|example/worker:latest|
`)
    expect(discovery.requiresSelection).toBe(true)
    expect(discovery.hostClients).toContain('postgresql')
    expect(discovery.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: 'host:postgresql:127.0.0.1:5432:report_reader:reports',
          host: '127.0.0.1',
          port: 5432,
          database: 'reports',
          username: 'report_reader',
          systemUser: 'postgres',
          queryReady: true
        }),
        expect.objectContaining({
          targetId: 'host:mysql:default:default:app_reader:customers',
          database: 'customers',
          username: 'app_reader',
          queryReady: true
        }),
        expect.objectContaining({
          targetId: 'host:sqlite:default:default:default:/srv/app/data.sqlite',
          database: '/srv/app/data.sqlite',
          queryReady: true
        }),
        expect.objectContaining({
          targetId: 'container:postgres:postgresql:orders',
          database: 'orders',
          username: 'root',
          queryReady: true,
          systemDatabase: false
        }),
        expect.objectContaining({
          database: 'postgres',
          systemDatabase: true
        })
      ])
    )
    expect(discovery.applications).toEqual([
      {
        container: 'shop-api',
        image: 'example/shop:latest',
        publishedPorts: '0.0.0.0:3000->3000/tcp'
      },
      { container: 'worker', image: 'example/worker:latest', publishedPorts: '' }
    ])
    expect(discovery.guidance).toContain('用户确认')
    const command = buildMcpDatabaseDiscoveryCommand()
    expect(command).toContain('HOST_TARGET')
    expect(command).toContain('pg_catalog.pg_database')
    expect(command).toContain('INFORMATION_SCHEMA.SCHEMATA')
    expect(command).toContain("'PRAGMA schema_version;'")
    expect(command).toContain("docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}'")
    expect(command).not.toContain('docker inspect')
    expect(command).not.toContain('printenv')
    expect(command).not.toContain('PGPASSWORD')
  })

  it('retains an explicit unconfigured target when host authentication is unavailable', () => {
    const discovery = parseMcpDatabaseDiscovery('HOST_CLIENT|mariadb')
    expect(discovery.targets).toEqual([
      expect.objectContaining({
        targetId: 'host:mariadb:unspecified',
        authStatus: 'requires-configuration',
        queryReady: false
      })
    ])
  })

  it('selects one non-system host database discovered through peer authentication', () => {
    const discovery = parseMcpDatabaseDiscovery(`
HOST_CLIENT|postgresql
HOST_TARGET|postgresql|||postgres|app|verified:no|postgres
HOST_TARGET|postgresql|||postgres|postgres|verified:yes|postgres
`)
    expect(discovery.requiresSelection).toBe(false)
    expect(discovery.targets).toHaveLength(2)
    expect(discovery.targets[0]).toEqual(
      expect.objectContaining({
        database: 'app',
        username: 'postgres',
        systemUser: 'postgres',
        queryReady: true,
        systemDatabase: false
      })
    )
  })

  it('parses host and container targets for every extended database engine', () => {
    const discovery = parseMcpDatabaseDiscovery(`
HOST_CLIENT|mongodb
HOST_CLIENT|redis
HOST_CLIENT|sqlserver
HOST_CLIENT|oracle
HOST_TARGET|mongodb|||reader|app|verified:no|
HOST_TARGET|redis||||0|verified:no|
HOST_TARGET|sqlserver|||reader|orders|verified:no|
HOST_TARGET|oracle|||REPORTER|ORCL|verified:no|
TARGET|mongodb|mongo-1|mongo:8|27017/tcp|reader|app|verified:no
TARGET|redis|redis-1|redis:8|6379/tcp||0|verified:no
TARGET|sqlserver|mssql-1|mssql/server:2025|1433/tcp|sa|orders|verified:no
TARGET|oracle|oracle-1|oracle/database:23|1521/tcp|SYS|ORCL|verified:no
`)
    expect(discovery.targets).toHaveLength(8)
    expect(discovery.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: 'mongodb', database: 'app', queryReady: true }),
        expect.objectContaining({ engine: 'redis', database: '0', queryReady: true }),
        expect.objectContaining({ engine: 'sqlserver', database: 'orders', queryReady: true }),
        expect.objectContaining({ engine: 'oracle', database: 'ORCL', queryReady: true })
      ])
    )
    expect(discovery.targets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ authStatus: 'requires-configuration' })])
    )
  })
  it.each<McpDatabaseEngine>(['mysql', 'mariadb', 'postgresql', 'sqlite'])(
    'allows joins, aggregates, subqueries and pagination for %s',
    (engine) => {
      const plan = buildMcpDatabaseQuery({
        engine,
        database: engine === 'sqlite' ? '/srv/app/data.sqlite' : 'app',
        query:
          'SELECT u.id, COUNT(*) AS event_count FROM users u JOIN logs l ON u.id = l.user_id WHERE u.id IN (SELECT id FROM users) GROUP BY u.id ORDER BY u.id LIMIT 10 OFFSET 10',
        maxRows: 50
      })
      expect(plan.stdin).toContain('LIMIT 50')
      expect(plan.stdin).toContain('OFFSET 10')
      expect(plan.stdin).toContain('ROLLBACK;')
      expect(plan.command).toContain('timeout')
      expect(plan.command).not.toContain('SELECT')
    }
  )

  it.each<McpDatabaseEngine>(['mysql', 'postgresql', 'sqlite'])(
    'allows CTEs and unions for %s',
    (engine) => {
      expect(
        validateMcpDatabaseQuery(
          'WITH recent AS (SELECT id FROM logs) SELECT id FROM recent UNION ALL SELECT id FROM logs',
          engine
        ).sql
      ).toContain('WITH')
    }
  )

  it.each(['SHOW TABLES', 'SHOW CREATE TABLE users', 'SHOW COLUMNS FROM users', 'DESCRIBE users'])(
    'allows schema discovery: %s',
    (query) => {
      const plan = buildMcpDatabaseQuery({ engine: 'mysql', database: 'app', query })
      expect(plan.maxRows).toBeNull()
      expect(plan.stdin).not.toContain('AS mshell_query')
    }
  )

  it.each([
    'DELETE FROM users',
    'UPDATE users SET name = 1',
    'INSERT INTO users VALUES (1)',
    'DROP TABLE users',
    'CREATE TABLE copied AS SELECT * FROM users',
    'SELECT 1; DELETE FROM users',
    'SELECT 1; COMMIT; DELETE FROM users',
    'SELECT * FROM users FOR UPDATE',
    'SELECT * FROM users LOCK IN SHARE MODE',
    "SELECT * FROM users INTO OUTFILE '/tmp/data'",
    "SELECT * FROM users INTO DUMPFILE '/tmp/data'",
    'SELECT @x := 1',
    'CALL remove_users()',
    'SELECT custom_write_function()',
    'SELECT COUNT(*) FROM users WHERE custom_write_function() = 1',
    'SELECT system(1)',
    'SELECT sys_exec(1)',
    'SELECT SLEEP(60)',
    'SELECT GET_LOCK(1,1)',
    "SELECT 1 /*! INTO OUTFILE '/tmp/payload' */",
    'SELECT 1 /*M! UNION SELECT 2 */',
    'SELECT 1\n\\! touch /tmp/payload',
    'SELECT 1\n.source /tmp/payload',
    'SELECT app.count(*) FROM users',
    'SELECT pg_database_size(1)'
  ])('rejects write and client escape attempts: %s', (query) => {
    expect(() => validateMcpDatabaseQuery(query, 'mysql')).toThrow()
  })

  it.each([
    'SELECT pg_terminate_backend(1)',
    'SELECT pg_read_file(1)',
    'SELECT lo_export(1,2)',
    'SELECT nextval(1)',
    'SELECT set_config(1,2,3)',
    'SELECT dblink_exec(1,2)',
    'SELECT public.count(*) FROM users',
    'SELECT 1 INTO copied',
    'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone',
    'COPY users TO PROGRAM 1',
    'SELECT 1; END; DELETE FROM users'
  ])('rejects PostgreSQL side effects: %s', (query) => {
    expect(() => validateMcpDatabaseQuery(query, 'postgresql')).toThrow()
  })

  it.each([
    'SELECT load_extension(1)',
    'SELECT writefile(1,2)',
    'ATTACH DATABASE 1 AS other',
    'PRAGMA query_only=OFF',
    'VACUUM',
    'SELECT 1; DELETE FROM users'
  ])('rejects SQLite side effects: %s', (query) => {
    expect(() => validateMcpDatabaseQuery(query, 'sqlite')).toThrow()
  })

  it('qualifies PostgreSQL built-ins and retains SQL conditional syntax', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'postgresql',
      database: 'app',
      query: 'SELECT count(*), coalesce(max(id), 0), now() FROM users'
    })
    expect(plan.stdin).toContain('pg_catalog.count(*)')
    expect(plan.stdin).toContain('pg_catalog.max(')
    expect(plan.stdin).toContain('pg_catalog.now()')
    expect(plan.stdin).not.toContain('pg_catalog.coalesce')
    expect(plan.command).toContain('default_transaction_read_only=on')
    expect(plan.command).toContain('statement_timeout=20000')
    expect(plan.command).toContain("'-X' '-w'")
    expect(plan.stdin).toContain('BEGIN READ ONLY;')
  })

  it('enforces read-only mode, bounded SELECTs and timeouts in MySQL and MariaDB', () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      const plan = buildMcpDatabaseQuery({
        engine,
        database: 'app',
        query: 'SELECT * FROM logs',
        timeoutMs: 1500
      })
      expect(plan.command).toContain('--init-command=SET SESSION TRANSACTION READ ONLY')
      expect(plan.command).toContain('--local-infile=0')
      expect(plan.command).toContain('--skip-reconnect')
      expect(plan.stdin).toContain('START TRANSACTION READ ONLY;')
      expect(plan.stdin).toContain(
        engine === 'mysql' ? 'MAX_EXECUTION_TIME=1500' : 'max_statement_time=1.5'
      )
    }
  })

  it('can use a discovered host system account while retaining query protections', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'postgresql',
      database: 'app',
      username: 'postgres',
      systemUser: 'postgres',
      query: 'SELECT COUNT(*) FROM logs'
    })
    expect(plan.command).toContain("'runuser' '-u' 'postgres' '--' 'timeout'")
    expect(plan.stdin).toContain('BEGIN READ ONLY;')
    expect(plan.stdin).toContain('ROLLBACK;')
  })

  it('uses SQLite safe and read-only mode without startup scripts', () => {
    const plan = buildMcpDatabaseQuery({
      engine: 'sqlite',
      database: "/srv/customer's data.sqlite",
      query: 'SELECT * FROM sqlite_master',
      container: 'db-1'
    })
    expect(plan.command).toContain("'docker' 'exec' '-i' 'db-1' 'timeout'")
    expect(plan.command).toContain(
      "'sqlite3' '-safe' '-readonly' '-batch' '-bail' '-init' '/dev/null'"
    )
    expect(plan.command).toContain("customer'\"'\"'s")
    expect(plan.stdin).toContain('PRAGMA query_only=ON;')
  })

  it.each<Partial<Parameters<typeof buildMcpDatabaseQuery>[0]>>([
    { database: 'postgresql://user:password@host/db' },
    { database: 'app;touch /tmp/payload' },
    { host: 'host;touch /tmp/payload' },
    { username: 'user\ncommand' },
    { container: '--privileged' },
    { container: 'app;id' },
    { systemUser: 'postgres;id' },
    { systemUser: 'postgres', container: 'database' },
    { systemUser: 'mysql', engine: 'mysql' },
    { maxRows: 0 },
    { maxRows: 2001 },
    { timeoutMs: 500_000 },
    { port: -1 }
  ])('rejects command injection and invalid limits: %j', (override) => {
    expect(() =>
      buildMcpDatabaseQuery({ engine: 'mysql', database: 'app', query: 'SELECT 1', ...override })
    ).toThrow()
  })

  it('rejects SQLite URI paths and unrelated connection parameters', () => {
    expect(() =>
      buildMcpDatabaseQuery({
        engine: 'sqlite',
        database: 'file:/tmp/db?mode=rw',
        query: 'SELECT 1'
      })
    ).toThrow()
    expect(() =>
      buildMcpDatabaseQuery({
        engine: 'sqlite',
        database: '/tmp/db',
        host: 'localhost',
        query: 'SELECT 1'
      })
    ).toThrow()
  })

  it('removes ordinary comments without rejecting literals containing SQL keywords', () => {
    const { sql } = validateMcpDatabaseQuery(
      "SELECT 'DELETE FROM users; -- text' AS message /* note */",
      'mysql'
    )
    expect(sql).toContain('DELETE FROM users; -- text')
    expect(sql).not.toContain('note')
  })

  it.each([
    ['psql: error: role "postgres" does not exist', 'postgresql', true, 'USER_NOT_FOUND'],
    ['psql: error: database "app" does not exist', 'postgresql', true, 'DATABASE_NOT_FOUND'],
    [
      'psql: error: password authentication failed for user "reader"',
      'postgresql',
      false,
      'AUTHENTICATION_FAILED'
    ],
    ["mysql: Access denied for user 'reader'@'localhost'", 'mysql', false, 'AUTHENTICATION_FAILED'],
    ["mysql: Unknown database 'app'", 'mysql', true, 'DATABASE_NOT_FOUND'],
    [
      "timeout: failed to run command 'psql': No such file or directory",
      'postgresql',
      true,
      'CLIENT_MISSING'
    ],
    ['/bin/sh: timeout: not found', 'sqlite', false, 'TIMEOUT_MISSING'],
    ['/bin/sh: mongosh: not found', 'mongodb', false, 'CLIENT_MISSING'],
    ['NOAUTH Authentication required', 'redis', false, 'AUTHENTICATION_FAILED'],
    ["Login failed for user 'reader'", 'sqlserver', false, 'AUTHENTICATION_FAILED'],
    ['ORA-01017: invalid username/password', 'oracle', false, 'AUTHENTICATION_FAILED'],
    [
      'Error response from daemon: No such container: database',
      'mysql',
      true,
      'CONTAINER_UNAVAILABLE'
    ],
    ['could not connect to server: Connection refused', 'postgresql', false, 'CONNECTION_FAILED'],
    ['Error: unable to open database file', 'sqlite', false, 'DATABASE_UNAVAILABLE'],
    ['ERROR: relation "logs" does not exist', 'postgresql', false, 'OBJECT_NOT_FOUND'],
    [
      'ERROR: cannot execute DELETE in a read-only transaction',
      'postgresql',
      true,
      'READ_ONLY_VIOLATION'
    ],
    ['Command execution timeout: hidden sql', 'postgresql', false, 'QUERY_TIMEOUT'],
    ['Command output exceeded limit of 262144 bytes', 'mysql', false, 'OUTPUT_LIMIT_EXCEEDED']
  ] as const)(
    'classifies database failure without reflecting raw output: %s',
    (message, engine, container, errorCode) => {
      const failure = classifyMcpDatabaseError(new Error(message), {
        engine,
        container: container ? 'database' : undefined
      })
      expect(failure.errorCode).toBe(errorCode)
      expect(JSON.stringify(failure)).not.toContain(message)
      expect(failure.message).not.toContain('hidden sql')
    }
  )

  it('gives PostgreSQL container-specific guidance for an unknown role', () => {
    const failure = classifyMcpDatabaseError(
      new Error('role "postgres" does not exist password=secret'),
      { engine: 'postgresql', container: 'postgres' }
    )
    expect(failure.errorCode).toBe('USER_NOT_FOUND')
    expect(failure.guidance).toContain('不要默认填写 postgres')
    expect(JSON.stringify(failure)).not.toContain('password=secret')
  })

  it('classifies an unavailable discovered system account without exposing the raw error', () => {
    const failure = classifyMcpDatabaseError(
      new Error('runuser: user postgres does not exist secret-detail'),
      { engine: 'postgresql', systemUser: 'postgres' }
    )
    expect(failure.errorCode).toBe('PERMISSION_DENIED')
    expect(failure.message).toContain('系统账号')
    expect(JSON.stringify(failure)).not.toContain('secret-detail')
  })
})
