import { describe, expect, it } from 'vitest'
import { isMermaidLanguage } from './mermaidCodeBlock'

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
})
