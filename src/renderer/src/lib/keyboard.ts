export const isImeComposing = (event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean =>
  event.isComposing || event.keyCode === 229

interface ShortcutTargetLike {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** 输入控件内不执行全局编辑命令，但 Milkdown 编辑区仍允许使用应用快捷键。 */
export const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== 'object') return false
  const element = target as ShortcutTargetLike
  if (element.closest?.('.milkdown .editor')) return false
  if (element.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? '')
}
