import type { OpenFile } from '../components/Sidebar'

export interface DocumentTabState {
  openFiles: OpenFile[]
  activeFileId: string
  contents: Record<string, string>
  savedMap: Record<string, boolean>
  savedContents: Record<string, string>
}

export const isDocumentDirty = (content: string, savedContent: string): boolean =>
  content !== savedContent

export const pinPreviewOpenFile = (openFiles: OpenFile[], fileId: string): OpenFile[] =>
  openFiles.map((file) => (file.id === fileId && file.preview ? { ...file, preview: false } : file))

export const findDiscardablePreview = (
  openFiles: OpenFile[],
  nextFileId: string,
): OpenFile | undefined => openFiles.find((file) => file.preview && file.id !== nextFileId)

export const getNeighborTabId = (openFiles: OpenFile[], fileId: string): string | null => {
  const index = openFiles.findIndex((file) => file.id === fileId)
  if (index === -1) return null
  return openFiles[index + 1]?.id ?? openFiles[index - 1]?.id ?? null
}

export const reorderTabs = (
  openFiles: OpenFile[],
  from: number,
  to: number,
): OpenFile[] => {
  if (
    from === to ||
    from < 0 ||
    from >= openFiles.length ||
    to < 0 ||
    to >= openFiles.length
  ) {
    return openFiles
  }
  const next = [...openFiles]
  const [moved] = next.splice(from, 1)
  if (!moved) return openFiles
  next.splice(to, 0, moved)
  return next
}

export type DocumentTabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/** 返回键盘导航后的标签；左右方向键会在首尾之间循环。 */
export const getTabNavigationTargetId = (
  openFiles: OpenFile[],
  fileId: string,
  key: DocumentTabNavigationKey,
): string | null => {
  const index = openFiles.findIndex((file) => file.id === fileId)
  if (index === -1 || openFiles.length === 0) return null
  if (key === 'Home') return openFiles[0].id
  if (key === 'End') return openFiles[openFiles.length - 1].id
  const offset = key === 'ArrowRight' ? 1 : -1
  return openFiles[(index + offset + openFiles.length) % openFiles.length].id
}

export const requiresCloseConfirmation = (
  savedMap: Record<string, boolean>,
  fileId: string,
): boolean => savedMap[fileId] === false

export const updateDocumentContent = (
  state: DocumentTabState,
  fileId: string,
  content: string,
): DocumentTabState => {
  const isSaved = !isDocumentDirty(content, state.savedContents[fileId] ?? '')
  return {
    ...state,
    openFiles: isSaved ? state.openFiles : pinPreviewOpenFile(state.openFiles, fileId),
    contents: { ...state.contents, [fileId]: content },
    savedMap: { ...state.savedMap, [fileId]: isSaved },
  }
}
