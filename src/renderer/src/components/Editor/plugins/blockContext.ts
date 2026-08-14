import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 块级上下文标记（光标所在块高亮，对标 Typora） ==================== */

const blockContextKey = new PluginKey('block-context')

/** 找到包含光标的顶层块，给它加一个高亮 class */
function buildBlockContextDecos(state: EditorState): DecorationSet {
  const doc = state.doc
  const from = state.selection.from
  // M13：顶层块互不重叠，命中即退出，无需遍历完所有块
  // L20：from == 块末尾（光标恰在两块边界，渲染在下一块开头）时
  // 不应高亮前一块——用 < end 排除边界命中；文档末尾（from == docSize，
  // 光标在最后一行末尾）无块命中，兜底高亮最后一块
  let foundStart = -1
  let foundEnd = -1
  let lastStart = -1
  let lastEnd = -1
  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize
    lastStart = offset
    lastEnd = end
    if (foundStart >= 0) return
    if (from >= offset && from < end) {
      foundStart = offset
      foundEnd = end
    }
  })
  if (foundStart < 0) {
    if (lastStart < 0) return DecorationSet.empty
    foundStart = lastStart
    foundEnd = lastEnd
  }
  return DecorationSet.create(doc, [
    Decoration.node(foundStart, foundEnd, { class: 'block-active' }),
  ])
}

export const blockContextPlugin = new Plugin({
  key: blockContextKey,
  state: {
    init: (_c, state) => buildBlockContextDecos(state),
    apply(tr, prev, _old, newState) {
      if (tr.docChanged || tr.selectionSet) return buildBlockContextDecos(newState)
      return prev
    },
  },
  props: {
    decorations(state) {
      return blockContextKey.getState(state) as DecorationSet
    },
  },
})
