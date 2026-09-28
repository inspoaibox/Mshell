export type McpExtendedDatabaseEngine = 'mongodb' | 'redis' | 'oracle'

export interface McpExtendedDatabaseQuery {
  engine: McpExtendedDatabaseEngine
  database: string
  query: string
  host?: string
  port?: number
  username?: string
  systemUser?: string
  container?: string
  maxRows?: number
  timeoutMs?: number
}

export interface McpExtendedDatabasePlan {
  command: string
  stdin: string
  maxRows: number | null
  timeoutMs: number
  format: 'json' | 'csv'
}

const MONGO_OPERATIONS = new Set(['find', 'aggregate', 'count', 'distinct', 'listCollections'])
const MONGO_DANGEROUS_OPERATORS = new Set(['$accumulator', '$function', '$merge', '$out', '$where'])
const REDIS_READ_ONLY_COMMANDS = new Set(
  `BITCOUNT BITPOS DBSIZE EXISTS GEODIST GEOHASH GEOPOS GEOSEARCH GET GETBIT GETRANGE
   HEXISTS HGET HGETALL HKEYS HLEN HMGET HRANDFIELD HSCAN HSTRLEN HVALS
   INFO LCS LINDEX LLEN LPOS LRANGE MGET PFCOUNT PTTL RANDOMKEY SCAN SCARD SDIFF
   SINTER SINTERCARD SISMEMBER SMEMBERS SMISMEMBER SORT_RO SRANDMEMBER SSCAN STRLEN
   SUNION TIME TTL TYPE XINFO XLEN XPENDING XRANGE XREAD XREVRANGE ZCARD ZCOUNT
   ZINTER ZINTERCARD ZLEXCOUNT ZMSCORE ZRANDMEMBER ZRANGE ZRANGEBYLEX ZRANGEBYSCORE
   ZRANK ZREVRANGE ZREVRANGEBYLEX ZREVRANGEBYSCORE ZREVRANK ZSCAN ZSCORE ZUNION`
    .split(/\s+/)
    .filter(Boolean)
)
const ORACLE_QUERY_FUNCTIONS = new Set(
  `abs add_months ascii avg bitand cast ceil coalesce concat corr count covar_pop covar_samp
   current_date current_timestamp decode dense_rank dump exp extract first_value floor
   greatest instr json_exists json_query json_value lag last_day last_value lead least
   length listagg ln log lower lpad ltrim max median min mod months_between next_day
   nth_value ntile nullif nvl nvl2 power rank ratio_to_report regexp_count regexp_instr
   regexp_like regexp_replace regexp_substr replace round row_number rpad rtrim sign sin
   sqrt standard_hash stddev stddev_pop stddev_samp substr sum sys_context sysdate tan to_char to_date
   to_number to_timestamp translate trim trunc upper variance var_pop var_samp`
    .split(/\s+/)
    .filter(Boolean)
)
const ORACLE_SYNTAX_CALLS = new Set(['as', 'exists', 'in', 'over', 'partition', 'values'])

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function validateCommonInput(input: McpExtendedDatabaseQuery) {
  const maxRows = input.maxRows ?? 200
  const timeoutMs = input.timeoutMs ?? 20_000
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 2000)
    throw new Error('单次查询行数必须为 1 到 2000')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000)
    throw new Error('查询超时必须为 1000 到 120000 毫秒')
  if (
    input.port !== undefined &&
    (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
  )
    throw new Error('数据库端口无效')
  if (input.container !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(input.container))
    throw new Error('Docker 容器名称无效')
  if (input.host !== undefined && !/^[A-Za-z0-9_./:%-]{1,255}$/.test(input.host))
    throw new Error('数据库主机名无效')
  if (input.username !== undefined && !/^[A-Za-z0-9_.@-]{1,128}$/.test(input.username))
    throw new Error('数据库用户名无效')
  if (
    input.systemUser !== undefined &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(input.systemUser)
  )
    throw new Error('数据库系统账号无效')
  if (input.container !== undefined && input.systemUser !== undefined)
    throw new Error('Docker 容器与宿主机系统账号不能同时使用')
  if (!input.query.trim() || input.query.length > 20_000)
    throw new Error('查询不能为空或超过 20000 个字符')
  return { maxRows, timeoutMs }
}

function validateJsonValue(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('MongoDB 查询嵌套层级不能超过 20')
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return
  if (Array.isArray(value)) {
    if (value.length > 2000) throw new Error('MongoDB 查询数组过长')
    value.forEach((entry) => validateJsonValue(entry, depth + 1))
    return
  }
  if (typeof value !== 'object') throw new Error('MongoDB 查询只能包含 JSON 数据')
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error('MongoDB 查询包含不安全字段')
    if (MONGO_DANGEROUS_OPERATORS.has(key.toLowerCase()))
      throw new Error(`MongoDB 查询不允许操作符 ${key}`)
    validateJsonValue(child, depth + 1)
  }
}

function parseMongoRequest(query: string, maxRows: number) {
  let request: Record<string, any>
  try {
    request = JSON.parse(query)
  } catch {
    throw new Error('MongoDB 查询必须是有效的 JSON 请求')
  }
  if (!request || Array.isArray(request) || typeof request !== 'object')
    throw new Error('MongoDB 查询必须是 JSON 对象')
  validateJsonValue(request)
  if (!MONGO_OPERATIONS.has(request.operation))
    throw new Error('MongoDB 仅支持 find、aggregate、count、distinct 和 listCollections')
  if (request.operation !== 'listCollections') {
    if (
      typeof request.collection !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,255}$/.test(request.collection)
    )
      throw new Error('MongoDB collection 名称无效')
  }
  if (request.operation === 'aggregate') {
    if (!Array.isArray(request.pipeline))
      throw new Error('MongoDB aggregate 必须提供 pipeline 数组')
    request.pipeline = [...request.pipeline, { $limit: maxRows }]
  }
  if (request.operation === 'distinct') {
    if (typeof request.field !== 'string' || !/^[A-Za-z0-9_.-]{1,255}$/.test(request.field))
      throw new Error('MongoDB distinct 字段名称无效')
  }
  if (request.operation === 'find') {
    const requestedLimit = request.limit === undefined ? maxRows : request.limit
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
      throw new Error('MongoDB find limit 必须是正整数')
    request.limit = Math.min(requestedLimit, maxRows)
    if (request.skip !== undefined && (!Number.isInteger(request.skip) || request.skip < 0))
      throw new Error('MongoDB find skip 必须是非负整数')
  }
  return request
}

function buildMongoPlan(input: McpExtendedDatabaseQuery, maxRows: number, timeoutMs: number) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(input.database)) throw new Error('MongoDB 数据库名称无效')
  if (input.systemUser) throw new Error('MongoDB 不支持宿主机系统账号模式')
  const request = parseMongoRequest(input.query, maxRows)
  const encodedRequest = JSON.stringify(request)
  const encodedDatabase = JSON.stringify(input.database)
  const script = `
const request = EJSON.deserialize(${encodedRequest});
const targetDb = db.getSiblingDB(${encodedDatabase});
let result;
if (request.operation === 'find') {
  let cursor = targetDb.getCollection(request.collection).find(request.filter || {}, request.projection || {}).maxTimeMS(${timeoutMs});
  if (request.sort) cursor = cursor.sort(request.sort);
  if (request.skip) cursor = cursor.skip(request.skip);
  result = { documents: cursor.limit(request.limit).toArray() };
} else if (request.operation === 'aggregate') {
  result = { documents: targetDb.getCollection(request.collection).aggregate(request.pipeline, { allowDiskUse: false, maxTimeMS: ${timeoutMs} }).toArray() };
} else if (request.operation === 'count') {
  result = { count: targetDb.getCollection(request.collection).countDocuments(request.filter || {}, { maxTimeMS: ${timeoutMs} }) };
} else if (request.operation === 'distinct') {
  result = { values: targetDb.getCollection(request.collection).distinct(request.field, request.filter || {}, { maxTimeMS: ${timeoutMs} }).slice(0, ${maxRows}) };
} else {
  result = { collections: targetDb.getCollectionInfos({}, true).slice(0, ${maxRows}).map((entry) => entry.name) };
}
print(EJSON.stringify(result, { relaxed: true }));
`
  let args = ['mongosh', '--quiet', '--norc']
  if (input.host) args.push(`--host=${input.host}`)
  if (input.port) args.push(`--port=${input.port}`)
  if (input.container) {
    const inner = [
      'user="${MONGO_INITDB_ROOT_USERNAME:-}"',
      'secret="${MONGO_INITDB_ROOT_PASSWORD:-}"',
      'set -- mongosh --quiet --norc',
      '[ -n "$user" ] && [ -n "$secret" ] && set -- "$@" --username="$user" --password="$secret" --authenticationDatabase=admin',
      `exec timeout --signal=TERM --kill-after=2s ${Math.ceil(timeoutMs / 1000)}s "$@"`
    ].join('; ')
    args = ['docker', 'exec', '-i', input.container, 'sh', '-c', inner]
  } else {
    args = [
      'timeout',
      '--signal=TERM',
      '--kill-after=2s',
      `${Math.ceil(timeoutMs / 1000)}s`,
      ...args
    ]
  }
  return {
    command: args.map(shellQuote).join(' '),
    stdin: script,
    maxRows,
    timeoutMs,
    format: 'json' as const
  }
}

function redisCliQuote(value: string): string {
  let output = '"'
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (character === '"' || character === '\\') output += `\\${character}`
    else if (code < 0x20 || code === 0x7f) output += `\\x${code.toString(16).padStart(2, '0')}`
    else output += character
  }
  return `${output}"`
}

function buildRedisPlan(input: McpExtendedDatabaseQuery, maxRows: number, timeoutMs: number) {
  if (input.systemUser) throw new Error('Redis 不支持宿主机系统账号模式')
  if (!/^\d{1,5}$/.test(input.database) || Number(input.database) > 65535)
    throw new Error('Redis database 必须是 0 到 65535 的数字')
  let request: { command?: unknown; args?: unknown }
  try {
    request = JSON.parse(input.query)
  } catch {
    throw new Error('Redis 查询必须是有效的 JSON 请求')
  }
  const command = typeof request.command === 'string' ? request.command.toUpperCase() : ''
  if (!REDIS_READ_ONLY_COMMANDS.has(command))
    throw new Error(`Redis 命令 ${command || 'unknown'} 不在只读白名单中`)
  const rawArgs = request.args ?? []
  if (!Array.isArray(rawArgs) || rawArgs.length > 256)
    throw new Error('Redis args 必须是最多 256 项的数组')
  const args = rawArgs.map((value) => {
    if (!['string', 'number', 'boolean'].includes(typeof value))
      throw new Error('Redis 参数只能是字符串、数字或布尔值')
    const normalized = String(value)
    if (normalized.length > 4096) throw new Error('Redis 单个参数不能超过 4096 个字符')
    return normalized
  })
  if (['SCAN', 'HSCAN', 'SSCAN', 'ZSCAN'].includes(command)) {
    const countIndex = args.findIndex((value) => value.toUpperCase() === 'COUNT')
    if (countIndex === -1) args.push('COUNT', String(maxRows))
    else {
      const requestedCount = Number(args[countIndex + 1])
      if (!Number.isInteger(requestedCount) || requestedCount < 1)
        throw new Error('Redis SCAN COUNT 必须是正整数')
      args[countIndex + 1] = String(Math.min(requestedCount, maxRows))
    }
  }
  let cliArgs = ['redis-cli', '--json', '--no-auth-warning', '-n', input.database]
  if (input.host) cliArgs.push('-h', input.host)
  if (input.port) cliArgs.push('-p', String(input.port))
  if (input.username) cliArgs.push('--user', input.username)
  cliArgs = [
    'timeout',
    '--signal=TERM',
    '--kill-after=2s',
    `${Math.ceil(timeoutMs / 1000)}s`,
    ...cliArgs
  ]
  if (input.container) {
    const inner =
      'if [ -n "${REDIS_PASSWORD:-}" ]; then export REDISCLI_AUTH="$REDIS_PASSWORD"; fi; exec "$@"'
    cliArgs = ['docker', 'exec', '-i', input.container, 'sh', '-c', inner, 'sh', ...cliArgs]
  }
  return {
    command: cliArgs.map(shellQuote).join(' '),
    stdin: [command, ...args].map(redisCliQuote).join(' ') + '\n',
    maxRows,
    timeoutMs,
    format: 'json' as const
  }
}

function stripOracleCommentsAndLiterals(query: string): string {
  let output = ''
  let index = 0
  while (index < query.length) {
    const character = query[index]
    const next = query[index + 1]
    if (character === "'") {
      output += ' '
      index += 1
      let closed = false
      while (index < query.length) {
        if (query[index] === "'" && query[index + 1] === "'") {
          index += 2
          continue
        }
        if (query[index] === "'") {
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) throw new Error('Oracle 查询包含未闭合字符串')
      continue
    }
    if (character === '-' && next === '-') {
      while (index < query.length && query[index] !== '\n') index += 1
      output += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      const end = query.indexOf('*/', index + 2)
      if (end === -1) throw new Error('Oracle 查询包含未闭合注释')
      output += ' '
      index = end + 2
      continue
    }
    output += character
    index += 1
  }
  return output
}

export function validateOracleQuery(query: string): string {
  if (
    /^\s*(?:@|!|host\b|spool\b|start\b|connect\b|set\b|prompt\b|exit\b|column\b|ttitle\b|\/\s*$)/im.test(
      query
    )
  )
    throw new Error('Oracle 查询不允许 SQL*Plus 客户端命令')
  const inspected = stripOracleCommentsAndLiterals(query)
  const semicolons = [...inspected.matchAll(/;/g)]
  if (
    semicolons.length > 1 ||
    (semicolons.length === 1 && inspected.slice(semicolons[0].index! + 1).trim())
  )
    throw new Error('Oracle 只允许单条查询')
  const normalized = inspected.replace(/;\s*$/, '').trim()
  if (!/^(?:select|with)\b/i.test(normalized)) throw new Error('Oracle 只允许 SELECT 或 WITH 查询')
  if (
    /\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|commit|rollback|savepoint|call|execute|begin|declare|function|procedure|pragma|lock|nextval)\b/i.test(
      normalized
    )
  )
    throw new Error('Oracle 查询不允许修改、过程或事务控制语句')
  if (/\bfor\s+update\b/i.test(normalized) || /\binto\b/i.test(normalized))
    throw new Error('Oracle 查询不允许 SELECT INTO 或写锁')
  if (/"[^"]+"\s*\(/.test(normalized)) throw new Error('Oracle 查询不允许带引号的函数调用')
  const functionPattern = /\b([A-Za-z][A-Za-z0-9_$#.]*)\s*\(/g
  for (const match of normalized.matchAll(functionPattern)) {
    const name = match[1].toLowerCase()
    if (name.includes('.') || (!ORACLE_QUERY_FUNCTIONS.has(name) && !ORACLE_SYNTAX_CALLS.has(name)))
      throw new Error(`Oracle 查询函数尚未确认为只读：${match[1]}`)
  }
  return query.replace(/;\s*$/, '').trim()
}

function buildOraclePlan(input: McpExtendedDatabaseQuery, maxRows: number, timeoutMs: number) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(input.database)) throw new Error('Oracle 服务名无效')
  if (input.systemUser && !/^[A-Za-z0-9_.-]{1,128}$/.test(input.systemUser))
    throw new Error('Oracle 系统账号无效')
  const sql = validateOracleQuery(input.query)
  const connectTarget =
    input.systemUser || input.container
      ? '/ AS SYSDBA'
      : input.host
        ? `/@//${input.host}:${input.port ?? 1521}/${input.database}`
        : '/'
  let args = ['sqlplus', '-S', '-L', '/nolog']
  if (!input.host) args = ['env', `ORACLE_SID=${input.database}`, ...args]
  args = ['timeout', '--signal=TERM', '--kill-after=2s', `${Math.ceil(timeoutMs / 1000)}s`, ...args]
  if (input.container) args = ['docker', 'exec', '-i', input.container, ...args]
  else if (input.systemUser) args = ['runuser', '-u', input.systemUser, '--', ...args]
  const stdin = `WHENEVER SQLERROR EXIT SQL.SQLCODE\nCONNECT ${connectTarget}\nSET DEFINE OFF\nSET ECHO OFF FEEDBACK OFF HEADING ON PAGESIZE 50000 LINESIZE 32767 TRIMSPOOL ON\nSET MARKUP CSV ON QUOTE ON\nSET TRANSACTION READ ONLY;\nSELECT * FROM (${sql}) mshell_query FETCH FIRST ${maxRows} ROWS ONLY;\nROLLBACK;\nEXIT\n`
  return {
    command: args.map(shellQuote).join(' '),
    stdin,
    maxRows,
    timeoutMs,
    format: 'csv' as const
  }
}

export function buildExtendedDatabaseQuery(
  input: McpExtendedDatabaseQuery
): McpExtendedDatabasePlan {
  const { maxRows, timeoutMs } = validateCommonInput(input)
  if (input.engine === 'mongodb') return buildMongoPlan(input, maxRows, timeoutMs)
  if (input.engine === 'redis') return buildRedisPlan(input, maxRows, timeoutMs)
  return buildOraclePlan(input, maxRows, timeoutMs)
}
