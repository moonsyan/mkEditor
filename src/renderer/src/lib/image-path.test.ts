import { describe, expect, it } from 'vitest'
import { toStoredImages } from './image-path'

describe('图片路径回写', () => {
  it('不含编辑器图片协议时保留原字符串引用', () => {
    const markdown = '普通文本\n![远程图片](https://example.com/image.png)'
    expect(toStoredImages(markdown, 'E:/notes')).toBe(markdown)
  })

  it('把当前文档目录下的编辑器图片路径还原为相对路径', () => {
    const markdown = '![封面](mdimg:///E:/notes/assets/cover.png)'
    expect(toStoredImages(markdown, 'E:/notes')).toBe('![封面](assets/cover.png)')
  })
})
