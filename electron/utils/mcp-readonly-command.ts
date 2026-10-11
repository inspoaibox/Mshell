const MAX_COMMAND_LENGTH = 2000

const BASIC_READ_ONLY_PROGRAMS = new Set([
  'cat',
  'df',
  'du',
  'file',
  'findmnt',
  'free',
  'getent',
  'grep',
  'groups',
  'head',
  'id',
  'iostat',
  'last',
  'lastlog',
  'lscpu',
  'ls',
  'lsattr',
  'lsblk',
  'lsof',
  'md5sum',
  'mpstat',
  'netstat',
  'nproc',
  'pgrep',
  'pidof',
  'printenv',
  'ps',
  'pstree',
  'pwd',
  'readlink',
  'realpath',
  'sha256sum',
  'ss',
  'stat',
  'tail',
  'uname',
  'uptime',
  'vmstat',
  'w',
  'wc',
  'whereis',
  'which',
  'who',
  'whoami'
])

const SPECIAL_READ_ONLY_PROGRAMS = new Set([
  'crontab',
  'date',
  'docker',
  'docker-compose',
  'find',
  'firewall-cmd',
  'hostname',
  'ip',
  'ip6tables',
  'iptables',
  'journalctl',
  'nft',
  'systemctl',
  'ufw'
])

export const MCP_READ_ONLY_QUERY_PROGRAMS = [
  ...BASIC_READ_ONLY_PROGRAMS,
  ...SPECIAL_READ_ONLY_PROGRAMS
].sort()

/** Options allowed before a sub-command; true means the option consumes the next word. */
type OptionTable = Record<string, boolean>

function splitWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let hasWord = false
  let quote: "'" | '"' | null = null

  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      hasWord = true
    } else if (/\s/.test(char)) {
      if (hasWord) {
        words.push(current)
        current = ''
        hasWord = false
      }
    } else {
      current += char
      hasWord = true
    }
  }

  if (quote) {
    throw new Error('查询命令包含未闭合的引号')
  }
  if (hasWord) words.push(current)
  return words
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function optionName(arg: string): string {
  return arg.startsWith('--') ? arg.split('=')[0] : arg
}

/**
 * Locate the first positional word the way getopt would, so an option value such as
 * `-p status` cannot be mistaken for the sub-command. Unknown options are rejected.
 */
function findAction(
  args: string[],
  options: OptionTable,
  program: string
): { action?: string; index: number } {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-') || arg === '-') return { action: arg, index }
    if (arg === '--') throw new Error(`${program} 不允许使用 -- 分隔参数`)

    const name = optionName(arg)
    if (!(name in options)) {
      throw new Error(`${program} 在子命令前不支持参数 ${arg}`)
    }
    if (options[name] && !arg.includes('=')) index++
  }
  return { index: args.length }
}

/**
 * Reject long options that getopt_long could expand to a forbidden option through an
 * unambiguous prefix (for example `--rot` -> `--rotate`).
 */
function rejectLongOptions(args: string[], forbidden: string[], message: string): void {
  for (const arg of args) {
    if (!arg.startsWith('--') || arg === '--') continue
    const name = optionName(arg).slice(2)
    if (name && forbidden.some((option) => option.startsWith(name))) {
      throw new Error(message)
    }
  }
}

/** Reject forbidden short flags, including when they are grouped such as `-tf` or `-50f`. */
function rejectShortFlags(
  args: string[],
  forbidden: string,
  valueFlags: string,
  message: string
): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-') || arg.startsWith('--') || arg === '-') continue
    for (let position = 1; position < arg.length; position++) {
      const flag = arg[position]
      if (forbidden.includes(flag)) throw new Error(message)
      if (valueFlags.includes(flag)) {
        // Options with optional values never consume a following option, so keep checking it.
        if (position === arg.length - 1 && !(args[index + 1] || '').startsWith('-')) index++
        break
      }
    }
  }
}

function requireExactArgs(
  args: string[],
  options: OptionTable,
  program: string,
  allowPositional: (arg: string) => boolean = () => false
): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-')) {
      if (!allowPositional(arg)) throw new Error(`${program} 不支持参数 ${arg}`)
      continue
    }
    const name = optionName(arg)
    if (!(name in options)) throw new Error(`${program} 不支持参数 ${arg}`)
    if (options[name] && !arg.includes('=')) {
      if (index + 1 >= args.length) throw new Error(`${program} 参数 ${arg} 缺少值`)
      index++
    }
  }
}

const SYSTEMCTL_GLOBAL_OPTIONS: OptionTable = {
  '-a': false,
  '--all': false,
  '--failed': false,
  '--full': false,
  '-l': false,
  '--no-legend': false,
  '--no-pager': false,
  '--plain': false,
  '-q': false,
  '--quiet': false,
  '--system': false,
  '--user': false,
  '-n': true,
  '--lines': true,
  '-o': true,
  '--output': true,
  '-p': true,
  '--property': true,
  '--state': true,
  '-t': true,
  '--type': true
}

function validateSystemctl(args: string[]): void {
  const { action } = findAction(args, SYSTEMCTL_GLOBAL_OPTIONS, 'systemctl')
  const allowed = new Set([
    'cat',
    'help',
    'is-active',
    'is-enabled',
    'is-failed',
    'list-dependencies',
    'list-sockets',
    'list-timers',
    'list-unit-files',
    'list-units',
    'show',
    'show-environment',
    'status'
  ])
  if (action && !allowed.has(action)) {
    throw new Error(`systemctl 仅允许查询操作，当前操作被拒绝：${action}`)
  }
}

const DOCKER_COMPOSE_GLOBAL_OPTIONS: OptionTable = {
  '--ansi': true,
  '--env-file': true,
  '-f': true,
  '--file': true,
  '-p': true,
  '--profile': true,
  '--progress': true,
  '--project-directory': true,
  '--project-name': true
}

function validateDockerActionArgs(action: string, args: string[], label: string): void {
  if (action === 'logs') {
    rejectShortFlags(args, 'f', 'n', '持续跟随日志不适合 MCP 查询，请移除 --follow')
    if (args.some((arg) => optionName(arg) === '--follow')) {
      throw new Error('持续跟随日志不适合 MCP 查询，请移除 --follow')
    }
  }
  if (args.some((arg) => /^(?:-o|--output)(?:=|$)/.test(arg))) {
    throw new Error('Docker 查询不允许把结果写入远程文件')
  }
  if (action === 'stats' && !args.includes('--no-stream')) {
    throw new Error(`${label} 必须添加 --no-stream，避免查询持续占用连接`)
  }
}

function validateDocker(args: string[], program: string): void {
  const simpleActions = new Set([
    'images',
    'info',
    'inspect',
    'logs',
    'port',
    'ps',
    'stats',
    'top',
    'version'
  ])
  const nestedActions: Record<string, Set<string>> = {
    compose: new Set(['config', 'images', 'logs', 'ls', 'ps', 'top', 'version']),
    container: new Set(['inspect', 'logs', 'ls', 'port', 'stats', 'top']),
    image: new Set(['history', 'inspect', 'ls']),
    network: new Set(['inspect', 'ls']),
    system: new Set(['df', 'info']),
    volume: new Set(['inspect', 'ls'])
  }

  if (program === 'docker-compose') {
    const { action, index } = findAction(args, DOCKER_COMPOSE_GLOBAL_OPTIONS, program)
    if (!action) return
    if (!nestedActions.compose.has(action)) {
      throw new Error(`docker-compose 仅允许查询操作，当前操作被拒绝：${action}`)
    }
    validateDockerActionArgs(action, args.slice(index + 1), program)
    return
  }

  // Docker global flags may redirect the daemon or swallow the next word, so none are allowed.
  const { action, index } = findAction(args, { '-v': false, '--version': false }, program)
  if (!action) return
  if (!simpleActions.has(action) && !nestedActions[action]) {
    throw new Error(`docker 仅允许查询操作，当前操作被拒绝：${action}`)
  }
  if (!nestedActions[action]) {
    validateDockerActionArgs(action, args.slice(index + 1), `docker ${action}`)
    return
  }

  const nestedArgs = args.slice(index + 1)
  const nestedOptions = action === 'compose' ? DOCKER_COMPOSE_GLOBAL_OPTIONS : {}
  const nested = findAction(nestedArgs, nestedOptions, `docker ${action}`)
  if (!nested.action) return
  if (!nestedActions[action].has(nested.action)) {
    throw new Error(`docker ${action} 仅允许查询操作，当前操作被拒绝：${nested.action}`)
  }
  validateDockerActionArgs(
    nested.action,
    nestedArgs.slice(nested.index + 1),
    `docker ${action} ${nested.action}`
  )
}

const IP_GLOBAL_OPTIONS: OptionTable = {
  '-4': false,
  '-6': false,
  '-br': false,
  '-brief': false,
  '-c': false,
  '-color': false,
  '-d': false,
  '-details': false,
  '-h': false,
  '-human': false,
  '-j': false,
  '-json': false,
  '-o': false,
  '-oneline': false,
  '-p': false,
  '-pretty': false,
  '-s': false,
  '-stats': false,
  '-statistics': false
}

function validateIp(args: string[]): void {
  // iproute2 accepts abbreviations (`ip a fl`), so objects and actions must be spelled exactly.
  const objects = new Set([
    'a',
    'addr',
    'address',
    'l',
    'link',
    'maddr',
    'maddress',
    'n',
    'neigh',
    'neighbor',
    'neighbour',
    'netns',
    'r',
    'ro',
    'route',
    'ru',
    'rule',
    'tunnel',
    'tuntap'
  ])
  const actions = new Set(['get', 'list', 'lst', 'show'])
  const { action: object, index } = findAction(args, IP_GLOBAL_OPTIONS, 'ip')
  if (!object) return
  if (!objects.has(object)) {
    throw new Error(
      `ip 仅允许查询 addr、link、route、neigh、rule 等对象，当前对象被拒绝：${object}`
    )
  }
  const action = args[index + 1]
  if (action !== undefined && !actions.has(action)) {
    throw new Error(`ip 仅允许 show、list、get 查询操作，请写完整操作名；当前操作被拒绝：${action}`)
  }
  if (object === 'netns' && action === 'get') {
    throw new Error('ip netns 仅允许 list 或 show')
  }
}

function validateIptables(program: string, args: string[]): void {
  let hasList = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (/^-[LSnvx]+$/.test(arg)) {
      if (/[LS]/.test(arg)) hasList = true
      continue
    }
    if (['--list', '--list-rules'].includes(arg)) {
      hasList = true
      continue
    }
    if (['--numeric', '--verbose', '--exact', '--line-numbers'].includes(arg)) continue
    if (/^--table=[a-z]+$/.test(arg)) continue
    if (arg === '-t' || arg === '--table') {
      if (!/^[a-z]+$/.test(args[index + 1] || '')) throw new Error(`${program} -t 需要表名`)
      index++
      continue
    }
    if (!arg.startsWith('-')) continue
    throw new Error(`${program} 仅允许列出规则，不支持参数 ${arg}`)
  }
  if (!hasList) throw new Error(`${program} 必须使用 -L、--list、-S 或 --list-rules`)
}

function validateNft(args: string[]): void {
  const options: OptionTable = {
    '-a': false,
    '--handle': false,
    '-j': false,
    '--json': false,
    '-n': false,
    '--numeric': false,
    '-s': false,
    '--stateless': false,
    '-t': false,
    '--terse': false,
    '-y': false,
    '--numeric-priority': false
  }
  const { action, index } = findAction(args, options, 'nft')
  if (action !== 'list') throw new Error('nft 仅允许 list 查询')
  // nft joins the remaining words into one command string; options there are not expected.
  if (args.slice(index + 1).some((arg) => arg.startsWith('-'))) {
    throw new Error('nft list 之后不允许再出现参数选项')
  }
}

function validateDate(args: string[]): void {
  requireExactArgs(
    args,
    {
      '-u': false,
      '--utc': false,
      '--universal': false,
      '-R': false,
      '--rfc-email': false,
      '-I': false,
      '--iso-8601': false,
      '--rfc-3339': false,
      '-d': true,
      '--date': true,
      '-r': true,
      '--reference': true
    },
    'date',
    (arg) => arg.startsWith('+')
  )
}

function validateJournalctl(args: string[]): void {
  rejectLongOptions(
    args,
    [
      'flush',
      'follow',
      'relinquish-var',
      'rotate',
      'setup-keys',
      'smart-relinquish-var',
      'sync',
      'update-catalog',
      'vacuum-files',
      'vacuum-size',
      'vacuum-time'
    ],
    'journalctl 修改、清理或持续跟随操作已被拒绝'
  )
  rejectShortFlags(args, 'f', 'nupSUtoDMgFcTiI', '持续跟随日志不适合 MCP 查询')
}

function validateSpecialProgram(program: string, args: string[]): void {
  switch (program) {
    case 'systemctl':
      validateSystemctl(args)
      return
    case 'docker':
    case 'docker-compose':
      validateDocker(args, program)
      return
    case 'ip':
      validateIp(args)
      return
    case 'iptables':
    case 'ip6tables':
      validateIptables(program, args)
      return
    case 'nft':
      validateNft(args)
      return
    case 'ufw':
      if (
        args[0] !== 'status' ||
        args.slice(1).some((arg) => !['numbered', 'verbose'].includes(arg))
      ) {
        throw new Error('ufw 仅允许 status、status verbose 或 status numbered 查询')
      }
      return
    case 'firewall-cmd':
      if (
        args.some(
          (arg) =>
            !/^(?:--state|--list(?:-[a-z-]+)?|--get(?:-[a-z-]+)?|--query(?:-[a-z-]+)?(?:=.*)?|--zone=[^=]+|--help|--version)$/.test(
              arg
            )
        )
      ) {
        throw new Error('firewall-cmd 仅允许 state、list、get 和 query 查询参数')
      }
      return
    case 'journalctl':
      validateJournalctl(args)
      return
    case 'crontab':
      requireExactArgs(args, { '-l': false, '-u': true }, 'crontab')
      if (!args.includes('-l')) throw new Error('crontab 仅允许使用 -l 查询任务')
      return
    case 'find':
      if (
        args.some((arg) =>
          /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(arg)
        )
      ) {
        throw new Error('find 的执行、删除和文件输出操作已被拒绝')
      }
      return
    case 'date':
      validateDate(args)
      return
    case 'hostname':
      requireExactArgs(
        args,
        {
          '-A': false,
          '--all-fqdns': false,
          '-a': false,
          '--alias': false,
          '-d': false,
          '--domain': false,
          '-f': false,
          '--fqdn': false,
          '--long': false,
          '-I': false,
          '--all-ip-addresses': false,
          '-i': false,
          '--ip-address': false,
          '-s': false,
          '--short': false
        },
        'hostname'
      )
      return
  }
}

function validateBasicProgram(program: string, args: string[]): void {
  switch (program) {
    case 'file':
      rejectLongOptions(args, ['compile'], 'file 编译 magic 数据库的操作已被拒绝')
      rejectShortFlags(args, 'C', 'mfFeP', 'file 编译 magic 数据库的操作已被拒绝')
      return
    case 'tail':
      rejectLongOptions(args, ['follow', 'retry'], '持续跟随文件不适合 MCP 查询')
      rejectShortFlags(args, 'fF', 'ncs', '持续跟随文件不适合 MCP 查询')
      return
    case 'ss':
      // -K closes sockets and -D dumps raw diagnostics into a file.
      rejectLongOptions(args, ['kill', 'diag'], 'ss 的断开连接和写文件操作已被拒绝')
      rejectShortFlags(args, 'KD', 'fAFN', 'ss 的断开连接和写文件操作已被拒绝')
      return
    case 'lastlog':
      rejectLongOptions(args, ['clear', 'set'], 'lastlog 修改登录记录的操作已被拒绝')
      rejectShortFlags(args, 'CS', 'btuR', 'lastlog 修改登录记录的操作已被拒绝')
      return
  }
}

export interface McpReadOnlyCommand {
  /** Normalized command text shown to the Agent and written to the audit log. */
  command: string
  /** Command with every word single-quoted, so the remote shell performs no expansion. */
  shellCommand: string
}

export function parseMcpReadOnlyCommand(value: string): McpReadOnlyCommand {
  const command = value.trim()
  if (!command) throw new Error('查询命令不能为空')
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`查询命令不能超过 ${MAX_COMMAND_LENGTH} 个字符`)
  }
  if (/[\u0000-\u001f\u007f;&|<>`\\$]/.test(command)) {
    throw new Error('只允许执行单条查询命令，不支持管道、重定向、命令串或 Shell 展开')
  }

  const words = splitWords(command)
  const program = words[0]
  if (!program || !/^[a-z0-9][a-z0-9._-]*$/.test(program)) {
    throw new Error('查询命令必须以受支持的程序名开头')
  }
  if (!BASIC_READ_ONLY_PROGRAMS.has(program) && !SPECIAL_READ_ONLY_PROGRAMS.has(program)) {
    throw new Error(
      `不支持查询程序 ${program}；允许的程序：${MCP_READ_ONLY_QUERY_PROGRAMS.join(', ')}`
    )
  }

  const args = words.slice(1)
  if (SPECIAL_READ_ONLY_PROGRAMS.has(program)) {
    validateSpecialProgram(program, args)
  } else {
    validateBasicProgram(program, args)
  }

  // The validator reasons about these exact words; quoting prevents brace, glob and tilde
  // expansion from turning them into different arguments on the remote shell.
  return { command, shellCommand: words.map(shellQuote).join(' ') }
}

export function validateMcpReadOnlyCommand(value: string): string {
  return parseMcpReadOnlyCommand(value).command
}
