import { describe, expect, it } from 'vitest'
import { isImeComposing } from './keyboard'

describe('输入法键盘保护', () => {
  it('合成中的按键不应触发全局快捷键', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 0 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 83 })).toBe(false)
  })
})
