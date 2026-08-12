import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { DecorationSet } from '@milkdown/kit/prose/view'

/* ==================== 搜索引擎（装饰高亮 + 正则 + 计数） ==================== */

export interface SearchHit {
  from: number
  to: number
}

/** 模块级搜索状态（单编辑器实例，安全） */
export const searchState = {
  hits: [] as SearchHit[],
  current: -1,
  lastQuery: '',
  lastUseRegex: false,
  lastCaseSensitive: false,
  lastWholeWord: false,
}

export function buildSearchRegex(
  query: string,
  useRegex: boolean,
  caseSensitive: boolean,
  wholeWord = false,
): RegExp | null {
  try {
    let source = useRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!source) return null
    // 全字匹配：用 \b 包裹（正则模式下同样包裹整个表达式，与 VSCode 一致）
    if (wholeWord) source = `\\b(?:${source})\\b`
    return new RegExp(source, caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

export function collectHits(doc: ProseNode, re: RegExp): SearchHit[] {
  const hits: SearchHit[] = []
  doc.descendants((node, pos) => {
    // B3：搜索跳过代码块与 frontmatter 元数据（与 Typora 对齐，避免误匹配）
    if (node.type.name === 'code_block' || node.type.name === 'frontmatter') return false
    if (!node.isText) return
    const text = node.text ?? ''
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      hits.push({ from: pos + m.index, to: pos + m.index + m[0].length })
    }
  })
  return hits
}

export const searchKey = new PluginKey('search-highlight')

/** 搜索高亮插件：装饰集通过 meta 更新 */
export const searchPlugin = new Plugin({
  key: searchKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, prev) {
      const meta = tr.getMeta(searchKey)
      if (meta !== undefined) return meta as DecorationSet
      return (prev as DecorationSet).map(tr.mapping, tr.doc)
    },
  },
  props: {
    decorations(state) {
      return searchKey.getState(state) as DecorationSet
    },
  },
})
