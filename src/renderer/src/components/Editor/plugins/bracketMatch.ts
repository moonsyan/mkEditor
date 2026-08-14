import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 前后缀匹配高亮（括号/引号配对高亮，对标 Typora） ==================== */

const bracketMatchKey = new PluginKey('bracket-match')

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
/** 引号视为"开放"的前导字符（空白/结构符号/起始） */
const QUOTE_OPEN_RE = /[\s([{<,;:，；：。"'‘（【]/

/**
 * 在文本块内，从索引 idx 出发寻找与之配对的另一端（括号或引号）。
 * toDoc 把组合文本索引换算为文档坐标：块内含原子节点（脚注引用/wiki 链接/
 * 公式等）时 textContent 不含原子文本，直接 blockStart + idx 会错位
 */
function matchPairAt(
  text: string,
  toDoc: (textIdx: number) => number,
  idx: number,
): { a: [number, number]; b: [number, number] } | null {
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
            return { a: [toDoc(idx), toDoc(idx) + 1], b: [toDoc(i), toDoc(i) + 1] }
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
            return { a: [toDoc(i), toDoc(i) + 1], b: [toDoc(idx), toDoc(idx) + 1] }
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
          if (depth === 0) return { a: [toDoc(idx), toDoc(idx) + 1], b: [toDoc(i), toDoc(i) + 1] }
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
          if (depth === 0) return { a: [toDoc(i), toDoc(i) + 1], b: [toDoc(idx), toDoc(idx) + 1] }
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
  const parent = $from.parent
  const blockStart = $from.start()
  // L7：逐子节点累加文档偏移，text 索引与文档坐标正确换算。
  // 块内含原子节点（footnote_ref/wiki_link/math 等）时其文本不在
  // textContent 里，按子节点遍历取每个文本片段的起始位置
  const textParts: string[] = []
  const partOffsets: number[] = []
  parent.forEach((child, offset) => {
    if (child.isText) {
      partOffsets.push(blockStart + offset)
      textParts.push(child.text ?? '')
    }
  })
  const text = textParts.join('')
  /** 组合文本索引 → 文档坐标 */
  const toDoc = (textIdx: number): number => {
    let acc = 0
    for (let p = 0; p < textParts.length; p++) {
      const next = acc + textParts[p].length
      if (textIdx < next) return partOffsets[p] + (textIdx - acc)
      acc = next
    }
    return blockStart + textIdx
  }
  // 光标（父容器内文档偏移）→ 组合文本索引
  const cursorRel = $from.parentOffset
  let cursorTextIdx = text.length
  {
    let acc = 0
    for (let p = 0; p < textParts.length; p++) {
      const partStart = partOffsets[p] - blockStart
      const partLen = textParts[p].length
      if (cursorRel <= partStart + partLen) {
        cursorTextIdx = acc + Math.max(0, Math.min(partLen, cursorRel - partStart))
        break
      }
      acc += partLen
    }
  }
  const tryIdx = (i: number): { a: [number, number]; b: [number, number] } | null => {
    if (i < 0 || i >= text.length) return null
    return matchPairAt(text, toDoc, i)
  }
  const r = tryIdx(cursorTextIdx - 1) || tryIdx(cursorTextIdx)
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
