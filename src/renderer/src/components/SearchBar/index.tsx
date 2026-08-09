import { useState, useRef, useEffect } from 'react'

interface SearchBarProps {
  /** 是否显示替换输入框 */
  withReplace: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 匹配总数 */
  count: number
  /** 当前匹配索引（0 起，-1 无） */
  current: number
  /** 查询变化（返回匹配信息） */
  onQueryChange: (query: string, useRegex: boolean, caseSensitive: boolean) => void
  /** 上一个 / 下一个 */
  onNext: (backwards: boolean) => void
  /** 替换当前匹配 */
  onReplace: (replacement: string) => void
  /** 全部替换 */
  onReplaceAll: (replacement: string) => void
}

/**
 * 查找替换栏（ProseMirror 装饰高亮引擎）
 * 支持正则模式、大小写敏感、匹配计数（x/y）、逐个替换与全部替换。
 */
export function SearchBar({
  withReplace,
  onClose,
  count,
  current,
  onQueryChange,
  onNext,
  onReplace,
  onReplaceAll,
}: SearchBarProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [replacement, setReplacement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [withReplace])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    onQueryChange(value, useRegex, caseSensitive)
  }

  const toggleRegex = () => {
    const next = !useRegex
    setUseRegex(next)
    onQueryChange(query, next, caseSensitive)
  }

  const toggleCase = () => {
    const next = !caseSensitive
    setCaseSensitive(next)
    onQueryChange(query, useRegex, next)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onNext(true)
      else onNext(false)
    }
  }

  const countText = !query
    ? ''
    : count > 0
      ? `${current + 1} / ${count}`
      : '无匹配'

  return (
    <div className="search-bar">
      <div className="search-row">
        {/* 正则开关 */}
        <div
          className={`search-regex ${useRegex ? 'on' : ''}`}
          onClick={toggleRegex}
          title={useRegex ? '正则模式：开' : '正则模式：关'}
        >
          .*
        </div>
        {/* 大小写敏感开关 */}
        <div
          className={`search-regex ${caseSensitive ? 'on' : ''}`}
          onClick={toggleCase}
          title={caseSensitive ? '区分大小写：开' : '区分大小写：关'}
        >
          Aa
        </div>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="查找"
          value={query}
          spellCheck={false}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {countText && <span className="search-count">{countText}</span>}
        <div className="search-btn" onClick={() => onNext(true)} title="上一个 (Shift+Enter)">
          <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" /></svg>
        </div>
        <div className="search-btn" onClick={() => onNext(false)} title="下一个 (Enter)">
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
        </div>
        <div className="search-btn" onClick={onClose} title="关闭 (Esc)">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
      </div>
      {withReplace && (
        <div className="search-row">
          <span className="search-regex-placeholder" />
          <input
            className="search-input"
            placeholder="替换为"
            value={replacement}
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                onReplace(replacement)
              }
            }}
          />
          <div className="search-btn search-btn-text" onClick={() => onReplace(replacement)} title="替换当前匹配并跳到下一个">
            替换
          </div>
          <div className="search-btn search-btn-text" onClick={() => onReplaceAll(replacement)} title="替换全部匹配">
            全部
          </div>
        </div>
      )}
    </div>
  )
}
