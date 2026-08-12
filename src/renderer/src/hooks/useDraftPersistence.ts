import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { deleteDraft, saveDraft as persistDraft } from '../lib/drafts'

export interface PendingDraft {
  id: string
  content: string
}

interface UseDraftPersistenceOptions {
  activeFileId: string
  content: string
  ready: boolean
}

/**
 * 将当前文档变更防抖写为草稿，并在切换标签时同步落盘最后一次输入。
 */
export function useDraftPersistence({
  activeFileId,
  content,
  ready,
}: UseDraftPersistenceOptions): {
  clearDraft: (id: string) => Promise<void>
  draftPendingRef: MutableRefObject<PendingDraft | null>
  saveDraft: (id: string, content: string) => Promise<void>
} {
  const draftPendingRef = useRef<PendingDraft | null>(null)
  const activeFileIdRef = useRef(activeFileId)
  activeFileIdRef.current = activeFileId

  const clearDraft = useCallback(async (id: string) => {
    try {
      await deleteDraft(id)
    } catch {
      // 草稿清理失败不影响主保存流程。
    }
  }, [])

  const saveDraft = useCallback(async (id: string, draftContent: string) => {
    await persistDraft(id, draftContent)
  }, [])

  const flushPendingDraft = useCallback(() => {
    const pending = draftPendingRef.current
    if (!pending) return
    draftPendingRef.current = null
    void saveDraft(pending.id, pending.content).catch(() => {})
  }, [saveDraft])

  useEffect(() => {
    if (!ready) return
    draftPendingRef.current = { id: activeFileId, content }
    let didWrite = false
    const timer = setTimeout(() => {
      didWrite = true
      draftPendingRef.current = null
      void saveDraft(activeFileId, content).catch(() => {})
    }, 1000)

    return () => {
      clearTimeout(timer)
      if (!didWrite && activeFileIdRef.current !== activeFileId) flushPendingDraft()
    }
  }, [activeFileId, content, flushPendingDraft, ready, saveDraft])

  return { clearDraft, draftPendingRef, saveDraft }
}
