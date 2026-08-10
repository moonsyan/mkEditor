import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 块级上下文标记（光标所在块高亮，对标 Typora） ==================== */

const blockContextKey = new PluginKey('block-context')

/** 找到包含光标的顶层块，给它加一个高亮 class */
function buildBlockContextDecos(state: EditorState): DecorationSet {
  const doc = state.doc
  const from = state.selection.from
  const found: { start: number; end: number }[] = []
  doc.forEach((node, offset) => {
    const start = offset
    const end = offset + node.nodeSize
    if (from >= start && from <= end) found.push({ start, end })
  })
  if (found.length === 0) return DecorationSet.empty
  return DecorationSet.create(doc, [
    Decoration.node(found[0].start, found[0].end, { class: 'block-active' }),
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
