import { useRef, useState } from 'react'
import type { OpenFile } from '../Sidebar'
import { getTabNavigationTargetId, type DocumentTabNavigationKey } from '../../lib/document-tabs'

interface TabBarProps {
  openFiles: OpenFile[]
  activeFileId: string
  savedMap: Record<string, boolean>
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  /** 拖拽排序：把 from 位置的文件移动到 to 位置 */
  onReorder: (from: number, to: number) => void
}

/**
 * 多标签页栏（对标 Typora）：展示所有已打开文档，点击切换、关闭按钮收起、
 * 支持拖拽排序。复用现有 openFiles / activeFileId 状态，不改动单文档内核。
 */
export function TabBar({ openFiles, activeFileId, savedMap, onSwitch, onClose, onReorder }: TabBarProps) {
  // D8：拖拽记录被拖标签的 id 而非下标——openFiles 可能在拖拽中变化
  //（预览标签替换、其它标签关闭等），落点与高亮也按 id 追踪：
  // 闭包里的渲染下标 i 在 openFiles 变化后过期，落点会插到错误位置
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, fileId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSwitch(fileId)
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

  return (
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
  )
}
