import { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react'
import type { DemoFolder } from '../../data/demo-files'
import type { FolderTreeNode } from '../../../../preload/api'
import { parseOutline, type OutlineNode } from '../../lib/outline'
import { isImeComposing } from '../../lib/keyboard'

/** 打开中的文档（含真实文件的磁盘路径） */
export interface OpenFile {
  id: string
  name: string
  /** 磁盘路径（真实文件才有，演示文件为空） */
  path?: string
  /** 侧栏单击打开的临时预览标签；双击或首次修改后转为固定标签 */
  preview?: boolean
}

/** 已打开的工作区文件夹 */
export interface WorkspaceInfo {
  path: string
  name: string
  tree: FolderTreeNode[]
}

interface SidebarProps {
  /** 演示文件树结构 */
  demoTree: DemoFolder[]
  /** 演示文件名映射（id → 显示名） */
  demoFileNames: Record<string, string>
  /** 打开的工作区文件夹（可为空） */
  workspace: WorkspaceInfo | null
  /** 当前打开的所有文件（用于展示树外的外部文件） */
  openFiles: OpenFile[]
  /** 当前激活的文件 ID */
  activeFileId: string
  /** 当前文档 Markdown（用于生成大纲） */
  content: string
  /** 点击演示文件；固定标签由双击触发 */
  onSelectDemoFile: (id: string, pinned: boolean) => void
  /** 点击工作区/磁盘文件（传路径）；固定标签由双击触发 */
  onSelectWorkspaceFile: (path: string, pinned: boolean) => void
  /** 点击大纲标题（index 为标题在文档中的顺序） */
  onOutlineClick: (index: number) => void
  /** 该值变化时自动切到大纲 Tab（用于"视图 → 大纲面板"菜单） */
  focusOutlineTick?: number
  /** 当前光标所在标题索引（大纲跟随高亮，-1 无） */
  activeOutlineIndex?: number
  /** 工作区文件操作（仅工作区模式下有效） */
  onCreateFile?: (dirPath: string) => void
  onRenameFile?: (path: string, newName: string) => void
  onDeleteFile?: (path: string) => void
  /** 拖拽移动文件/文件夹到目标目录（U5） */
  onMoveFile?: (path: string, targetDir: string) => void
  /** 右键在新窗口打开文件（U7） */
  onOpenInNewWindow?: (path: string) => void
  /** 初始折叠键列表（持久化恢复）；null = 无记录，所有文件夹默认折叠 */
  initialCollapsedKeys?: string[] | null
  /** 折叠键变化回调 */
  onCollapsedKeysChange?: (keys: string[]) => void
  /** 当前活动标签页 */
  activeTab?: 'files' | 'outline'
  /** 标签页切换回调 */
  onActiveTabChange?: (tab: 'files' | 'outline') => void
  /**
   * L16：折叠时不卸载组件（保留滚动位置/重命名状态），只缩到宽度 0。
   * 折叠期间用 inert 阻止 Tab 聚焦被裁切的内容。
   */
  collapsed?: boolean
}

/** 统一的树节点模型（演示树与工作区树归一化后渲染） */
interface UiNode {
  key: string
  name: string
  kind: 'folder' | 'file'
  demoId?: string
  path?: string
  children?: UiNode[]
}

/* ==================== 小图标 ==================== */

function ChevronIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className={`tree-chevron ${open ? 'open' : ''}`} viewBox="0 0 24 24">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

function FolderIcon(): JSX.Element {
  return (
    <svg className="tree-icon tree-icon-folder" viewBox="0 0 24 24">
      <path d="M3 7a2 2 0 0 1 2-2h4.2a1 1 0 0 1 .8.4L11.6 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function FileIcon(): JSX.Element {
  return (
    <svg className="tree-icon tree-icon-file" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

export function Sidebar({
  demoTree,
  demoFileNames,
  workspace,
  openFiles,
  activeFileId,
  content,
  onSelectDemoFile,
  onSelectWorkspaceFile,
  onOutlineClick,
  focusOutlineTick = 0,
  activeOutlineIndex = -1,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
  onOpenInNewWindow,
  initialCollapsedKeys,
  onCollapsedKeysChange,
  activeTab: controlledTab,
  onActiveTabChange,
  collapsed = false,
}: SidebarProps): JSX.Element {
  const deferredContent = useDeferredValue(content)
  const [localActiveTab, setLocalActiveTab] = useState<'files' | 'outline'>('files')
  const activeTab = controlledTab ?? localActiveTab
  const setActiveTab = onActiveTabChange ?? setLocalActiveTab
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(
    () => new Set(initialCollapsedKeys ?? []),
  )
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<number>>(new Set())
  // 右键菜单与内联重命名
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: UiNode } | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // 文件树拖拽移动（U5）：正在拖动的节点与当前悬停的投放目标
  const [dragNode, setDragNode] = useState<{ path: string; kind: 'file' | 'folder' } | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)

  // L16：折叠时不卸载组件，只把宽度缩到 0（保留滚动位置/重命名状态）。
  // inert 阻止 Tab 聚焦到被裁切的内容（React 18 不识别 inert prop，用 ref 设置）。
  const sidebarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sidebarRef.current
    if (!el) return
    if (collapsed) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [collapsed])

  /** 判断当前拖动的节点能否放入目标文件夹 */
  const canDropInto = (target: UiNode): boolean => {
    if (!dragNode || !target.path || target.kind !== 'folder') return false
    const src = dragNode.path
    // 不能移入自身或自身的子目录
    if (target.path === src) return false
    if (target.path.startsWith(src + '/') || target.path.startsWith(src + '\\')) return false
    // 已在目标目录下，无需移动
    if (src.replace(/[\\/][^\\/]+$/, '') === target.path) return false
    return true
  }

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [ctxMenu])

  // 菜单触发切到大纲。
  // 用 ref 记录已消费的 tick：L16 后组件折叠不再卸载，
  // 但仍需防止旧 tick 在后续渲染中被重复消费导致 Tab 错误停在大纲。
  const lastOutlineTickRef = useRef(focusOutlineTick)
  useEffect(() => {
    if (focusOutlineTick > lastOutlineTickRef.current) {
      lastOutlineTickRef.current = focusOutlineTick
      setActiveTab('outline')
    }
  }, [focusOutlineTick])

  /* ==================== 文件树数据 ==================== */

  // 演示树归一化为 UiNode
  const demoNodes = useMemo<UiNode[]>(
    () =>
      demoTree.map((folder) => ({
        key: `demo:${folder.label}`,
        name: folder.label,
        kind: 'folder' as const,
        children: folder.fileIds.map((id) => ({
          key: id,
          name: demoFileNames[id] ?? id,
          kind: 'file' as const,
          demoId: id,
        })),
      })),
    [demoTree, demoFileNames],
  )

  // 工作区树归一化为 UiNode
  const workspaceNodes = useMemo<UiNode[]>(() => {
    if (!workspace) return []
    const convert = (node: FolderTreeNode): UiNode => ({
      key: node.path,
      name: node.name,
      kind: node.children ? ('folder' as const) : ('file' as const),
      path: node.path,
      children: node.children?.map(convert),
    })
    return [
      {
        key: workspace.path,
        name: workspace.name,
        kind: 'folder',
        path: workspace.path,
        children: workspace.tree.map(convert),
      },
    ]
  }, [workspace])

  /** 收集所有文件夹 key（演示树 + 工作区树，含嵌套子文件夹） */
  const collectFolderKeys = (nodes: UiNode[]): string[] => {
    const keys: string[] = []
    const walk = (list: UiNode[]) => {
      for (const n of list) {
        if (n.kind === 'folder') {
          keys.push(n.key)
          walk(n.children ?? [])
        }
      }
    }
    walk(nodes)
    return keys
  }

  // 折叠状态初始化：
  // - 无持久化记录（initialCollapsedKeys === null）→ 所有文件夹默认折叠（全新用户）
  // - 有记录但与当前树完全不匹配 → 打开了新的工作区 → 全部折叠
  // - 有匹配记录 → 恢复记录原样
  // 注意：本 effect 不写回记录（折叠全部是幂等的，无需持久化）；
  // 用户第一次手动折叠/展开时，onCollapsedKeysChange 自然把记录更新为新工作区的键
  const allFolderKeys = useMemo(
    () => collectFolderKeys([...demoNodes, ...workspaceNodes]),
    [demoNodes, workspaceNodes],
  )
  useEffect(() => {
    if (allFolderKeys.length === 0) return
    // 注意用 != null：同时排除 undefined（未传 prop）与 null（无记录）
    if (initialCollapsedKeys != null) {
      // 空数组 = 用户曾展开全部文件夹，必须保持原样（不能当作"无匹配"处理）
      const matched =
        initialCollapsedKeys.length === 0 ||
        initialCollapsedKeys.some((k) => allFolderKeys.includes(k))
      setCollapsedKeys(matched ? new Set(initialCollapsedKeys) : new Set(allFolderKeys))
    } else {
      // 无记录：全部默认折叠
      setCollapsedKeys(new Set(allFolderKeys))
    }
  }, [initialCollapsedKeys, allFolderKeys])

  const toggleCollapse = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      onCollapsedKeysChange?.(Array.from(next))
      return next
    })
  }

  /* ==================== 大纲数据 ==================== */

  // 长文档输入时延后刷新大纲，保持编辑器输入优先。
  const outlineTree = useMemo<OutlineNode[]>(
    () => parseOutline(deferredContent),
    [deferredContent],
  )

  const toggleHeading = (idx: number) => {
    setCollapsedHeadings((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  /* ==================== 渲染：文件树 ==================== */

  /** 右键打开上下文菜单（仅工作区节点） */
  const openCtxMenu = (e: React.MouseEvent, node: UiNode) => {
    if (!workspace || !node.path) return
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, node })
  }

  const openTreeFile = (node: UiNode, pinned: boolean) => {
    // 从搜索结果点选文件时，搜索输入框持有焦点会挡住编辑器焦点恢复（H2），先释放
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && active.closest('input, textarea')) {
      active.blur()
    }
    if (node.demoId !== undefined) {
      onSelectDemoFile(node.demoId, pinned)
      return
    }
    if (node.path) onSelectWorkspaceFile(node.path, pinned)
  }

  const renderTreeNode = (node: UiNode, depth: number): JSX.Element => {
    const indent = 8 + depth * 14
    // 层级引导线：每个祖先层级一条竖线（与箭头列对齐）
    const guides: JSX.Element[] = []
    for (let i = 0; i < depth; i++) {
      guides.push(
        <span key={i} className="tree-guide" style={{ left: 8 + i * 14 + 5 }} />,
      )
    }
    if (node.kind === 'folder') {
      const open = !collapsedKeys.has(node.key)
      // 工作区文件夹支持拖入移动（U5）
      const droppable = !!workspace && !!node.path
      return (
        <div key={node.key} role="none">
          <div
            className={`tree-row tree-folder-row ${dropKey === node.key ? 'drop-target' : ''}`}
            style={{ paddingLeft: indent }}
            role="treeitem"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => toggleCollapse(node.key)}
            onKeyDown={(event) => {
              if (isImeComposing(event.nativeEvent)) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              toggleCollapse(node.key)
            }}
            onContextMenu={(e) => openCtxMenu(e, node)}
            draggable={droppable}
            onDragStart={(e) => {
              if (!node.path) return
              setDragNode({ path: node.path, kind: node.kind })
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', node.name)
            }}
            onDragEnd={() => {
              setDragNode(null)
              setDropKey(null)
            }}
            onDragOver={(e) => {
              if (canDropInto(node)) {
                e.preventDefault()
                e.stopPropagation()
                setDropKey(node.key)
              }
            }}
            onDragLeave={() => setDropKey((k) => (k === node.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (dragNode && canDropInto(node) && node.path) {
                onMoveFile?.(dragNode.path, node.path)
              }
              setDragNode(null)
              setDropKey(null)
            }}
          >
            {guides}
            <ChevronIcon open={open} />
            <FolderIcon />
            <span className="tree-name">{node.name}</span>
          </div>
          {open && (
            <div role="group">
              {node.children?.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }
    const isActive =
      node.demoId !== undefined
        ? activeFileId === node.demoId
        : activeFileId === `file-${node.path}`
    // 内联重命名态
    if (renamingKey === node.key && node.path) {
      return (
        <div
          key={node.key}
          className="tree-row tree-file-row"
          style={{ paddingLeft: indent }}
        >
          {guides}
          <span className="tree-chevron-slot" />
          <FileIcon />
          <input
            className="tree-rename-input"
            autoFocus
            value={renameValue}
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e.nativeEvent)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                if (node.path && renameValue.trim()) {
                  onRenameFile?.(node.path, renameValue)
                }
                setRenamingKey(null)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setRenamingKey(null)
              }
            }}
            onBlur={() => setRenamingKey(null)}
          />
        </div>
      )
    }
    return (
      <div
        key={node.key}
        className={`tree-row tree-file-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: indent }}
        role="treeitem"
        tabIndex={0}
        aria-selected={isActive}
        onClick={() => openTreeFile(node, false)}
        onDoubleClick={() => openTreeFile(node, true)}
        onKeyDown={(event) => {
          if (isImeComposing(event.nativeEvent)) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openTreeFile(node, false)
        }}
        onContextMenu={(e) => openCtxMenu(e, node)}
        draggable={!!workspace && !!node.path}
        onDragStart={(e) => {
          if (!node.path) return
          setDragNode({ path: node.path, kind: node.kind })
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.name)
        }}
        onDragEnd={() => {
          setDragNode(null)
          setDropKey(null)
        }}
      >
        {guides}
        <span className="tree-chevron-slot" />
        <FileIcon />
        <span className="tree-name">{node.name}</span>
      </div>
    )
  }

  /* ==================== 渲染：大纲 ==================== */

  const renderOutlineNode = (node: OutlineNode): JSX.Element => {
    const hasChildren = node.children.length > 0
    const collapsed = collapsedHeadings.has(node.idx)
    const isActive = node.idx === activeOutlineIndex
    return (
      <div key={node.idx} className="outline-node">
        <button
          type="button"
          className={`outline-row outline-h${node.level} ${isActive ? 'active' : ''}`}
          onClick={() => onOutlineClick(node.idx)}
          onKeyDown={(event) => {
            if (!hasChildren) return
            if (event.key === 'ArrowRight' && collapsed) {
              event.preventDefault()
              toggleHeading(node.idx)
            }
            if (event.key === 'ArrowLeft' && !collapsed) {
              event.preventDefault()
              toggleHeading(node.idx)
            }
          }}
          aria-expanded={hasChildren ? !collapsed : undefined}
          title={node.text}
        >
          {hasChildren ? (
            <span
              className={`outline-caret ${collapsed ? '' : 'open'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleHeading(node.idx)
              }}
            >
              <svg viewBox="0 0 24 24">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </span>
          ) : (
            <span className="outline-caret outline-caret-empty" />
          )}
          <span className="outline-text">{node.text}</span>
        </button>
        {hasChildren && !collapsed && (
          <div className="outline-sub">{node.children.map(renderOutlineNode)}</div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={sidebarRef}
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      aria-hidden={collapsed}
    >
      {/* Tab 切换 */}
      <div className="sidebar-tabs" role="tablist" aria-label="侧栏视图">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'files'}
          aria-controls="sidebar-files-panel"
          className={`sidebar-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          文件
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'outline'}
          aria-controls="sidebar-outline-panel"
          className={`sidebar-tab ${activeTab === 'outline' ? 'active' : ''}`}
          onClick={() => setActiveTab('outline')}
        >
          大纲
        </button>
      </div>

      <div className="sidebar-body">
        {/* ===== 文件树面板 ===== */}
        {activeTab === 'files' && (
          <div
            id="sidebar-files-panel"
            className="panel active"
            role="tabpanel"
            aria-label="文件"
          >
            {/* 已打开工作区：只显示当前文件夹；否则显示演示树 + 外部文件 */}
            {workspace ? (
              <div role="tree" aria-label="文件列表">
                {workspaceNodes.length > 0 ? (
                  workspaceNodes.map((node) => renderTreeNode(node, 0))
                ) : (
                  <div className="tree-empty">文件夹为空，已新建空白文档</div>
                )}
              </div>
            ) : (
              <div role="tree" aria-label="文件列表">
                {demoNodes.map((node) => renderTreeNode(node, 0))}
              </div>
            )}
          </div>
        )}

        {/* ===== 大纲面板 ===== */}
        {activeTab === 'outline' && (
          <div
            id="sidebar-outline-panel"
            className="panel active"
            role="tabpanel"
            aria-label="大纲"
          >
            {outlineTree.length === 0 ? (
              <div className="outline-empty">暂无标题</div>
            ) : (
              <div className="outline-root">{outlineTree.map(renderOutlineNode)}</div>
            )}
          </div>
        )}
      </div>

      {/* ===== 右键上下文菜单（工作区文件操作） ===== */}
      {ctxMenu && (
        <div
          className="tree-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.node.kind === 'folder' && (
            <div
              className="tree-ctx-item"
              onClick={() => {
                if (ctxMenu.node.path) onCreateFile?.(ctxMenu.node.path)
                setCtxMenu(null)
              }}
            >
              新建文件
            </div>
          )}
          {ctxMenu.node.kind === 'file' && (
            <>
              <div
                className="tree-ctx-item"
                onClick={() => {
                  setRenamingKey(ctxMenu.node.key)
                  setRenameValue(ctxMenu.node.name)
                  setCtxMenu(null)
                }}
              >
                重命名
              </div>
              <div
                className="tree-ctx-item"
                onClick={() => {
                  if (ctxMenu.node.path) {
                    void navigator.clipboard.writeText(ctxMenu.node.path)
                  }
                  setCtxMenu(null)
                }}
              >
                复制路径
              </div>
              <div
                className="tree-ctx-item"
                onClick={() => {
                  if (ctxMenu.node.path) onOpenInNewWindow?.(ctxMenu.node.path)
                  setCtxMenu(null)
                }}
              >
                在新窗口打开
              </div>
              <div className="tree-ctx-sep" />
              <div
                className="tree-ctx-item danger"
                onClick={() => {
                  if (
                    ctxMenu.node.path &&
                    window.confirm(
                      `确定删除“${ctxMenu.node.name}”吗？\n文件将移入回收站，可恢复。`,
                    )
                  ) {
                    onDeleteFile?.(ctxMenu.node.path)
                  }
                  setCtxMenu(null)
                }}
              >
                删除
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
