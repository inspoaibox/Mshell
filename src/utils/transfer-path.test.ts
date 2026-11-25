import { describe, expect, it } from 'vitest'
import {
  invalidEntryNameReason,
  isLocalRoot,
  joinLocalPath,
  joinRemotePath,
  localDriveOf,
  normalizeLocalPath,
  parentLocalPath,
  parentRemotePath,
  unsafeLocalFileNameReason
} from './transfer-path'

describe('transfer path helpers', () => {
  it('keeps the drive root when going up on Windows', () => {
    expect(parentLocalPath('C:\\Users')).toBe('C:\\')
    expect(parentLocalPath('C:\\Users\\me\\')).toBe('C:\\Users')
    expect(parentLocalPath('C:\\')).toBe('C:\\')
    expect(parentLocalPath('c:')).toBe('C:\\')
    expect(parentLocalPath('D:/work/proj')).toBe('D:\\work')
  })

  it('handles UNC and POSIX paths', () => {
    expect(parentLocalPath('\\\\server\\share\\dir')).toBe('\\\\server\\share')
    expect(isLocalRoot('\\\\server\\share')).toBe(true)
    expect(parentLocalPath('/home/me')).toBe('/home')
    expect(parentLocalPath('/home')).toBe('/')
    expect(parentLocalPath('/')).toBe('/')
  })

  it('joins and normalizes paths', () => {
    expect(normalizeLocalPath('C:')).toBe('C:\\')
    expect(joinLocalPath('C:', 'a.txt')).toBe('C:\\a.txt')
    expect(joinLocalPath('C:\\', 'a.txt')).toBe('C:\\a.txt')
    expect(joinLocalPath('D:/x', 'a.txt')).toBe('D:\\x\\a.txt')
    expect(joinLocalPath('/tmp', 'a.txt')).toBe('/tmp/a.txt')
    expect(localDriveOf('d:/x')).toBe('D:')
    expect(joinRemotePath('/', 'a')).toBe('/a')
    expect(joinRemotePath('/var/', 'a')).toBe('/var/a')
    expect(parentRemotePath('/var/log/')).toBe('/var')
    expect(parentRemotePath('/var')).toBe('/')
  })

  it('rejects remote names that escape the local directory', () => {
    expect(unsafeLocalFileNameReason('..\\..\\Startup\\x.bat')).toBeTruthy()
    expect(unsafeLocalFileNameReason('a:stream')).toBeTruthy()
    expect(unsafeLocalFileNameReason('..')).toBeTruthy()
    expect(unsafeLocalFileNameReason('CON')).toBeTruthy()
    expect(unsafeLocalFileNameReason('report 2026.tar.gz')).toBeUndefined()
    expect(invalidEntryNameReason('sub/name')).toBeTruthy()
    expect(invalidEntryNameReason('new name')).toBeUndefined()
  })
})
