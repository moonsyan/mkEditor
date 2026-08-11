import { describe, expect, it } from 'vitest'
import { isEditableShortcutTarget, isImeComposing } from './keyboard'

describe('输入法键盘保护', () => {
  it('合成中的按键不应触发全局快捷键', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 0 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 83 })).toBe(false)
  })
})

describe('全局快捷键作用域', () => {
  it('跳过普通表单与可编辑标题', () => {
    expect(
      isEditableShortcutTarget({ tagName: 'INPUT', closest: () => null } as unknown as EventTarget),
    ).toBe(true)
    expect(
      isEditableShortcutTarget({ isContentEditable: true, closest: () => null } as unknown as EventTarget),
    ).toBe(true)
  })

  it('允许 Milkdown 编辑器接收快捷键', () => {
    expect(
      isEditableShortcutTarget({ tagName: 'DIV', closest: () => ({}) } as unknown as EventTarget),
    ).toBe(false)
  })
})
