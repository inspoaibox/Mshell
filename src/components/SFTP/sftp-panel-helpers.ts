/**
 * SFTP 文件传输页面使用的纯逻辑工具（便于单测）。
 */

export interface RemoteEntryLike {
  type: 'file' | 'directory' | 'symlink'
  targetType?: 'file' | 'directory'
}

/** 目录，或者指向目录的符号链接 */
export const isDirectoryLike = (entry: RemoteEntryLike): boolean =>
  entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory')

/** 普通文件，或者指向文件的符号链接 */
export const isFileLike = (entry: RemoteEntryLike): boolean =>
  entry.type === 'file' || (entry.type === 'symlink' && entry.targetType === 'file')

/** 排序时目录（含指向目录的链接）排在前面 */
export const entryRank = (entry: RemoteEntryLike): number => (isDirectoryLike(entry) ? 0 : 1)

/** ElMessageBox 被取消（按钮）或关闭（X / Esc）时的 reject 值 */
export const isDialogDismissed = (error: unknown): boolean => error === 'cancel' || error === 'close'

/** 远程 sftp:extract 支持的格式 */
export const REMOTE_ARCHIVE_EXTENSIONS = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tgz',
  '.tar',
  '.zip',
  '.gz',
  '.bz2',
  '.xz',
  '.rar',
  '.7z'
]

/** 本地 fs:extract 支持的格式 */
export const LOCAL_ARCHIVE_EXTENSIONS = ['.tar.gz', '.tgz', '.tar', '.zip', '.gz', '.7z']

export const isArchiveName = (name: string, extensions: string[]): boolean => {
  const lower = name.toLowerCase()
  return extensions.some((ext) => lower.endsWith(ext) && lower.length > ext.length)
}

export interface HistoryEntryLike {
  id: string
  status: string
}

/**
 * 把一条传输历史放到最前面。同一任务的同一终态只保留一条（重复上报时用新数据替换旧的），
 * 超出 limit 的旧记录被丢弃。返回新数组。
 */
export const upsertHistoryItem = <T extends HistoryEntryLike>(
  history: T[],
  item: T,
  limit = 100
): T[] => {
  const rest = history.filter((entry) => !(entry.id === item.id && entry.status === item.status))
  return [item, ...rest].slice(0, limit)
}
