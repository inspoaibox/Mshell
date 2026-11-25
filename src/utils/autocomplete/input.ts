export const shellQuote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'"

export const quoteCompletionPath = (path: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(path)) return path
  if (path === '~') return '~'
  if (path.startsWith('~/')) return '~/' + shellQuote(path.slice(2))
  return shellQuote(path)
}

/** Small lexical scanner for completion; it never evaluates expansions. */
export function completionInput(input: string) {
  const words: string[] = []
  let current = '',
    start = 0,
    quote = '',
    escaped = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else current += char
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) {
      if (i > start) words.push(current)
      current = ''
      start = i + 1
    } else current += char
  }
  words.push(current)
  return { words, current, start, rawCurrent: input.slice(start), quote, escaped }
}

export function isSingleLineCommand(value: string) {
  return !!value.trim() && !/[\x00-\x1f\x7f\u2028\u2029]/.test(value)
}
