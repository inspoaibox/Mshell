export interface ScriptVariable {
  name: string
  label?: string
  type?: string
  required?: boolean
  defaultValue?: string
}
export type ScriptValues = Record<string, string | string[]>
export const quoteShell = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
export const valueText = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join(' ') : String(value ?? '')

export interface ScriptDeploymentResult {
  path: string
  savedPath?: string
}
export const SCRIPT_DEPLOYMENT_PATH_MARKER = '__MSHELL_DEPLOYED_PATH__'

export function validateDeployedScriptPath(path: string, fileName?: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path))
    throw new Error('部署返回的脚本路径无效')
  const parts = path.slice(1).split('/')
  const name = parts[parts.length - 1]
  if (
    parts.some((part) => !part || part === '.' || part === '..') ||
    !/^[a-zA-Z0-9._\-\u4e00-\u9fa5]+$/.test(name) ||
    (fileName !== undefined && name !== fileName)
  )
    throw new Error('部署返回的脚本路径无效或文件名不匹配')
  return path
}

export function parseScriptDeploymentPath(output: string, fileName: string): string {
  const lines = output.split(/\r?\n/)
  const record = lines.filter((line) => line.startsWith(SCRIPT_DEPLOYMENT_PATH_MARKER)).pop()
  if (!record) throw new Error('部署未返回实际脚本路径，已停止运行，请重新部署')
  return validateDeployedScriptPath(record.slice(SCRIPT_DEPLOYMENT_PATH_MARKER.length), fileName)
}

/** Shell's own ${HOME} etc. are never auto-discovered as application parameters. */
export function extractScriptVariables(content: string): string[] {
  return [
    ...new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g), (m) => m[1]))
  ]
}

export function renderScriptText(
  content: string,
  values: ScriptValues,
  variables: ScriptVariable[]
): string {
  const names = new Map(variables.map((v) => [v.name, v]))
  return content.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}|\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    (match, brace, dollar) => {
      const variable = names.get(brace || dollar)
      if (!variable) return match
      return variable.type === 'password' ? '[运行时隐藏输入]' : valueText(values[variable.name])
    }
  )
}

/** Bind values as data once; never insert user data into executable shell syntax. */
export function compileScript(
  content: string,
  values: ScriptValues,
  variables: ScriptVariable[]
): string {
  const names = new Map<string, ScriptVariable>()
  for (const variable of variables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable.name) || names.has(variable.name))
      throw new Error('变量名无效或重复：' + variable.name)
    names.set(variable.name, variable)
  }
  const used = new Set<string>()
  const token = (text: string) => {
    const match = /^(?:\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}|\$\{([a-zA-Z_][a-zA-Z0-9_]*)\})/.exec(
      text
    )
    if (!match) return null
    const name = match[1] || match[2]
    if (!names.has(name)) {
      if (match[1]) throw new Error('请配置脚本变量：' + name)
      return null
    }
    used.add(name)
    return { length: match[0].length, reference: '${__mshell_value_' + name + '}' }
  }
  type Frame = { quote: string; depth: number }
  const frames: Frame[] = [{ quote: '', depth: 0 }]
  const heredocs: Array<{ delimiter: string; quoted: boolean; tabs: boolean }> = []
  let result = ''
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (heredocs.length) {
      const doc = heredocs[0]
      if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) {
        heredocs.shift()
        result += line + '\n'
        continue
      }
      for (let i = 0; i < line.length; ) {
        const match = token(line.slice(i))
        if (match) {
          result += match.reference
          i += match.length
          continue
        }
        const char = line[i++]
        result += doc.quoted && /[\\$`]/.test(char) ? '\\' + char : char
      }
      result += '\n'
      continue
    }
    for (let i = 0; i < line.length; ) {
      const frame = frames[frames.length - 1]
      if (line[i] === '\\' && frame.quote !== "'") {
        result += line.slice(i, i + 2)
        i += 2
        continue
      }
      if (frame.quote !== "'" && line.slice(i, i + 2) === '$(') {
        frames.push({ quote: '', depth: 1 })
        result += '$('
        i += 2
        continue
      }
      if (!frame.quote && line[i] === '#' && (i === 0 || /[\s;]/.test(line[i - 1]))) {
        result += line.slice(i)
        break
      }
      if (!frame.quote && line[i - 1] !== '<' && line[i + 2] !== '<') {
        const doc = /^<<(-?)\s*(?:'([a-zA-Z_]\w*)'|"([a-zA-Z_]\w*)"|([a-zA-Z_]\w*))/.exec(
          line.slice(i)
        )
        if (doc) {
          const delimiter = doc[2] || doc[3] || doc[4]
          heredocs.push({ delimiter, quoted: !!(doc[2] || doc[3]), tabs: !!doc[1] })
          result += '<<' + doc[1] + delimiter
          i += doc[0].length
          continue
        }
      }
      const match = token(line.slice(i))
      if (match) {
        result +=
          frame.quote === '"'
            ? match.reference
            : frame.quote === "'"
              ? '\'"' + match.reference + '"\''
              : '"' + match.reference + '"'
        i += match.length
        continue
      }
      const char = line[i++]
      if (char === "'" || char === '"') {
        if (!frame.quote) frame.quote = char
        else if (frame.quote === char) frame.quote = ''
      } else if (!frame.quote && frames.length > 1) {
        if (char === '(') frame.depth++
        if (char === ')' && --frame.depth === 0) frames.pop()
      }
      result += char
    }
    result += '\n'
  }
  if (heredocs.length) throw new Error('脚本的 here-document 缺少结束标记')
  const bindings: string[] = []
  for (const name of used) {
    const variable = names.get(name)!
    const key = '__mshell_value_' + name
    if (variable.type === 'password') {
      // Passwords are entered only into the remote TTY, never embedded in a file/clipboard.
      bindings.push(
        `${key}=''`,
        `IFS= read -r -s -p ${quoteShell((variable.label || name) + ' (password): ')} ${key} </dev/tty || exit 1`,
        `printf '\\n' >/dev/tty`
      )
      if (variable.required)
        bindings.push(`[ -n "$${key}" ] || { printf '%s\\n' '密码不能为空' >&2; exit 1; }`)
    } else {
      const value = valueText(values[name])
      if (value.includes('\0')) throw new Error('变量不能包含空字符：' + name)
      if (variable.required && !value.trim())
        throw new Error('请填写变量：' + (variable.label || name))
      bindings.push(`${key}=${quoteShell(value)}`)
    }
  }
  return [...bindings, result].join('\n')
}

export function buildScriptDeployment(
  content: string,
  fileName: string,
  copyTo?: string,
  reportPath = false
): string {
  for (const name of [fileName, ...(copyTo === undefined ? [] : [copyTo])])
    if (!/^[a-zA-Z0-9._\-\u4e00-\u9fa5]+$/.test(name) || name === '.' || name === '..')
      throw new Error('脚本文件名无效')
  let delimiter = 'MSHELL_SCRIPT'
  while (content.split('\n').includes(delimiter)) delimiter += '_END'
  return [
    '(',
    'set -eu',
    'umask 077',
    'mkdir -p "$HOME/.mshell/scripts"',
    'chmod 700 "$HOME/.mshell/scripts"',
    'mshell_scripts_dir="$(cd -- "$HOME/.mshell/scripts" && pwd -P)"',
    'mshell_tmp="$(mktemp "$mshell_scripts_dir/.deploy.XXXXXXXX")"',
    `trap 'rm -f -- "$mshell_tmp"' EXIT HUP INT TERM`,
    `cat > "$mshell_tmp" <<'${delimiter}'`,
    content.replace(/\n?$/, '\n').slice(0, -1),
    delimiter,
    'bash -n "$mshell_tmp"',
    'chmod 700 "$mshell_tmp"',
    `mv -fT -- "$mshell_tmp" "$mshell_scripts_dir/"${quoteShell(fileName)}`,
    ...(copyTo && copyTo !== fileName
      ? [
          'mshell_tmp="$(mktemp "$mshell_scripts_dir/.deploy.XXXXXXXX")"',
          `cp -- "$mshell_scripts_dir/"${quoteShell(fileName)} "$mshell_tmp"`,
          'chmod 700 "$mshell_tmp"',
          `mv -fT -- "$mshell_tmp" "$mshell_scripts_dir/"${quoteShell(copyTo)}`
        ]
      : []),
    `printf '%s\\n' ${quoteShell('已部署/更新: ' + fileName)}`,
    ...(reportPath
      ? [
          `printf '%s%s\\n' '${SCRIPT_DEPLOYMENT_PATH_MARKER}' "$mshell_scripts_dir/"${quoteShell(fileName)}`
        ]
      : []),
    ')'
  ].join('\n')
}
