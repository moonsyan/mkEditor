import { describe, expect, it } from 'vitest'
import {
  deleteFrontmatterProperty,
  extractFrontmatterRaw,
  setFrontmatterProperty,
} from './frontmatter-parser'

describe('frontmatter 属性编辑', () => {
  it('正确提取 CRLF 文档中的 frontmatter 文本', () => {
    const markdown = '---\r\ntitle: A\r\ntags: [x, y]\r\n---\r\n\r\n# 标题'
    const extracted = extractFrontmatterRaw(markdown)

    expect(extracted?.text).toBe('title: A\r\ntags: [x, y]')
    expect(markdown.slice(extracted?.end)).toBe('\r\n\r\n# 标题')
  })

  it('更新单个属性时保留注释与其他 YAML 行', () => {
    const markdown = '---\r\n# 注释\r\ntitle: A\r\ntags:\r\n  - x\r\n---\r\n正文'
    const next = setFrontmatterProperty(markdown, 'title', 'B')

    expect(next).toBe('---\r\n# 注释\r\ntitle: B\r\ntags:\r\n  - x\r\n---\r\n正文')
  })

  it('删除最后一个属性时移除 frontmatter 围栏且不残留 CRLF', () => {
    const markdown = '---\r\ntitle: A\r\n---\r\n正文'

    expect(deleteFrontmatterProperty(markdown, 'title')).toBe('正文')
  })
})
