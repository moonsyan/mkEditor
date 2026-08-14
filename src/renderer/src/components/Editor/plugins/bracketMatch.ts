import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 前后缀匹配高亮（括号/引号配对高亮，对标 Typora） ==================== */

const bracketMatchKey = new PluginKey('bracket-match')

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
/** 引号视为"开放"的前导字符（空白/结构符号/起始） */
const QUOTE_OPEN_RE = /[\s([{<,;:，；：。"'‘（【]/

/** 在文本块内，从索引 idx 出发寻找与之配对的另一端（括号或引号） */
function matchPairAt(text: string, blockStart: number, idx: number): { a: [number, number]; b: [number, number] } | null {
  const ch = text[idx]
  // 括号（L9：按类型配对，栈式匹配，(] 不再误配对，([)] 不再错配）
  if (OPENERS[ch] || CLOSERS[ch]) {
    if (OPENERS[ch]) {
      // 向后扫描：遇开放符入栈（记期望的闭符），遇闭符校验类型后出栈
      const expected: string[] = [OPENERS[ch]]
      for (let i = idx + 1; i < text.length; i++) {
        const c = text[i]
        if (OPENERS[c]) expected.push(OPENERS[c])
        else if (CLOSERS[c]) {
          if (expected.length === 0) return null
          if (c !== expected[expected.length - 1]) return null
          expected.pop()
          if (expected.length === 0) {
            return { a: [blockStart + idx, blockStart + idx + 1], b: [blockStart + i, blockStart + i + 1] }
          }
        }
      }
    } else {
      // 向前扫描：记录已见闭符，遇开放符必须与最近未消化的闭符同型
      const expected: string[] = []
      for (let i = idx - 1; i >= 0; i--) {
        const c = text[i]
        if (CLOSERS[c]) expected.push(c)
        else if (OPENERS[c]) {
          if (expected.length === 0) {
            if (OPENERS[c] !== ch) return null
            return { a: [blockStart + i, blockStart + i + 1], b: [blockStart + idx, blockStart + idx + 1] }
          }
          if (OPENERS[c] !== expected[expected.length - 1]) return null
          expected.pop()
        }
      }
    }
    return null
  }
  // 双引号
  if (ch === '"') {
    const prev = idx > 0 ? text[idx - 1] : ' '
    const isOpen = QUOTE_OPEN_RE.test(prev)
    if (isOpen) {
      let depth = 1
      for (let i = idx + 1; i < text.length; i++) {
        if (text[i] !== '"') continue
        const p = i > 0 ? text[i - 1] : ' '
        if (QUOTE_OPEN_RE.test(p)) depth++
        else {
          depth--
          if (depth === 0) return { a: [blockStart + idx, blockStart + idx + 1], b: [blockStart + i, blockStart + i + 1] }
        }
      }
    } else {
      let depth = 1
      for (let i = idx - 1; i >= 0; i--) {
        if (text[i] !== '"') continue
        const p = i > 0 ? text[i - 1] : ' '
        if (QUOTE_OPEN_RE.test(p)) depth++
        else {
          depth--
          if (depth === 0) return { a: [blockStart + i, blockStart + i + 1], b: [blockStart + idx, blockStart + idx + 1] }
        }
      }
    }
    return null
  }
  return null
}

function buildBracketDecos(state: EditorState): DecorationSet {
  const sel = state.selection
  if (!sel.empty) return DecorationSet.empty
  const $from = sel.$from
  const text = $from.parent.textContent
  const blockStart = $from.start()
  const cursor = $from.parentOffset
  const tryIdx = (i: number): { a: [number, number]; b: [number, number] } | null => {
    if (i < 0 || i >= text.length) return null
    return matchPairAt(text, blockStart, i)
  }
  const r = tryIdx(cursor - 1) || tryIdx(cursor)
  if (!r) return DecorationSet.empty
  return DecorationSet.create(state.doc, [
    Decoration.inline(r.a[0], r.a[1], { class: 'bracket-match' }),
    Decoration.inline(r.b[0], r.b[1], { class: 'bracket-match' }),
  ])
}

export const bracketMatchPlugin = new Plugin({
  key: bracketMatchKey,
  state: {
    init: (_c, state) => buildBracketDecos(state),
    apply(tr, prev, _old, newState) {
      if (tr.docChanged || tr.selectionSet) return buildBracketDecos(newState)
      return prev
    },
  },
  props: {
    decorations(state) {
      return bracketMatchKey.getState(state) as DecorationSet
    },
  },
})
