import { describe, expect, it } from 'vitest'
import { sortSnippetsPinnedFirst } from './snippet-order'

describe('sortSnippetsPinnedFirst', () => {
  it('puts recently pinned snippets first and preserves the order of other snippets', () => {
    const snippets = [
      { id: 'first' },
      { id: 'older-pin', pinnedAt: '2026-09-10T10:00:00.000Z' },
      { id: 'second' },
      { id: 'newer-pin', pinnedAt: '2026-09-11T10:00:00.000Z' }
    ]

    expect(sortSnippetsPinnedFirst(snippets).map((snippet) => snippet.id)).toEqual([
      'newer-pin',
      'older-pin',
      'first',
      'second'
    ])
    expect(snippets.map((snippet) => snippet.id)).toEqual([
      'first',
      'older-pin',
      'second',
      'newer-pin'
    ])
  })

  it('treats invalid pinned timestamps as unpinned', () => {
    const snippets = [{ id: 'invalid', pinnedAt: 'invalid' }, { id: 'valid', pinnedAt: '2026-09-11T10:00:00.000Z' }]

    expect(sortSnippetsPinnedFirst(snippets).map((snippet) => snippet.id)).toEqual([
      'valid',
      'invalid'
    ])
  })
})
