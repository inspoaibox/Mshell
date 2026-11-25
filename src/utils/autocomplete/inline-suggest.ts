/**
 * 内联建议系统 - 类似 Fish Shell 的 autosuggestions
 * 在光标后显示灰色的预览文本
 */

import { registry } from './registry'
import { loadCompletionHistory } from './history'

export interface InlineSuggestion {
  text: string // 完整的建议文本
  ghostText: string // 需要显示的灰色部分（补全部分）
  source: 'history' | 'command' | 'path' | 'ai'
  confidence: number // 置信度 0-100
}

/**
 * 获取内联建议
 * @param input 当前输入
 * @param sessionId 会话ID（用于远程补全）
 */
export async function getInlineSuggestion(
  input: string,
  sessionId?: string
): Promise<InlineSuggestion | null> {
  if (!input || input.length < 2) return null

  // 1. 优先从历史命令中匹配
  const historySuggestion = await getHistorySuggestion(input)
  if (historySuggestion && historySuggestion.confidence >= 80) {
    return historySuggestion
  }

  // 2. 从 Registry 获取命令补全
  const commandSuggestion = await getCommandSuggestion(input, sessionId)
  if (commandSuggestion) {
    return commandSuggestion
  }

  // 3. 返回历史建议（即使置信度较低）
  return historySuggestion
}

/**
 * 从历史命令获取建议
 */
async function getHistorySuggestion(input: string): Promise<InlineSuggestion | null> {
  const history = await loadCompletionHistory()

  // 精确前缀匹配
  const exactMatch = history.find(
    (cmd) => cmd.startsWith(input) && cmd !== input && cmd.length > input.length
  )

  if (exactMatch) {
    return {
      text: exactMatch,
      ghostText: exactMatch.substring(input.length),
      source: 'history',
      confidence: 90
    }
  }

  // 模糊匹配（命令开头相同）
  const words = input.split(/\s+/)
  if (words.length === 1) {
    const fuzzyMatch = history.find((cmd) => {
      const cmdFirstWord = cmd.split(/\s+/)[0]
      return cmdFirstWord.startsWith(input) && cmdFirstWord !== input
    })

    if (fuzzyMatch) {
      return {
        text: fuzzyMatch,
        ghostText: fuzzyMatch.substring(input.length),
        source: 'history',
        confidence: 70
      }
    }
  }

  return null
}

/**
 * 从命令定义获取建议
 */
async function getCommandSuggestion(
  input: string,
  _sessionId?: string
): Promise<InlineSuggestion | null> {
  const words = input.split(/\s+/)
  const cmdName = words[0]

  // 单词命令补全
  if (words.length === 1 && !input.endsWith(' ')) {
    const allCommands = registry.getAllCommandNames()
    const match = allCommands.find((cmd) => cmd.startsWith(cmdName) && cmd !== cmdName)

    if (match) {
      return {
        text: match + ' ',
        ghostText: match.substring(cmdName.length) + ' ',
        source: 'command',
        confidence: 85
      }
    }
  }

  // 多词命令 - 从 Registry 获取子命令/选项
  if (words.length === 2 && input.endsWith(' ')) {
    const def = registry.getCommand(cmdName)
    if (def?.options && def.options.length > 0) {
      // 获取最高优先级的选项
      const topOption = def.options
        .filter((opt) => opt.type === 'subcommand')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]

      if (topOption) {
        return {
          text: input + topOption.text,
          ghostText: topOption.text,
          source: 'command',
          confidence: 60
        }
      }
    }
  }

  return null
}

/**
 * 检查是否应该显示内联建议
 */
export function shouldShowInlineSuggestion(input: string): boolean {
  // 不显示的情况
  if (!input) return false
  if (input.length < 2) return false
  if (input.startsWith('#')) return false // AI 命令模式
  if (input.startsWith('/') || input.trimStart().startsWith('?')) return false
  if (input.includes('\n')) return false

  return true
}
