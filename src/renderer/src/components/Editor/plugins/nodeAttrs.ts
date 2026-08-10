import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/**
 * 节点属性装饰：代码块/行内代码 spellcheck=false（拼写检查排除），图片 draggable（拖拽重定位）。
 * 用 ProseMirror 装饰而非外部 DOM 修改，避免与 ProseMirror 自身 DOM 同步互相触发导致死循环。
 */
function buildNodeAttrDecos(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { spellcheck: 'false' }))
      return false
    }
    if (node.type.name === 'image') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { draggable: 'true' }))
      return false
    }
    if (node.isText && node.marks.some((m) => m.type.name === 'code')) {
      decos.push(Decoration.inline(pos, pos + node.nodeSize, { spellcheck: 'false' }))
    }
  })
  return DecorationSet.create(doc, decos)
}

export const nodeAttrsKey = new PluginKey('node-attrs')

export const nodeAttrsPlugin = new Plugin({
  key: nodeAttrsKey,
  state: {
    init: (_config, state) => buildNodeAttrDecos(state.doc),
    apply: (tr, prev) => (tr.docChanged ? buildNodeAttrDecos(tr.doc) : prev),
  },
  props: {
    decorations(state) {
      return nodeAttrsKey.getState(state) as DecorationSet
    },
  },
})
