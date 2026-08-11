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
