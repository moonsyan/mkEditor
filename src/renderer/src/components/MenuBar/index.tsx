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
    { label: '关闭标签页', shortcut: 'Ctrl+W', action: 'closeTab' },
    { label: '关闭其他标签页', action: 'closeOtherTabs' },
    { label: '关闭全部标签页', action: 'closeAllTabs' },
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
    { label: '查找', shortcut: 'Ctrl+F', action: 'find' },
    { label: '替换', shortcut: 'Ctrl+H', action: 'replace' },
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
  /** D2：当前菜单是否由点击打开（悬停打开的菜单，点击标题=钉住而非关闭） */
  const openByClickRef = useRef(false)
  /** D3：当前打开菜单的触发按钮（窗口尺寸变化时按新位置重算下拉坐标） */
  const triggerRef = useRef<HTMLElement | null>(null)

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

  // D3：窗口尺寸变化时按触发按钮的新位置重算下拉坐标
  // （fixed 定位不随窗口移动，不重算会悬在旧位置）
  useEffect(() => {
    if (!openKey) return
    const recompute = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setDdStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left })
    }
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [openKey])

  const handleItemClick = useCallback(
    (key: string, item: MenuItemDef) => {
      setOpenKey(null)
      if (item.action) onAction(item.action)
    },
    [onAction],
  )

  /** 打开菜单时计算下拉位置（fixed 定位，避免被 workspace overflow 裁剪） */
  const openMenu = useCallback((key: string, trigger: HTMLElement, byClick = false) => {
    triggerRef.current = trigger
    const rect = trigger.getBoundingClientRect()
    setDdStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left })
    openByClickRef.current = byClick
    setOpenKey(key)
  }, [])

  const handleMenuKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (event.key === 'Escape') {
      setOpenKey(null)
      return
    }
    if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    // 键盘打开按"点击打开"处理：再次 Enter/空格可关闭
    openMenu(key, event.currentTarget, true)
  }

  return (
    <div className="menubar" ref={barRef}>
      {Object.keys(menus).map((key) => (
        <div
          key={key}
          className="menu-entry"
          onMouseEnter={(event) => {
            const trigger = event.currentTarget.querySelector('button')
            if (trigger) openMenu(key, trigger)
          }}
        >
          <button
            type="button"
            className={`menu-item ${openKey === key ? 'open' : ''}`}
            aria-expanded={openKey === key}
            aria-haspopup="menu"
            onClick={(event) => {
              if (openKey === key) {
                // D2：悬停打开的菜单，点击标题=钉住（保持打开）；
                // 点击打开的菜单，再点=关闭
                if (openByClickRef.current) setOpenKey(null)
              } else {
                openMenu(key, event.currentTarget, true)
              }
            }}
            onKeyDown={(event) => handleMenuKeyDown(event, key)}
          >
          {MENU_LABELS[key]}
          </button>
          {openKey === key && (
            <div className="dropdown show" style={ddStyle} role="menu">
            {menus[key].map((item, i) =>
              item.separator ? (
                <div key={i} className="dd-sep" />
              ) : (
                <button
                  type="button"
                  key={i}
                  className="dd-item"
                  role="menuitem"
                  onClick={() => handleItemClick(key, item)}
                >
                  <span className="dd-label">{item.label}</span>
                  {item.shortcut && <span className="sc">{item.shortcut}</span>}
                </button>
              ),
            )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
