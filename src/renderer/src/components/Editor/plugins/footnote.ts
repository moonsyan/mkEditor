import { schemaCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { EditorState } from '@milkdown/kit/prose/state'
import { $inputRule, $node, $prose } from '@milkdown/kit/utils'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { footnote as footnoteSyntax } from 'micromark-extension-footnote'
import {
  footnoteFromMarkdown,
  footnoteToMarkdown,
} from 'mdast-util-footnote'

/* ==================== 脚注支持 ==================== */

/** unified 插件：让 remark 解析/序列化 [^1] 脚注语法 */
interface UnifiedLike {
  data(): Record<string, unknown[] | undefined>
}
export function footnoteRemarkPlugin(this: UnifiedLike) {
  const data = this.data()
  const add = (field: string, value: unknown) => {
    ;(data[field] = data[field] ?? []).push(value)
  }
  add('micromarkExtensions', footnoteSyntax)
  add('fromMarkdownExtensions', footnoteFromMarkdown)
  add('toMarkdownExtensions', footnoteToMarkdown)
}

/** 脚注引用 [^1]（行内原子节点，渲染为上标） */
export const footnoteRefSchema = $node('footnote_ref', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    label: { default: '' },
    identifier: { default: '' },
  },
  parseMarkdown: {
    match: (n) => n.type === 'footnoteReference',
    runner: (state, node, type) => {
      state.addNode(type, {
        label: node.label as string,
        identifier: node.identifier as string,
      })
    },
  },
  toMarkdown: {
    match: (n) => n.type.name === 'footnote_ref',
    runner: (state, node) => {
      state.addNode('footnoteReference', undefined, undefined, {
        label: node.attrs.label,
        identifier: node.attrs.identifier,
      })
    },
  },
  toDOM: (node) => [
    'sup',
    { class: 'footnote-ref', 'data-label': node.attrs.label },
    `[^${node.attrs.label}]`,
  ],
}))

/** 脚注定义 [^1]: 内容（块级节点） */
export const footnoteDefSchema = $node('footnote_def', () => ({
  group: 'block',
  content: 'inline*',
  attrs: {
    label: { default: '' },
    identifier: { default: '' },
  },
  parseMarkdown: {
    match: (n) => n.type === 'footnoteDefinition',
    runner: (state, node, type) => {
      state.openNode(type, {
        label: node.label as string,
        identifier: node.identifier as string,
      })
      state.next((node.children ?? []) as MarkdownNode[])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (n) => n.type.name === 'footnote_def',
    runner: (state, node) => {
      state.openNode('footnoteDefinition', undefined, {
        label: node.attrs.label,
        identifier: node.attrs.identifier,
      })
      state.next(node.content)
      state.closeNode()
    },
  },
  toDOM: (node) => [
    'div',
    { class: 'footnote-def', 'data-label': node.attrs.label },
    0,
  ],
}))

/** 行首输入 [^label]: 空格 → 转为脚注定义块 */
export const footnoteDefInputRule = $inputRule((ctx) => {
  const schema = ctx.get(schemaCtx)
  return new InputRule(/^\[\^([^\]\s]+)\]:\s$/, (state, match, start, end) => {
    const type = schema.nodes.footnote_def
    if (!type) return null
    const label = match[1]
    const tr = state.tr.replaceRangeWith(
      start,
      end,
      type.create({ label, identifier: label.toLowerCase() }),
    )
    return tr
      .setSelection(TextSelection.create(tr.doc, start + 1))
      .scrollIntoView()
  })
})

/** 输入 [^label] → 转为脚注引用（上标） */
export const footnoteRefInputRule = $inputRule((ctx) => {
  const schema = ctx.get(schemaCtx)
  return new InputRule(/\[\^([^\]\s]+)\]$/, (state, match, start, end) => {
    const type = schema.nodes.footnote_ref
    if (!type) return null
    const label = match[1]
    // M3：`[^1]: 定义` 键入时，ref 规则在 `]` 落地的瞬间抢先触发，def 规则
    // （要求行首 `[^…]: ` 整体匹配）就永远等不到了——先得到上标引用 + 字面
    // `: 定义` 文本，保存重开还会被 micromark 解析成定义、内容静默变化。
    // `]` 后紧跟 `:` 视为正在输入定义，本次不转换，等 `: ` 敲出后由 def
    // 规则整段转成定义块；mid-paragraph 的 `[^x]:`（micromark 中也不是
    // 合法引用/定义）保持字面文本，与加载路径行为一致
    const after = state.doc.textBetween(end, end + 1)
    if (after === ':') return null
    return state.tr.replaceRangeWith(
      start,
      end,
      type.create({ label, identifier: label.toLowerCase() }),
    )
  })
})

/** 光标是否在脚注定义节点内 */
const inFootnoteDef = (state: EditorState): boolean => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'footnote_def') return true
  }
  return false
}

/**
 * 脚注定义内 Enter 插入换行而非拆分节点（L12）：
 * 默认 splitBlock 会把定义拆成两个同标签的 footnote_def，
 * 序列化后出现重复 [^1]: 定义。续行缩进由 mdast-util-footnote 的
 * toMarkdown（indentLines）负责，往返安全。
 * 与 frontmatter 一致，须注册在 commonmark 预设之前才能抢先其 Enter 绑定。
 */
export const footnoteDefKeymap = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      if (!inFootnoteDef(state)) return false
      if (dispatch) {
        dispatch(state.tr.insertText('\n').scrollIntoView())
      }
      return true
    },
  }),
)
