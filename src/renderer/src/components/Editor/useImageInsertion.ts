import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { toMdimgUrl } from '../../lib/image-path'

export interface EditorImageHints {
  documentId?: string
  docPath?: string
  workspacePath?: string
  imageHost?: { provider: 'local' | 'smms'; configured: boolean }
}

interface UseImageInsertionOptions {
  imageHintsRef: MutableRefObject<EditorImageHints | undefined>
  insertMarkdown: (markdown: string) => void
  notify: (message: string) => void
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024

const readAsDataUrl = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })

/**
 * 串行保存粘贴或拖入的图片，保证 Markdown 中的插入顺序与用户选择顺序一致。
 */
export function useImageInsertion({
  imageHintsRef,
  insertMarkdown,
  notify,
}: UseImageInsertionOptions): {
  handlePaste: (event: React.ClipboardEvent) => void
  handleDrop: (event: React.DragEvent) => void
  handleDragOver: (event: React.DragEvent) => void
} {
  const imageQueueRef = useRef<Promise<void>>(Promise.resolve())

  const insertImageFileTask = useCallback(
    async (file: File, imageHints: EditorImageHints | undefined) => {
      if (!window.desktopAPI) return
      if (file.size > MAX_IMAGE_SIZE) {
        notify('图片超过 20MB，无法插入')
        return
      }

      const documentId = imageHints?.documentId
      const dataUrl = await readAsDataUrl(file)
      if (!dataUrl) return

      const host = imageHints?.imageHost
      if (host?.provider === 'smms' && host.configured) {
        const upload = await window.desktopAPI.document.uploadImage(dataUrl)
        if (upload.ok && upload.data?.url) {
          if (imageHintsRef.current?.documentId !== documentId) {
            notify('已切换文档，图片未插入')
            return
          }
          const alt = file.name.replace(/\.[^.]+$/, '')
          insertMarkdown(`![${alt}](${upload.data.url})`)
          return
        }
        notify('图床上传失败，已改为保存到本地')
      }

      const result = await window.desktopAPI.document.saveImage(dataUrl, {
        docPath: imageHints?.docPath,
        workspacePath: imageHints?.workspacePath,
      })
      if (!result.ok || !result.data) return
      if (imageHintsRef.current?.documentId !== documentId) {
        notify('已切换文档，图片已保存但未插入')
        return
      }
      const url = toMdimgUrl(result.data.path)
      insertMarkdown(`![${result.data.name}](${url})`)
    },
    [imageHintsRef, insertMarkdown, notify],
  )

  const insertImageFile = useCallback(
    (file: File) => {
      const imageHints = imageHintsRef.current
      imageQueueRef.current = imageQueueRef.current
        .then(() => insertImageFileTask(file, imageHints))
        .catch(() => {})
    },
    [insertImageFileTask],
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? [])
      const file = items.find((item) => item.type.startsWith('image/'))?.getAsFile()
      if (!file) return
      event.preventDefault()
      insertImageFile(file)
    },
    [insertImageFile],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      // M10：dragOver 已对所有文件 preventDefault（接受拖放），
      // drop 必须同样拦截，否则 .pdf/.docx 等非图片会落入浏览器默认导航、整个窗口跳走
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (files.length === 0) return
      files.forEach(insertImageFile)
    },
    [insertImageFile],
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    const hasFile = Array.from(event.dataTransfer?.items ?? []).some(
      (item) => item.kind === 'file',
    )
    if (hasFile) event.preventDefault()
  }, [])

  return { handlePaste, handleDrop, handleDragOver }
}
