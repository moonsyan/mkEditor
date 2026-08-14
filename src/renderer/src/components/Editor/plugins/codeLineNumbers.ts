import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { analyzeDecorationChange } from './decoOptimize'

/* ==================== 代码块行号（装饰 widget，不修改文档） ==================== */

export const lineNumKey = new PluginKey('code-line-numbers')

type CodeBlockLineInfo = {
  pos: number
  lineCount: number
}

type LineNumberState = {
  decorations: DecorationSet
  blocks: CodeBlockLineInfo[]
}

/** 行号开关（模块级：插件只在编辑器创建时实例化一次，开关变化通过 meta 触发重建） */
let lineNumbersEnabled = false

export function setLineNumbersEnabled(enabled: boolean): void {
  lineNumbersEnabled = enabled
}

/** 为每个代码块生成行号 widget + 节点 class 装饰 */
function getCodeBlockLines(doc: ProseNode): CodeBlockLineInfo[] {
  if (!lineNumbersEnabled) return []
  const blocks: CodeBlockLineInfo[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return
    blocks.push({ pos, lineCount: Math.max(1, node.textContent.split('\n').length) })
    return false
  })
  return blocks
}

function buildLineNumDecos(doc: ProseNode, blocks = getCodeBlockLines(doc)): DecorationSet {
  const decos: Decoration[] = []
  blocks.forEach(({ pos, lineCount }) => {
    const node = doc.nodeAt(pos)
    if (!node) return
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
  })
  return DecorationSet.create(doc, decos)
}

function mapCodeBlockLines(blocks: CodeBlockLineInfo[], tr: Transaction): CodeBlockLineInfo[] {
  return blocks.flatMap((block) => {
    const mapped = tr.mapping.mapResult(block.pos, -1)
    if (mapped.deleted) return []
    return [{ ...block, pos: mapped.pos }]
  })
}

function haveSameCodeBlockLines(left: CodeBlockLineInfo[], right: CodeBlockLineInfo[]): boolean {
  return (
    left.length === right.length &&
    left.every((block, index) => block.pos === right[index].pos && block.lineCount === right[index].lineCount)
  )
}

export const lineNumPlugin = new Plugin({
  key: lineNumKey,
  state: {
    init: (_config, state): LineNumberState => {
      const blocks = getCodeBlockLines(state.doc)
      return { decorations: buildLineNumDecos(state.doc, blocks), blocks }
    },
    apply(tr, prev) {
      const previous = prev as LineNumberState
      if (tr.getMeta(lineNumKey) !== undefined) {
        const blocks = getCodeBlockLines(tr.doc)
        return { decorations: buildLineNumDecos(tr.doc, blocks), blocks }
      }
      if (!tr.docChanged) {
        return {
          decorations: previous.decorations.map(tr.mapping, tr.doc),
          blocks: mapCodeBlockLines(previous.blocks, tr),
        }
      }
      // M13：段落内打字不触碰代码块，直接映射复用，避免每次按键全文档扫描
      const info = analyzeDecorationChange(tr)
      const touchesCodeBlock =
        info.blockAt === 'code_block' || info.sliceBlocks.has('code_block')
      if (!touchesCodeBlock) {
        return {
          decorations: previous.decorations.map(tr.mapping, tr.doc),
          blocks: mapCodeBlockLines(previous.blocks, tr),
        }
      }
      const blocks = getCodeBlockLines(tr.doc)
      const mappedBlocks = mapCodeBlockLines(previous.blocks, tr)
      if (haveSameCodeBlockLines(mappedBlocks, blocks)) {
        // 单字符输入不影响行号，复用 widget，避免干扰代码块光标与输入法组合态。
        return { decorations: previous.decorations.map(tr.mapping, tr.doc), blocks }
      }
      return { decorations: buildLineNumDecos(tr.doc, blocks), blocks }
    },
  },
  props: {
    decorations(state) {
      return (lineNumKey.getState(state) as LineNumberState | undefined)?.decorations
    },
  },
})
