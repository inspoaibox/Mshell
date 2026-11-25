import { shellQuote } from '../../src/utils/autocomplete/input'

export type CompletionPathEntry = { name: string; directory: boolean }

const remotePath = (path: string) =>
  path === '~'
    ? '"$HOME"'
    : path.startsWith('~/')
      ? '"$HOME"/' + shellQuote(path.slice(2))
      : shellQuote(path)

export function buildPathCompletionScript(input: string, cwd?: string): string {
  if (typeof input !== 'string' || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input))
    throw new Error('无效的补全路径')
  const slash = input.lastIndexOf('/')
  const dir = slash < 0 ? '.' : input.slice(0, slash + 1)
  const prefix = slash < 0 ? input : input.slice(slash + 1)
  const absolute = dir.startsWith('/') || dir.startsWith('~/')
  if (!absolute && (!cwd || !/^(?:\/|~(?:\/|$))/.test(cwd))) throw new Error('无法确认终端当前目录')
  if (cwd && (cwd.length > 4096 || /[\x00-\x1f\x7f]/.test(cwd))) throw new Error('无效的当前目录')
  return `sh <<'MSHELL_PATH_COMPLETION'
set -f
${absolute ? '' : `cd -- ${remotePath(cwd!)} || exit 1`}
directory=${remotePath(dir)}
prefix=${shellQuote(prefix)}
[ -d "$directory" ] || exit 1
set +f
count=0
for entry in "$directory"/* "$directory"/.[!.]* "$directory"/..?*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name="\${entry##*/}"
  case "$name" in "$prefix"*) ;; *) continue ;; esac
  if [ -d "$entry" ]; then kind=d; else kind=f; fi
  printf '%s\\0%s\\0' "$kind" "$name"
  count=$((count + 1))
  [ "$count" -lt 1000 ] || break
done
MSHELL_PATH_COMPLETION`
}

export function parsePathCompletions(output: string): CompletionPathEntry[] {
  const fields = output.split('\0')
  const entries: CompletionPathEntry[] = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (!['d', 'f'].includes(fields[i]) || !fields[i + 1] || /[\x00-\x1f\x7f]/.test(fields[i + 1]))
      continue
    entries.push({ name: fields[i + 1], directory: fields[i] === 'd' })
  }
  return entries
}
