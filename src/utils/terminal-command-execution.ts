const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const stripTrailingLineBreaks = (value: string) => normalizeLineEndings(value).replace(/\n+$/, '')

export const buildTerminalExecutePayload = (
  command: string,
  bracketedPasteEnabled = false
) => {
  const normalized = stripTrailingLineBreaks(command)
  if (!normalized) return ''

  if (!normalized.includes('\n')) {
    return `${normalized}\r`
  }

  return `${buildTerminalInsertPayload(normalized, bracketedPasteEnabled)}\r`
}

export const buildTerminalInsertPayload = (text: string, bracketedPasteEnabled: boolean) => {
  const normalized = normalizeLineEndings(text).replace(/\n/g, '\r')
  if (!normalized) return ''

  return bracketedPasteEnabled ? `\x1b[200~${normalized}\x1b[201~` : normalized
}
