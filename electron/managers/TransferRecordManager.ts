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
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  connectionId: string
  checksum?: string // 文件校验和
}

/**
 * TransferRecordManager - 管理传输记录，支持断点续传
 */
export class TransferRecordManager {
  private recordsPath: string
  private records: Map<string, TransferRecord>

  constructor() {
    const userDataPath = app.getPath('userData')
    this.recordsPath = join(userDataPath, 'transfer-records.json')
    this.records = new Map()
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    try {
      if (existsSync(this.recordsPath)) {
        const content = await fs.readFile(this.recordsPath, 'utf-8')
        const data = JSON.parse(content)
        
        if (Array.isArray(data)) {
          for (const record of data) {
            this.records.set(record.id, record)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load transfer records:', error)
      this.records = new Map()
    }
  }

  /**
   * 保存记录到文件
   */
  private async save(): Promise<void> {
    try {
      const data = Array.from(this.records.values())
      await fs.writeFile(this.recordsPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save transfer records:', error)
    }
  }

  /**
   * 创建传输记录
   */
  async createRecord(record: Omit<TransferRecord, 'createdAt' | 'updatedAt'>): Promise<TransferRecord> {
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
      record => record.status === 'pending' || record.status === 'paused' || record.status === 'active'
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
    this.records.delete(id)
    await this.save()
  }

  /**
   * 清理已完成的记录（保留最近100条）
   */
  async cleanupCompletedRecords(): Promise<void> {
    const completed = Array.from(this.records.values())
      .filter(r => r.status === 'completed')
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
