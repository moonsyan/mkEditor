import { useState, useEffect } from 'react'
import type { ShortcutMap } from '../../data/shortcuts'
import { isImeComposing } from '../../lib/keyboard'
import { NAV_ITEMS } from './constants'
import { AppearancePanel } from './AppearancePanel'
import { EditorPanel } from './EditorPanel'
import { ShortcutsPanel } from './ShortcutsPanel'

/** 编辑区字号（像素，逐像素可调，对标 Typora） */
export type FontSize = number

/** 内容宽度（像素，逐像素可调，对标 Typora） */
export type ContentWidth = number

/** 行距（倍数，逐档可调，对标 Typora） */
export type LineHeight = number

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
  /** 拼写检查语言（B4 部分改善：Electron 内置词典） */
  spellcheckLang: string
  onSpellcheckLangChange: (value: string) => void
  multiWindow: boolean
  onMultiWindowChange: (value: boolean) => void
  /** 点击正文下方空白区跳到文末（U8） */
  blankClickToEnd: boolean
  onBlankClickToEndChange: (value: boolean) => void
  /** 代码块行号开关 */
  codeLineNumbers: boolean
  onCodeLineNumbersChange: (value: boolean) => void
  /** 自定义主题 CSS（已导入的文件名，null 未导入） */
  customCssName?: string | null
  onImportCss: () => void
  onRemoveCss: () => void
  /** 图床配置 */
  imageHost: { provider: 'local' | 'smms'; configured: boolean }
  onImageHostProviderChange: (provider: 'local' | 'smms') => Promise<void>
  onImageHostTokenSave: (token: string) => Promise<boolean>
  /** 快捷键 */
  shortcuts: ShortcutMap
  onShortcutsChange: (map: ShortcutMap) => void
}

/**
 * 设置弹窗（Typora 风格：左侧分类导航 + 右侧配置面板）
 * 所有配置项通过 props 受控，持久化由 App 负责。
 * 三个面板拆分在同目录：AppearancePanel / EditorPanel / ShortcutsPanel。
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
  spellcheckLang,
  onSpellcheckLangChange,
  multiWindow,
  onMultiWindowChange,
  blankClickToEnd,
  onBlankClickToEndChange,
  codeLineNumbers,
  onCodeLineNumbersChange,
  customCssName,
  onImportCss,
  onRemoveCss,
  imageHost,
  onImageHostProviderChange,
  onImageHostTokenSave,
  shortcuts,
  onShortcutsChange,
}: SettingsDialogProps): JSX.Element | null {
  const [nav, setNav] = useState('appearance')

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return
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
            <button
              type="button"
              key={item.id}
              className={`dialog-nav-item ${nav === item.id ? 'active' : ''}`}
              aria-current={nav === item.id ? 'page' : undefined}
              onClick={() => setNav(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 右侧面板 */}
        <div className="dialog-body">
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭" title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {nav === 'appearance' && (
            <AppearancePanel
              theme={theme}
              onThemeChange={onThemeChange}
              fontSize={fontSize}
              onFontSizeChange={onFontSizeChange}
              contentWidth={contentWidth}
              onContentWidthChange={onContentWidthChange}
              lineHeight={lineHeight}
              onLineHeightChange={onLineHeightChange}
              contentFont={contentFont}
              onContentFontChange={onContentFontChange}
              zoom={zoom}
              onZoomChange={onZoomChange}
              customCssName={customCssName}
              onImportCss={onImportCss}
              onRemoveCss={onRemoveCss}
            />
          )}

          {nav === 'editor' && (
            <EditorPanel
              autosave={autosave}
              onAutosaveChange={onAutosaveChange}
              typewriter={typewriter}
              onTypewriterChange={onTypewriterChange}
              spellcheck={spellcheck}
              onSpellcheckChange={onSpellcheckChange}
              spellcheckLang={spellcheckLang}
              onSpellcheckLangChange={onSpellcheckLangChange}
              multiWindow={multiWindow}
              onMultiWindowChange={onMultiWindowChange}
              blankClickToEnd={blankClickToEnd}
              onBlankClickToEndChange={onBlankClickToEndChange}
              codeLineNumbers={codeLineNumbers}
              onCodeLineNumbersChange={onCodeLineNumbersChange}
              imageHost={imageHost}
              onImageHostProviderChange={onImageHostProviderChange}
              onImageHostTokenSave={onImageHostTokenSave}
            />
          )}

          {nav === 'shortcuts' && (
            <ShortcutsPanel shortcuts={shortcuts} onShortcutsChange={onShortcutsChange} />
          )}
        </div>
      </div>
    </div>
  )
}
