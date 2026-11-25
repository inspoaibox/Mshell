import { describe, expect, it, vi } from 'vitest'
import {
  decodeEditableText,
  encodeEditedText,
  expandHomePath,
  getEntryKind,
  isDirectoryLike,
  isExtractableArchiveName,
  isFileLike,
  isMessageBoxDismissal,
  looksBinaryText,
  planTransfers,
  stripArchiveExtension,
  type ConflictDecision,
  type ConflictPromptContext
} from '../terminal-file-panel-utils'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('symlink classification', () => {
  it('classifies entries by link target', () => {
    expect(getEntryKind({ name: 'a', type: 'directory' })).toBe('directory')
    expect(getEntryKind({ name: 'a', type: 'file' })).toBe('file')
    expect(getEntryKind({ name: 'a', type: 'symlink', targetType: 'directory' })).toBe(
      'link-directory'
    )
    expect(getEntryKind({ name: 'a', type: 'symlink', targetType: 'file' })).toBe('link-file')
    expect(getEntryKind({ name: 'a', type: 'symlink' })).toBe('link-broken')
  })

  it('treats links as directories or files by target', () => {
    expect(isDirectoryLike({ name: 'a', type: 'symlink', targetType: 'directory' })).toBe(true)
    expect(isFileLike({ name: 'a', type: 'symlink', targetType: 'directory' })).toBe(false)
    expect(isFileLike({ name: 'a', type: 'symlink', targetType: 'file' })).toBe(true)
    expect(isFileLike({ name: 'a', type: 'symlink' })).toBe(false)
    expect(isDirectoryLike({ name: 'a', type: 'symlink' })).toBe(false)
  })
})

describe('archive helpers', () => {
  it('matches backend-supported extensions case-insensitively', () => {
    expect(isExtractableArchiveName('A.TAR.GZ')).toBe(true)
    expect(isExtractableArchiveName('x.Zip')).toBe(true)
    expect(isExtractableArchiveName('x.7z')).toBe(true)
    expect(isExtractableArchiveName('x.txt')).toBe(false)
    expect(stripArchiveExtension('Backup.TAR.GZ')).toBe('Backup')
    expect(stripArchiveExtension('a.tgz')).toBe('a')
    expect(stripArchiveExtension('.zip')).toBe('.zip')
  })
})

describe('misc helpers', () => {
  it('recognises message box dismissals', () => {
    expect(isMessageBoxDismissal('cancel')).toBe(true)
    expect(isMessageBoxDismissal('close')).toBe(true)
    expect(isMessageBoxDismissal(new Error('x'))).toBe(false)
  })

  it('expands home paths', () => {
    expect(expandHomePath('~', '/home/u')).toBe('/home/u')
    expect(expandHomePath('~/a/b', '/home/u/')).toBe('/home/u/a/b')
    expect(expandHomePath('~other/a', '/home/u')).toBe('~other/a')
    expect(expandHomePath('/etc', '/home/u')).toBe('/etc')
  })

  it('detects binary text by NUL bytes', () => {
    expect(looksBinaryText('abc\u0000def')).toBe(true)
    expect(looksBinaryText('plain')).toBe(false)
  })
})

describe('decodeEditableText / encodeEditedText', () => {
  it('round-trips LF files unchanged', () => {
    const source = 'a\nb\n'
    const result = decodeEditableText(utf8(source))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe(source)
    expect(result.format).toEqual({ eol: '\n', bom: false, mixedEol: false })
    expect(encodeEditedText(result.text, result.format)).toBe(source)
  })

  it('normalizes CRLF for editing and restores it on save', () => {
    const source = 'line1\r\nline2\r\n'
    const result = decodeEditableText(utf8(source))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe('line1\nline2\n')
    expect(result.format.eol).toBe('\r\n')
    expect(encodeEditedText(result.text + 'line3', result.format)).toBe('line1\r\nline2\r\nline3')
  })

  it('keeps the absence of a trailing newline', () => {
    const result = decodeEditableText(utf8('a\r\nb'))
    if (!result.ok) throw new Error('decode failed')
    expect(encodeEditedText(result.text, result.format)).toBe('a\r\nb')
  })

  it('preserves the UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('中文\r\n')])
    const result = decodeEditableText(bytes)
    if (!result.ok) throw new Error('decode failed')
    expect(result.text).toBe('中文\n')
    expect(result.format.bom).toBe(true)
    const saved = encodeEditedText(result.text, result.format)
    expect(saved.charCodeAt(0)).toBe(0xfeff)
    expect(saved.slice(1)).toBe('中文\r\n')
  })

  it('flags mixed line endings', () => {
    const result = decodeEditableText(utf8('a\r\nb\nc\n\nd'))
    if (!result.ok) throw new Error('decode failed')
    expect(result.format.mixedEol).toBe(true)
    expect(result.format.eol).toBe('\n')
  })

  it('refuses non UTF-8 content', () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const result = decodeEditableText(gbk)
    expect(result).toEqual({ ok: false, reason: '文件不是 UTF-8 编码，暂不支持编辑' })
  })

  it('refuses binary content', () => {
    const result = decodeEditableText(new Uint8Array([0x61, 0x00, 0x62]))
    expect(result.ok).toBe(false)
  })
})

describe('planTransfers', () => {
  const src = (name: string, size = 10) => ({ name, size })

  it('plans non-conflicting files without asking', async () => {
    const ask = vi.fn()
    const result = await planTransfers([src('a'), src('b')], [], true, ask)
    expect(ask).not.toHaveBeenCalled()
    expect(result.planned.map((item) => item.targetName)).toEqual(['a', 'b'])
  })

  it('asks for conflicts and applies the choice to all when requested', async () => {
    const ask = vi.fn(
      async (_context: ConflictPromptContext): Promise<ConflictDecision> => ({
        action: 'skip',
        applyToAll: true
      })
    )
    const result = await planTransfers(
      [src('a'), src('b'), src('c')],
      [
        { name: 'a', type: 'file', size: 1 },
        { name: 'b', type: 'file', size: 1 }
      ],
      true,
      ask
    )
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0][0].remaining).toBe(2)
    expect(result.skipped.map((item) => item.name)).toEqual(['a', 'b'])
    expect(result.planned.map((item) => item.targetName)).toEqual(['c'])
  })

  it('auto-renames subsequent conflicts with rename-all', async () => {
    const ask = vi.fn(
      async (_context: ConflictPromptContext): Promise<ConflictDecision> => ({
        action: 'rename',
        fileName: 'a (1).txt',
        applyToAll: true
      })
    )
    const result = await planTransfers(
      [src('a.txt'), src('a.txt')],
      [{ name: 'a.txt', type: 'file', size: 1 }],
      true,
      ask
    )
    expect(ask).toHaveBeenCalledTimes(1)
    expect(result.planned.map((item) => item.targetName)).toEqual(['a (1).txt', 'a (2).txt'])
  })

  it('re-asks when an overwrite-all choice cannot apply to a directory', async () => {
    const decisions: ConflictDecision[] = [
      { action: 'overwrite', applyToAll: true },
      { action: 'skip' }
    ]
    const ask = vi.fn(async (_context: ConflictPromptContext) => decisions.shift()!)
    const result = await planTransfers(
      [src('f'), src('d'), src('g')],
      [
        { name: 'f', type: 'file', size: 1 },
        { name: 'd', type: 'directory', size: 0 },
        { name: 'g', type: 'file', size: 1 }
      ],
      true,
      ask
    )
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1][0].targetType).toBe('directory')
    expect(result.planned.map((item) => item.targetName)).toEqual(['f', 'g'])
    expect(result.skipped.map((item) => item.name)).toEqual(['d'])
  })

  it('offers resume only for smaller existing files', async () => {
    const ask = vi.fn(
      async (_context: ConflictPromptContext): Promise<ConflictDecision> => ({ action: 'resume' })
    )
    const result = await planTransfers(
      [src('a', 100)],
      [{ name: 'a', type: 'file', size: 40 }],
      true,
      ask
    )
    expect(ask.mock.calls[0][0].canResume).toBe(true)
    expect(result.planned[0].resumeFromExisting).toBe(true)
  })

  it('detects case-insensitive conflicts for local targets', async () => {
    const ask = vi.fn(
      async (_context: ConflictPromptContext): Promise<ConflictDecision> => ({ action: 'skip' })
    )
    await planTransfers(
      [src('README.md')],
      [{ name: 'readme.md', type: 'file', size: 1 }],
      false,
      ask
    )
    expect(ask).toHaveBeenCalledTimes(1)
  })
})
