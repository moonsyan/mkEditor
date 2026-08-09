/**
 * 可自定义快捷键：动作清单、默认键位、组合键解析
 * 仅全局层快捷键可自定义；撤销/粗体等编辑器内置键位由 Milkdown keymap 处理
 */

export interface ShortcutActionDef {
  id: string
  label: string
}

/** 可自定义的快捷键动作（设置面板按此顺序展示） */
export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  { id: 'new', label: '新建文档' },
  { id: 'open', label: '打开文件' },
  { id: 'openFolder', label: '打开文件夹' },
  { id: 'save', label: '保存' },
  { id: 'saveAs', label: '另存为' },
  { id: 'find', label: '查找' },
  { id: 'replace', label: '查找替换' },
  { id: 'strike', label: '删除线' },
  { id: 'h1', label: '标题 1' },
  { id: 'h2', label: '标题 2' },
  { id: 'h3', label: '标题 3' },
  { id: 'text', label: '恢复为正文' },
  { id: 'toggleSidebar', label: '切换侧栏' },
  { id: 'outline', label: '大纲面板' },
  { id: 'preview', label: '分栏预览' },
  { id: 'zoomIn', label: '放大编辑区' },
  { id: 'zoomOut', label: '缩小编辑区' },
  { id: 'focusMode', label: '专注模式' },
]

/** 快捷键映射：动作 id → 组合键字符串（如 'Ctrl+Shift+O'），空串表示未绑定 */
export type ShortcutMap = Record<string, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  new: 'Ctrl+N',
  open: 'Ctrl+O',
  openFolder: 'Ctrl+Shift+O',
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  find: 'Ctrl+F',
  replace: 'Ctrl+H',
  strike: 'Ctrl+Shift+X',
  h1: 'Ctrl+1',
  h2: 'Ctrl+2',
  h3: 'Ctrl+3',
  text: 'Ctrl+0',
  toggleSidebar: 'Ctrl+J',
  outline: 'Ctrl+Shift+L',
  preview: 'Ctrl+Shift+P',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  focusMode: 'F11',
}

/** 把 KeyboardEvent 归一化为组合键字符串（与 DEFAULT_SHORTCUTS 同格式） */
export function comboFromEvent(e: KeyboardEvent): string {
  // 单独按下修饰键不产生组合
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k === '=' || k === '+') k = '='
  else if (k === '-' || k === '_') k = '-'
  else if (k.length === 1) k = k.toUpperCase()
  parts.push(k)
  return parts.join('+')
}

/** 合并默认表（补齐缺失动作，丢弃未知动作） */
export function mergeShortcuts(saved: unknown): ShortcutMap {
  const result: ShortcutMap = { ...DEFAULT_SHORTCUTS }
  if (saved && typeof saved === 'object') {
    for (const def of SHORTCUT_ACTIONS) {
      const v = (saved as Record<string, unknown>)[def.id]
      if (typeof v === 'string') result[def.id] = v
    }
  }
  return result
}
