import { describe, expect, it } from 'vitest'
import { buildSearchRegex } from './searchHighlight'

describe('搜索正则构建', () => {
  it('默认将查询词作为普通文本匹配', () => {
    const regex = buildSearchRegex('a.b', false, false)

    expect(regex?.test('aXb')).toBe(false)
    expect(regex?.test('A.B')).toBe(true)
  })

  it('支持全字匹配与非法正则保护', () => {
    const wholeWord = buildSearchRegex('note', false, true, true)

    expect(wholeWord?.test('notebook')).toBe(false)
    expect(wholeWord?.test('note')).toBe(true)
    expect(buildSearchRegex('[', true, false)).toBeNull()
  })
})
