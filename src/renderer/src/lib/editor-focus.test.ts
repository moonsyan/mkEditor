import { describe, expect, it } from 'vitest'
import { shouldRestoreEditorFocus } from './editor-focus'

const fakeElement = (closestResult: boolean): HTMLElement =>
  ({ closest: () => closestResult }) as unknown as HTMLElement

describe('编辑器焦点恢复', () => {
  it('焦点回落至页面主体后恢复编辑器', () => {
    const body = {} as HTMLElement
    expect(shouldRestoreEditorFocus(body, body)).toBe(true)
    expect(shouldRestoreEditorFocus(null, body)).toBe(true)
  })

  it('用户已进入输入控件时不抢占焦点', () => {
    const body = {} as HTMLElement
    expect(shouldRestoreEditorFocus(fakeElement(true), body)).toBe(false)
  })

  it('焦点在侧栏行/按钮等应用自有元素上时恢复编辑器', () => {
    const body = {} as HTMLElement
    expect(shouldRestoreEditorFocus(fakeElement(false), body)).toBe(true)
  })
})
