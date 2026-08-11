import { useEffect } from 'react'
import type { OpenFile, WorkspaceInfo } from '../components/Sidebar'

export interface SessionData {
  activeFileId?: string
  files?: { id: string; name: string; path?: string }[]
  workspacePath?: string
}

interface UseDocumentSessionPersistenceOptions {
  activeFileId: string
  demoFileIds: ReadonlySet<string>
  freshMode: boolean
  openFiles: OpenFile[]
  ready: boolean
  workspace: WorkspaceInfo | null
}

/** 恢复后仅持久化真实文件标签，避免演示文件和新窗口覆盖主会话。 */
export function useDocumentSessionPersistence({
  activeFileId,
  demoFileIds,
  freshMode,
  openFiles,
  ready,
  workspace,
}: UseDocumentSessionPersistenceOptions): void {
  useEffect(() => {
    if (freshMode || !ready) return
    const seen = new Set<string>()
    const files = openFiles
      .filter((file) => !demoFileIds.has(file.id) && file.id && !seen.has(file.id) && seen.add(file.id))
      .slice(0, 200)
      .map((file) => ({ id: file.id, name: file.name, path: file.path }))
    const data: SessionData = {
      activeFileId: openFiles.some((file) => file.id === activeFileId) ? activeFileId : undefined,
      workspacePath: workspace?.path,
      files,
    }
    window.desktopAPI?.settings.set('session', data).catch(() => {})
  }, [activeFileId, demoFileIds, freshMode, openFiles, ready, workspace])
}
