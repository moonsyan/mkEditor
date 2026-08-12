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
})
