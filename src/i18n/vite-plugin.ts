import type { Plugin } from 'vite'
import { baseParse, NodeTypes } from '@vue/compiler-dom'

const HAN = /[\u4e00-\u9fff]/

// These attributes are rendered as user-facing strings by Vue/Element Plus.
// Keeping the list explicit avoids translating data attributes, values, or
// user-provided content at build time.
const TRANSLATABLE_ATTRIBUTES = new Set([
  'title',
  'content',
  'label',
  'placeholder',
  'aria-label',
  'start-placeholder',
  'end-placeholder',
  'range-separator',
  'confirm-button-text',
  'cancel-button-text',
  'empty-text',
  'loading-text',
  'no-match-text',
  'no-data-text'
])

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
      if (value) {
        replacements.push({
          start: node.loc.start.offset,
          end: node.loc.end.offset,
          value: `${leading}{{ $legacyT(${json(value)}) }}${trailing}`
        })
      }
    }
    if (node.type === NodeTypes.ELEMENT && node.props) {
      for (const prop of node.props) {
        if (
          prop.type !== NodeTypes.ATTRIBUTE ||
          !prop.value ||
          !TRANSLATABLE_ATTRIBUTES.has(prop.name) ||
          !HAN.test(prop.value.content)
        ) continue

        const attrStart = prop.loc.start.offset
        const attrEnd = prop.loc.end.offset
        replacements.push({
          start: attrStart,
          end: attrEnd,
          value: `:${prop.name}='$legacyT(${json(prop.value.content)})'`
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
