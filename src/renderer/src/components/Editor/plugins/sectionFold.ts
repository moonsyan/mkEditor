import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'

/* ==================== 标题段落折叠（点击标题左侧折叠/展开，对标 Typora） ==================== */

export const sectionFoldKey = new PluginKey('section-fold')

/** 构建折叠装饰：标题左侧折叠标记 + 已折叠区块隐藏 */
function buildFoldDecos(state: EditorState, collapsed: Set<number>): DecorationSet {
  const doc = state.doc
  const decos: Decoration[] = []
  const headings: { start: number; end: number; level: number }[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      headings.push({ start: offset, end: offset + node.nodeSize, level: node.attrs.level as number })
    }
  })
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (collapsed.has(h.start)) {
      // 区块终点：下一个同级或更高级标题，或文档末尾
      let end = doc.content.size
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= h.level) {
          end = headings[j].start
          break
        }
      }
      doc.forEach((node, offset) => {
        if (offset > h.start && offset < end) {
          decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'folded-hidden' }))
        }
      })
    }
    decos.push(
      Decoration.widget(
        h.start,
        (view: EditorView) => {
          const el = document.createElement('span')
          const isCollapsed = collapsed.has(h.start)
          el.className = 'fold-toggle' + (isCollapsed ? ' collapsed' : '')
          el.textContent = isCollapsed ? '▸' : '▾'
          el.addEventListener('mousedown', (e) => {
            e.preventDefault()
            view.dispatch(view.state.tr.setMeta(sectionFoldKey, { toggle: h.start }))
          })
          return el
        },
        { side: -1, ignoreSelection: true, key: 'fold-' + h.start },
      ),
    )
  }
  return DecorationSet.create(doc, decos)
}

export const sectionFoldPlugin = new Plugin({
  key: sectionFoldKey,
  state: {
    init: () => ({ collapsed: new Set<number>(), decos: DecorationSet.empty }),
    apply(tr, prev, _old, newState) {
      const meta = tr.getMeta(sectionFoldKey)
      let collapsed = prev.collapsed
      if (meta && meta.reset) {
        // 切换文档（replaceContent）时清空，避免旧文件的折叠位置映射泄漏到新文档
        collapsed = new Set<number>()
      } else if (meta && meta.toggle !== undefined) {
        collapsed = new Set(prev.collapsed)
        if (collapsed.has(meta.toggle)) collapsed.delete(meta.toggle)
        else collapsed.add(meta.toggle)
      } else if (tr.docChanged) {
        // 文档变化后重新映射折叠位置，跳过已不存在的标题
        collapsed = new Set<number>()
        prev.collapsed.forEach((pos) => {
          const m = tr.mapping.map(pos)
          if (m != null && m <= tr.doc.content.size) {
            const node = tr.doc.nodeAt(m)
            if (node && node.type.name === 'heading') collapsed.add(m)
          }
        })
      }
      return { collapsed, decos: buildFoldDecos(newState, collapsed) }
    },
  },
  props: {
    decorations(state) {
      return sectionFoldKey.getState(state).decos as DecorationSet
    },
  },
})
