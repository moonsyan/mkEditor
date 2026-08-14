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

  it('L17:删除最后属性时连 frontmatter 后的分隔空行一起去掉', () => {
    // rest 为 "\n\nbody"，只去一个 \n 会残留 "\nbody"
    const withLf = '---\ntitle: A\n---\n\n# 标题'
    expect(deleteFrontmatterProperty(withLf, 'title')).toBe('# 标题')

    const withCrlf = '---\r\ntitle: A\r\n---\r\n\r\n# 标题'
    expect(deleteFrontmatterProperty(withCrlf, 'title')).toBe('# 标题')

    // 作者多留一个空行（两个空行）时保留一个
    const extraGap = '---\ntitle: A\n---\n\n\n# 标题'
    expect(deleteFrontmatterProperty(extraGap, 'title')).toBe('\n# 标题')
  })

  it('L18:重复键时编辑/删除作用于最后一行（与解析器 last-wins 一致）', () => {
    const markdown = '---\ntitle: A\ntitle: B\n---\n正文'

    // 面板显示 B（解析器读最后一行），编辑 B 应改最后一行
    expect(setFrontmatterProperty(markdown, 'title', 'C')).toBe(
      '---\ntitle: A\ntitle: C\n---\n正文',
    )
    // 删除同样删最后一行
    expect(deleteFrontmatterProperty(markdown, 'title')).toBe(
      '---\ntitle: A\n---\n正文',
    )
  })
})
