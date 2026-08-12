/**
 * 仅当焦点已回落到页面主体时才恢复编辑器，避免覆盖用户刚转入的输入控件。
 */
export const shouldRestoreEditorFocus = (
  activeElement: Element | null,
  body: Element,
): boolean => !activeElement || activeElement === body
