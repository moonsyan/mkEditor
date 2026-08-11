import { describe, expect, it } from 'vitest'
import { toEditorImages, toStoredImages } from './image-path'

describe('图片路径回写', () => {
  it('不含编辑器图片协议时保留原字符串引用', () => {
    const markdown = '普通文本\n![远程图片](https://example.com/image.png)'
    expect(toStoredImages(markdown, 'E:/notes')).toBe(markdown)
  })

  it('把当前文档目录下的编辑器图片路径还原为相对路径', () => {
    const markdown = '![封面](mdimg:///E:/notes/assets/cover.png)'
    expect(toStoredImages(markdown, 'E:/notes')).toBe('![封面](assets/cover.png)')
  })

  it('编码图片路径中的 URL 特殊字符并可正确回写', () => {
    const markdown = '![图片](assets/封面 #1?.png)'
    const editorMarkdown = toEditorImages(markdown, 'E:/notes')
    expect(editorMarkdown).toContain('mdimg:///E%3A/notes/assets/')
    expect(editorMarkdown).toContain('%23')
    expect(editorMarkdown).toContain('%3F')
    expect(toStoredImages(editorMarkdown, 'E:/notes')).toBe(markdown)
  })
})
