import { describe, expect, it } from 'vitest'
import { toEditorImages, toMdimgUrl, toStoredImages } from './image-path'

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
    expect(editorMarkdown).toContain(toMdimgUrl('E:/notes/assets/封面 #1?.png'))
    expect(editorMarkdown).toContain('%23')
    expect(editorMarkdown).toContain('%3F')
    expect(toStoredImages(editorMarkdown, 'E:/notes')).toBe(markdown)
  })

  it('文件名含括号（Windows 重复下载命名）时往返不截断', () => {
    const markdown = '![截图](attachments/screenshot(1).png)'
    const editorMarkdown = toEditorImages(markdown, 'E:/notes')
    // encodeURIComponent 不编码括号，括号原样出现在 mdimg URL 中；
    // 关键是 src 必须完整（不被第一个 `)` 截断）且可 round-trip 还原
    expect(editorMarkdown).toContain('attachments/screenshot(1).png)')
    expect(toStoredImages(editorMarkdown, 'E:/notes')).toBe(markdown)
  })

  it('文件名含嵌套括号时保留原样不截断（正则保守回退）', () => {
    const markdown = '![a](assets/x(a(b)).png)'
    const editorMarkdown = toEditorImages(markdown, 'E:/notes')
    // 嵌套括号无法被配对正则匹配 → src 保持相对路径原文，绝不被截断
    expect(editorMarkdown).toBe(markdown)
  })
})
