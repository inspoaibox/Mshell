/**
 * 终端文件面板的纯逻辑：符号链接分类、传输冲突规划、文本编辑的编码/换行处理等。
 * 不依赖 Vue / Electron，便于单元测试。
 */

export type TransferConflictAction = 'overwrite' | 'skip' | 'rename' | 'resume'

export interface PanelEntryLike {
  name: string
  type: 'file' | 'directory' | 'symlink'
  targetType?: 'file' | 'directory'
  size?: number
}

/** 目录项的实际类别：符号链接按目标类型区分，目标不存在时为 link-broken */
export type PanelEntryKind = 'directory' | 'file' | 'link-directory' | 'link-file' | 'link-broken'

export const getEntryKind = (entry: PanelEntryLike): PanelEntryKind => {
  if (entry.type === 'directory') return 'directory'
  if (entry.type === 'file') return 'file'
  if (entry.targetType === 'directory') return 'link-directory'
  if (entry.targetType === 'file') return 'link-file'
  return 'link-broken'
}

/** 可以进入的目录（含指向目录的链接） */
export const isDirectoryLike = (entry: PanelEntryLike): boolean => {
  const kind = getEntryKind(entry)
  return kind === 'directory' || kind === 'link-directory'
}

/** 可以当作文件预览/编辑/下载的项（含指向文件的链接） */
export const isFileLike = (entry: PanelEntryLike): boolean => {
  const kind = getEntryKind(entry)
  return kind === 'file' || kind === 'link-file'
}

export const isBrokenLink = (entry: PanelEntryLike): boolean =>
  getEntryKind(entry) === 'link-broken'

/** 与后端 sftp:extract 支持的格式保持一致（不区分大小写） */
export const EXTRACTABLE_EXTENSIONS = [
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tar.xz',
  '.tar',
  '.zip',
  '.gz',
  '.bz2',
  '.xz',
  '.rar',
  '.7z'
]

export const isExtractableArchiveName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return EXTRACTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** 去掉压缩扩展名（不区分大小写），用于解压子目录名 */
export const stripArchiveExtension = (name: string): string => {
  const lower = name.toLowerCase()
  const ext = EXTRACTABLE_EXTENSIONS.find((item) => lower.endsWith(item))
  return ext && name.length > ext.length ? name.slice(0, -ext.length) : name
}

/** ElMessageBox 被取消（取消按钮、右上角 X、Esc）时的 reject 值 */
export const isMessageBoxDismissal = (error: unknown): boolean =>
  error === 'cancel' || error === 'close'

export const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

/** 把 `~` / `~/xxx` 展开为 home 目录；`~user` 形式无法确定，原样返回 */
export const expandHomePath = (path: string, homeDir: string): string => {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return `${homeDir.replace(/\/+$/, '')}/${path.slice(2)}`
  return path
}

export const guessHomeDir = (username?: string): string =>
  username && username !== 'root' ? `/home/${username}` : '/root'

// ---------------- 传输冲突规划 ----------------

const splitFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return { base: fileName, extension: '' }
  return { base: fileName.slice(0, dotIndex), extension: fileName.slice(dotIndex) }
}

export const hasNameConflict = (name: string, existingNames: string[], caseSensitive: boolean) => {
  if (caseSensitive) return existingNames.includes(name)
  const normalized = name.toLocaleLowerCase()
  return existingNames.some((existingName) => existingName.toLocaleLowerCase() === normalized)
}

export const generateConflictRename = (
  fileName: string,
  existingNames: string[],
  caseSensitive: boolean
) => {
  const { base, extension } = splitFileName(fileName)
  let index = 1
  let nextName = `${base} (${index})${extension}`
  while (hasNameConflict(nextName, existingNames, caseSensitive)) {
    index += 1
    nextName = `${base} (${index})${extension}`
  }
  return nextName
}

export interface TransferPlanSource {
  /** 目标文件名（来源文件名） */
  name: string
  /** 来源大小，用于判断是否可续传 */
  size: number
}

export interface ExistingTarget {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
}

export interface ConflictPromptContext {
  fileName: string
  targetType: 'file' | 'directory' | 'queued'
  canOverwrite: boolean
  canResume: boolean
  /** 用于生成/校验新名称的已占用名称 */
  takenNames: string[]
  caseSensitive: boolean
  /** 之后还有多少个待处理项（>0 时可提供“全部应用”） */
  remaining: number
}

export interface ConflictDecision {
  action: TransferConflictAction
  /** action 为 rename 时的新名称 */
  fileName?: string
  /** 对后续冲突应用相同操作 */
  applyToAll?: boolean
}

export interface PlannedTransfer<T> {
  source: T
  targetName: string
  resumeFromExisting: boolean
}

/**
 * 依次为每个来源决定目标名称：先根据已存在的目标和本批次已规划的名称检测冲突，
 * 冲突时调用 ask 询问（可“全部应用”）。全部决定后再开始传输，避免边传边问。
 */
export const planTransfers = async <T extends TransferPlanSource>(
  sources: T[],
  existing: ExistingTarget[],
  caseSensitive: boolean,
  ask: (context: ConflictPromptContext) => Promise<ConflictDecision>
): Promise<{ planned: PlannedTransfer<T>[]; skipped: T[] }> => {
  const planned: PlannedTransfer<T>[] = []
  const skipped: T[] = []
  const plannedNames: string[] = []
  const existingNames = existing.map((item) => item.name)
  let remembered: TransferConflictAction | null = null

  const findExisting = (name: string) =>
    existing.find((item) =>
      caseSensitive
        ? item.name === name
        : item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]
    const target = findExisting(source.name)
    const queued = hasNameConflict(source.name, plannedNames, caseSensitive)

    if (!target && !queued) {
      planned.push({ source, targetName: source.name, resumeFromExisting: false })
      plannedNames.push(source.name)
      continue
    }

    const targetType: ConflictPromptContext['targetType'] = queued
      ? 'queued'
      : target?.type === 'directory'
        ? 'directory'
        : 'file'
    const canOverwrite = targetType === 'file'
    const canResume =
      canOverwrite && target !== undefined && target.size > 0 && target.size < source.size
    const takenNames = [...existingNames, ...plannedNames]

    let decision: ConflictDecision | null = null
    if (remembered === 'skip') decision = { action: 'skip' }
    else if (remembered === 'rename') decision = { action: 'rename' }
    else if (remembered === 'overwrite' && canOverwrite) decision = { action: 'overwrite' }
    else if (remembered === 'resume' && canResume) decision = { action: 'resume' }

    if (!decision) {
      decision = await ask({
        fileName: source.name,
        targetType,
        canOverwrite,
        canResume,
        takenNames,
        caseSensitive,
        remaining: sources.length - index - 1
      })
      if (decision.applyToAll) remembered = decision.action
    }

    if (decision.action === 'skip') {
      skipped.push(source)
      continue
    }

    if (decision.action === 'rename') {
      const newName =
        decision.fileName && !hasNameConflict(decision.fileName, takenNames, caseSensitive)
          ? decision.fileName
          : generateConflictRename(source.name, takenNames, caseSensitive)
      planned.push({ source, targetName: newName, resumeFromExisting: false })
      plannedNames.push(newName)
      continue
    }

    // 覆盖或续传只对已存在的普通文件有效；其余情况（目录、同批重名）不允许
    if (!canOverwrite || (decision.action === 'resume' && !canResume)) {
      skipped.push(source)
      continue
    }

    planned.push({
      source,
      targetName: source.name,
      resumeFromExisting: decision.action === 'resume'
    })
    plannedNames.push(source.name)
  }

  return { planned, skipped }
}

// ---------------- 文本预览 / 编辑 ----------------

/** 文本中包含 NUL 字符时视为二进制 */
export const looksBinaryText = (text: string): boolean => text.includes('\u0000')

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const BOM_CODE = 0xfeff

export interface EditableTextFormat {
  /** 保存时使用的换行符 */
  eol: '\n' | '\r\n'
  /** 原文件是否带 UTF-8 BOM */
  bom: boolean
  /** 原文件是否混用了多种换行符（保存时会统一为 eol） */
  mixedEol: boolean
}

export type DecodeEditableResult =
  | { ok: true; text: string; format: EditableTextFormat }
  | { ok: false; reason: string }

/**
 * 把文件字节解码为可在 textarea 中编辑的文本：
 * - 必须是合法 UTF-8，否则拒绝（避免保存时把非 UTF-8 内容写坏）；
 * - 含 NUL 视为二进制；
 * - 去掉 BOM 并记录；换行统一为 \n，记录原换行风格以便保存时还原。
 */
export const decodeEditableText = (bytes: Uint8Array): DecodeEditableResult => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { ok: false, reason: '文件不是 UTF-8 编码，暂不支持编辑' }
  }
  if (looksBinaryText(text)) {
    return { ok: false, reason: '二进制文件不支持在线编辑' }
  }

  const bom = text.charCodeAt(0) === BOM_CODE
  if (bom) text = text.slice(1)

  const crlfCount = (text.match(/\r\n/g) || []).length
  const loneLfCount = (text.match(/(?<!\r)\n/g) || []).length
  const loneCrCount = (text.match(/\r(?!\n)/g) || []).length
  const eol: '\n' | '\r\n' = crlfCount > loneLfCount ? '\r\n' : '\n'
  const styles = [crlfCount, loneLfCount, loneCrCount].filter((count) => count > 0).length

  return {
    ok: true,
    text: text.replace(/\r\n?/g, '\n'),
    format: { eol, bom, mixedEol: styles > 1 }
  }
}

/** 把编辑器内容（\n 换行）按原文件格式还原为要写回的字符串 */
export const encodeEditedText = (text: string, format: EditableTextFormat): string => {
  const normalized = text.replace(/\r\n?/g, '\n')
  const withEol = format.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
  return format.bom ? String.fromCharCode(BOM_CODE) + withEol : withEol
}
