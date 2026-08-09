import { useState } from 'react'

/** PDF 导出选项（传给主进程 printToPDF） */
export interface PdfOptions {
  /** 纸张尺寸 */
  pageSize: 'A4' | 'Letter' | 'A5' | 'Legal'
  /** 页边距档位 */
  margins: 'narrow' | 'standard' | 'wide'
  /** 是否显示页眉页脚（文档标题 + 页码） */
  headerFooter: boolean
  /** 是否在首页生成目录（标题≥2 个时生效） */
  toc: boolean
}

interface ExportPdfDialogProps {
  open: boolean
  onClose: () => void
  /** 确认后执行导出 */
  onExport: (options: PdfOptions) => void
}

const PAGE_SIZES: { id: PdfOptions['pageSize']; label: string }[] = [
  { id: 'A4', label: 'A4' },
  { id: 'Letter', label: 'Letter' },
  { id: 'A5', label: 'A5' },
  { id: 'Legal', label: 'Legal' },
]

const MARGIN_OPTIONS: { id: PdfOptions['margins']; label: string }[] = [
  { id: 'narrow', label: '窄' },
  { id: 'standard', label: '标准' },
  { id: 'wide', label: '宽' },
]

/**
 * PDF 导出选项弹窗：纸张尺寸 / 页边距 / 页眉页脚
 * 样式复用 settings.css 的 dialog 与分段控件。
 */
export function ExportPdfDialog({
  open,
  onClose,
  onExport,
}: ExportPdfDialogProps): JSX.Element | null {
  const [pageSize, setPageSize] = useState<PdfOptions['pageSize']>('A4')
  const [margins, setMargins] = useState<PdfOptions['margins']>('standard')
  const [headerFooter, setHeaderFooter] = useState(true)
  const [toc, setToc] = useState(false)

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog pdf-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">导出 PDF</span>
          <div className="dialog-close" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </div>
        <div className="pdf-dialog-body">
          <div className="settings-row">
            <span className="settings-label">纸张尺寸</span>
            <div className="seg">
              {PAGE_SIZES.map((opt) => (
                <div
                  key={opt.id}
                  className={`seg-item ${pageSize === opt.id ? 'on' : ''}`}
                  onClick={() => setPageSize(opt.id)}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-label">页边距</span>
            <div className="seg">
              {MARGIN_OPTIONS.map((opt) => (
                <div
                  key={opt.id}
                  className={`seg-item ${margins === opt.id ? 'on' : ''}`}
                  onClick={() => setMargins(opt.id)}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
          <div
            className="settings-row settings-row-toggle"
            onClick={() => setHeaderFooter((v) => !v)}
          >
            <span className="settings-label">
              页眉页脚
              <span className="settings-hint">页眉显示文档标题，页脚显示页码</span>
            </span>
            <div className={`switch ${headerFooter ? 'on' : ''}`} />
          </div>
          <div
            className="settings-row settings-row-toggle"
            onClick={() => setToc((v) => !v)}
          >
            <span className="settings-label">
              目录页
              <span className="settings-hint">首页生成可跳转目录（H1–H3，标题≥2 个时生效）</span>
            </span>
            <div className={`switch ${toc ? 'on' : ''}`} />
          </div>
          <div className="pdf-dialog-actions">
            <div className="sc-btn" onClick={onClose}>
              取消
            </div>
            <div
              className="sc-btn pdf-export-btn"
              onClick={() => onExport({ pageSize, margins, headerFooter, toc })}
            >
              导出
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
