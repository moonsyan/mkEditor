import { useState, useMemo, useEffect, useRef } from 'react'
import type { DemoFolder } from '../../data/demo-files'
import type { FolderTreeNode } from '../../../../preload/api'

/** 打开中的文档（含真实文件的磁盘路径） */
export interface OpenFile {
  id: string
  name: string
  /** 磁盘路径（真实文件才有，演示文件为空） */
  path?: string
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
  /** 点击演示文件 */
  onSelectDemoFile: (id: string) => void
  /** 点击工作区/磁盘文件（传路径） */
  onSelectWorkspaceFile: (path: string) => void
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

/* ==================== 大纲模型 ==================== */

interface OutlineNode {
  idx: number
  level: number
  text: string
  children: OutlineNode[]
}

/** 按标题层级构建大纲树（h2 挂在最近的 h1 下，以此类推） */
function buildOutlineTree(headings: { level: number; text: string }[]): OutlineNode[] {
  const root: OutlineNode[] = []
  const stack: OutlineNode[] = []
  headings.forEach((h, idx) => {
    const node: OutlineNode = { idx, level: h.level, text: h.text, children: [] }
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else root.push(node)
    stack.push(node)
  })
  return root
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
}: SidebarProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'files' | 'outline'>('files')
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<number>>(new Set())
  // 右键菜单与内联重命名
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: UiNode } | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 点击其他区域关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [ctxMenu])

  // 菜单触发切到大纲。
  // 用 ref 记录已消费的 tick：侧栏折叠后组件会重新挂载，
  // 若不记录，旧的 tick 会被重复消费导致 Tab 错误停在大纲。
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

  // 不在任何树中的外部打开文件
  const externalFiles = useMemo(() => {
    const inTree = new Set<string>(
      openFiles.filter((f) => !f.path).map((f) => f.id),
    )
    // 演示文件 ID
    demoTree.forEach((folder) => folder.fileIds.forEach((id) => inTree.add(id)))
    return openFiles.filter((f) => {
      if (inTree.has(f.id)) return false
      // 属于工作区路径下的文件也不算外部
      if (f.path && workspace && f.path.startsWith(workspace.path)) return false
      return true
    })
  }, [openFiles, demoTree, workspace])

  // 工作区模式下的未命名文档（无磁盘路径且非演示文件）
  const workspaceUntitled = useMemo(() => {
    const demoIds = new Set(demoTree.flatMap((folder) => folder.fileIds))
    return openFiles.filter((f) => !f.path && !demoIds.has(f.id))
  }, [openFiles, demoTree])

  const toggleCollapse = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /* ==================== 大纲数据 ==================== */

  // 从 Markdown 提取标题（跳过代码块内的 #，与编辑器实际渲染保持一致）
  const outlineTree = useMemo<OutlineNode[]>(() => {
    const headings: { level: number; text: string }[] = []
    let inFence = false
    for (const line of content.split('\n')) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      // 支持引用块内标题（`> # x`，可多层），与编辑器解析及 DOM 顺序对齐
      const match = line.match(/^\s*(?:>\s*)*(#{1,4})\s+(.+)$/)
      if (match) headings.push({ level: match[1].length, text: match[2] })
    }
    return buildOutlineTree(headings)
  }, [content])

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
      return (
        <div key={node.key}>
          <div
            className="tree-row tree-folder-row"
            style={{ paddingLeft: indent }}
            onClick={() => toggleCollapse(node.key)}
            onContextMenu={(e) => openCtxMenu(e, node)}
          >
            {guides}
            <ChevronIcon open={open} />
            <FolderIcon />
            <span className="tree-name">{node.name}</span>
          </div>
          {open && node.children?.map((child) => renderTreeNode(child, depth + 1))}
        </div>
      )
    }
    const isActive =
      node.demoId !== undefined
        ? activeFileId === node.demoId
        : activeFileId === `file-${node.path}`
    // 已打开标记（区分打开过与未打开的文件）
    const isOpened =
      node.path !== undefined && openFiles.some((f) => f.id === `file-${node.path}`)
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
        onClick={() => {
          if (node.demoId !== undefined) onSelectDemoFile(node.demoId)
          else if (node.path) onSelectWorkspaceFile(node.path)
        }}
        onContextMenu={(e) => openCtxMenu(e, node)}
      >
        {guides}
        <span className="tree-chevron-slot" />
        <FileIcon />
        <span className="tree-name">{node.name}</span>
        {isOpened && !isActive && <span className="tree-open-dot" title="已打开" />}
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
        <div
          className={`outline-row outline-h${node.level} ${isActive ? 'active' : ''}`}
          onClick={() => onOutlineClick(node.idx)}
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
        </div>
        {hasChildren && !collapsed && (
          <div className="outline-sub">{node.children.map(renderOutlineNode)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="sidebar">
      {/* Tab 切换 */}
      <div className="sidebar-tabs">
        <div
          className={`sidebar-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          文件
        </div>
        <div
          className={`sidebar-tab ${activeTab === 'outline' ? 'active' : ''}`}
          onClick={() => setActiveTab('outline')}
        >
          大纲
        </div>
      </div>

      <div className="sidebar-body">
        {/* ===== 文件树面板 ===== */}
        {activeTab === 'files' && (
          <div className="panel active">
            {/* 已打开工作区：只显示当前文件夹；否则显示演示树 + 外部文件 */}
            {workspace ? (
              <>
                {workspaceNodes.length > 0 ? (
                  workspaceNodes.map((node) => renderTreeNode(node, 0))
                ) : (
                  <div className="tree-empty">文件夹为空，已新建空白文档</div>
                )}
                {/* 工作区内新建的未命名文档 */}
                {workspaceUntitled.length > 0 && (
                  <div>
                    <div className="tree-section-label">新建文档</div>
                    {workspaceUntitled.map((file) => (
                      <div
                        key={file.id}
                        className={`tree-row tree-file-row ${activeFileId === file.id ? 'active' : ''}`}
                        style={{ paddingLeft: 8 }}
                        onClick={() => onSelectDemoFile(file.id)}
                      >
                        <span className="tree-chevron-slot" />
                        <FileIcon />
                        <span className="tree-name">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {demoNodes.map((node) => renderTreeNode(node, 0))}

                {/* 外部打开的文件 */}
                {externalFiles.length > 0 && (
                  <div>
                    <div className="tree-section-label">外部文件</div>
                    {externalFiles.map((file) => (
                      <div
                        key={file.id}
                        className={`tree-row tree-file-row ${activeFileId === file.id ? 'active' : ''}`}
                        style={{ paddingLeft: 8 }}
                        onClick={() => {
                          if (file.path) onSelectWorkspaceFile(file.path)
                        }}
                      >
                        <span className="tree-chevron-slot" />
                        <FileIcon />
                        <span className="tree-name">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== 大纲面板 ===== */}
        {activeTab === 'outline' && (
          <div className="panel active">
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
