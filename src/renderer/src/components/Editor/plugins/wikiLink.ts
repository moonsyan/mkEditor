import { schemaCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { $inputRule, $node, $prose } from '@milkdown/kit/utils'

/* ==================== Wiki 链接 [[target]] / [[target|alias]] 支持 ==================== */

/* ---------- ProseMirror 节点定义 ---------- */

export const wikiLinkSchema = $node('wiki_link', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    target: { default: '' },
    alias: { default: '' },
  },
  parseMarkdown: {
    match: (n) => n.type === 'wikiLink',
    runner: (state, node, type) => {
      const target = (node.target as string) || ''
      const alias = (node.alias as string) || ''
      state.addNode(type, { target, alias })
    },
  },
  toMarkdown: {
    match: (n) => n.type.name === 'wiki_link',
    runner: (state, node) => {
      const target = node.attrs.target as string
      const alias = node.attrs.alias as string
      // 以 html 节点原样输出 [[...]] 文本（html 处理器不做任何转义）：
      // text 节点会被 mdast-util-to-markdown 的 safe() 转义成 \[\[...\]\]，
      // 导致保存后 wiki 链接失效；wikiLink 无对应的 mdast 节点类型，直接 addNode 会抛错
      state.addNode('html', undefined, alias ? `[[${target}|${alias}]]` : `[[${target}]]`)
    },
  },
  toDOM: (node) => {
    const target = node.attrs.target as string
    const alias = node.attrs.alias as string
    const display = alias || target
    return [
      'span',
      {
        class: 'wiki-link',
        'data-target': target,
        title: target,
      },
      display,
    ]
  },
}))

/* ---------- 输入规则：输入 [[target]] → wiki_link 节点 ---------- */

export const wikiLinkInputRule = $inputRule((ctx) => {
  const schema = ctx.get(schemaCtx)
  return new InputRule(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]$/,
    (state, match, start, end) => {
      const type = schema.nodes.wiki_link
      if (!type) return null
      const target = (match[1] ?? '').trim()
      const alias = (match[2] ?? '').trim()
      if (!target) return null
      return state.tr.replaceRangeWith(
        start,
        end,
        type.create({ target, alias }),
      )
    },
  )
})

/* ---------- 文档加载后转换 [[...]] 文本为 wiki_link 节点 ---------- */

/** 当前活跃的编辑器视图（仅一个编辑器实例；用于停止已销毁视图的链式转换） */
let currentView: EditorView | null = null

/** 扫描整个文档，将匹配 [[target]] 模式的文本替换为 wiki_link 节点 */
function convertWikiText(view: EditorView) {
  // 编辑器已销毁或已重建：停止链式 setTimeout 循环
  if (currentView !== view) return
  const { state, dispatch } = view
  const type = state.schema.nodes.wiki_link
  if (!type) return

  const tr = state.tr
  let found = false
  const RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

  state.doc.descendants((node, pos) => {
    if (found) return false // 事务已有一个替换，不再继续避免位置漂移

    // 只在文本节点中查找（跳过代码块和 frontmatter）
    if (!node.isText) return
    // 跳过在代码块或 frontmatter 中的文本
    const $pos = state.doc.resolve(pos)
    let skip = false
    for (let d = $pos.depth; d >= 0; d--) {
      const n = $pos.node(d)
      if (n.type.name === 'code_block' || n.type.name === 'frontmatter') {
        skip = true
        break
      }
    }
    if (skip) return

    const text = node.text ?? ''
    RE.lastIndex = 0
    const m = RE.exec(text)
    if (m) {
      const target = m[1]?.trim() ?? ''
      const alias = (m[2] ?? '').trim()
      const start = pos + m.index
      const end = start + m[0].length
      tr.replaceRangeWith(start, end, type.create({ target, alias }))
      found = true
    }
  })

  if (found) {
    // 自动转换不是用户操作，不进 undo 历史
    // （否则多次 Ctrl+Z 会把 wiki 链接还原为文本，破坏用户输入记录）
    tr.setMeta('addToHistory', false)
    dispatch(tr)
    // 继续扫描，使用 setTimeout 批量转换
    setTimeout(() => convertWikiText(view), 0)
  }
}

export const wikiTextConvertPlugin = $prose(() => {
  return new Plugin({
    view(view) {
      currentView = view
      // 文档加载后批量转换
      setTimeout(() => convertWikiText(view), 50)
      return {
        destroy() {
          // 编辑器销毁后停止链式转换循环
          if (currentView === view) currentView = null
        },
      }
    },
  })
})

/**
 * 内容替换（切换文档）后重新转换 [[...]] 文本为 wiki_link 节点。
 * wikiTextConvertPlugin 只在编辑器创建时运行一次，切换文档不会再次触发，
 * 因此 Editor.replaceContent 替换内容后必须手动调用本函数。
 */
export function convertWikiTextInDoc(view: EditorView): void {
  setTimeout(() => convertWikiText(view), 0)
}

/* ---------- 点击跳转插件 ---------- */

let onWikiLinkClickHandler: ((target: string) => void) | null = null

export function setWikiLinkClickHandler(fn: ((target: string) => void) | null) {
  onWikiLinkClickHandler = fn
}

export const wikiLinkClickPlugin = $prose(() => {
  return new Plugin({
    props: {
      handleClick(view: EditorView, _pos: number, event: MouseEvent) {
        const target = event.target as HTMLElement
        const link = target.closest('.wiki-link') as HTMLElement | null
        if (!link) return false
        const targetStr = link.getAttribute('data-target')
        if (targetStr && onWikiLinkClickHandler) {
          event.preventDefault()
          event.stopPropagation()
          onWikiLinkClickHandler(targetStr)
          return true
        }
        return false
      },
    },
  })
})

/* ---------- 自动补全插件 ---------- */

export interface WikiAutocompleteState {
  query: string
  from: number
  to: number
  coords: { top: number; left: number; bottom: number }
}

export const wikiAutocompleteKey = new PluginKey<WikiAutocompleteState | null>(
  'wiki-autocomplete',
)

let onAutocompleteChange: ((state: WikiAutocompleteState | null) => void) | null = null

export function setWikiAutocompleteHandler(
  fn: ((state: WikiAutocompleteState | null) => void) | null,
) {
  onAutocompleteChange = fn
}

export const wikiAutocompletePlugin = $prose(() => {
  return new Plugin<WikiAutocompleteState | null>({
    key: wikiAutocompleteKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(wikiAutocompleteKey)
        if (meta !== undefined) return meta as WikiAutocompleteState | null

        if (tr.docChanged) {
          const sel = tr.selection
          const $pos = sel.$from
          const textBefore = $pos.parent.textContent.slice(0, $pos.parentOffset)
          const bracketIdx = textBefore.lastIndexOf('[[')
          if (bracketIdx < 0) {
            if (prev) return null
            return prev
          }

          const query = textBefore.slice(bracketIdx + 2)
          if (query.includes(']]')) {
            if (prev) return null
            return prev
          }
          if (query.length > 200) {
            if (prev) return null
            return prev
          }

          let inCodeOrFM = false
          for (let d = $pos.depth; d >= 0; d--) {
            const nodeType = $pos.node(d).type.name
            if (nodeType === 'code_block' || nodeType === 'frontmatter') {
              inCodeOrFM = true
              break
            }
          }
          if (inCodeOrFM) {
            if (prev) return null
            return prev
          }

          const from = sel.from - query.length - 2
          const to = sel.from
          return {
            query,
            from,
            to,
            coords: prev?.coords ?? { top: 0, left: 0, bottom: 0 },
          }
        }

        return prev
      },
    },
    view(view) {
      return {
        update(view) {
          const state = wikiAutocompleteKey.getState(view.state)
          if (state) {
            try {
              const sel = view.state.selection
              // M8：coordsAtPos 返回视口坐标，浮层定位容器也是视口（无定位祖先）；
              // 减去 view.dom 的 rect 会让浮层整体上移（顶栏 + 属性面板高度），改为直接透传视口坐标
              const coords = view.coordsAtPos(sel.$from.pos)
              const updated: WikiAutocompleteState = {
                ...state,
                coords: {
                  top: coords.bottom,
                  left: coords.left,
                  bottom: coords.bottom,
                },
              }
              if (onAutocompleteChange) onAutocompleteChange(updated)
            } catch {
              // coordsAtPos may fail
            }
          } else {
            if (onAutocompleteChange) onAutocompleteChange(null)
          }
        },
        destroy() {
          if (onAutocompleteChange) onAutocompleteChange(null)
        },
      }
    },
  })
})
