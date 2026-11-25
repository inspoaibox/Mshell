import { registry } from './registry'
import { completionInput, isSingleLineCommand } from './input'
import { loadCompletionHistory } from './history'
import { getRemotePathSuggestions, withCompletionDirectory } from './providers/file-system'
import type { CompletionItem } from './types'

export type CompletionChoice = CompletionItem & {
  command: string
  sourceInput: string
  snippetId?: string
}

export async function getCompletions(
  input: string,
  sessionId: string,
  cwd: string | undefined,
  api: any
): Promise<CompletionChoice[]> {
  if (!input || /[\x00-\x1f\x7f]/.test(input)) return []
  const context = completionInput(input)
  const { words, current, start } = context
  if (context.escaped) return []
  const items: CompletionChoice[] = []
  const whole = (
    text: string,
    type: CompletionItem['type'],
    description?: string,
    snippetId?: string
  ) => {
    if (!isSingleLineCommand(text)) return
    items.push({
      text,
      command: text,
      sourceInput: input,
      type,
      description,
      snippetId,
      matchPart: input,
      restPart: text.startsWith(input) ? text.slice(input.length) : text,
      priority: type === 'history' ? 100 : 80
    })
  }
  const token = (item: CompletionItem) => {
    if (!isSingleLineCommand(item.text)) return
    const directory = item.type === 'path' && /\/['"]?$/.test(item.text)
    const text = item.text + (directory || item.text.endsWith(' ') ? '' : ' ')
    items.push({
      ...item,
      command: input.slice(0, start) + text,
      sourceInput: input,
      matchPart: item.matchPart ?? current,
      restPart: item.restPart ?? item.text.slice(current.length)
    })
  }
  if (words.length === 1 && input.startsWith('/')) {
    const result = await api.snippet?.searchByShortcut?.(input)
    if (result?.success && result.data?.length) {
      result.data.forEach((snippet: any) =>
        whole(snippet.command, 'shortcut', snippet.name, snippet.id)
      )
      return items
    }
  }
  if (!input.startsWith('/')) {
    const history = await loadCompletionHistory()
    history
      .filter((command) => command.startsWith(input) && command !== input)
      .slice(0, 8)
      .forEach((command) => whole(command, 'history'))
  }
  if (words.length === 1 && !context.quote) {
    registry
      .getAllCommandNames()
      .filter((name) => name.startsWith(current) && name !== current)
      .forEach((name) => token({ text: name, type: 'command', priority: 80 }))
    const result = await api.snippet?.getAll?.()
    if (result?.success)
      result.data
        .filter((snippet: any) => snippet.command.startsWith(input) && snippet.command !== input)
        .slice(0, 5)
        .forEach((snippet: any) => whole(snippet.command, 'snippet', snippet.name, snippet.id))
  }
  let def = registry.getCommand(words[0]),
    depth = 0
  for (let i = 1; i < words.length - 1; i++) {
    if (!def?.subcommands?.[words[i]]) break
    def = def.subcommands[words[i]]
    depth++
  }
  if (words.length >= 2 && def) {
    const scopedAPI = withCompletionDirectory(api, cwd)
    const generated =
      (await def
        .generate?.({
          input,
          args: words,
          currentArgIndex: words.length - 1,
          currentArg: current,
          sessionId,
          cwd,
          electronAPI: scopedAPI
        })
        .catch(() => [])) || []
    for (const item of def.options || []) {
      if (item.type === 'subcommand' && words.length - 1 !== depth + 1) continue
      if (item.text.startsWith(current)) token(item)
    }
    generated
      .filter(
        (item) =>
          item.type === 'path' ||
          item.text.startsWith(current) ||
          item.displayText?.startsWith(current)
      )
      .forEach(token)
  }
  if (
    current.includes('/') ||
    current.startsWith('.') ||
    current.startsWith('~') ||
    ['cd', 'ls', 'cat', 'rm', 'cp', 'mv', 'vim', 'nano'].includes(words[words.length - 2])
  ) {
    const paths = await getRemotePathSuggestions(sessionId, current, {
      electronAPI: api,
      cwd,
      foldersOnly: words[0] === 'cd',
      showHidden: true
    })
    paths.forEach(token)
  }
  return [
    ...new Map(
      items
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .map((item) => [item.command, item])
    ).values()
  ].slice(0, 20)
}
