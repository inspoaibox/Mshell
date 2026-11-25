export interface TerminalInputSnapshot {
  text: string
  cursor: number
  revision: number
  ready: boolean
  valid: boolean
}

/** Tracks only known shell edits. Unknown escape sequences invalidate the draft. */
export class TerminalInputState {
  private chars: string[] = []
  cursor = 0
  revision = 0
  ready = false
  valid = false
  cwd = ''
  private prompt = ''
  private oscDirectory = ''

  setDirectory(path: string) {
    if (path.startsWith('/') && !/[\x00-\x1f\x7f]/.test(path)) this.cwd = this.oscDirectory = path
  }

  snapshot(): TerminalInputSnapshot {
    return {
      text: this.chars.join(''),
      cursor: this.cursor,
      revision: this.revision,
      ready: this.ready,
      valid: this.valid
    }
  }

  get canSuggest() {
    return this.ready && this.valid && this.cursor === this.chars.length
  }

  reset(ready = false) {
    this.chars = []
    this.cursor = 0
    this.ready = ready
    this.valid = ready
    this.revision++
  }

  invalidate() {
    this.valid = false
    this.revision++
  }

  replace(text: string) {
    this.chars = Array.from(text)
    this.cursor = this.chars.length
    this.valid = !/[\x00-\x1f\x7f]/.test(text)
    this.revision++
  }

  observePrompt(line: string) {
    // Exclude continuation prompts and REPL prompts such as >>>.
    if (!/[#$%❯➜]\s*$/.test(line) || /[\r\n]/.test(line)) return
    if (this.ready && this.valid && this.chars.length) return
    if (this.ready && !this.valid && line !== this.prompt) return
    this.prompt = line
    const path =
      line.match(/^[^\r\n]*?@[^:]+:([/~].*?)[#$%]\s*$/)?.[1] ||
      line.match(/^([/~].*?)\s*[#$%❯]\s*$/)?.[1]
    this.cwd = this.oscDirectory || path?.trim() || ''
    this.reset(true)
  }

  feed(data: string): string | undefined {
    if (data === '\r' || data === '\n') {
      const command = this.ready && this.valid ? this.chars.join('') : undefined
      this.reset(false)
      return command
    }
    if (data === '\x03') {
      this.reset(false)
      return
    }
    if (!this.ready || !this.valid) return
    this.revision++
    switch (data) {
      case '\x7f':
      case '\b':
        if (this.cursor > 0) this.chars.splice(--this.cursor, 1)
        return
      case '\x1b[3~':
        this.chars.splice(this.cursor, 1)
        return
      case '\x1b[D':
      case '\x1bOD':
      case '\x02':
        this.cursor = Math.max(0, this.cursor - 1)
        return
      case '\x1b[C':
      case '\x1bOC':
      case '\x06':
        this.cursor = Math.min(this.chars.length, this.cursor + 1)
        return
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
      case '\x01':
        this.cursor = 0
        return
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
      case '\x05':
        this.cursor = this.chars.length
        return
      case '\x15':
        this.chars.splice(0, this.cursor)
        this.cursor = 0
        return
      case '\x0b':
        this.chars.splice(this.cursor)
        return
      case '\x17': {
        const before = this.chars.slice(0, this.cursor).join('')
        const length = Array.from(before.match(/\s*\S+\s*$/)?.[0] || '').length
        this.chars.splice(this.cursor - length, length)
        this.cursor -= length
        return
      }
      case '\x0c':
        return
    }
    if (/[\x00-\x1f\x7f]/.test(data)) {
      this.invalidate()
      return
    }
    const inserted = Array.from(data)
    this.chars.splice(this.cursor, 0, ...inserted)
    this.cursor += inserted.length
  }
}

export const matchesInputSnapshot = (
  current: TerminalInputSnapshot,
  expected: TerminalInputSnapshot
) =>
  current.ready &&
  current.valid &&
  current.revision === expected.revision &&
  current.text === expected.text
