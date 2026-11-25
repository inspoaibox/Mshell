import type { CompletionItem } from '../types'
import { quoteCompletionPath, shellQuote } from '../input'

type CompletionAPI = {
  completionCwd?: string
  ssh?: {
    completePath?: (
      id: string,
      path: string,
      cwd?: string
    ) => Promise<{ success: boolean; data?: Array<{ name: string; directory: boolean }> }>
    executeCommand?: (
      id: string,
      command: string,
      timeout?: number
    ) => Promise<{ success: boolean; data?: string }>
  }
}

/** Scope legacy read-only generators (Git, npm, archives) to this terminal's observed directory. */
export function withCompletionDirectory(api: CompletionAPI, cwd?: string): CompletionAPI {
  const path =
    cwd === '~'
      ? '"$HOME"'
      : cwd?.startsWith('~/')
        ? '"$HOME"/' + shellQuote(cwd.slice(2))
        : shellQuote(cwd || '')
  return {
    ...api,
    completionCwd: cwd,
    ssh: {
      ...api.ssh,
      executeCommand: async (id, command, timeout) => {
        if (!cwd || !/^(?:\/|~(?:\/|$))/.test(cwd) || /[\x00-\x1f\x7f]/.test(cwd))
          return { success: false }
        return (
          (await api.ssh?.executeCommand?.(id, 'cd -- ' + path + ' && ' + command, timeout)) || {
            success: false
          }
        )
      }
    }
  }
}

async function executeRemote(
  sessionId: string,
  command: string,
  api: CompletionAPI,
  timeout = 3000
): Promise<string | null> {
  try {
    const result = await api.ssh?.executeCommand?.(sessionId, command, timeout)
    return result?.success && result.data ? result.data.trim() : null
  } catch {
    return null
  }
}

export async function getRemotePathSuggestions(
  sessionId: string,
  inputPath: string,
  options: { electronAPI: CompletionAPI; cwd?: string; foldersOnly?: boolean; showHidden?: boolean }
): Promise<CompletionItem[]> {
  try {
    const api = options.electronAPI
    const result = await api.ssh?.completePath?.(
      sessionId,
      inputPath,
      options.cwd ?? api.completionCwd
    )
    if (!result?.success || !result.data) return []
    const slash = inputPath.lastIndexOf('/')
    const prefixPath = slash < 0 ? '' : inputPath.slice(0, slash + 1)
    const prefix = slash < 0 ? inputPath : inputPath.slice(slash + 1)
    return result.data
      .filter(
        (entry) =>
          (!options.foldersOnly || entry.directory) &&
          (options.showHidden !== false || !entry.name.startsWith('.'))
      )
      .filter((entry) => entry.name.startsWith(prefix) && !/[\x00-\x1f\x7f]/.test(entry.name))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
      .slice(0, 30)
      .map((entry) => {
        const name = entry.name + (entry.directory ? '/' : '')
        return {
          text: quoteCompletionPath(
            (!prefixPath && name.startsWith('-') ? './' : prefixPath) + name
          ),
          displayText: name,
          type: 'path' as const,
          description: entry.directory ? '目录' : '文件',
          priority: entry.directory ? 80 : 70,
          matchPart: prefix,
          restPart: name.slice(prefix.length)
        }
      })
  } catch {
    return []
  }
}

export const getRemoteDirectories = (id: string, input: string, api: CompletionAPI) =>
  getRemotePathSuggestions(id, input, { electronAPI: api, foldersOnly: true, showHidden: true })
export const getRemoteFiles = (id: string, input: string, api: CompletionAPI) =>
  getRemotePathSuggestions(id, input, { electronAPI: api, showHidden: true })

/**
 * 获取运行中的 Docker 容器
 */
export async function getDockerContainers(
  sessionId: string,
  electronAPI: any,
  all = false
): Promise<CompletionItem[]> {
  if (!sessionId || !electronAPI) return []

  const cmd = all
    ? `docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}" 2>/dev/null`
    : `docker ps --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}" 2>/dev/null`

  const output = await executeRemote(sessionId, cmd, electronAPI, 5000)
  if (!output) return []

  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [id, name, status, image] = line.split('|')
      return {
        text: name || id,
        displayText: name || id,
        type: 'hint' as const,
        description: `${status} (${image})`,
        priority: 90,
        matchPart: '',
        restPart: name || id
      }
    })
}

/**
 * 获取 Docker 镜像列表
 */
export async function getDockerImages(
  sessionId: string,
  electronAPI: any
): Promise<CompletionItem[]> {
  if (!sessionId || !electronAPI) return []

  const cmd = `docker images --format "{{.Repository}}:{{.Tag}}|{{.Size}}" 2>/dev/null`
  const output = await executeRemote(sessionId, cmd, electronAPI, 5000)
  if (!output) return []

  return output
    .split('\n')
    .filter((line) => line.trim() && !line.includes('<none>'))
    .map((line) => {
      const [name, size] = line.split('|')
      return {
        text: name,
        displayText: name,
        type: 'hint' as const,
        description: size,
        priority: 85,
        matchPart: '',
        restPart: name
      }
    })
}

/**
 * 获取 PM2 进程列表
 */
export async function getPM2Processes(
  sessionId: string,
  electronAPI: any
): Promise<CompletionItem[]> {
  if (!sessionId || !electronAPI) return []

  const cmd = `pm2 jlist 2>/dev/null`
  const output = await executeRemote(sessionId, cmd, electronAPI, 5000)
  if (!output) return []

  try {
    const processes = JSON.parse(output)
    return processes.map((proc: any) => ({
      text: proc.name,
      displayText: proc.name,
      type: 'hint' as const,
      description: `${proc.pm2_env?.status || 'unknown'} (pid: ${proc.pid})`,
      priority: 90,
      matchPart: '',
      restPart: proc.name
    }))
  } catch {
    return []
  }
}

/**
 * 获取 Git 分支列表
 */
export async function getGitBranches(
  sessionId: string,
  electronAPI: any
): Promise<CompletionItem[]> {
  if (!sessionId || !electronAPI) return []

  const cmd = `git branch -a --format="%(refname:short)|%(objectname:short)" 2>/dev/null`
  const output = await executeRemote(sessionId, cmd, electronAPI, 3000)
  if (!output) return []

  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [name, commit] = line.split('|')
      const isRemote = name.startsWith('origin/')
      return {
        text: name,
        displayText: name,
        type: 'hint' as const,
        description: isRemote ? `远程分支 (${commit})` : `本地分支 (${commit})`,
        priority: isRemote ? 70 : 90,
        matchPart: '',
        restPart: name
      }
    })
}

/**
 * 获取 Git 远程仓库列表
 */
export async function getGitRemotes(
  sessionId: string,
  electronAPI: any
): Promise<CompletionItem[]> {
  if (!sessionId || !electronAPI) return []

  const cmd = `git remote -v 2>/dev/null | grep '(push)' | awk '{print $1}'`
  const output = await executeRemote(sessionId, cmd, electronAPI, 3000)
  if (!output) return []

  const remotes = [...new Set(output.split('\n').filter((r) => r.trim()))]
  return remotes.map((name) => ({
    text: name,
    displayText: name,
    type: 'hint' as const,
    description: '远程仓库',
    priority: 90,
    matchPart: '',
    restPart: name
  }))
}
