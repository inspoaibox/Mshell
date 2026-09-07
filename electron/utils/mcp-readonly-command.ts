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

function splitWords(command: string): string[] {
  const words: string[] = []
  let current = ''
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
    } else if (/\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (quote) {
    throw new Error('查询命令包含未闭合的引号')
  }
  if (current) words.push(current)
  return words
}

function firstNonOption(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith('-'))
}

function rejectMatching(args: string[], pattern: RegExp, message: string): void {
  if (args.some((arg) => pattern.test(arg))) {
    throw new Error(message)
  }
}

function validateSystemctl(args: string[]): void {
  const action = firstNonOption(args)
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

function validateDocker(args: string[], program: string): void {
  const action = firstNonOption(args)
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

  if (!action) return
  if (program === 'docker-compose') {
    if (!nestedActions.compose.has(action)) {
      throw new Error(`docker-compose 仅允许查询操作，当前操作被拒绝：${action}`)
    }
  } else if (!simpleActions.has(action) && !nestedActions[action]) {
    throw new Error(`docker 仅允许查询操作，当前操作被拒绝：${action}`)
  } else if (nestedActions[action]) {
    const actionIndex = args.indexOf(action)
    const nestedAction = firstNonOption(args.slice(actionIndex + 1))
    if (nestedAction && !nestedActions[action].has(nestedAction)) {
      throw new Error(`docker ${action} 仅允许查询操作，当前操作被拒绝：${nestedAction}`)
    }
  }

  rejectMatching(args, /^(?:-f|--follow(?:=|$))/, '持续跟随日志不适合 MCP 查询，请移除 --follow')
  rejectMatching(args, /^(?:-o|--output)(?:=|$)/, 'Docker 查询不允许把结果写入远程文件')
  if (args.includes('stats') && !args.includes('--no-stream')) {
    throw new Error('docker stats 必须添加 --no-stream，避免查询持续占用连接')
  }
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
      rejectMatching(
        args,
        /^(?:add|append|attach|batch|change|delete|del|exec|flush|replace|restore|save|set)$/,
        'ip 仅允许 show、list、get 等查询操作'
      )
      return
    case 'iptables':
    case 'ip6tables': {
      const allowed = args.some((arg) => /^(?:-L|--list|-S|--list-rules)$/.test(arg))
      rejectMatching(
        args,
        /^(?:-A|-D|-I|-R|-F|-N|-X|-P|-Z|--append|--delete|--insert|--replace|--flush|--new-chain|--delete-chain|--policy|--zero)$/,
        `${program} 仅允许列出规则`
      )
      if (!allowed) throw new Error(`${program} 必须使用 -L、--list、-S 或 --list-rules`)
      return
    }
    case 'nft':
      if (firstNonOption(args) !== 'list') throw new Error('nft 仅允许 list 查询')
      return
    case 'ufw':
      if (firstNonOption(args) !== 'status') throw new Error('ufw 仅允许 status 查询')
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
      rejectMatching(
        args,
        /^--(?:vacuum|rotate|flush|sync|relinquish-var|smart-relinquish-var|setup-keys|update-catalog)/,
        'journalctl 修改或清理操作已被拒绝'
      )
      rejectMatching(args, /^(?:-f|--follow)$/, '持续跟随日志不适合 MCP 查询')
      return
    case 'crontab':
      if (!args.includes('-l') || args.some((arg) => /^(?:-e|-r)$/.test(arg))) {
        throw new Error('crontab 仅允许使用 -l 查询任务')
      }
      return
    case 'find':
      rejectMatching(
        args,
        /^-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/,
        'find 的执行、删除和文件输出操作已被拒绝'
      )
      return
    case 'date':
      rejectMatching(args, /^(?:-s|--set(?:=|$))/, 'date 设置系统时间的操作已被拒绝')
      if (args.some((arg) => !arg.startsWith('-') && !arg.startsWith('+'))) {
        throw new Error('date 仅允许无参数、显示格式或查询选项，不能设置系统时间')
      }
      return
    case 'hostname':
      if (args.some((arg) => !arg.startsWith('-'))) {
        throw new Error('hostname 仅允许无参数或查询参数，不能设置主机名')
      }
      rejectMatching(args, /^(?:-b|-F|--boot|--file)/, 'hostname 设置操作已被拒绝')
      return
  }
}

export function validateMcpReadOnlyCommand(value: string): string {
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
  if (program === 'file') {
    rejectMatching(args, /^(?:-C|--compile)/, 'file 编译 magic 数据库的操作已被拒绝')
  }
  if (program === 'tail') {
    rejectMatching(args, /^(?:-f|-F|--follow(?:=|$))/, '持续跟随文件不适合 MCP 查询')
  }
  if (SPECIAL_READ_ONLY_PROGRAMS.has(program)) {
    validateSpecialProgram(program, args)
  }

  return command
}
