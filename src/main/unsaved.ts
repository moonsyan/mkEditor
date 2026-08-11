import type { WebContents } from 'electron'

/**
 * WebContents 未保存状态存储。
 * 用 WeakMap 替代在 Electron 内部对象上挂载自定义属性（`__unsaved`），
 * 避免 Monkey-Patching 在 Electron 内部结构变更时静默失效。
 */
const unsavedMap = new WeakMap<WebContents, boolean>()

export function setWebContentsUnsaved(wc: WebContents, unsaved: boolean): void {
  unsavedMap.set(wc, unsaved)
}

export function getWebContentsUnsaved(wc: WebContents): boolean {
  return unsavedMap.get(wc) === true
}
