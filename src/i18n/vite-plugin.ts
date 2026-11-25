import type { Plugin } from 'vite'
import { baseParse, NodeTypes } from '@vue/compiler-dom'

const HAN = /[\u4e00-\u9fff]/

function json(value: string): string {
  return JSON.stringify(value)
}

function transformTemplate(template: string): string {
  let ast
  try {
    ast = baseParse(template, { comments: true })
  } catch {
    return template
  }
  const replacements: Array<{ start: number; end: number; value: string }> = []
  const visit = (node: any) => {
    if (node.type === NodeTypes.TEXT && HAN.test(node.content)) {
      const leading = node.content.match(/^\s*/)?.[0] || ''
      const trailing = node.content.match(/\s*$/)?.[0] || ''
      const value = node.content.trim()
      if (value && !value.includes('{{')) {
        replacements.push({
          start: node.loc.start.offset,
          end: node.loc.end.offset,
          value: `${leading}{{ $legacyT(${json(value)}) }}${trailing}`
        })
      }
    }
    if (node.children) node.children.forEach(visit)
  }
  ast.children.forEach(visit)
  let result = template
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`
  }
  return result
}

export function legacyI18nPlugin(): Plugin {
  return {
    name: 'mshell-legacy-i18n',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue')) return null
      const templateMatch = code.match(
        /(<template(?:\s[^>]*)?>)([\s\S]*)(<\/template>)(?=\s*(?:<script|<style|$))/
      )
      if (!templateMatch) return null
      const transformed = transformTemplate(templateMatch[2])
      if (transformed === templateMatch[2]) return null
      return {
        code: code.replace(templateMatch[2], transformed),
        map: null
      }
    }
  }
}
