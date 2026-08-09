import { useState, useEffect } from 'react'
import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, comboFromEvent } from '../../data/shortcuts'
import type { ShortcutMap } from '../../data/shortcuts'

/** 编辑区字号档位 */
export type FontSize = 'sm' | 'md' | 'lg'

/** 内容宽度档位 */
export type ContentWidth = 'narrow' | 'standard' | 'wide'

/** 行距档位 */
export type LineHeight = 'compact' | 'standard' | 'loose'

/** 内容字体 */
export type ContentFont = 'default' | 'serif' | 'mono'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** 外观 */
  theme: string
  onThemeChange: (theme: string) => void
  fontSize: FontSize
  onFontSizeChange: (size: FontSize) => void
  contentWidth: ContentWidth
  onContentWidthChange: (width: ContentWidth) => void
  lineHeight: LineHeight
  onLineHeightChange: (height: LineHeight) => void
  contentFont: ContentFont
  onContentFontChange: (font: ContentFont) => void
  zoom: number
  onZoomChange: (zoom: number) => void
  /** 编辑器 */
  autosave: boolean
  onAutosaveChange: (value: boolean) => void
  typewriter: boolean
  onTypewriterChange: (value: boolean) => void
  spellcheck: boolean
  onSpellcheckChange: (value: boolean) => void
  multiWindow: boolean
  onMultiWindowChange: (value: boolean) => void
  /** 快捷键 */
  shortcuts: ShortcutMap
  onShortcutsChange: (map: ShortcutMap) => void
}

const THEMES = [
  { id: 'default', name: '暖白', color: '#F7F5F2', desc: '经典暖色调' },
  { id: 'dark', name: '墨夜', color: '#171614', desc: '深邃暗色' },
  { id: 'ocean', name: '海雾', color: '#EFF4F9', desc: '冷调蓝灰' },
  { id: 'rose', name: '玫砂', color: '#FBF5F3', desc: '温暖粉棕' },
]

const FONT_OPTIONS: { id: FontSize; label: string }[] = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '标准' },
  { id: 'lg', label: '大' },
]

const WIDTH_OPTIONS: { id: ContentWidth; label: string }[] = [
  { id: 'narrow', label: '窄' },
  { id: 'standard', label: '标准' },
  { id: 'wide', label: '宽' },
]

const LINE_HEIGHT_OPTIONS: { id: LineHeight; label: string }[] = [
  { id: 'compact', label: '紧凑' },
  { id: 'standard', label: '标准' },
  { id: 'loose', label: '宽松' },
]

const CONTENT_FONT_OPTIONS: { id: ContentFont; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'serif', label: '衬线' },
  { id: 'mono', label: '等宽' },
]

const NAV_ITEMS = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'shortcuts', label: '快捷键' },
]

/**
 * 设置弹窗（Typora 风格：左侧分类导航 + 右侧配置面板）
 * 所有配置项通过 props 受控，持久化由 App 负责。
 */
export function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  contentWidth,
  onContentWidthChange,
  lineHeight,
  onLineHeightChange,
  contentFont,
  onContentFontChange,
  zoom,
  onZoomChange,
  autosave,
  onAutosaveChange,
  typewriter,
  onTypewriterChange,
  spellcheck,
  onSpellcheckChange,
  multiWindow,
  onMultiWindowChange,
  shortcuts,
  onShortcutsChange,
}: SettingsDialogProps): JSX.Element | null {
  const [nav, setNav] = useState('appearance')
  /** 正在录入快捷键的动作 id */
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [scError, setScError] = useState('')

  // 录入模式：捕获下一个有效组合键（capture 阶段，避免触发其它快捷键逻辑）
  useEffect(() => {
    if (!recordingId) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setRecordingId(null)
        setScError('')
        return
      }
      const combo = comboFromEvent(e)
      // 必须含 Ctrl（或功能键），避免占用单字符按键
      if (!combo || (!(e.ctrlKey || e.metaKey) && !/^F\d{1,2}$/.test(e.key))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const conflict = Object.entries(shortcuts).find(([a, c]) => a !== recordingId && c === combo)
      if (conflict) {
        const def = SHORTCUT_ACTIONS.find((d) => d.id === conflict[0])
        setScError(`该组合键已被“${def?.label ?? conflict[0]}”占用`)
        return
      }
      onShortcutsChange({ ...shortcuts, [recordingId]: combo })
      setScError('')
      setRecordingId(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [recordingId, shortcuts, onShortcutsChange])

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

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 左侧导航 */}
        <div className="dialog-nav">
          <div className="dialog-nav-title">设置</div>
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`dialog-nav-item ${nav === item.id ? 'active' : ''}`}
              onClick={() => setNav(item.id)}
            >
              {item.label}
            </div>
          ))}
        </div>

        {/* 右侧面板 */}
        <div className="dialog-body">
          <div className="dialog-close" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>

          {nav === 'appearance' && (
            <>
              <div className="settings-section-title">主题</div>
              <div className="theme-cards">
                {THEMES.map((t) => (
                  <div
                    key={t.id}
                    className={`theme-card ${theme === t.id ? 'on' : ''}`}
                    onClick={() => onThemeChange(t.id)}
                  >
                    <span className="theme-card-dot" style={{ background: t.color }} />
                    <span className="theme-card-name">{t.name}</span>
                    <span className="theme-card-desc">{t.desc}</span>
                  </div>
                ))}
              </div>

              <div className="settings-section-title">正文字号</div>
              <div className="settings-row">
                <span className="settings-label">编辑器文字大小</span>
                <div className="seg">
                  {FONT_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className={`seg-item ${fontSize === opt.id ? 'on' : ''}`}
                      onClick={() => onFontSizeChange(opt.id)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">内容宽度</span>
                <div className="seg">
                  {WIDTH_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className={`seg-item ${contentWidth === opt.id ? 'on' : ''}`}
                      onClick={() => onContentWidthChange(opt.id)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">行距</span>
                <div className="seg">
                  {LINE_HEIGHT_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className={`seg-item ${lineHeight === opt.id ? 'on' : ''}`}
                      onClick={() => onLineHeightChange(opt.id)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">内容字体</span>
                <div className="seg">
                  {CONTENT_FONT_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className={`seg-item ${contentFont === opt.id ? 'on' : ''}`}
                      onClick={() => onContentFontChange(opt.id)}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-section-title">缩放</div>
              <div className="settings-row">
                <span className="settings-label">
                  整体缩放（{Math.round(zoom * 100)}%）
                </span>
                <div className="zoom-ctrl">
                  <div
                    className="zoom-btn"
                    onClick={() => onZoomChange(Math.max(0.7, +(zoom - 0.1).toFixed(2)))}
                  >
                    −
                  </div>
                  <div className="zoom-btn" onClick={() => onZoomChange(1)}>
                    重置
                  </div>
                  <div
                    className="zoom-btn"
                    onClick={() => onZoomChange(Math.min(1.8, +(zoom + 0.1).toFixed(2)))}
                  >
                    +
                  </div>
                </div>
              </div>
            </>
          )}

          {nav === 'editor' && (
            <>
              <div className="settings-section-title">编辑</div>
              <div className="settings-row settings-row-toggle" onClick={() => onAutosaveChange(!autosave)}>
                <span className="settings-label">
                  自动保存
                  <span className="settings-hint">磁盘文件每 30 秒自动写回</span>
                </span>
                <div className={`switch ${autosave ? 'on' : ''}`} />
              </div>
              <div className="settings-row settings-row-toggle" onClick={() => onTypewriterChange(!typewriter)}>
                <span className="settings-label">
                  打字机模式
                  <span className="settings-hint">光标所在行始终保持屏幕居中</span>
                </span>
                <div className={`switch ${typewriter ? 'on' : ''}`} />
              </div>
              <div className="settings-row settings-row-toggle" onClick={() => onSpellcheckChange(!spellcheck)}>
                <span className="settings-label">
                  拼写检查（英文）
                  <span className="settings-hint">仅检查正文，代码块与行内代码自动排除</span>
                </span>
                <div className={`switch ${spellcheck ? 'on' : ''}`} />
              </div>
              <div className="settings-row settings-row-toggle" onClick={() => onMultiWindowChange(!multiWindow)}>
                <span className="settings-label">
                  多窗口模式
                  <span className="settings-hint">允许同时打开多个窗口（重启后生效）</span>
                </span>
                <div className={`switch ${multiWindow ? 'on' : ''}`} />
              </div>
            </>
          )}

          {nav === 'shortcuts' && (
            <>
              <div className="settings-section-title">全局快捷键</div>
              <div className="sc-tip">
                点击"修改"后按下新组合键（需含 Ctrl 或为功能键），Esc 取消；"清除"可停用该快捷键
              </div>
              {scError && <div className="sc-error">{scError}</div>}
              {SHORTCUT_ACTIONS.map((def) => (
                <div className="settings-row sc-row" key={def.id}>
                  <span className="settings-label">{def.label}</span>
                  <div className="sc-edit-group">
                    <span className={`sc-combo ${recordingId === def.id ? 'recording' : ''}`}>
                      {recordingId === def.id
                        ? '按下组合键…'
                        : shortcuts[def.id] || '未设置'}
                    </span>
                    <div
                      className="sc-btn"
                      onClick={() => {
                        setRecordingId(def.id)
                        setScError('')
                      }}
                    >
                      修改
                    </div>
                    {shortcuts[def.id] && recordingId !== def.id && (
                      <div
                        className="sc-btn"
                        onClick={() => onShortcutsChange({ ...shortcuts, [def.id]: '' })}
                      >
                        清除
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div
                className="sc-reset"
                onClick={() => {
                  onShortcutsChange({ ...DEFAULT_SHORTCUTS })
                  setScError('')
                  setRecordingId(null)
                }}
              >
                恢复默认快捷键
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
