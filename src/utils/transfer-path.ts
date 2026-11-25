/**
 * 文件传输路径工具：本地路径（Windows / POSIX）与远程 POSIX 路径的拼接、返回上级，
 * 以及远程文件名落到本地磁盘前的安全检查。SFTP 页面和终端文件面板共用。
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export const isWindowsLocalPath = (value: string): boolean =>
  WINDOWS_DRIVE.test(value) || value.startsWith('\\\\') || value.includes('\\')

const localSeparator = (value: string): string => (isWindowsLocalPath(value) ? '\\' : '/')

/**
 * 规范化本地路径：Windows 下统一使用反斜杠、盘符根目录保留结尾的 \（`C:` → `C:\`），
 * 去掉多余的分隔符；UNC 路径保留开头的 \\。
 */
export const normalizeLocalPath = (value: string): string => {
  const input = value.trim()
  if (!input) return input
  if (!isWindowsLocalPath(input)) {
    const collapsed = input.replace(/\/+/g, '/')
    return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed
  }

  const unc = /^[\\/]{2}/.test(input)
  const body = input.replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/^\\/, '')
  if (unc) {
    return `\\\\${body.replace(/\\$/, '')}`
  }
  if (/^[a-zA-Z]:\\?$/.test(body)) {
    return `${body.slice(0, 2).toUpperCase()}\\`
  }
  const trimmed = body.replace(/\\$/, '')
  return WINDOWS_DRIVE.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed
}

/** 是否为本地根目录（`C:\`、`/` 或 UNC 共享根 `\\server\share`） */
export const isLocalRoot = (value: string): boolean => {
  const normalized = normalizeLocalPath(value)
  if (normalized === '/') return true
  if (/^[A-Z]:\\$/.test(normalized)) return true
  if (normalized.startsWith('\\\\')) {
    return normalized.slice(2).split('\\').filter(Boolean).length <= 2
  }
  return false
}

/** 本地路径的上一级；已经是根目录时返回原路径 */
export const parentLocalPath = (value: string): string => {
  const normalized = normalizeLocalPath(value)
  if (!normalized || isLocalRoot(normalized)) return normalized
  const separator = localSeparator(normalized)
  const index = normalized.lastIndexOf(separator)
  if (separator === '/') {
    return index <= 0 ? '/' : normalized.slice(0, index)
  }
  const parent = normalized.slice(0, index)
  return normalizeLocalPath(/^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent)
}

export const joinLocalPath = (dirPath: string, name: string): string => {
  const normalized = normalizeLocalPath(dirPath)
  const separator = localSeparator(normalized)
  return normalized.endsWith(separator) ? `${normalized}${name}` : `${normalized}${separator}${name}`
}

/** 本地路径所在盘符（`D:`），非 Windows 盘符路径返回空字符串 */
export const localDriveOf = (value: string): string => {
  const match = normalizeLocalPath(value).match(/^([A-Z]):/)
  return match ? `${match[1]}:` : ''
}

export const joinRemotePath = (dirPath: string, name: string): string =>
  `${dirPath.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/') || '/'

export const parentRemotePath = (value: string): string => {
  const trimmed = value.replace(/\/+$/, '')
  if (!trimmed) return '/'
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

/**
 * 远程文件名是否可以安全地作为本地文件名使用。
 * 远程（Linux）文件名可以包含 \ : 等字符，在 Windows 上会被当作路径分隔符或
 * NTFS 备用数据流，导致写到目标目录之外。
 */
export const unsafeLocalFileNameReason = (name: string): string | undefined => {
  if (!name || name === '.' || name === '..') return '文件名无效'
  if (/[\\/]/.test(name)) return '文件名包含路径分隔符'
  if (/[\x00-\x1f]/.test(name)) return '文件名包含控制字符'
  if (/[<>:"|?*]/.test(name)) return '文件名包含 Windows 不允许的字符（< > : " | ? *）'
  if (/[ .]$/.test(name)) return '文件名以空格或点结尾，Windows 无法保存'
  if (WINDOWS_RESERVED.test(name)) return '文件名是 Windows 保留名称'
  return undefined
}

/**
 * 新建或重命名时的名称检查（本地或远程），不允许借助名称移动到其它目录。
 */
export const invalidEntryNameReason = (name: string): string | undefined => {
  const trimmed = name.trim()
  if (!trimmed) return '名称不能为空'
  if (trimmed === '.' || trimmed === '..') return '名称无效'
  if (/[\\/]/.test(trimmed)) return '名称不能包含 / 或 \\'
  if (/[\x00-\x1f]/.test(trimmed)) return '名称不能包含控制字符'
  return undefined
}
