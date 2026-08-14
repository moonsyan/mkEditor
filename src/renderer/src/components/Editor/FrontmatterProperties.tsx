import { useState, useCallback, useRef } from 'react'
import { isImeComposing } from '../../lib/keyboard'

export interface FrontmatterPropertiesProps {
  properties: Record<string, string> | null
  show: boolean
  onToggle: () => void
  onUpdateProperty: (key: string, value: string) => void
  onDeleteProperty: (key: string) => void
  onAddProperty: (key: string, value: string) => void
}

/**
 * YAML Frontmatter 属性面板（仿 Obsidian Properties）。
 * 以紧凑表格展示文档元数据，支持行内编辑。
 */
export function FrontmatterProperties({
  properties,
  show,
  onToggle,
  onUpdateProperty,
  onDeleteProperty,
  onAddProperty,
}: FrontmatterPropertiesProps): JSX.Element {
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editBuffer, setEditBuffer] = useState('')
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const cancelEditRef = useRef(false)

  const entries = properties ? Object.entries(properties) : []

  const startEdit = useCallback((key: string, value: string) => {
    cancelEditRef.current = false
    setEditingField(key)
    setEditBuffer(value)
  }, [])

  const commitEdit = useCallback(
    (key: string) => {
      const nextValue = editBuffer
      if (nextValue !== (properties?.[key] ?? '')) {
        onUpdateProperty(key, nextValue)
      }
      setEditingField(null)
      setEditBuffer('')
    },
    [editBuffer, properties, onUpdateProperty],
  )

  const cancelAdd = useCallback(() => {
    setAdding(false)
    setNewKey('')
    setNewVal('')
  }, [])

  const commitAdd = useCallback(() => {
    const key = newKey.trim()
    const val = newVal
    if (key) {
      onAddProperty(key, val)
    }
    cancelAdd()
  }, [newKey, newVal, onAddProperty, cancelAdd])

  return (
    <div className={`frontmatter-props ${show ? 'open' : ''}`}>
      <button
        type="button"
      className="fm-toggle-btn"
      onClick={onToggle}
      aria-expanded={show}
      title={show ? '收起属性' : '展开属性'}
      >
        <svg
          className={`fm-chevron ${show ? 'open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>属性</span>
        {properties && (
          <span className="fm-count">{Object.keys(properties).length}</span>
        )}
      </button>

      {show && (
        <div className="fm-table">
          {entries.map(([key, value]) => (
            <div key={key} className="fm-row">
              <span className="fm-key">{key}</span>
              <span className="fm-val">
                {editingField === key ? (
                  <input
                    className="fm-input"
                    autoFocus
                    value={editBuffer}
                    spellCheck={false}
                    onChange={(e) => setEditBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (isImeComposing(e.nativeEvent)) return
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitEdit(key)
                        return
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEditRef.current = true
                        setEditingField(null)
                      }
                    }}
                    onBlur={() => {
                      if (cancelEditRef.current) {
                        cancelEditRef.current = false
                        return
                      }
                      commitEdit(key)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="fm-val-text"
                    onClick={() => startEdit(key, value)}
                    aria-label={`编辑属性 ${key}`}
                    title="点击编辑"
                  >
                    {value || ' '}
                  </button>
                )}
              </span>
              <button
                type="button"
                className="fm-rm-btn"
                onClick={() => {
                  // E11：删除后清空行内编辑状态——否则同一 key 重新添加时，
                  // 旧 editBuffer 会顶掉新值
                  setEditingField(null)
                  setEditBuffer('')
                  onDeleteProperty(key)
                }}
                aria-label={`删除属性 ${key}`}
                title={`删除属性 "${key}"`}
              >
                ×
              </button>
            </div>
          ))}
          {adding ? (
            <div className="fm-row fm-row-new">
              <input
                className="fm-input fm-key-input"
                autoFocus
                placeholder="属性名"
                value={newKey}
                spellCheck={false}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e.nativeEvent)) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitAdd()
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelAdd()
                  }
                }}
              />
              <input
                className="fm-input"
                placeholder="值（可选）"
                value={newVal}
                spellCheck={false}
                onChange={(e) => setNewVal(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e.nativeEvent)) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitAdd()
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelAdd()
                  }
                }}
              />
              <button
                type="button"
                className="fm-rm-btn"
                onClick={cancelAdd}
                aria-label="取消添加属性"
              >
                ×
              </button>
            </div>
          ) : (
            <button type="button" className="fm-add-btn" onClick={() => setAdding(true)}>
              + 添加属性
            </button>
          )}
        </div>
      )}
    </div>
  )
}
