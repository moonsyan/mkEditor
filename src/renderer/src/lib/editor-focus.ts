/**
 * 判定是否应把焦点还给编辑器。
 * - 焦点已回落页面主体 → 恢复；
 * - 焦点在侧栏行/大纲按钮/菜单按钮等应用自有可聚焦元素上 → 也恢复
 *   （否则点完文件后行元素持有焦点，打字无反应）；
 * - 焦点在输入控件（搜索框、快捷键录入器等）→ 不抢占。
 */
export const shouldRestoreEditorFocus = (
  activeElement: Element | null,
  body: Element,
): boolean => {
  if (!activeElement || activeElement === body) return true
  const el = activeElement as HTMLElement
  if (typeof el.closest === 'function' && el.closest('input, textarea, select, [contenteditable="true"]')) {
    return false
  }
  return true
}
