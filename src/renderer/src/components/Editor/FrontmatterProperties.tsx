import { useState, useCallback } from 'react'
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
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editBuffer, setEditBuffer] = useState('')
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  const entries = properties ? Object.entries(properties) : []

  const startEdit = useCallback((key: string, value: string) => {
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

  const commitAdd = useCallback(() => {
    const key = newKey.trim()
    const val = newVal
    if (key) {
      onAddProperty(key, val)
    }
    setAdding(false)
    setNewKey('')
    setNewVal('')
  }, [newKey, newVal, onAddProperty])

  return (
    <div className={`frontmatter-props ${show ? 'open' : ''}`}>
      <button
        type="button"
        className="fm-toggle-btn"
        onClick={onToggle}
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
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setEditingField(null)
                      }
                    }}
                    onBlur={() => commitEdit(key)}
                  />
                ) : (
                  <span
                    className="fm-val-text"
                    onClick={() => startEdit(key, value)}
                    title="点击编辑"
                  >
                    {value || ' '}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="fm-rm-btn"
                onClick={() => onDeleteProperty(key)}
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
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setAdding(false)
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
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setAdding(false)
                  }
                }}
              />
              <button type="button" className="fm-rm-btn" onClick={() => setAdding(false)}>
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
