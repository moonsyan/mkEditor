import { useState } from 'react'
import type { OpenFile } from '../Sidebar'

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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (openFiles.length === 0) return null

  return (
    <div className="tabbar" role="tablist">
      {openFiles.map((file, i) => {
        const active = file.id === activeFileId
        const dirty = savedMap[file.id] === false
        return (
          <div
            key={file.id}
            role="tab"
            className={`tab ${active ? 'active' : ''} ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'drag-over' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== i) setOverIndex(i)
            }}
            onDragLeave={() => {
              if (overIndex === i) setOverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i)
              setDragIndex(null)
              setOverIndex(null)
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setOverIndex(null)
            }}
            onClick={() => onSwitch(file.id)}
            title={file.path ?? file.name}
          >
            <span className="tab-name">{file.name}</span>
            {dirty && <span className="tab-dot" />}
            <span
              className="tab-close"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation()
                onClose(file.id)
              }}
            >
              ×
            </span>
          </div>
        )
      })}
    </div>
  )
}
