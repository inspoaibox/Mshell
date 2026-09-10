const SCRIPT_MARKER_PREFIX = 'mshell-script-done'
const TOKEN_PATTERN = /^[a-f0-9-]{16,64}$/i

export function createScriptRunToken(): string {
  return crypto.randomUUID()
}

export function buildInteractiveScriptCommand(scriptPath: string, token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error('脚本运行标记无效')
  if (!/^~\/\.mshell\/scripts\/'[^'\r\n]+'$/.test(scriptPath)) {
    throw new Error('脚本路径无效')
  }
  return [
    `bash ${scriptPath}`,
    'mshell_status=$?',
    `printf '\\n\\033]777;${SCRIPT_MARKER_PREFIX};${token};%s\\007' "$mshell_status"`
  ].join('; ')
}

export function findScriptCompletion(output: string, token: string): number | null {
  if (!TOKEN_PATTERN.test(token)) return null
  const marker = `\x1b]777;${SCRIPT_MARKER_PREFIX};${token};`
  const markerIndex = output.lastIndexOf(marker)
  if (markerIndex < 0) return null
  const statusStart = markerIndex + marker.length
  const statusEnd = output.indexOf('\x07', statusStart)
  if (statusEnd < 0) return null
  const status = output.slice(statusStart, statusEnd)
  return /^\d{1,3}$/.test(status) ? Number(status) : null
}

export function appendScriptOutputBuffer(current: string, chunk: string, maxLength = 2048): string {
  const combined = current + chunk
  return combined.length > maxLength ? combined.slice(-maxLength) : combined
}
