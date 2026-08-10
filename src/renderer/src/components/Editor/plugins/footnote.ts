import { schemaCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule, $node } from '@milkdown/kit/utils'
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
    return state.tr.replaceRangeWith(
      start,
      end,
      type.create({ label, identifier: label.toLowerCase() }),
    )
  })
})
