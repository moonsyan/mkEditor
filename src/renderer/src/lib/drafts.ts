/** 草稿数据（崩溃/退出后恢复未保存内容） */
export type DraftMap = Record<string, { content: string; savedAt: number }>

/** 读取全部草稿 */
export async function loadDrafts(): Promise<DraftMap> {
  if (!window.desktopAPI) return {}
  const res = await window.desktopAPI.settings.get('drafts')
  return (res?.ok && res.data ? res.data : {}) as DraftMap
}

/** 原子保存单篇草稿，避免旧的完整草稿副本覆盖其他文档。 */
export async function saveDraft(id: string, content: string): Promise<void> {
  if (!window.desktopAPI) return
  const res = await window.desktopAPI.settings.upsertDraft(id, content)
  if (!res.ok) throw new Error(res.error?.code ?? 'DRAFT_SAVE_FAILED')
}

/** 原子删除单篇草稿，保留其他标签或窗口的草稿。 */
export async function deleteDraft(id: string): Promise<void> {
  if (!window.desktopAPI) return
  const res = await window.desktopAPI.settings.deleteDraft(id)
  if (!res.ok) throw new Error(res.error?.code ?? 'DRAFT_DELETE_FAILED')
}
