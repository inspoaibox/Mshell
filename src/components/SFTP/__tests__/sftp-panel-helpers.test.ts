import { describe, expect, it } from 'vitest'
import {
  entryRank,
  isArchiveName,
  isDialogDismissed,
  isDirectoryLike,
  isFileLike,
  LOCAL_ARCHIVE_EXTENSIONS,
  REMOTE_ARCHIVE_EXTENSIONS,
  upsertHistoryItem
} from '../sftp-panel-helpers'

describe('sftp-panel-helpers', () => {
  it('treats symlinks by their target type', () => {
    expect(isDirectoryLike({ type: 'directory' })).toBe(true)
    expect(isDirectoryLike({ type: 'symlink', targetType: 'directory' })).toBe(true)
    expect(isDirectoryLike({ type: 'symlink', targetType: 'file' })).toBe(false)
    expect(isFileLike({ type: 'symlink', targetType: 'file' })).toBe(true)
    expect(isFileLike({ type: 'symlink' })).toBe(false)
    expect(isDirectoryLike({ type: 'symlink' })).toBe(false)
    expect(entryRank({ type: 'symlink', targetType: 'directory' })).toBe(0)
    expect(entryRank({ type: 'file' })).toBe(1)
  })

  it('recognizes dialog dismissal values', () => {
    expect(isDialogDismissed('cancel')).toBe(true)
    expect(isDialogDismissed('close')).toBe(true)
    expect(isDialogDismissed(new Error('x'))).toBe(false)
  })

  it('matches archive extensions case-insensitively', () => {
    expect(isArchiveName('A.TAR.GZ', REMOTE_ARCHIVE_EXTENSIONS)).toBe(true)
    expect(isArchiveName('a.tar.bz2', REMOTE_ARCHIVE_EXTENSIONS)).toBe(true)
    expect(isArchiveName('a.RAR', REMOTE_ARCHIVE_EXTENSIONS)).toBe(true)
    expect(isArchiveName('a.xz', REMOTE_ARCHIVE_EXTENSIONS)).toBe(true)
    expect(isArchiveName('a.rar', LOCAL_ARCHIVE_EXTENSIONS)).toBe(false)
    expect(isArchiveName('notes.txt', REMOTE_ARCHIVE_EXTENSIONS)).toBe(false)
    expect(isArchiveName('.zip', REMOTE_ARCHIVE_EXTENSIONS)).toBe(false)
  })

  it('keeps one history entry per task and terminal state', () => {
    let history: Array<{ id: string; status: string; error?: string }> = []
    history = upsertHistoryItem(history, { id: 'a', status: 'failed', error: 'first' })
    history = upsertHistoryItem(history, { id: 'b', status: 'completed' })
    history = upsertHistoryItem(history, { id: 'a', status: 'failed', error: 'second' })
    expect(history).toEqual([
      { id: 'a', status: 'failed', error: 'second' },
      { id: 'b', status: 'completed' }
    ])

    history = upsertHistoryItem(history, { id: 'a', status: 'completed' })
    expect(history.map((item) => `${item.id}:${item.status}`)).toEqual([
      'a:completed',
      'a:failed',
      'b:completed'
    ])
  })

  it('limits history length', () => {
    let history: Array<{ id: string; status: string }> = []
    for (let index = 0; index < 5; index += 1) {
      history = upsertHistoryItem(history, { id: String(index), status: 'completed' }, 3)
    }
    expect(history.map((item) => item.id)).toEqual(['4', '3', '2'])
  })
})
