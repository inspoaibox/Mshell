import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { baseParse, NodeTypes } from '@vue/compiler-dom'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const translationPath = path.join(sourceRoot, 'i18n', 'template-translations.json')
const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'))
const translatableAttributes = new Set([
  'title', 'content', 'label', 'placeholder', 'aria-label',
  'start-placeholder', 'end-placeholder', 'range-separator',
  'confirm-button-text', 'cancel-button-text', 'empty-text',
  'loading-text', 'no-match-text', 'no-data-text'
])
const han = /[\u4e00-\u9fff]/
const files = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-mobile', '.git'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(vue|ts|js|mjs)$/.test(entry.name)) files.push(full)
  }
}

walk(sourceRoot)

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function isCovered(value) {
  return Boolean(translations[value]) || Object.keys(translations).some((key) => value.startsWith(key))
}

const findings = []
for (const file of files) {
  if (file.includes(`${path.sep}__tests__${path.sep}`) || file.endsWith('.test.ts')) continue
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file)

  if (file.endsWith('.vue')) {
    const templateMatch = source.match(/<template(?:\s[^>]*)?>([\s\S]*)<\/template>(?=\s*(?:<script|<style|$))/)
    if (templateMatch) {
      const template = templateMatch[1]
      try {
        const ast = baseParse(template, { comments: true })
        const visit = (node) => {
          if (node.type === NodeTypes.TEXT && han.test(node.content)) {
            const value = node.content.trim()
            if (value && !isCovered(value)) {
              findings.push({ type: 'template-text', file: relative, line: lineAt(source, templateMatch.index + 1 + node.loc.start.offset), value })
            }
          }
          if (node.type === NodeTypes.ELEMENT) {
            for (const prop of node.props || []) {
              if (prop.type === NodeTypes.ATTRIBUTE && prop.value && translatableAttributes.has(prop.name) && han.test(prop.value.content) && !isCovered(prop.value.content)) {
                findings.push({ type: 'template-attribute', file: relative, line: lineAt(source, templateMatch.index + 1 + prop.loc.start.offset), value: `${prop.name}=${prop.value.content}` })
              }
            }
          }
          for (const child of node.children || []) visit(child)
        }
        for (const node of ast.children) visit(node)
      } catch (error) {
        findings.push({ type: 'parse-error', file: relative, value: error.message })
      }
    }

    const scriptBlocks = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => ({
      content: match[1],
      offset: match.index + match[0].indexOf(match[1])
    }))
    for (const block of scriptBlocks) {
      const messageCall = /(?:ElMessage(?:Box)?|ElNotification)\.(?:success|warning|error|info|confirm)\s*\(\s*(['"`])([\s\S]*?)\1/g
      for (const match of block.content.matchAll(messageCall)) {
        const value = match[2]
        if (han.test(value) && !isCovered(value)) {
          findings.push({ type: 'message-call', file: relative, line: lineAt(source, block.offset + match.index), value })
        }
      }
    }
  }
}

const isNonUiEntry = (key) =>
  key.includes('=>') ||
  key.includes('if [') ||
  key.includes('__MSHELL_ERROR__') ||
  key.startsWith('closeBlockReason(') ||
  key.startsWith('transferConflictDialog?.') ||
  key.startsWith('row.targetType') ||
  key.startsWith('ruleStep ===') ||
  key.startsWith('variable.type ===') ||
  key.startsWith('确认关闭 ？方式：${mode') ||
  key.startsWith('分${') ||
  key.startsWith('小时${') ||
  key.startsWith('{ 0:') ||
  key.startsWith('{ 0:')
const untranslatedValues = Object.entries(translations).filter(([key, value]) => (han.test(value) || key === value) && !isNonUiEntry(key))
const ignoredNonUiValues = Object.entries(translations).filter(([key, value]) => (han.test(value) || key === value) && isNonUiEntry(key))
console.log(`I18n audit: ${files.length} source files, ${findings.length} uncovered UI candidates`)
console.log(`Translation table: ${Object.keys(translations).length} entries, ${untranslatedValues.length} UI values still contain Chinese or are identical (${ignoredNonUiValues.length} code/data entries ignored)`)
for (const finding of findings) console.log(`${finding.type}\t${finding.file}:${finding.line}\t${finding.value}`)
if (untranslatedValues.length) {
  console.log('\nTranslation entries requiring review:')
  for (const [key, value] of untranslatedValues) console.log(`${key} => ${value}`)
}
