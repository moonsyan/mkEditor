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
  /** E4：切换标签冲刷草稿时读取编辑器实时内容，避免 200ms 防抖窗口内内容滞后 */
  getLiveContent?: (id: string) => string
}

/**
 * 将当前文档变更防抖写为草稿，并在切换标签时同步落盘最后一次输入。
 */
export function useDraftPersistence({
  activeFileId,
  content,
  ready,
  getLiveContent,
}: UseDraftPersistenceOptions): {
  clearDraft: (id: string) => Promise<void>
  draftPendingRef: MutableRefObject<PendingDraft | null>
  saveDraft: (id: string, content: string) => Promise<void>
} {
  const draftPendingRef = useRef<PendingDraft | null>(null)
  const activeFileIdRef = useRef(activeFileId)
  activeFileIdRef.current = activeFileId
  /** E5：已显式清除草稿的 id（关闭标签、丢弃修改等），
   *  防抖定时器与切换冲刷都要跳过，避免草稿被"复活" */
  const clearedDraftsRef = useRef<Set<string>>(new Set())

  const clearDraft = useCallback(async (id: string) => {
    clearedDraftsRef.current.add(id)
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
    if (clearedDraftsRef.current.has(pending.id)) return
    // E4：状态内容最多滞后 200ms（markdownUpdated 防抖），
    // 冲刷时优先用编辑器实时内容兜底
    const fresh = getLiveContent?.(pending.id)
    void saveDraft(pending.id, fresh ?? pending.content).catch(() => {})
  }, [getLiveContent, saveDraft])

  useEffect(() => {
    if (!ready) return
    // 重新打开/切换回某文件后，该文件不再处于"已清除"状态
    clearedDraftsRef.current.delete(activeFileId)
    draftPendingRef.current = { id: activeFileId, content }
    let didWrite = false
    const timer = setTimeout(() => {
      // E5：clearDraft 之后定时器不得复活草稿（如关闭最后一个标签时，
      // activeFileId 不变、effect 清理不触发，定时器仍会执行）
      if (clearedDraftsRef.current.has(activeFileId)) return
      didWrite = true
      draftPendingRef.current = null
      void saveDraft(activeFileId, content).catch(() => {})
    }, 1000)

    return () => {
      clearTimeout(timer)
      if (!didWrite && activeFileIdRef.current !== activeFileId) flushPendingDraft()
    }
  }, [activeFileId, content, flushPendingDraft, getLiveContent, ready, saveDraft])

  return { clearDraft, draftPendingRef, saveDraft }
}
