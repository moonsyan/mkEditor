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
      if (tr.docChanged) {
        // M9：搜索后编辑文档会让 searchState.hits 位置过期，
        // 与装饰同样经 tr.mapping 重映射，保证 next/替换落在编辑后的正确位置
        searchState.hits = searchState.hits
          .map((hit) => {
            // 与 DecorationSet.map 的偏置一致（两端 -1），保证命中范围与高亮范围重合
            const fromResult = tr.mapping.mapResult(hit.from, -1)
            const toResult = tr.mapping.mapResult(hit.to, -1)
            if (fromResult.deleted || toResult.deleted) return null
            return { from: fromResult.pos, to: toResult.pos }
          })
          .filter((hit): hit is SearchHit => hit !== null)
        if (searchState.current >= searchState.hits.length) {
          searchState.current = searchState.hits.length - 1
        }
      }
      return (prev as DecorationSet).map(tr.mapping, tr.doc)
    },
  },
  props: {
    decorations(state) {
      return searchKey.getState(state) as DecorationSet
    },
  },
})
