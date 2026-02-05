import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname, basename } from 'path'
import { createWriteStream, createReadStream } from 'fs'
import archiver from 'archiver'
import unzipper from 'unzipper'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * 注册本地文件系统 IPC 处理器
 */
export function registerFsHandlers() {
  // 读取目录
  ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const files = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dirPath, entry.name)
          let stats
          try {
            stats = await fs.stat(fullPath)
          } catch {
            stats = { size: 0, mtime: new Date() }
          }
          
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: stats.size || 0,
            mtime: stats.mtime || new Date()
          }
        })
      )
      
      return { success: true, files }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 创建目录
  ipcMain.handle('fs:createDirectory', async (_event, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除文件或目录
  ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)
      if (stats.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true })
      } else {
        await fs.unlink(filePath)
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 重命名文件或目录
  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    try {
      await fs.rename(oldPath, newPath)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取文件信息
  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)
      return {
        success: true,
        stats: {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          mtime: stats.mtime,
          ctime: stats.ctime
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 压缩单个文件或目录
  ipcMain.handle('fs:compress', async (_event, sourcePath: string, archivePath: string) => {
    try {
      const stats = await fs.stat(sourcePath)
      const ext = archivePath.toLowerCase()
      
      if (ext.endsWith('.zip')) {
        await compressToZip([sourcePath], archivePath)
      } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
        await compressToTarGz([sourcePath], archivePath)
      } else if (ext.endsWith('.tar')) {
        await compressToTar([sourcePath], archivePath)
      } else {
        // 默认使用 zip
        await compressToZip([sourcePath], archivePath)
      }
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 压缩多个文件或目录
  ipcMain.handle('fs:compressMultiple', async (_event, sourcePaths: string[], archivePath: string) => {
    try {
      const ext = archivePath.toLowerCase()
      
      if (ext.endsWith('.zip')) {
        await compressToZip(sourcePaths, archivePath)
      } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
        await compressToTarGz(sourcePaths, archivePath)
      } else if (ext.endsWith('.tar')) {
        await compressToTar(sourcePaths, archivePath)
      } else {
        await compressToZip(sourcePaths, archivePath)
      }
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 解压文件
  ipcMain.handle('fs:extract', async (_event, archivePath: string, targetDir: string) => {
    try {
      const ext = archivePath.toLowerCase()
      
      // 确保目标目录存在
      await fs.mkdir(targetDir, { recursive: true })
      
      if (ext.endsWith('.zip')) {
        await extractZip(archivePath, targetDir)
      } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz') || ext.endsWith('.tar') || ext.endsWith('.gz')) {
        await extractTar(archivePath, targetDir)
      } else if (ext.endsWith('.7z')) {
        // 7z 需要系统安装 7z 命令
        await execAsync(`7z x "${archivePath}" -o"${targetDir}" -y`)
      } else {
        return { success: false, error: '不支持的压缩格式' }
      }
      
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}

// 压缩为 ZIP
async function compressToZip(sourcePaths: string[], archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    
    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))
    
    archive.pipe(output)
    
    for (const sourcePath of sourcePaths) {
      const name = basename(sourcePath)
      const stats = require('fs').statSync(sourcePath)
      
      if (stats.isDirectory()) {
        archive.directory(sourcePath, name)
      } else {
        archive.file(sourcePath, { name })
      }
    }
    
    archive.finalize()
  })
}

// 压缩为 tar.gz
async function compressToTarGz(sourcePaths: string[], archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } })
    
    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))
    
    archive.pipe(output)
    
    for (const sourcePath of sourcePaths) {
      const name = basename(sourcePath)
      const stats = require('fs').statSync(sourcePath)
      
      if (stats.isDirectory()) {
        archive.directory(sourcePath, name)
      } else {
        archive.file(sourcePath, { name })
      }
    }
    
    archive.finalize()
  })
}

// 压缩为 tar
async function compressToTar(sourcePaths: string[], archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath)
    const archive = archiver('tar')
    
    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))
    
    archive.pipe(output)
    
    for (const sourcePath of sourcePaths) {
      const name = basename(sourcePath)
      const stats = require('fs').statSync(sourcePath)
      
      if (stats.isDirectory()) {
        archive.directory(sourcePath, name)
      } else {
        archive.file(sourcePath, { name })
      }
    }
    
    archive.finalize()
  })
}

// 解压 ZIP
async function extractZip(archivePath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(archivePath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on('close', () => resolve())
      .on('error', (err) => reject(err))
  })
}

// 解压 tar/tar.gz
async function extractTar(archivePath: string, targetDir: string): Promise<void> {
  const tar = require('tar')
  await tar.extract({
    file: archivePath,
    cwd: targetDir
  })
}
