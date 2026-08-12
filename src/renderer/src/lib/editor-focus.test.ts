import { describe, expect, it } from 'vitest'
import { shouldRestoreEditorFocus } from './editor-focus'

describe('编辑器焦点恢复', () => {
  it('焦点回落至页面主体后恢复编辑器', () => {
    const body = {} as HTMLElement
    expect(shouldRestoreEditorFocus(body, body)).toBe(true)
    expect(shouldRestoreEditorFocus(null, body)).toBe(true)
  })

  it('用户已进入其他控件时不抢占焦点', () => {
    const body = {} as HTMLElement
    const input = {} as HTMLInputElement
    expect(shouldRestoreEditorFocus(input, body)).toBe(false)
  })
})
