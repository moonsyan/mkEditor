import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'

/** 最近打开的磁盘文件 */
export interface RecentFile {
  path: string
  name: string
}

interface MenuBarProps {
  onAction: (action: string) => void
  /** 最近打开的文件（渲染在文件菜单内） */
  recentFiles?: RecentFile[]
}

interface MenuItemDef {
  label: string
  shortcut?: string
  action?: string
  separator?: boolean
}

const MENU_DEFS: Record<string, MenuItemDef[]> = {
  file: [
    { label: '新建文档', shortcut: 'Ctrl+N', action: 'new' },
    { label: '新建窗口', action: 'newWindow' },
    { label: '打开文件', shortcut: 'Ctrl+O', action: 'open' },
    { label: '打开文件夹', shortcut: 'Ctrl+Shift+O', action: 'openFolder' },
    { label: '全工作区搜索…', action: 'wsSearch' },
    { label: '保存', shortcut: 'Ctrl+S', action: 'save' },
    { label: '另存为', shortcut: 'Ctrl+Shift+S', action: 'saveAs' },
    { label: '', separator: true },
    { label: '偏好设置…', action: 'settings' },
    { label: '', separator: true },
    { label: '导出 PDF', action: 'exportPdf' },
    { label: '导出 HTML', action: 'exportHtml' },
    { label: '导出 Markdown', action: 'exportMarkdown' },
    { label: '导出 Word / EPUB…（pandoc）', action: 'exportPandoc' },
    { label: '', separator: true },
    { label: '图片管理…', action: 'images' },
  ],
  edit: [
    { label: '撤销', shortcut: 'Ctrl+Z', action: 'undo' },
    { label: '重做', shortcut: 'Ctrl+Shift+Z', action: 'redo' },
    { label: '', separator: true },
    { label: '粗体', shortcut: 'Ctrl+B', action: 'bold' },
    { label: '斜体', shortcut: 'Ctrl+I', action: 'italic' },
    { label: '删除线', shortcut: 'Ctrl+Shift+X', action: 'strike' },
    { label: '插入链接', shortcut: 'Ctrl+K', action: 'insertLink' },
    { label: '插入图片', shortcut: 'Ctrl+Alt+I', action: 'insertImage' },
    { label: '', separator: true },
    { label: '查找替换', shortcut: 'Ctrl+H', action: 'find' },
  ],
  para: [
    { label: '标题 1', shortcut: 'Ctrl+1', action: 'h1' },
    { label: '标题 2', shortcut: 'Ctrl+2', action: 'h2' },
    { label: '标题 3', shortcut: 'Ctrl+3', action: 'h3' },
    { label: '正文', shortcut: 'Ctrl+0', action: 'text' },
    { label: '', separator: true },
    { label: '无序列表', action: 'ul' },
    { label: '有序列表', action: 'ol' },
    { label: '任务列表', action: 'task' },
    { label: '', separator: true },
    { label: '引用', action: 'quote' },
    { label: '代码块', action: 'code' },
    { label: '表格', action: 'table' },
    { label: '表格加行（下方）', action: 'tableRow' },
    { label: '表格加列（右侧）', action: 'tableCol' },
    { label: '删除选中单元格', action: 'tableDel' },
    { label: '分割线', action: 'hr' },
  ],
  view: [
    { label: '切换侧栏', shortcut: 'Ctrl+J', action: 'toggleSidebar' },
    { label: '专注模式', shortcut: 'F11', action: 'toggleFocus' },
    { label: '分栏预览', shortcut: 'Ctrl+Shift+P', action: 'togglePreview' },
    { label: '', separator: true },
    { label: '打字机模式', action: 'typewriter' },
    { label: '大纲面板', shortcut: 'Ctrl+Shift+L', action: 'outline' },
    { label: '', separator: true },
    { label: '放大', shortcut: 'Ctrl+=', action: 'zoomIn' },
    { label: '缩小', shortcut: 'Ctrl+-', action: 'zoomOut' },
    { label: '重置缩放', action: 'zoomReset' },
  ],
  help: [
    { label: '快捷键一览', action: 'shortcuts' },
    { label: 'Markdown 语法', action: 'markdown' },
    { label: '写作统计…', action: 'stats' },
    { label: '', separator: true },
    { label: '关于 MarkdownSoft', action: 'about' },
  ],
}

const MENU_LABELS: Record<string, string> = {
  file: '文件',
  edit: '编辑',
  para: '段落',
  view: '视图',
  help: '帮助',
}

export function MenuBar({ onAction, recentFiles = [] }: MenuBarProps): JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [ddStyle, setDdStyle] = useState<CSSProperties>({})
  const barRef = useRef<HTMLDivElement>(null)

  /** 实际菜单定义：把最近文件动态注入文件菜单（"打开文件夹"之后） */
  const menus = useMemo(() => {
    const defs: Record<string, MenuItemDef[]> = { ...MENU_DEFS }
    if (recentFiles.length > 0) {
      const fileItems = [...MENU_DEFS.file]
      // 找到"打开文件夹"的位置，在其后插入最近文件
      const idx = fileItems.findIndex((i) => i.action === 'openFolder')
      const recent: MenuItemDef[] = [
        { label: '', separator: true },
        ...recentFiles.map((r) => ({
          label: r.name,
          action: `openRecent:${r.path}`,
        })),
      ]
      fileItems.splice(idx + 1, 0, ...recent)
      defs.file = fileItems
    }
    return defs
  }, [recentFiles])

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenKey(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleItemClick = useCallback(
    (key: string, item: MenuItemDef) => {
      setOpenKey(null)
      if (item.action) onAction(item.action)
    },
    [onAction],
  )

  /** 打开菜单时计算下拉位置（fixed 定位，避免被 workspace overflow 裁剪） */
  const openMenu = useCallback((key: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect()
    setDdStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left })
    setOpenKey(key)
  }, [])

  return (
    <div className="menubar" ref={barRef}>
      {Object.keys(menus).map((key) => (
        <div
          key={key}
          className={`menu-item ${openKey === key ? 'open' : ''}`}
          onClick={(e) => {
            const el = e.currentTarget
            if (openKey === key) setOpenKey(null)
            else openMenu(key, el)
          }}
          onMouseEnter={(e) => {
            if (openKey && openKey !== key) openMenu(key, e.currentTarget)
          }}
        >
          {MENU_LABELS[key]}
          {openKey === key && (
            <div className="dropdown show" style={ddStyle}>
            {menus[key].map((item, i) =>
              item.separator ? (
                <div key={i} className="dd-sep" />
              ) : (
                <div
                  key={i}
                  className="dd-item"
                  onClick={() => handleItemClick(key, item)}
                >
                  <span className="dd-label">{item.label}</span>
                  {item.shortcut && <span className="sc">{item.shortcut}</span>}
                </div>
              ),
            )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
