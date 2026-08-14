import { useState, useEffect, useRef, useCallback } from 'react'
import { isImeComposing } from '../../lib/keyboard'

export interface WikiSuggestion {
  name: string
  path: string
}

export interface WikiAutocompleteProps {
  query: string
  suggestions: WikiSuggestion[]
  x: number
  y: number
  onSelect: (path: string) => void
  onClose: () => void
}

/**
 * Wiki 链接自动补全浮层。
 * 在输入 [[ 后弹出，展示工作区文件列表，支持键盘导航与点击选择。
 */
export function WikiAutocomplete({
  query,
  suggestions,
  x,
  y,
  onSelect,
  onClose,
}: WikiAutocompleteProps): JSX.Element | null {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // C-8：查询变化时选中项复位到首项，避免 Enter 选中与当前输入无关的旧高亮项
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // 确保 activeIndex 在 suggestions 范围内
  useEffect(() => {
    if (activeIndex >= suggestions.length) {
      setActiveIndex(Math.max(0, suggestions.length - 1))
    }
  }, [suggestions.length, activeIndex])

  // 选中项滚动到可见
  useEffect(() => {
    const el = listRef.current?.querySelector('.wiki-ac-item.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSelect = useCallback(
    (index: number) => {
      if (index >= 0 && index < suggestions.length) {
        onSelect(suggestions[index].path)
      }
    },
    [suggestions, onSelect],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 组合键（Ctrl/Cmd/Alt）不拦截，放行给全局快捷键与编辑器
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isImeComposing(event)) return
      // C-2：零候选时浮层返回 null 但本监听仍注册，不能再吞键
      if (suggestions.length === 0) return
      // C-2：焦点移出编辑器（如搜索框、属性面板输入）时按键应交给当前控件，
      // 不拦截（补全浮层本身不可聚焦，点击项时焦点仍在编辑器内）
      const active = document.activeElement
      if (!(active && active.classList.contains('ProseMirror'))) return
      // 捕获阶段拦截（H3）：PM 的 keydown 在编辑器 DOM 冒泡阶段，
      // 若不提前 stopPropagation，↓/↑ 会同时移动文档光标、Enter 会先拆段再插入链接
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((current) => Math.min(suggestions.length - 1, current + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        handleSelect(activeIndex)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeIndex, handleSelect, onClose, suggestions.length])

  if (suggestions.length === 0) return null

  return (
    <div
      className="wiki-ac-panel"
      style={{ top: y + 20, left: x }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="wiki-ac-list" ref={listRef}>
        {suggestions.map((item, i) => (
          <div
            key={item.path}
            className={`wiki-ac-item ${i === activeIndex ? 'active' : ''}`}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={() => handleSelect(i)}
          >
            <span className="wiki-ac-name">{item.name}</span>
            <span className="wiki-ac-path">{item.path}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 从工作区文件树中筛选匹配 query 的文件建议。
 * @param tree - 工作区文件树
 * @param query - 用户输入的搜索字符串
 * @param maxResults - 最大建议数（默认 20）
 */
export function filterWikiSuggestions(
  tree: { name: string; path: string; children?: Array<{ name: string; path: string; children?: unknown[] }> }[],
  query: string,
  maxResults = 20,
): WikiSuggestion[] {
  if (!query) return []
  const lower = query.toLowerCase()
  const results: WikiSuggestion[] = []

  const walk = (nodes: Array<{ name: string; path: string; children?: unknown[] }>) => {
    for (const node of nodes) {
      if (node.children) {
        walk(node.children as Array<{ name: string; path: string; children?: unknown[] }>)
      } else {
        const name = node.name.replace(/\.md$/i, '')
        if (name.toLowerCase().includes(lower)) {
          results.push({ name, path: node.path })
          if (results.length >= maxResults) return
        }
      }
    }
  }
  walk(tree)
  return results
}
