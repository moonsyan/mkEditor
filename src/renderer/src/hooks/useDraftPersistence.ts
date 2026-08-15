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
  /**
   * 禁用草稿持久化（fresh 窗口）：草稿经 settings-store 共享，fresh 窗口
   * 写入/删除草稿会覆盖或误删主窗口同一文件的未保存内容（两个窗口对同一
   * 文件有不同编辑状态）。fresh 窗口不写不删草稿，未保存内容仅在窗口
   * 生命周期内有效
   */
  enabled?: boolean
}

/**
 * 将当前文档变更防抖写为草稿，并在切换标签时同步落盘最后一次输入。
 */
export function useDraftPersistence({
  activeFileId,
  content,
  ready,
  getLiveContent,
  enabled = true,
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
    if (!enabled) return
    clearedDraftsRef.current.add(id)
    try {
      await deleteDraft(id)
    } catch {
      // 草稿清理失败不影响主保存流程。
    }
  }, [enabled])

  const saveDraft = useCallback(async (id: string, draftContent: string) => {
    if (!enabled) return
    await persistDraft(id, draftContent)
  }, [enabled])

  const flushPendingDraft = useCallback(() => {
    if (!enabled) return
    const pending = draftPendingRef.current
    if (!pending) return
    draftPendingRef.current = null
    if (clearedDraftsRef.current.has(pending.id)) return
    // E4：状态内容最多滞后 200ms（markdownUpdated 防抖），
    // 冲刷时优先用编辑器实时内容兜底
    const fresh = getLiveContent?.(pending.id)
    void saveDraft(pending.id, fresh ?? pending.content).catch(() => {})
  }, [enabled, getLiveContent, saveDraft])

  useEffect(() => {
    if (!ready || !enabled) return
    // X-M1：已显式清除（关闭标签）的文件在内容变空时不得复活草稿——
    // 原实现每次 content 变化都删除清除标记，关闭最后一个标签后
    // content 变 ''、activeFileId 不变，标记被删、定时器 1 秒后把空草稿
    // 写回已关闭的文件；重启后以空白+脏恢复，Ctrl+S 会用空内容覆盖磁盘原文
    if (content === '' && clearedDraftsRef.current.has(activeFileId)) return
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
  }, [activeFileId, content, flushPendingDraft, getLiveContent, ready, saveDraft, enabled])

  return { clearDraft, draftPendingRef, saveDraft }
}
