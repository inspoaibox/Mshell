import { isSingleLineCommand, completionInput } from './autocomplete/input'
import { matchesInputSnapshot, type TerminalInputSnapshot } from './terminal-input-state'

export function parseAICommand(response: string): string {
  const text = response.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('AI 未返回有效的命令对象，请重试')
  }
  const command = (parsed as { command?: unknown } | null)?.command
  if (typeof command !== 'string' || !isSingleLineCommand(command))
    throw new Error('AI 建议必须是单行命令，不能包含换行或控制字符')
  const trimmed = command.trim()
  const syntax = completionInput(trimmed)
  if (
    syntax.quote ||
    syntax.escaped ||
    /(?:&&|\|\||[|<>])\s*$/.test(trimmed) ||
    trimmed.length > 4096
  )
    throw new Error('AI 命令不完整，请重试或手动编辑')
  if (!/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*[A-Za-z_./][A-Za-z0-9_./+-]*(?:\s|$)/.test(trimmed))
    throw new Error('AI 建议不是可识别的 Shell 命令，请重试')
  return trimmed
}

export function commandNeedsConfirmation(command: string) {
  return (
    /(?:^|[\s;&|()])(?:sudo\s+)?(?:rm|rmdir|mv|dd|mkfs\S*|wipefs|shred|reboot|shutdown|poweroff|kill|killall|pkill|chmod|chown|iptables|nft|ufw|firewall-cmd|eval)\b/i.test(
      command
    ) ||
    /\b(?:docker|podman)\s+(?:\S+\s+)?(?:rm|prune|stop|restart|kill)\b/i.test(command) ||
    /\b(?:systemctl|service)\b.*\b(?:stop|restart|disable|mask)\b/i.test(command) ||
    /\b(?:apt(?:-get)?|yum|dnf|apk)\b.*\b(?:remove|purge|del|autoremove)\b/i.test(command) ||
    /\b(?:bash|sh|zsh|python\d*|perl|ruby|node)\s+.*-[ce]\b/i.test(command) ||
    /\b(?:sed|perl)\b.*\s-i\b|\btee\b|(?:^|[^<])>{1,2}|\|\s*(?:ba)?sh\b|\$\(|`/.test(command)
  )
}

export function formatCommandExplanation(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

export async function executeSuggestedCommand(
  command: string,
  expected: TerminalInputSnapshot,
  context: {
    snapshot: () => TerminalInputSnapshot | undefined
    isCurrent: () => boolean
    confirm: () => Promise<unknown>
    write: () => boolean
  }
): Promise<boolean> {
  if (!isSingleLineCommand(command) || !context.isCurrent()) return false
  if (commandNeedsConfirmation(command)) await context.confirm()
  const current = context.snapshot()
  if (!current || !matchesInputSnapshot(current, expected) || !context.isCurrent()) return false
  return context.write()
}
