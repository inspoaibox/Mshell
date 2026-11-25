/**
 * AI Prompt Templates
 * 定义不同 AI 操作的提示词模板
 */

import type { AIAction } from '../../src/types/ai'

export interface PromptTemplate {
  action: AIAction
  template: string
}

/**
 * 提示词模板映射
 */
export const PROMPT_TEMPLATES: Record<AIAction, PromptTemplate> = {
  write: {
    action: 'write',
    template: `Write code based on this description: {content}

Language: {language}

Return only the code without explanations or markdown code blocks.`
  },

  explain: {
    action: 'explain',
    template: `请作为一名资深开发人员，详细分析并解释以下代码片段的主要功能和目的。

\`\`\`{language}
{content}
\`\`\`
`
  },

  optimize: {
    action: 'optimize',
    template: `Optimize this code:

\`\`\`{language}
{content}
\`\`\`

Return only the optimized code without explanations or markdown code blocks.`
  },

  chat: {
    action: 'chat',
    template: `{content}`
  }
}

/**
 * 命令智能相关的提示词模板
 */
export const COMMAND_INTELLIGENCE_PROMPTS = {
  // 命令纠错
  commandCorrection: `用户输入了一个错误的命令：{wrongCommand}
错误信息：{errorMessage}

请分析这个错误，并提供正确的命令建议。
只返回一行正确的命令，不要任何解释。`,

  // 命令解释
  commandExplain: `请详细解释以下 Linux/Unix 命令的作用和用法：

命令：{command}

请包含：
1. 命令的主要功能
2. 各个参数/选项的含义
3. 使用示例
4. 注意事项（如有）

请用简洁清晰的中文回答。`,

  // 命令生成（# 触发）
  commandGenerate: `你是一个 Linux/Unix 命令行专家。用户想要：{query}

要求：
1. 只返回一行可执行的 shell 命令
2. 不要任何解释、注释或 markdown 格式
3. 不要代码块标记
4. 直接输出命令

命令：`
}

/**
 * 构建提示词
 * @param action AI 操作类型
 * @param content 用户内容
 * @param language 代码语言（可选）
 * @returns 构建好的提示词
 */
export function buildPrompt(action: AIAction, content: string, language?: string): string {
  const template = PROMPT_TEMPLATES[action]
  if (!template) {
    throw new Error(`Unknown action: ${action}`)
  }

  let prompt = template.template

  // 替换变量
  prompt = prompt.replace('{content}', () => content)
  prompt = prompt.replace(/{language}/g, language || 'unknown')

  return prompt
}

/**
 * 移除代码块标记
 * @param code 可能包含代码块标记的代码
 * @returns 清理后的代码
 */
export function removeCodeBlockMarkers(code: string): string {
  // 移除开头的代码块标记（```language 或 ```）
  let cleaned = code.replace(/^```[\w]*\n?/gm, '')

  // 移除结尾的代码块标记
  cleaned = cleaned.replace(/\n?```$/gm, '')

  return cleaned.trim()
}
