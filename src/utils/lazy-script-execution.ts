import { compileScript, type ScriptValues, type ScriptVariable } from './lazy-script-template'
import { appendScriptOutputBuffer, findScriptCompletion } from './terminal-script-execution'

export interface ExecutableScript {
  id: string
  name: string
  fileName: string
  content: string
  type: 'command' | 'shell' | 'steps'
  riskLevel: string
  runMode: string
  variables: ScriptVariable[]
}
export function snapshotScript<T extends ExecutableScript>(script: T, values: ScriptValues) {
  const saved = JSON.parse(JSON.stringify(script)) as T
  const parameters = JSON.parse(JSON.stringify(values)) as ScriptValues
  for (const variable of saved.variables)
    if (variable.type === 'password') {
      delete parameters[variable.name]
      delete variable.defaultValue
    }
  return {
    script: saved,
    values: parameters,
    content:
      script.type === 'steps' ? '' : compileScript(saved.content, parameters, saved.variables),
    sensitive: saved.variables.some((variable) => variable.type === 'password')
  }
}

export function terminalReadinessError(
  instance:
    | {
        echoEnabled: boolean
        terminal: {
          buffer: {
            active: {
              type: string
              baseY: number
              cursorY: number
              getLine: (
                line: number
              ) => { translateToString: (trim: boolean) => string } | undefined
            }
          }
        }
      }
    | undefined
): string | null {
  if (!instance) return '目标终端尚未初始化，请先打开终端'
  if (!instance.echoEnabled) return '目标终端正在等待隐藏输入，请先完成当前操作'
  const buffer = instance.terminal.buffer.active
  if (buffer.type !== 'normal') return '目标终端正在运行 Vim、Nano 或其他全屏程序，请先退出到 Shell'
  const line = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) || ''
  if (!/[#$%>]\s*$/.test(line)) return '未检测到空闲 Shell 提示符，请先结束当前程序并清空输入行'
  return null
}

export function waitForScriptCompletion(options: {
  token: string
  timeout: number
  signal: AbortSignal
  subscribe: (callback: (chunk: string) => void) => () => void
  onDisconnect: (callback: () => void) => () => void
  start: (signal: AbortSignal) => Promise<void>
}): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false
    const startController = new AbortController()
    let buffer = ''
    const releases: Array<() => void> = []
    const finish = (error?: Error, status?: number) => {
      if (settled) return
      settled = true
      startController.abort()
      clearTimeout(timer)
      options.signal.removeEventListener('abort', cancel)
      releases.forEach((release) => release())
      if (error) reject(error)
      else resolve(status!)
    }
    const cancel = () => finish(new Error('已停止等待；已启动的远程脚本请在终端中确认或中断'))
    const timer = setTimeout(
      () => finish(new Error('等待脚本完成超时；远程任务可能仍在运行，请检查终端')),
      options.timeout
    )
    options.signal.addEventListener('abort', cancel, { once: true })
    if (options.signal.aborted) {
      cancel()
      return
    }
    releases.push(
      options.subscribe((chunk) => {
        // Parse before truncating: a completed marker may precede a large prompt/output chunk.
        const status = findScriptCompletion(buffer + chunk, options.token)
        if (status !== null) finish(undefined, status)
        else buffer = appendScriptOutputBuffer(buffer, chunk)
      })
    )
    releases.push(options.onDisconnect(() => finish(new Error('SSH 已断开，无法确认脚本结果'))))
    Promise.resolve()
      .then(() => {
        if (!settled) return options.start(startController.signal)
      })
      .catch((error) => finish(error))
  })
}
