import { TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  buildSearchRegex,
  collectHits,
  searchKey,
  searchState,
} from './plugins/searchHighlight'
import { collapsedRangeAt, sectionFoldKey } from './plugins/sectionFold'

export interface SearchResult {
  count: number
  current: number
}

export interface SearchController {
  start: (
    query: string,
    useRegex: boolean,
    caseSensitive: boolean,
    wholeWord?: boolean,
  ) => SearchResult
  next: (backwards: boolean) => number
  replaceCurrent: (replacement: string) => SearchResult
  replaceAll: (replacement: string) => number
  end: () => void
}

const updateHighlights = (view: EditorView): void => {
  const decorations = searchState.hits.map((hit, index) =>
    Decoration.inline(hit.from, hit.to, {
      class: index === searchState.current ? 'search-hit current' : 'search-hit',
    }),
  )
  view.dispatch(
    view.state.tr.setMeta(searchKey, DecorationSet.create(view.state.doc, decorations)),
  )
}

const clearHighlights = (view: EditorView): void => {
  view.dispatch(view.state.tr.setMeta(searchKey, DecorationSet.empty))
}

const refreshHits = (view: EditorView): SearchResult => {
  const regex = buildSearchRegex(
    searchState.lastQuery,
    searchState.lastUseRegex,
    searchState.lastCaseSensitive,
    searchState.lastWholeWord,
  )
  if (!regex) {
    searchState.hits = []
    searchState.current = -1
    clearHighlights(view)
    return { count: 0, current: -1 }
  }

  searchState.hits = collectHits(view.state.doc, regex)
  const selectionPosition = view.state.selection.from
  searchState.current = searchState.hits.findIndex((hit) => hit.from >= selectionPosition)
  if (searchState.current === -1 && searchState.hits.length > 0) searchState.current = 0
  updateHighlights(view)
  return { count: searchState.hits.length, current: searchState.current }
}

/**
 * 搜索状态与 ProseMirror 装饰层的命令适配器。UI 仅通过 EditorHandle 调用它。
 */
export function createSearchController(getView: () => EditorView | null): SearchController {
  return {
    start: (query, useRegex, caseSensitive, wholeWord = false) => {
      const view = getView()
      if (!view) return { count: 0, current: -1 }
      searchState.lastQuery = query
      searchState.lastUseRegex = useRegex
      searchState.lastCaseSensitive = caseSensitive
      searchState.lastWholeWord = wholeWord
      return refreshHits(view)
    },

    next: (backwards) => {
      const view = getView()
      if (!view || searchState.hits.length === 0) return searchState.current
      searchState.current = backwards
        ? searchState.current <= 0
          ? searchState.hits.length - 1
          : searchState.current - 1
        : (searchState.current + 1) % searchState.hits.length
      const hit = searchState.hits[searchState.current]
      const decorations = searchState.hits.map((item, index) =>
        Decoration.inline(item.from, item.to, {
          class: index === searchState.current ? 'search-hit current' : 'search-hit',
        }),
      )
      let tr = view.state.tr
      // M12：命中在折叠小节内时先展开该小节，否则光标跳进不可见内容、滚动无效
      const folded = collapsedRangeAt(view.state, hit.from)
      if (folded) tr = tr.setMeta(sectionFoldKey, { toggle: folded.heading })
      view.dispatch(
        tr
          .setMeta(searchKey, DecorationSet.create(view.state.doc, decorations))
          .setSelection(TextSelection.create(view.state.doc, hit.from))
          .scrollIntoView(),
      )
      return searchState.current
    },

    replaceCurrent: (replacement) => {
      const view = getView()
      const hit = searchState.hits[searchState.current]
      if (!view || !hit) return { count: searchState.hits.length, current: searchState.current }
      view.dispatch(view.state.tr.insertText(replacement, hit.from, hit.to).scrollIntoView())
      return refreshHits(view)
    },

    replaceAll: (replacement) => {
      const view = getView()
      if (!view || searchState.hits.length === 0) return 0
      let transaction = view.state.tr
      for (let index = searchState.hits.length - 1; index >= 0; index--) {
        const hit = searchState.hits[index]
        transaction = transaction.insertText(replacement, hit.from, hit.to)
      }
      view.dispatch(transaction.scrollIntoView())
      const count = searchState.hits.length
      searchState.hits = []
      searchState.current = -1
      clearHighlights(view)
      return count
    },

    end: () => {
      searchState.hits = []
      searchState.current = -1
      const view = getView()
      if (view) clearHighlights(view)
    },
  }
}
