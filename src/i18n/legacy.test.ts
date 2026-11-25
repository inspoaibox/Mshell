import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'
import { translateLegacy } from './legacy'

describe('legacy template translation', () => {
  afterEach(() => {
    i18n.global.locale.value = 'zh-CN'
  })

  it('follows the global composition locale when translating static UI text', () => {
    i18n.global.locale.value = 'en-US'
    expect(translateLegacy('保存设置')).toBe('Save settings')
    expect(translateLegacy('设置')).toBe('Settings')
    expect(translateLegacy('关于')).toBe('About')
    expect(translateLegacy('自定义非商用许可')).toBe('Custom non-commercial license')

    i18n.global.locale.value = 'zh-CN'
    expect(translateLegacy('Save settings')).toBe('保存设置')
    expect(translateLegacy('Settings')).toBe('设置')
    expect(translateLegacy('About')).toBe('关于')
    expect(translateLegacy('Custom non-commercial license')).toBe('自定义非商用许可')
  })
})
