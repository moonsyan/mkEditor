import type { FontSize, ContentWidth, LineHeight, ContentFont } from './index'
import {
  THEMES,
  FONT_PRESETS,
  WIDTH_PRESETS,
  LINE_PRESETS,
  CONTENT_FONT_OPTIONS,
} from './constants'

interface AppearancePanelProps {
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
  customCssName?: string | null
  onImportCss: () => void
  onRemoveCss: () => void
}

/** 外观面板：主题 / 字号 / 内容宽度 / 行距 / 字体 / 缩放 / 自定义主题 */
export function AppearancePanel({
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
  customCssName,
  onImportCss,
  onRemoveCss,
}: AppearancePanelProps): JSX.Element {
  return (
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
          {FONT_PRESETS.map((opt) => (
            <div
              key={opt.label}
              className={`seg-item ${Math.abs(fontSize - opt.value) < 0.01 ? 'on' : ''}`}
              onClick={() => onFontSizeChange(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">精确字号（{fontSize}px）</span>
        <input
          type="range"
          className="fine-slider"
          min={12}
          max={24}
          step={1}
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
        />
      </div>

      <div className="settings-section-title">内容宽度</div>
      <div className="settings-row">
        <span className="settings-label">内容宽度</span>
        <div className="seg">
          {WIDTH_PRESETS.map((opt) => (
            <div
              key={opt.label}
              className={`seg-item ${Math.abs(contentWidth - opt.value) < 0.5 ? 'on' : ''}`}
              onClick={() => onContentWidthChange(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">精确宽度（{contentWidth}px）</span>
        <input
          type="range"
          className="fine-slider"
          min={480}
          max={1400}
          step={20}
          value={contentWidth}
          onChange={(e) => onContentWidthChange(Number(e.target.value))}
        />
      </div>

      <div className="settings-section-title">行距</div>
      <div className="settings-row">
        <span className="settings-label">行距</span>
        <div className="seg">
          {LINE_PRESETS.map((opt) => (
            <div
              key={opt.label}
              className={`seg-item ${Math.abs(lineHeight - opt.value) < 0.001 ? 'on' : ''}`}
              onClick={() => onLineHeightChange(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">精确行距（{lineHeight.toFixed(2)}）</span>
        <input
          type="range"
          className="fine-slider"
          min={1.2}
          max={2.6}
          step={0.05}
          value={lineHeight}
          onChange={(e) => onLineHeightChange(Number(e.target.value))}
        />
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

      <div className="settings-section-title">自定义主题</div>
      <div className="settings-row">
        <span className="settings-label">
          主题 CSS
          <span className="settings-hint">
            {customCssName ? `已导入：${customCssName}` : '导入自己的 CSS 文件覆盖内置主题样式'}
          </span>
        </span>
        <div className="sc-edit-group">
          <div className="sc-btn" onClick={onImportCss}>
            {customCssName ? '重新导入' : '导入'}
          </div>
          {customCssName && (
            <div className="sc-btn" onClick={onRemoveCss}>
              移除
            </div>
          )}
        </div>
      </div>
    </>
  )
}
