import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'

/**
 * 传输记录接口
 */
export interface TransferRecord {
  id: string
  type: 'upload' | 'download'
  localPath: string
  remotePath: string
  totalSize: number
  transferred: number
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  updatedAt: string
  connectionId: string
  checksum?: string // 文件校验和
}

const RESUMABLE_STATUSES: TransferRecord['status'][] = ['pending', 'active', 'paused', 'failed']

/**
 * TransferRecordManager - 管理传输记录，支持断点续传
 */
export class TransferRecordManager {
  private recordsPath: string
  private records: Map<string, TransferRecord>
  private initPromise: Promise<void> | null = null
  /** 所有写盘操作串行执行的链 */
  private writeChain: Promise<void> = Promise.resolve()
  /** 已排队但尚未开始的保存；期间的新修改会被合并进这一次保存 */
  private queuedSave: Promise<void> | null = null

  constructor(recordsPath?: string) {
    this.recordsPath = recordsPath || join(app.getPath('userData'), 'transfer-records.json')
    this.records = new Map()
  }

  /**
   * 初始化（幂等：多次调用共享同一次加载）
   */
  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.load()
    }
    return this.initPromise
  }

  /** 确保记录已从磁盘加载，避免在加载前写盘覆盖已有记录 */
  private async ready(): Promise<void> {
    await this.initialize()
  }

  private async load(): Promise<void> {
    let sourcePath = this.recordsPath
    // 上次在 tmp 写完、rename 前崩溃时，主文件可能缺失
    if (!existsSync(sourcePath) && existsSync(`${this.recordsPath}.tmp`)) {
      sourcePath = `${this.recordsPath}.tmp`
    }
    if (!existsSync(sourcePath)) {
      return
    }

    let content: string
    try {
      content = await fs.readFile(sourcePath, 'utf-8')
    } catch (error) {
      console.error('Failed to read transfer records:', error)
      return
    }

    let data: unknown
    try {
      data = JSON.parse(content)
    } catch (error) {
      // 不要静默丢弃：把损坏的文件备份下来，再从空记录开始
      const backupPath = `${this.recordsPath}.corrupt-${Date.now()}`
      console.error(`Transfer records file is corrupt, backing up to ${backupPath}:`, error)
      await fs.rename(sourcePath, backupPath).catch((renameError) => {
        console.error('Failed to back up corrupt transfer records:', renameError)
      })
      this.records = new Map()
      return
    }

    if (!Array.isArray(data)) {
      return
    }

    let changed = sourcePath !== this.recordsPath
    for (const record of data as TransferRecord[]) {
      if (!record || typeof record.id !== 'string') continue
      const normalizedRecord = { ...record }
      if (normalizedRecord.status === 'active') {
        normalizedRecord.status = 'paused'
        normalizedRecord.updatedAt = new Date().toISOString()
        changed = true
      }
      this.records.set(normalizedRecord.id, normalizedRecord)
    }

    if (changed) {
      await this.save()
    }
  }

  /**
   * 保存记录到文件。
   * 写盘串行化：同一时刻只有一个写操作；已有排队未开始的保存时直接复用它（合并多次修改）。
   */
  private save(): Promise<void> {
    if (this.queuedSave) {
      return this.queuedSave
    }
    const run = this.writeChain.then(async () => {
      // 从这里开始的新修改需要另一次保存
      this.queuedSave = null
      await this.writeToDisk()
    })
    this.queuedSave = run
    this.writeChain = run.catch(() => {})
    return run
  }

  /** 原子写入：先写 .tmp 再 rename 覆盖，避免进程崩溃/并发导致 JSON 损坏 */
  private async writeToDisk(): Promise<void> {
    const tmpPath = `${this.recordsPath}.tmp`
    try {
      const data = Array.from(this.records.values())
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
      try {
        await fs.rename(tmpPath, this.recordsPath)
      } catch (error: any) {
        // Windows 上目标文件被占用（杀毒软件等）时 rename 可能失败，退回直接写入
        if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'EBUSY') {
          await fs.writeFile(this.recordsPath, JSON.stringify(data, null, 2), 'utf-8')
          await fs.unlink(tmpPath).catch(() => {})
        } else {
          throw error
        }
      }
    } catch (error) {
      console.error('Failed to save transfer records:', error)
    }
  }

  /** 等待所有已排队的写盘完成（测试与退出时使用） */
  async flush(): Promise<void> {
    await this.writeChain
  }

  /**
   * 创建传输记录
   */
  async createRecord(record: Omit<TransferRecord, 'createdAt' | 'updatedAt'>): Promise<TransferRecord> {
    await this.ready()
    const now = new Date().toISOString()
    const fullRecord: TransferRecord = {
      ...record,
      createdAt: now,
      updatedAt: now
    }

    this.records.set(record.id, fullRecord)
    await this.save()
    return fullRecord
  }

  /**
   * 更新传输记录
   */
  async updateRecord(id: string, updates: Partial<TransferRecord>): Promise<void> {
    await this.ready()
    const record = this.records.get(id)
    if (!record) {
      throw new Error(`Transfer record not found: ${id}`)
    }

    const updated = {
      ...record,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    this.records.set(id, updated)
    await this.save()
  }

  /**
   * 云同步原样写入传输记录
   */
  async syncPut(record: TransferRecord): Promise<void> {
    if (!record?.id) return
    await this.ready()
    this.records.set(record.id, record)
    await this.save()
  }

  /**
   * 云同步删除传输记录（不存在时忽略）
   */
  async syncRemove(id: string): Promise<void> {
    await this.ready()
    if (!this.records.delete(id)) return
    await this.save()
  }

  /**
   * 获取传输记录
   */
  getRecord(id: string): TransferRecord | undefined {
    return this.records.get(id)
  }

  /**
   * 获取所有记录
   */
  getAllRecords(): TransferRecord[] {
    return Array.from(this.records.values())
  }

  /**
   * 获取未完成的传输
   */
  getIncompleteTransfers(): TransferRecord[] {
    return Array.from(this.records.values()).filter(
      record => RESUMABLE_STATUSES.includes(record.status)
    )
  }

  /**
   * 获取指定连接的未完成传输
   */
  getIncompleteTransfersByConnection(connectionId: string): TransferRecord[] {
    return this.getIncompleteTransfers().filter(
      record => record.connectionId === connectionId
    )
  }

  /**
   * 删除传输记录
   */
  async deleteRecord(id: string): Promise<void> {
    await this.ready()
    this.records.delete(id)
    await this.save()
  }

  /**
   * 清理已完成的记录（保留最近100条）
   */
  async cleanupCompletedRecords(): Promise<void> {
    await this.ready()
    // 已完成与已取消的记录都不可恢复，一起按时间保留最近 100 条
    const completed = Array.from(this.records.values())
      .filter(r => r.status === 'completed' || r.status === 'cancelled')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // 保留最近100条，删除其余的
    if (completed.length > 100) {
      const toDelete = completed.slice(100)
      for (const record of toDelete) {
        this.records.delete(record.id)
      }
      await this.save()
    }
  }

  /**
   * 清理失败的记录（超过7天）
   */
  async cleanupFailedRecords(): Promise<void> {
    await this.ready()
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const toDelete: string[] = []

    for (const [id, record] of this.records) {
      if (record.status === 'failed') {
        const updatedTime = new Date(record.updatedAt).getTime()
        if (updatedTime < sevenDaysAgo) {
          toDelete.push(id)
        }
      }
    }

    for (const id of toDelete) {
      this.records.delete(id)
    }

    if (toDelete.length > 0) {
      await this.save()
    }
  }
}

// 导出单例
export const transferRecordManager = new TransferRecordManager()
