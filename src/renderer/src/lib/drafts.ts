/** 草稿数据（崩溃/退出后恢复未保存内容） */
export type DraftMap = Record<string, { content: string; savedAt: number }>

/** 读取全部草稿 */
export async function loadDrafts(): Promise<DraftMap> {
  if (!window.desktopAPI) return {}
  const res = await window.desktopAPI.settings.get('drafts')
  return (res?.ok && res.data ? res.data : {}) as DraftMap
}

/** 写回全部草稿 */
export async function saveDrafts(drafts: DraftMap): Promise<void> {
  await window.desktopAPI?.settings.set('drafts', drafts)
}
