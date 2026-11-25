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

    i18n.global.locale.value = 'zh-CN'
    expect(translateLegacy('Save settings')).toBe('保存设置')
  })
})
