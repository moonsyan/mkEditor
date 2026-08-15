import { useEffect, useRef, useState } from 'react'
import type { OpenFile } from '../Sidebar'
import { getTabNavigationTargetId, type DocumentTabNavigationKey } from '../../lib/document-tabs'

interface TabBarProps {
  openFiles: OpenFile[]
  activeFileId: string
  savedMap: Record<string, boolean>
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  /** 右键菜单：关闭其他标签页（保留当前激活的标签） */
  onCloseOthers: () => void
  /** 右键菜单：关闭全部标签页 */
  onCloseAll: () => void
  /** 拖拽排序：把 from 位置的文件移动到 to 位置 */
  onReorder: (from: number, to: number) => void
}

/**
 * 多标签页栏（对标 Typora）：展示所有已打开文档，点击切换、关闭按钮收起、
 * 支持拖拽排序。复用现有 openFiles / activeFileId 状态，不改动单文档内核。
 * 右键标签弹出菜单：关闭 / 关闭其他 / 关闭全部；中键点击直接关闭。
 */
export function TabBar({ openFiles, activeFileId, savedMap, onSwitch, onClose, onCloseOthers, onCloseAll, onReorder }: TabBarProps) {
  // D8：拖拽记录被拖标签的 id 而非下标——openFiles 可能在拖拽中变化
  //（预览标签替换、其它标签关闭等），落点与高亮也按 id 追踪：
  // 闭包里的渲染下标 i 在 openFiles 变化后过期，落点会插到错误位置
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // 右键菜单：{ 触发标签 id, 屏幕坐标 }
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId: string } | null>(null)

  // 菜单打开期间：点击其它区域 / 右键其它区域 / Esc 关闭菜单
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ctxMenu])

  // 切换/拖拽后把激活标签滚入可视区（标签多到溢出时，从侧栏点开文件
  // 不再"看不到当前标签"）
  useEffect(() => {
    tabRefs.current[activeFileId]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeFileId, openFiles.length])

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, fileId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSwitch(fileId)
      return
    }
    // 上下文菜单键 / Shift+F10：打开该标签的右键菜单
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      setCtxMenu({ x: rect.left, y: rect.bottom, fileId })
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextId = getTabNavigationTargetId(
      openFiles,
      fileId,
      event.key as DocumentTabNavigationKey,
    )
    if (!nextId) return
    tabRefs.current[nextId]?.focus()
    onSwitch(nextId)
  }

  if (openFiles.length === 0) return null

  const canCloseOthers = openFiles.length > 1

  return (
    <>
      <div className="tabbar" role="tablist">
        {openFiles.map((file, i) => {
          const active = file.id === activeFileId
          const dirty = savedMap[file.id] === false
          const preview = file.preview === true
          return (
            <div
              key={file.id}
              role="tab"
              ref={(element) => {
                tabRefs.current[file.id] = element
              }}
              aria-selected={active}
              aria-label={`${file.name}${dirty ? '，未保存' : ''}${preview ? '，预览标签' : ''}`}
              tabIndex={active ? 0 : -1}
              className={`tab ${active ? 'active' : ''} ${preview ? 'preview' : ''} ${overId === file.id && dragId !== null && dragId !== file.id ? 'drag-over' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(file.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragId !== null && dragId !== file.id) setOverId(file.id)
              }}
              onDragLeave={() => {
                if (overId === file.id) setOverId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId !== null && dragId !== file.id) {
                  // D8：起点与落点都按 id 反查当前下标（拖拽期间 openFiles 可能已变化）
                  const from = openFiles.findIndex((f) => f.id === dragId)
                  const to = openFiles.findIndex((f) => f.id === file.id)
                  if (from !== -1 && to !== -1) onReorder(from, to)
                }
                setDragId(null)
                setOverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onClick={() => onSwitch(file.id)}
              // 中键点击关闭（对标浏览器/VS Code 标签页习惯）
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                onClose(file.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCtxMenu({ x: e.clientX, y: e.clientY, fileId: file.id })
              }}
              onKeyDown={(event) => handleTabKeyDown(event, file.id)}
              title={preview ? '预览标签：双击左侧文件可固定' : (file.path ?? file.name)}
            >
              <span className="tab-name">{file.name}</span>
              {dirty && <span className="tab-dot" />}
              <button
                type="button"
                className="tab-close"
                aria-label={`关闭 ${file.name}`}
                title="关闭"
                onMouseDown={(event) => event.preventDefault()}
                onKeyDown={(event) => event.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(file.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/* 标签页右键菜单：关闭 / 关闭其他 / 关闭全部 */}
      {ctxMenu && (
        <div
          className="tab-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          role="menu"
          aria-label="标签页操作"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="tab-ctx-item"
            role="menuitem"
            onClick={() => {
              onClose(ctxMenu.fileId)
              setCtxMenu(null)
            }}
          >
            关闭
          </div>
          <div
            className={`tab-ctx-item ${canCloseOthers ? '' : 'disabled'}`}
            role="menuitem"
            aria-disabled={!canCloseOthers}
            onClick={() => {
              if (!canCloseOthers) return
              onCloseOthers()
              setCtxMenu(null)
            }}
          >
            关闭其他标签页
          </div>
          <div className="tab-ctx-sep" />
          <div
            className="tab-ctx-item"
            role="menuitem"
            onClick={() => {
              onCloseAll()
              setCtxMenu(null)
            }}
          >
            关闭全部标签页
          </div>
        </div>
      )}
    </>
  )
}
