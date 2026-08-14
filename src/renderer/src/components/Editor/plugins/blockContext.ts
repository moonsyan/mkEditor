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
  let foundStart = -1
  let foundEnd = -1
  doc.forEach((node, offset) => {
    if (foundStart >= 0) return
    if (from >= offset && from <= offset + node.nodeSize) {
      foundStart = offset
      foundEnd = offset + node.nodeSize
    }
  })
  if (foundStart < 0) return DecorationSet.empty
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
