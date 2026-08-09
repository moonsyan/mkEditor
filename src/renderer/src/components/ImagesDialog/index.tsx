import { useState, useEffect, useCallback } from 'react'

interface ImageItem {
  path: string
  name: string
  size: number
}

interface ImagesDialogProps {
  open: boolean
  onClose: () => void
  /** 扫描目录列表（文档旁 attachments / 工作区 attachments / 用户数据目录） */
  dirs: string[]
  /** 删除后回调（用于提示） */
  onNotify?: (msg: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 图片管理面板：列出所有已保存的图片附件，支持预览与删除（移入回收站）
 */
export function ImagesDialog({ open, onClose, dirs, onNotify }: ImagesDialogProps): JSX.Element | null {
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ImageItem | null>(null)

  const loadImages = useCallback(async () => {
    if (!window.desktopAPI) return
    setLoading(true)
    const res = await window.desktopAPI.workspace.listImages(dirs)
    if (res.ok && res.data) setImages(res.data.images)
    setLoading(false)
  }, [dirs])

  // 打开时加载
  useEffect(() => {
    if (open) void loadImages()
  }, [open, loadImages])

  // Esc 关闭（先关预览再关面板）
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (preview) setPreview(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, preview, onClose])

  const handleDelete = async (img: ImageItem) => {
    if (!window.desktopAPI) return
    if (!window.confirm(`确定删除图片“${img.name}”吗？\n将移入回收站，可恢复。`)) return
    const res = await window.desktopAPI.workspace.deleteImage(img.path)
    if (res.ok) {
      setImages((prev) => prev.filter((i) => i.path !== img.path))
      onNotify?.('图片已移入回收站')
    } else {
      onNotify?.('删除失败')
    }
  }

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog images-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">
            图片管理{images.length > 0 ? `（${images.length} 张）` : ''}
          </span>
          <div className="dialog-close" onClick={onClose} title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </div>

        <div className="help-body images-body">
          {loading ? (
            <div className="images-empty">加载中…</div>
          ) : images.length === 0 ? (
            <div className="images-empty">
              暂无图片附件
              <br />
              <span className="images-empty-hint">
                粘贴或拖入编辑器的图片会保存在文档旁的 attachments 文件夹
              </span>
            </div>
          ) : (
            <div className="images-grid">
              {images.map((img) => (
                <div key={img.path} className="image-card">
                  <div
                    className="image-thumb"
                    onClick={() => setPreview(img)}
                    title="点击预览"
                  >
                    <img src={`mdimg:///${img.path.replace(/\\/g, '/')}`} alt={img.name} />
                  </div>
                  <div className="image-meta">
                    <span className="image-name" title={img.name}>
                      {img.name}
                    </span>
                    <span className="image-size">{formatSize(img.size)}</span>
                    <div
                      className="image-del"
                      onClick={() => void handleDelete(img)}
                      title="移入回收站"
                    >
                      <svg viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 大图预览 */}
        {preview && (
          <div className="image-preview-overlay" onClick={() => setPreview(null)}>
            <img
              src={`mdimg:///${preview.path.replace(/\\/g, '/')}`}
              alt={preview.name}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="image-preview-name">{preview.name}</div>
          </div>
        )}
      </div>
    </div>
  )
}
