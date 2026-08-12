import { describe, expect, it } from 'vitest'
import { isCurrentEditorChange } from './editor-sync'

describe('编辑器内容回调归属', () => {
  it('接受仍与当前编辑器状态一致的回调', () => {
    expect(isCurrentEditorChange('# 当前文档', '# 当前文档')).toBe(true)
  })

  it('拒绝切换文档后仍在防抖队列中的旧回调', () => {
    expect(isCurrentEditorChange('# 旧文档', '# 当前文档')).toBe(false)
  })

  it('编辑器未就绪时不阻断回调', () => {
    expect(isCurrentEditorChange('# 文档', null)).toBe(true)
  })
})
