import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 代码块行号（装饰 widget，不修改文档） ==================== */

export const lineNumKey = new PluginKey('code-line-numbers')

/** 行号开关（模块级：插件只在编辑器创建时实例化一次，开关变化通过 meta 触发重建） */
let lineNumbersEnabled = false

export function setLineNumbersEnabled(enabled: boolean): void {
  lineNumbersEnabled = enabled
}

/** 为每个代码块生成行号 widget + 节点 class 装饰 */
function buildLineNumDecos(doc: ProseNode): DecorationSet {
  if (!lineNumbersEnabled) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return
    const lineCount = Math.max(1, node.textContent.split('\n').length)
    // 节点 class：CSS 据此给 pre 留出 gutter 空间
    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'has-line-numbers' }))
    // widget 插入 code 内部起始处，绝对定位到 pre 左侧
    decos.push(
      Decoration.widget(
        pos + 1,
        () => {
          const el = document.createElement('span')
          el.className = 'code-line-numbers'
          el.setAttribute('aria-hidden', 'true')
          let text = ''
          for (let i = 1; i <= lineCount; i++) text += (i > 1 ? '\n' : '') + i
          el.textContent = text
          return el
        },
        { side: -1, ignoreSelection: true },
      ),
    )
    return false
  })
  return DecorationSet.create(doc, decos)
}

export const lineNumPlugin = new Plugin({
  key: lineNumKey,
  state: {
    init: (_config, state) => buildLineNumDecos(state.doc),
    apply(tr, prev) {
      // 文档变化或开关切换（带 lineNumKey meta）时重建
      if (tr.docChanged || tr.getMeta(lineNumKey) !== undefined) {
        return buildLineNumDecos(tr.doc)
      }
      return (prev as DecorationSet).map(tr.mapping, tr.doc)
    },
  },
  props: {
    decorations(state) {
      return lineNumKey.getState(state) as DecorationSet
    },
  },
})
