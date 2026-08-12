import { $node, $prose } from '@milkdown/kit/utils'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { EditorState } from '@milkdown/kit/prose/state'
import { frontmatter as frontmatterSyntax } from 'micromark-extension-frontmatter'
import {
  frontmatterFromMarkdown,
  frontmatterToMarkdown,
} from 'mdast-util-frontmatter'

/* ==================== YAML Frontmatter 支持 ==================== */

/** unified 插件：让 remark 解析/序列化文档头部的 --- YAML --- 元数据块 */
interface UnifiedLike {
  data(): Record<string, unknown[] | undefined>
}
export function frontmatterRemarkPlugin(this: UnifiedLike) {
  const data = this.data()
  const add = (field: string, value: unknown) => {
    ;(data[field] = data[field] ?? []).push(value)
  }
  add('micromarkExtensions', frontmatterSyntax(['yaml']))
  add('fromMarkdownExtensions', frontmatterFromMarkdown(['yaml']))
  add('toMarkdownExtensions', frontmatterToMarkdown(['yaml']))
}

/**
 * Frontmatter 块级节点：文档头部 `---` 包裹的 YAML 元数据。
 * 内容为纯文本（code 语义），围栏由样式呈现，可直接编辑；
 * 序列化时还原为 `---\n…\n---` 语法。
 */
export const frontmatterSchema = $node('frontmatter', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  parseMarkdown: {
    match: (n) => n.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type, {})
      state.addText(node.value as string)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (n) => n.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, undefined, {
        value: node.textContent,
      })
    },
  },
  toDOM: () => ['div', { class: 'frontmatter-block' }, ['pre', 0]],
}))

/** 光标是否在 frontmatter 节点内 */
const inFrontmatter = (state: EditorState): boolean => {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'frontmatter') return true
  }
  return false
}

/**
 * frontmatter 内 Enter 插入换行而非拆分节点：
 * 默认 splitBlock 会把节点拆成两个，序列化后产生两段 --- 围栏。
 * 需注册在 commonmark 预设之前才能抢先其 Enter 绑定。
 */
export const frontmatterKeymap = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      if (!inFrontmatter(state)) return false
      if (dispatch) {
        dispatch(state.tr.insertText('\n').scrollIntoView())
      }
      return true
    },
  }),
)
