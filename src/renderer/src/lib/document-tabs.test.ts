import { describe, expect, it } from 'vitest'
import {
  findDiscardablePreview,
  getNeighborTabId,
  getTabNavigationTargetId,
  reorderTabs,
  requiresCloseConfirmation,
  updateDocumentContent,
  type DocumentTabState,
} from './document-tabs'

const createState = (): DocumentTabState => ({
  openFiles: [
    { id: 'welcome', name: '欢迎.md' },
    { id: 'preview', name: '预览.md', preview: true },
  ],
  activeFileId: 'preview',
  contents: { welcome: '# 欢迎', preview: '# 原文' },
  savedMap: { welcome: true, preview: true },
  savedContents: { welcome: '# 欢迎', preview: '# 原文' },
})

describe('文档标签状态', () => {
  it('单击打开下一个文件时只替换未修改的预览标签', () => {
    const state = createState()

    expect(findDiscardablePreview(state.openFiles, 'next')?.id).toBe('preview')
    expect(findDiscardablePreview(state.openFiles, 'preview')).toBeUndefined()
  })

  it('编辑预览标签后标记未保存并自动固定', () => {
    const next = updateDocumentContent(createState(), 'preview', '# 已修改')

    expect(next.savedMap.preview).toBe(false)
    expect(next.openFiles.find((file) => file.id === 'preview')?.preview).toBe(false)
  })

  it('恢复原文后清除未保存状态，固定标签仍保留', () => {
    const edited = updateDocumentContent(createState(), 'preview', '# 已修改')
    const restored = updateDocumentContent(edited, 'preview', '# 原文')

    expect(restored.savedMap.preview).toBe(true)
    expect(restored.openFiles.find((file) => file.id === 'preview')?.preview).toBe(false)
  })

  it('关闭标签时优先切换到右侧相邻标签', () => {
    const state = createState()

    expect(getNeighborTabId(state.openFiles, 'welcome')).toBe('preview')
    expect(getNeighborTabId(state.openFiles, 'preview')).toBe('welcome')
    expect(getNeighborTabId(state.openFiles, 'missing')).toBeNull()
  })

  it('拖拽排序后保持标签顺序，忽略越界索引', () => {
    const state = createState()

    expect(reorderTabs(state.openFiles, 0, 1).map((file) => file.id)).toEqual([
      'preview',
      'welcome',
    ])
    expect(reorderTabs(state.openFiles, -1, 0)).toBe(state.openFiles)
    expect(reorderTabs(state.openFiles, 0, 2)).toBe(state.openFiles)
  })

  it('使用方向键、Home 与 End 在标签之间导航', () => {
    const state = createState()

    expect(getTabNavigationTargetId(state.openFiles, 'welcome', 'ArrowLeft')).toBe('preview')
    expect(getTabNavigationTargetId(state.openFiles, 'preview', 'ArrowRight')).toBe('welcome')
    expect(getTabNavigationTargetId(state.openFiles, 'preview', 'Home')).toBe('welcome')
    expect(getTabNavigationTargetId(state.openFiles, 'welcome', 'End')).toBe('preview')
    expect(getTabNavigationTargetId(state.openFiles, 'missing', 'ArrowRight')).toBeNull()
  })

  it('仅修改过的文档在关闭前需要确认', () => {
    const state = createState()
    const edited = updateDocumentContent(state, 'preview', '# 已修改')

    expect(requiresCloseConfirmation(state.savedMap, 'preview')).toBe(false)
    expect(requiresCloseConfirmation(edited.savedMap, 'preview')).toBe(true)
  })
})
