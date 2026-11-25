import { translateLegacy } from './legacy'

const SKIP_SELECTOR =
  'input, textarea, [contenteditable="true"], pre, code, .xterm, .terminal-view, .terminal-panel'

function preserveWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] || ''
  const trailing = original.match(/\s*$/)?.[0] || ''
  return `${leading}${translated.trim()}${trailing}`
}

function translateAttributes(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[title], [placeholder], [aria-label]').forEach((el) => {
    for (const name of ['title', 'placeholder', 'aria-label']) {
      const value = el.getAttribute(name)
      if (!value) continue
      const translated = translateLegacy(value)
      if (translated !== value) el.setAttribute(name, translated)
    }
  })
}

function translateTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current: Node | null = walker.nextNode()
  while (current) {
    const parent = current.parentElement
    if (parent && !parent.closest(SKIP_SELECTOR) && /[\u4e00-\u9fff]/.test(current.nodeValue || '')) {
      nodes.push(current as Text)
    }
    current = walker.nextNode()
  }
  for (const node of nodes) {
    const original = node.nodeValue || ''
    const translated = translateLegacy(original.trim())
    if (translated !== original.trim()) node.nodeValue = preserveWhitespace(original, translated)
  }
}

export function installDomTranslator(root: HTMLElement) {
  const run = () => {
    translateAttributes(root)
    translateTextNodes(root)
  }
  const observer = new MutationObserver(() => queueMicrotask(run))
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  const localeListener = () => queueMicrotask(run)
  window.addEventListener('mshell-locale-changed', localeListener)
  run()
  return () => {
    observer.disconnect()
    window.removeEventListener('mshell-locale-changed', localeListener)
  }
}
