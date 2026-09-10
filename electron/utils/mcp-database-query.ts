import { Parser } from 'node-sql-parser'

export type McpDatabaseEngine = 'mysql' | 'mariadb' | 'postgresql' | 'sqlite'

export interface McpDatabaseQuery {
  engine: McpDatabaseEngine
  database: string
  query: string
  host?: string
  port?: number
  username?: string
  container?: string
  maxRows?: number
  timeoutMs?: number
}

export type McpDatabaseErrorCode =
  | 'CLIENT_MISSING'
  | 'TIMEOUT_MISSING'
  | 'DOCKER_UNAVAILABLE'
  | 'CONTAINER_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'USER_NOT_FOUND'
  | 'DATABASE_NOT_FOUND'
  | 'DATABASE_UNAVAILABLE'
  | 'CONNECTION_FAILED'
  | 'PERMISSION_DENIED'
  | 'OBJECT_NOT_FOUND'
  | 'QUERY_INVALID'
  | 'QUERY_TIMEOUT'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'READ_ONLY_VIOLATION'
  | 'QUERY_FAILED'

export interface McpDatabaseFailure {
  errorCode: McpDatabaseErrorCode
  message: string
  guidance: string
  retryable: boolean
}

export interface McpDatabaseTarget {
  targetId: string
  engine: McpDatabaseEngine
  location: 'host' | 'container'
  container?: string
  image?: string
  publishedPorts?: string
  username?: string
  database?: string
  authStatus: 'verified' | 'unverified' | 'requires-configuration'
  systemDatabase: boolean
  queryReady: boolean
}

export interface McpApplicationTarget {
  container: string
  image: string
  publishedPorts: string
}

export interface McpDatabaseDiscovery {
  hostClients: McpDatabaseEngine[]
  targets: McpDatabaseTarget[]
  applications: McpApplicationTarget[]
  requiresSelection: boolean
  guidance: string
}

const parser = new Parser()
const DIALECTS = { mysql: 'MySQL', mariadb: 'MySQL', postgresql: 'Postgresql', sqlite: 'Sqlite' }

// A SELECT can call a stored function that writes files or invokes another database.
// Only known query functions are accepted; transactions provide a second boundary.
const QUERY_FUNCTIONS = new Set(
  `abs acos asin atan atan2 ceil ceiling cos cot degrees exp floor ln log log10 log2 mod pi pow power
    radians round sign sin sqrt tan truncate trunc random rand
    avg count sum min max total group_concat string_agg array_agg json_agg jsonb_agg
    json_objectagg json_arrayagg bool_and bool_or every bit_and bit_or std stddev stddev_pop
    stddev_samp variance var_pop var_samp
    coalesce ifnull nullif if greatest least isnull
    ascii char_length character_length length octet_length bit_length concat concat_ws
    lower upper lcase ucase trim ltrim rtrim btrim substring substr left right replace
    reverse repeat lpad rpad instr locate position split_part regexp_replace regexp_substr
    regexp_like regexp_count format hex unhex encode decode md5 sha1 sha2
    date time datetime julianday unixepoch strftime timediff date_format time_format
    date_add date_sub adddate subdate addtime subtime datediff timestampdiff timestampadd
    extract date_part date_trunc to_char to_date to_timestamp str_to_date from_unixtime
    unix_timestamp now current_date current_time current_timestamp localtime localtimestamp
    year month day dayofmonth dayofweek dayofyear hour minute second week weekday quarter
    last_day make_date age clock_timestamp statement_timestamp transaction_timestamp
    json_extract json_unquote json_type json_length json_valid json_array_length
    json_object_keys jsonb_object_keys json_each jsonb_each json_each_text jsonb_each_text
    json_array_elements jsonb_array_elements json_array_elements_text jsonb_array_elements_text
    json_build_object jsonb_build_object json_build_array jsonb_build_array json_object json_array
    to_json to_jsonb row_to_json array_to_json array_length array_lower array_upper cardinality
    array_to_string string_to_array unnest generate_series
    row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value
    database schema version sqlite_version current_database current_schema current_schemas
    current_user session_user user connection_id pg_backend_pid
    pg_database_size pg_table_size pg_indexes_size pg_total_relation_size pg_relation_size
    pg_size_pretty pg_get_viewdef pg_get_indexdef pg_get_constraintdef pg_get_expr
    pg_encoding_to_char pg_is_in_recovery pg_postmaster_start_time
    typeof quote unicode char`
    .split(/\s+/)
    .filter(Boolean)
)

const MYSQL_QUERY_FUNCTIONS = new Set(
  `abs acos asin atan atan2 ceil ceiling cos cot degrees exp floor ln log log10 log2 mod pi pow power
    radians round sign sin sqrt tan truncate rand avg count sum min max group_concat
    json_objectagg json_arrayagg bit_and bit_or std stddev stddev_pop stddev_samp variance var_pop var_samp
    coalesce ifnull nullif if greatest least isnull ascii char_length character_length length octet_length
    bit_length concat concat_ws lower upper lcase ucase trim ltrim rtrim substring substr left right
    replace reverse repeat lpad rpad instr locate position regexp_replace regexp_substr regexp_like
    format hex unhex md5 sha1 sha2 date time timediff date_format time_format date_add date_sub
    adddate subdate addtime subtime datediff timestampdiff timestampadd extract str_to_date
    from_unixtime unix_timestamp now current_date current_time current_timestamp localtime localtimestamp
    year month day dayofmonth dayofweek dayofyear hour minute second week weekday quarter last_day
    json_extract json_unquote json_type json_length json_valid json_object json_array
    row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value
    database schema version current_user session_user user connection_id quote char`
    .split(/\s+/)
    .filter(Boolean)
)
const PG_SYNTAX_FUNCTIONS = new Set([
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'current_date',
  'current_time',
  'current_timestamp',
  'localtime',
  'localtimestamp',
  'current_user',
  'session_user',
  'extract',
  'position',
  'substring',
  'trim'
])

export function buildMcpDatabaseDiscoveryCommand(): string {
  return `
sh <<'MSHELL_DATABASE_DISCOVERY'
set +e
echo "__MSHELL_DATABASE_DISCOVERY_V1__"
emit_host() { printf 'HOST_CLIENT|%s\\n' "$1"; }
emit_app() { printf 'APPLICATION|%s|%s|%s\\n' "$1" "$2" "$3"; }
emit_target() { printf 'TARGET|%s|%s|%s|%s|%s|%s|%s\\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7"; }

command -v psql >/dev/null 2>&1 && emit_host postgresql
command -v mysql >/dev/null 2>&1 && emit_host mysql
command -v mariadb >/dev/null 2>&1 && emit_host mariadb
command -v sqlite3 >/dev/null 2>&1 && emit_host sqlite

if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}' 2>/dev/null | while IFS='|' read -r id name image ports; do
    [ -n "$id" ] || continue
    identity=$(printf '%s %s' "$name" "$image" | tr '[:upper:]' '[:lower:]')
    case "$identity" in
      *postgres*)
        db_user=$(docker exec "$id" sh -c 'printf %s "\${POSTGRES_USER:-postgres}"' 2>/dev/null)
        db_default=$(docker exec "$id" sh -c 'printf %s "\${POSTGRES_DB:-\${POSTGRES_USER:-postgres}}"' 2>/dev/null)
        case "$db_user" in ''|*[!A-Za-z0-9_.@-]*) db_user="" ;; esac
        case "$db_default" in ''|*[!A-Za-z0-9_.-]*) db_default="" ;; esac
        databases=$(docker exec "$id" sh -c 'exec psql -X -w --username="\${POSTGRES_USER:-postgres}" --dbname="\${POSTGRES_DB:-\${POSTGRES_USER:-postgres}}" -At -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"' 2>/dev/null)
        if [ $? -eq 0 ] && [ -n "$databases" ]; then
          printf '%s\\n' "$databases" | while IFS= read -r database; do
            case "$database" in ''|*[!A-Za-z0-9_.-]*) continue ;; esac
            system=no
            [ "$database" = postgres ] && system=yes
            emit_target postgresql "$name" "$image" "$ports" "$db_user" "$database" "verified:$system"
          done
        elif [ -n "$db_default" ]; then
          emit_target postgresql "$name" "$image" "$ports" "$db_user" "$db_default" "unverified:no"
        else
          emit_target postgresql "$name" "$image" "$ports" "$db_user" "" "requires-configuration:no"
        fi
        ;;
      *mariadb*|*mysql*|*percona*)
        engine=mysql
        case "$identity" in *mariadb*) engine=mariadb ;; esac
        db_user=$(docker exec "$id" sh -c 'printf %s "\${MYSQL_USER:-\${MARIADB_USER:-root}}"' 2>/dev/null)
        db_default=$(docker exec "$id" sh -c 'printf %s "\${MYSQL_DATABASE:-\${MARIADB_DATABASE:-}}"' 2>/dev/null)
        case "$db_user" in ''|*[!A-Za-z0-9_.@-]*) db_user="" ;; esac
        case "$db_default" in ''|*[!A-Za-z0-9_.-]*) db_default="" ;; esac
        databases=$(docker exec "$id" sh -c '
          user="\${MYSQL_USER:-\${MARIADB_USER:-root}}"
          if [ "$user" = root ]; then
            password="\${MYSQL_ROOT_PASSWORD:-\${MARIADB_ROOT_PASSWORD:-}}"
          else
            password="\${MYSQL_PASSWORD:-\${MARIADB_PASSWORD:-}}"
          fi
          [ -n "$password" ] && export MYSQL_PWD="$password"
          client=mysql
          command -v mysql >/dev/null 2>&1 || client=mariadb
          exec "$client" --batch --skip-column-names --user="$user" -e "SHOW DATABASES"
        ' 2>/dev/null)
        if [ $? -eq 0 ] && [ -n "$databases" ]; then
          printf '%s\\n' "$databases" | while IFS= read -r database; do
            case "$database" in ''|*[!A-Za-z0-9_.-]*) continue ;; esac
            system=no
            case "$database" in information_schema|performance_schema|mysql|sys) system=yes ;; esac
            emit_target "$engine" "$name" "$image" "$ports" "$db_user" "$database" "verified:$system"
          done
        elif [ -n "$db_default" ]; then
          emit_target "$engine" "$name" "$image" "$ports" "$db_user" "$db_default" "unverified:no"
        else
          emit_target "$engine" "$name" "$image" "$ports" "$db_user" "" "requires-configuration:no"
        fi
        ;;
      *) emit_app "$name" "$image" "$ports" ;;
    esac
  done
fi
echo "__MSHELL_DATABASE_DISCOVERY_END__"
MSHELL_DATABASE_DISCOVERY
`
}

function safeDiscoveryValue(value: string, pattern: RegExp, maxLength: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maxLength && pattern.test(trimmed) ? trimmed : ''
}

export function parseMcpDatabaseDiscovery(output: string): McpDatabaseDiscovery {
  const hostClients = new Set<McpDatabaseEngine>()
  const targets = new Map<string, McpDatabaseTarget>()
  const applications: McpApplicationTarget[] = []
  for (const line of output.split(/\r?\n/)) {
    const [kind, ...fields] = line.split('|')
    if (
      kind === 'HOST_CLIENT' &&
      ['mysql', 'mariadb', 'postgresql', 'sqlite'].includes(fields[0])
    ) {
      hostClients.add(fields[0] as McpDatabaseEngine)
      continue
    }
    if (kind === 'APPLICATION') {
      const container = safeDiscoveryValue(fields[0] || '', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 200)
      const image = safeDiscoveryValue(fields[1] || '', /^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/, 300)
      const publishedPorts = (fields.slice(2).join('|') || '').slice(0, 500)
      if (container && image) applications.push({ container, image, publishedPorts })
      continue
    }
    if (kind !== 'TARGET' || !['mysql', 'mariadb', 'postgresql'].includes(fields[0])) continue
    const engine = fields[0] as McpDatabaseEngine
    const container = safeDiscoveryValue(fields[1] || '', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 200)
    const image = safeDiscoveryValue(fields[2] || '', /^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/, 300)
    const publishedPorts = (fields[3] || '').slice(0, 500)
    const username = safeDiscoveryValue(fields[4] || '', /^[A-Za-z0-9_.@-]+$/, 128)
    const database = safeDiscoveryValue(fields[5] || '', /^[A-Za-z0-9_.-]+$/, 128)
    const [authValue, systemValue] = (fields[6] || '').split(':')
    const authStatus = ['verified', 'unverified', 'requires-configuration'].includes(authValue)
      ? (authValue as McpDatabaseTarget['authStatus'])
      : 'unverified'
    if (!container || !image) continue
    const targetId = `container:${container}:${engine}:${database || 'unspecified'}`
    targets.set(targetId, {
      targetId,
      engine,
      location: 'container',
      container,
      image,
      publishedPorts,
      username: username || undefined,
      database: database || undefined,
      authStatus,
      systemDatabase: systemValue === 'yes',
      queryReady: Boolean(database && username && authStatus === 'verified')
    })
  }
  for (const engine of hostClients) {
    const targetId = `host:${engine}:unspecified`
    targets.set(targetId, {
      targetId,
      engine,
      location: 'host',
      authStatus: 'requires-configuration',
      systemDatabase: false,
      queryReady: false
    })
  }
  const targetList = [...targets.values()]
  const selectableTargets = targetList.filter((target) => !target.systemDatabase && target.database)
  return {
    hostClients: [...hostClients],
    targets: targetList,
    applications,
    requiresSelection: selectableTargets.length !== 1 || applications.length > 1,
    guidance:
      '先根据用户指定的站点、程序或容器确认唯一目标，再把该目标的 engine、container、database 和 username 原样传给 query_database。存在多个候选时必须让用户确认；不得根据活动连接、名称相似、列表顺序或默认数据库自行猜测。'
  }
}

export function classifyMcpDatabaseError(
  error: unknown,
  input: Pick<McpDatabaseQuery, 'engine' | 'container'>
): McpDatabaseFailure {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase()
  const inContainer = Boolean(input.container)
  const client =
    input.engine === 'postgresql' ? 'psql' : input.engine === 'sqlite' ? 'sqlite3' : input.engine
  const failure = (
    errorCode: McpDatabaseErrorCode,
    message: string,
    guidance: string,
    retryable = false
  ): McpDatabaseFailure => ({ errorCode, message, guidance, retryable })

  if (/command output exceeded limit/.test(raw)) {
    return failure(
      'OUTPUT_LIMIT_EXCEEDED',
      '数据库返回内容超过单次读取上限',
      '缩小查询范围、减少字段，或使用稳定的 ORDER BY 配合 LIMIT/OFFSET 分页后重试。'
    )
  }
  if (
    /command execution timeout|command failed with code 124|timed out|statement timeout/.test(raw)
  ) {
    return failure(
      'QUERY_TIMEOUT',
      '数据库查询超时',
      '缩小时间范围、添加筛选条件或索引，必要时在允许范围内提高 timeoutMs。',
      true
    )
  }
  if (/no such container|container .+ is not running|container .+ not found/.test(raw)) {
    return failure(
      'CONTAINER_UNAVAILABLE',
      '数据库容器不存在或未运行',
      '先用 docker ps 确认正在运行的容器名称，再更新 container 参数。',
      true
    )
  }
  if (/docker.+(?:(?:command )?not found|not recognized)|failed to run command.+docker/.test(raw)) {
    return failure(
      'DOCKER_UNAVAILABLE',
      '远程服务器无法使用 Docker 客户端',
      '确认 Docker 已安装并且当前 SSH 用户有权访问 Docker；非容器数据库请移除 container。'
    )
  }
  if (
    new RegExp(
      `(?:failed to run command|(?:command )?not found|not recognized)[^\\n]*${client}|${client}[^\\n]*(?:(?:command )?not found|not recognized)`
    ).test(raw)
  ) {
    return failure(
      'CLIENT_MISSING',
      `找不到数据库客户端 ${client}`,
      inContainer
        ? `在目标容器内安装 ${client}，或改为在已安装客户端的宿主机上连接数据库。`
        : `在远程服务器安装 ${client}，或传入 container 在包含客户端的数据库容器内查询。`
    )
  }
  if (
    /timeout[^\n]*(?:(?:command )?not found|not recognized)|failed to run command[^\n]*timeout/.test(
      raw
    )
  ) {
    return failure(
      'TIMEOUT_MISSING',
      '找不到 GNU timeout 命令',
      inContainer
        ? '在目标容器内安装 coreutils，或使用包含 GNU timeout 的数据库镜像。'
        : '在远程服务器安装 coreutils。'
    )
  }
  if (/role .+ does not exist|unknown (?:user|role)|user .+ does not exist/.test(raw)) {
    return failure(
      'USER_NOT_FOUND',
      '指定的数据库用户不存在',
      input.engine === 'postgresql' && inContainer
        ? '使用容器初始化时的 PostgreSQL 用户；不要默认填写 postgres，也不要把 SSH 用户名当作数据库用户。'
        : '确认 username 是数据库账号，而不是 SSH 用户名或容器名称。'
    )
  }
  if (
    /database .+ does not exist|unknown database|unable to open database file|no such database/.test(
      raw
    )
  ) {
    return failure(
      input.engine === 'sqlite' ? 'DATABASE_UNAVAILABLE' : 'DATABASE_NOT_FOUND',
      input.engine === 'sqlite' ? '无法打开 SQLite 数据库文件' : '指定的数据库不存在',
      input.engine === 'sqlite'
        ? '确认 database 是容器或远程服务器内的绝对路径，并检查文件及父目录读取权限。'
        : '确认 database 使用真实数据库名称；容器部署通常来自初始化时的数据库配置。'
    )
  }
  if (
    /password authentication failed|no password supplied|fe_sendauth|peer authentication failed|access denied for user|authentication failed/.test(
      raw
    )
  ) {
    return failure(
      'AUTHENTICATION_FAILED',
      '数据库认证失败',
      inContainer
        ? '确认 username 与容器初始化账号一致；容器内仍要求密码时，在容器中配置只读客户端凭据。'
        : input.engine === 'postgresql'
          ? '在远程账号中配置只读用户的 .pgpass、peer 或 socket 认证；MCP 不接收明文密码。'
          : '在远程账号中配置只读用户的 .my.cnf 或 socket 认证；MCP 不接收明文密码。'
    )
  }
  if (
    /connection refused|could not connect to server|can.t connect to.+server|server closed the connection|lost connection/.test(
      raw
    )
  ) {
    return failure(
      'CONNECTION_FAILED',
      '无法连接数据库服务',
      '检查 host、port、数据库监听地址和容器网络；容器内查询通常不需要填写 host。',
      true
    )
  }
  if (
    /permission denied|not authorized|permission.+denied|insufficient privilege|command denied|access denied(?! for user)/.test(
      raw
    )
  ) {
    return failure(
      'PERMISSION_DENIED',
      '数据库账号没有读取目标对象的权限',
      '为专用只读账号授予目标库、schema 或表的 SELECT 权限后重试。'
    )
  }
  if (
    /relation .+ does not exist|no such table|unknown table|unknown column|column .+ does not exist|table .+ doesn.t exist/.test(
      raw
    )
  ) {
    return failure(
      'OBJECT_NOT_FOUND',
      '查询引用的表或字段不存在',
      '先查询 information_schema、PostgreSQL 系统目录或 sqlite_master，确认 schema、表名和字段名。'
    )
  }
  if (
    /read-only|read only|cannot execute .+ in a read-only transaction|attempt to write a readonly database/.test(
      raw
    )
  ) {
    return failure(
      'READ_ONLY_VIOLATION',
      '查询触发了数据库写入保护',
      'query_database 始终只读；需要修改数据时开启写入开关并使用 execute_command。'
    )
  }
  if (
    /syntax error|parse error|you have an error in your sql syntax|unrecognized token|near .+ syntax/.test(
      raw
    )
  ) {
    return failure(
      'QUERY_INVALID',
      '数据库拒绝了查询语法',
      '检查数据库版本、SQL 方言、函数和标识符，调整为当前数据库支持的只读查询。'
    )
  }
  return failure(
    'QUERY_FAILED',
    '数据库查询未完成',
    '检查数据库客户端、连接参数、只读账号权限和 SQL 字段；原始数据库错误已隐藏以保护敏感信息。'
  )
}

function inspectAst(value: unknown, engine: McpDatabaseEngine): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => inspectAst(item, engine))
    return
  }
  const node = value as Record<string, any>
  if (
    [
      'insert',
      'update',
      'delete',
      'replace',
      'create',
      'drop',
      'alter',
      'call',
      'set',
      'assign',
      'var'
    ].includes(node.type)
  ) {
    throw new Error('数据库查询不允许修改语句、变量赋值或存储过程')
  }
  if (node.into?.position || node.locking_read || node.for_update) {
    throw new Error('数据库查询不允许 INTO 文件输出、建表或加写锁')
  }
  if (node.type === 'function' || node.type === 'aggr_func') {
    const name =
      typeof node.name === 'string'
        ? node.name
        : node.name?.name?.map((part: any) => part.value).join('.')
    const schema = node.name?.schema?.value
    const allowedFunctions =
      engine === 'mysql' || engine === 'mariadb' ? MYSQL_QUERY_FUNCTIONS : QUERY_FUNCTIONS
    if (
      !name ||
      !allowedFunctions.has(name.toLowerCase()) ||
      (schema && !(engine === 'postgresql' && schema === 'pg_catalog'))
    ) {
      throw new Error(`查询函数尚未确认为只读：${name || 'unknown'}`)
    }
    // Resolve PostgreSQL functions in pg_catalog, not user-defined functions in public.
    if (engine === 'postgresql' && !PG_SYNTAX_FUNCTIONS.has(name.toLowerCase())) {
      if (typeof node.name === 'string') node.name = `pg_catalog.${name.toLowerCase()}`
      else
        node.name = {
          name: [{ type: 'default', value: name.toLowerCase() }],
          schema: { type: 'default', value: 'pg_catalog' }
        }
    }
  }
  Object.values(node).forEach((child) => inspectAst(child, engine))
}

export function validateMcpDatabaseQuery(query: string, engine: McpDatabaseEngine) {
  if (!DIALECTS[engine]) throw new Error('暂不支持此数据库类型')
  if (!query.trim() || query.length > 20_000) throw new Error('SQL 不能为空或超过 20000 个字符')
  // Do not forward client meta-commands, MySQL executable comments, or escape syntax.
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\\]/.test(query) ||
    /\/\*[!+]|\/\*M!/i.test(query)
  ) {
    throw new Error('查询不允许客户端转义命令或可执行注释')
  }
  let statements
  try {
    const ast = parser.astify(query, { database: DIALECTS[engine] })
    statements = Array.isArray(ast) ? ast : [ast]
  } catch {
    throw new Error('无法解析此 SQL；请使用单条 SELECT、WITH 查询或 MySQL SHOW/DESCRIBE 元数据查询')
  }
  const ast = statements[0]
  const metadata =
    (engine === 'mysql' || engine === 'mariadb') && ['show', 'desc'].includes(ast?.type)
  if (statements.length !== 1 || (!metadata && ast?.type !== 'select')) {
    throw new Error(
      '仅允许单条只读查询；新增、修改、删除等操作需要开启写入开关并使用 execute_command'
    )
  }
  inspectAst(ast, engine)
  // Execute the parsed form, never unchecked trailing SQL or parser-ignored comments.
  return { sql: parser.sqlify(ast, { database: DIALECTS[engine] }), metadata }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function buildMcpDatabaseQuery(input: McpDatabaseQuery) {
  const { engine, database, host, port, username, container } = input
  const { sql, metadata } = validateMcpDatabaseQuery(input.query, engine)
  const maxRows = input.maxRows ?? 200
  const timeoutMs = input.timeoutMs ?? 20_000
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 2000)
    throw new Error('单次查询行数必须为 1 到 2000')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000)
    throw new Error('查询超时必须为 1000 到 120000 毫秒')
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('数据库端口无效')
  if (container !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(container))
    throw new Error('Docker 容器名称无效')
  if (host !== undefined && !/^[a-zA-Z0-9_./:%-]{1,255}$/.test(host))
    throw new Error('数据库主机名无效')
  if (username !== undefined && !/^[a-zA-Z0-9_.@-]{1,128}$/.test(username))
    throw new Error('数据库用户名无效')
  if (engine === 'sqlite') {
    if (
      !database.startsWith('/') ||
      /[\u0000-\u001f\u007f]/.test(database) ||
      database.length > 4096
    ) {
      throw new Error('SQLite 数据库必须使用远程服务器上的绝对文件路径')
    }
    if (host !== undefined || port !== undefined || username !== undefined)
      throw new Error('SQLite 不接受主机、端口或用户名')
  } else if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(database)) {
    throw new Error('请传入数据库名称，不接受连接 URL、密码或连接参数字符串')
  }

  const boundedSql = metadata ? sql : `SELECT * FROM (${sql}) AS mshell_query LIMIT ${maxRows}`
  let args: string[]
  let stdin: string
  if (engine === 'sqlite') {
    args = [
      'sqlite3',
      '-safe',
      '-readonly',
      '-batch',
      '-bail',
      '-init',
      '/dev/null',
      '-header',
      '-csv',
      database
    ]
    stdin = `PRAGMA query_only=ON;\nBEGIN;\n${boundedSql};\nROLLBACK;\n`
  } else if (engine === 'postgresql') {
    args = [
      'env',
      `PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c search_path=pg_catalog,public`,
      'psql',
      '-X',
      '-w',
      '--csv',
      '-q',
      '-P',
      'pager=off',
      '-v',
      'ON_ERROR_STOP=1',
      `--dbname=${database}`
    ]
    if (host) args.push(`--host=${host}`)
    if (port) args.push(`--port=${port}`)
    if (username) args.push(`--username=${username}`)
    stdin = `BEGIN READ ONLY;\n${boundedSql};\nROLLBACK;\n`
  } else {
    args = [
      engine === 'mariadb' ? 'mariadb' : 'mysql',
      '--batch',
      '--quick',
      '--skip-auto-rehash',
      '--binary-mode',
      '--local-infile=0',
      '--skip-reconnect',
      '--skip-force',
      '--connect-timeout=5',
      '--init-command=SET SESSION TRANSACTION READ ONLY',
      `--database=${database}`
    ]
    if (host) args.push(`--host=${host}`)
    if (port) args.push(`--port=${port}`)
    if (username) args.push(`--user=${username}`)
    const timeoutSetting =
      engine === 'mariadb'
        ? `max_statement_time=${timeoutMs / 1000}`
        : `MAX_EXECUTION_TIME=${timeoutMs}`
    stdin = `SET SESSION ${timeoutSetting};\nSTART TRANSACTION READ ONLY;\n${boundedSql};\nROLLBACK;\n`
  }
  // Run timeout inside the container so expiry terminates the database client itself.
  args = ['timeout', '--signal=TERM', '--kill-after=2s', `${Math.ceil(timeoutMs / 1000)}s`, ...args]
  if (container) args = ['docker', 'exec', '-i', container, ...args]
  return {
    command: args.map(shellQuote).join(' '),
    stdin,
    maxRows: metadata ? null : maxRows,
    timeoutMs,
    format: engine === 'mysql' || engine === 'mariadb' ? 'tsv' : 'csv'
  }
}
