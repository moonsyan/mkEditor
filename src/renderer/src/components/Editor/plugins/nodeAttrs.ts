import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { analyzeDecorationChange } from './decoOptimize'

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
    apply: (tr, prev) => {
      // M13：纯文本编辑（段落打字）无需全文档重扫，映射旧装饰即可；
      // 变更触及代码块/图片/行内 code 或标记操作时才重建
      const info = analyzeDecorationChange(tr)
      const needsRebuild =
        info.hasMarkStep ||
        info.hasCodeMark ||
        info.sliceBlocks.has('code_block') ||
        info.sliceBlocks.has('frontmatter') ||
        info.sliceBlocks.has('image') ||
        // blockAt 只可能是块节点类型；image 是行内节点（在段落内），
        // 其增删已由 sliceBlocks 的 'image' 分支覆盖，此处不会命中
        (info.atBoundary && (info.blockAt === 'code_block' || info.blockAt === 'frontmatter'))
      if (!needsRebuild) return (prev as DecorationSet).map(tr.mapping, tr.doc)
      return buildNodeAttrDecos(tr.doc)
    },
  },
  props: {
    decorations(state) {
      return nodeAttrsKey.getState(state) as DecorationSet
    },
  },
})
