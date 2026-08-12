import { describe, expect, it } from 'vitest'
import { isMermaidLanguage, isSelectionInsideMermaidBlock } from './mermaidCodeBlock'

describe('isMermaidLanguage', () => {
  it('识别大小写与空白不同的 Mermaid 代码块语言', () => {
    expect(isMermaidLanguage('mermaid')).toBe(true)
    expect(isMermaidLanguage(' Mermaid ')).toBe(true)
    expect(isMermaidLanguage('MERMAID')).toBe(true)
  })

  it('不把其他代码块语言当作 Mermaid', () => {
    expect(isMermaidLanguage('markdown')).toBe(false)
    expect(isMermaidLanguage(undefined)).toBe(false)
  })

  it('仅在选区离开 Mermaid 代码块后恢复图表模式', () => {
    expect(isSelectionInsideMermaidBlock(11, 11, 10, 20)).toBe(true)
    expect(isSelectionInsideMermaidBlock(10, 10, 10, 20)).toBe(false)
    expect(isSelectionInsideMermaidBlock(11, 31, 10, 20)).toBe(false)
  })
})
