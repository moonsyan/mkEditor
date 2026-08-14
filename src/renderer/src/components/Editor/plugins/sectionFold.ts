import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { analyzeDecorationChange } from './decoOptimize'

/* ==================== 标题段落折叠（点击标题左侧折叠/展开，对标 Typora） ==================== */

export const sectionFoldKey = new PluginKey('section-fold')

interface FoldRange {
  start: number
  /** 标题节点自身结束位置（start + nodeSize，标题文本始终可见） */
  nodeEnd: number
  /** 区块结束位置（下一个同级/更高级标题或文档末尾） */
  end: number
  level: number
}

/** 计算所有标题区块范围（含未折叠的），供折叠装饰与选区/搜索处理复用 */
function computeFoldRanges(doc: ProseNode): FoldRange[] {
  const headings: FoldRange[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      headings.push({ start: offset, nodeEnd: offset + node.nodeSize, end: offset + node.nodeSize, level: node.attrs.level as number })
    }
  })
  const ranges: FoldRange[] = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    let end = doc.content.size
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].start
        break
      }
    }
    ranges.push({ ...h, end })
  }
  return ranges
}

/**
 * 光标/搜索位置是否落在已折叠区块内。
 * 返回所属标题位置；未折叠或不在隐藏区返回 null。
 * 隐藏区 = [nodeEnd, end)（标题文本本身始终可见）
 */
export function collapsedRangeAt(state: EditorState, pos: number): { heading: number } | null {
  const pluginState = sectionFoldKey.getState(state) as { collapsed: Set<number> } | undefined
  if (!pluginState || pluginState.collapsed.size === 0) return null
  for (const range of computeFoldRanges(state.doc)) {
    if (!pluginState.collapsed.has(range.start)) continue
    if (pos >= range.nodeEnd && pos < range.end) {
      return { heading: range.start }
    }
  }
  return null
}

/** 构建折叠装饰：标题左侧折叠标记 + 已折叠区块隐藏 */
function buildFoldDecos(state: EditorState, collapsed: Set<number>): DecorationSet {
  const doc = state.doc
  const decos: Decoration[] = []
  const ranges = computeFoldRanges(doc)
  for (const range of ranges) {
    const h = range
    if (collapsed.has(h.start)) {
      doc.forEach((node, offset) => {
        if (offset > h.start && offset < h.end) {
          decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'folded-hidden' }))
        }
      })
    }
    // L14：widget 工厂与 destroy 回调同级，监听器引用需提升到循环作用域
    // （基类 Event 自带 preventDefault/stopPropagation，Handler 只需 EventListener 签名）
    let onMousedown: EventListener | null = null
    decos.push(
      Decoration.widget(
        h.start,
        (view: EditorView) => {
          const el = document.createElement('span')
          const isCollapsed = collapsed.has(h.start)
          el.className = 'fold-toggle' + (isCollapsed ? ' collapsed' : '')
          el.textContent = isCollapsed ? '▸' : '▾'
          onMousedown = (e) => {
            e.preventDefault()
            // L14：replaceAll flush / 编辑器销毁后 widget 可能持有失效视图，
            // 直接 dispatch 会抛错；已销毁则忽略本次点击
            if (view.isDestroyed) return
            let tr = view.state.tr
            if (!isCollapsed) {
              // M12：折叠时若光标在将被隐藏的区块内，把选区移到标题文本末尾，
              // 否则光标落进 display:none 的内容里，后续打字全是盲改
              const sel = view.state.selection
              if (h.end > h.nodeEnd && sel.from >= h.nodeEnd && sel.from < h.end) {
                tr = tr.setSelection(TextSelection.create(tr.doc, h.nodeEnd - 1))
              }
            }
            view.dispatch(tr.setMeta(sectionFoldKey, { toggle: h.start }))
          }
          el.addEventListener('mousedown', onMousedown)
          return el
        },
        {
          side: -1,
          ignoreSelection: true,
          key: 'fold-' + h.start,
          // L14：装饰重建时移除监听，避免闭包持有已失效的 view
          destroy: (dom) => {
            if (onMousedown) dom.removeEventListener('mousedown', onMousedown)
          },
        },
      ),
    )
  }
  return DecorationSet.create(doc, decos)
}

export const sectionFoldPlugin = new Plugin({
  key: sectionFoldKey,
  state: {
    init: (): { collapsed: Set<number>; decos: DecorationSet } => ({
      collapsed: new Set<number>(),
      decos: DecorationSet.empty,
    }),
    apply(tr, prev, _old, newState) {
      const previous = prev as { collapsed: Set<number>; decos: DecorationSet }
      const meta = tr.getMeta(sectionFoldKey)
      if (meta && meta.reset) {
        // 切换文档（replaceContent）时清空，避免旧文件的折叠位置映射泄漏到新文档
        return { collapsed: new Set<number>(), decos: buildFoldDecos(newState, new Set()) }
      }
      if (meta && meta.toggle !== undefined) {
        const collapsed = new Set(previous.collapsed)
        if (collapsed.has(meta.toggle)) collapsed.delete(meta.toggle)
        else collapsed.add(meta.toggle)
        return { collapsed, decos: buildFoldDecos(newState, collapsed) }
      }
      if (!tr.docChanged) return previous
      // 文档变化后重新映射折叠位置，跳过已不存在的标题
      const collapsed = new Set<number>()
      previous.collapsed.forEach((pos) => {
        const m = tr.mapping.map(pos)
        if (m != null && m <= tr.doc.content.size) {
          const node = tr.doc.nodeAt(m)
          if (node && node.type.name === 'heading') collapsed.add(m)
        }
      })
      // M13：段落/标题内打字不改变折叠结构，映射复用旧装饰，
      // 避免每次按键全文档扫描重建（新增/删除标题时切片含 heading，才需重建）
      const info = analyzeDecorationChange(tr)
      if (!info.sliceBlocks.has('heading')) {
        return { collapsed, decos: previous.decos.map(tr.mapping, tr.doc) }
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
