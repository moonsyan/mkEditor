import { describe, expect, it } from 'vitest'
import { parseOutline } from './outline'

describe('文档大纲', () => {
  it('忽略代码围栏内的伪标题并保留引用标题', () => {
    const outline = parseOutline('# 标题\n```ts\n# 伪标题\n```\n> ## 引用标题')

    expect(outline).toEqual([
      {
        idx: 0,
        level: 1,
        text: '标题',
        children: [{ idx: 1, level: 2, text: '引用标题', children: [] }],
      },
    ])
  })

  it('可在合理时间内解析长文档', () => {
    const content = Array.from({ length: 20000 }, (_, index) => `## 标题 ${index}`).join('\n')
    const startedAt = performance.now()
    const outline = parseOutline(content)

    expect(outline).toHaveLength(20000)
    expect(performance.now() - startedAt).toBeLessThan(1500)
  })

  it('tab 缩进不是标题（CommonMark tab=4 空格=缩进代码块）', () => {
    const outline = parseOutline('\t# 伪标题\n## 真标题')
    expect(outline).toEqual([{ idx: 0, level: 2, text: '真标题', children: [] }])
  })

  it('支持 setext 标题（渲染层生成真实 h1/h2，缺失会导致大纲索引错位）', () => {
    const outline = parseOutline('一级标题\n===\n\n正文段落\n--\n\n## ATX 标题')
    expect(outline).toEqual([
      {
        idx: 0,
        level: 1,
        text: '一级标题',
        children: [
          { idx: 1, level: 2, text: '正文段落', children: [] },
          { idx: 2, level: 2, text: 'ATX 标题', children: [] },
        ],
      },
    ])
  })

  it('围栏关闭行后的 === 不是 setext；主题分隔线 --- 不是 setext', () => {
    const outline = parseOutline('text\n```\ncode\n```\n===\n\n前文\n---')
    expect(outline).toEqual([])
  })

  it('列表项不算段落，其后不产生 setext', () => {
    const outline = parseOutline('- item\n===')
    expect(outline).toEqual([])
  })
})
