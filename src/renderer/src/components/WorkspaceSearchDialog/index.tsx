import { useState, useRef, useEffect } from 'react'

/** 工作区搜索命中项 */
interface WsMatch {
  path: string
  line: number
  preview: string
}

/**
 * 预览文本中高亮首个匹配片段（子串/正则）；
 * 无法定位时原样返回，不影响展示。
 */
function renderHighlightedPreview(
  preview: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): JSX.Element | string {
  try {
    let idx = -1
    let len = query.length
    if (useRegex) {
      const re = new RegExp(query, caseSensitive ? '' : 'i')
      const m = re.exec(preview)
      if (m && m[0].length > 0) {
        idx = m.index
        len = m[0].length
      }
    } else {
      idx = caseSensitive
        ? preview.indexOf(query)
        : preview.toLowerCase().indexOf(query.toLowerCase())
    }
    if (idx < 0) return preview
    return (
      <>
        {preview.slice(0, idx)}
        <mark className="ws-match">{preview.slice(idx, idx + len)}</mark>
        {preview.slice(idx + len)}
      </>
    )
  } catch {
    return preview
  }
}

interface WorkspaceSearchDialogProps {
  open: boolean
  /** 工作区根目录 */
  workspacePath: string
  /** 工作区名（标题展示） */
  workspaceName: string
  onClose: () => void
  /** 点击结果：打开对应文件（并把查询词带入文档内搜索） */
  onSelect: (path: string, query: string, opts?: { caseSensitive: boolean; useRegex: boolean }) => void
}

/**
 * 工作区全文搜索（基础版）：跨文件逐行子串匹配，
 * 点击结果打开文件并在文档内继续定位。
 */
export function WorkspaceSearchDialog({
  open,
  workspacePath,
  workspaceName,
  onClose,
  onSelect,
}: WorkspaceSearchDialogProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [error, setError] = useState('')
  const [matches, setMatches] = useState<WsMatch[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 请求序号：连续搜索时只采纳最后一次结果，避免后发先至旧结果覆盖新结果
  const searchSeqRef = useRef(0)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const doSearch = async () => {
    const q = query.trim()
    if (!q || !window.desktopAPI) return
    const seq = ++searchSeqRef.current
    setLoading(true)
    setSearched(true)
    setError('')
    try {
      const res = await window.desktopAPI.workspace.search(
        workspacePath,
        q,
        caseSensitive,
        useRegex,
      )
      if (seq !== searchSeqRef.current) return // 已有更新的搜索，丢弃本次结果
      if (res.ok && res.data) {
        setMatches(res.data.matches)
        setTruncated(res.data.truncated)
      } else {
        setMatches([])
        if (res.error?.code === 'INVALID_REGEX') {
          setError('正则表达式不合法，请检查后重试')
        }
      }
    } catch {
      if (seq === searchSeqRef.current) setMatches([])
    } finally {
      if (seq === searchSeqRef.current) setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog ws-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">在工作区中搜索 · {workspaceName}</span>
          <div className="dialog-close" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </div>
        <div className="ws-dialog-body">
          <div className="ws-search-row">
            <div
              className={`search-regex ${useRegex ? 'on' : ''}`}
              onClick={() => setUseRegex((v) => !v)}
              title={useRegex ? '正则模式：开' : '正则模式：关'}
            >
              .*
            </div>
            <div
              className={`search-regex ${caseSensitive ? 'on' : ''}`}
              onClick={() => setCaseSensitive((v) => !v)}
              title={caseSensitive ? '区分大小写：开' : '区分大小写：关'}
            >
              Aa
            </div>
            <input
              ref={inputRef}
              className="search-input ws-input"
              placeholder="输入关键词，回车搜索全部 .md 文件"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void doSearch()
                }
              }}
            />
            <div className="sc-btn" onClick={() => void doSearch()}>
              搜索
            </div>
          </div>
          {error && <div className="ws-error">{error}</div>}
          <div className="ws-results">
            {loading && <div className="ws-empty">搜索中…</div>}
            {!loading && searched && matches.length === 0 && (
              <div className="ws-empty">无匹配结果</div>
            )}
            {!loading &&
              matches.map((m, i) => (
                <div
                  key={`${m.path}-${m.line}-${i}`}
                  className="ws-result-item"
                  onClick={() => onSelect(m.path, query.trim(), { caseSensitive, useRegex })}
                  title={m.path}
                >
                  <div className="ws-result-loc">
                    {m.path.split(/[\\/]/).pop()}
                    <span className="ws-result-line"> : {m.line}</span>
                  </div>
                  <div className="ws-result-preview">
                    {renderHighlightedPreview(m.preview, query.trim(), caseSensitive, useRegex)}
                  </div>
                </div>
              ))}
            {truncated && (
              <div className="ws-empty">结果过多，仅显示前 200 条</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
