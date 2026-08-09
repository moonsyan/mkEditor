import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import {
  Editor as MilkdownCore,
  EditorStatus,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  schemaCtx,
  remarkPluginsCtx,
} from '@milkdown/kit/core'
import type { CmdKey } from '@milkdown/kit/core'
import { Selection, TextSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { prism } from '@milkdown/plugin-prism'
import {
  replaceAll,
  insert,
  getHTML,
  getMarkdown,
  forceUpdate,
  callCommand,
  $inputRule,
  $node,
  $prose,
} from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { footnote as footnoteSyntax } from 'micromark-extension-footnote'
import {
  footnoteFromMarkdown,
  footnoteToMarkdown,
} from 'mdast-util-footnote'

/* 注意：plugin-math（KaTeX）与 plugin-diagram（Mermaid）体积很大，
 * 不在启动时静态导入，而是检测到公式/图表内容时动态加载，
 * 避免渲染进程启动内存峰值过高。 */

/* ==================== 搜索引擎（装饰高亮 + 正则 + 计数） ==================== */

const searchKey = new PluginKey('search-highlight')

interface SearchHit {
  from: number
  to: number
}

/** 模块级搜索状态（单编辑器实例，安全） */
let searchHits: SearchHit[] = []
let searchCurrent = -1
let lastQuery = ''
let lastUseRegex = false
let lastCaseSensitive = false

function buildSearchRegex(
  query: string,
  useRegex: boolean,
  caseSensitive: boolean,
): RegExp | null {
  try {
    const source = useRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!source) return null
    return new RegExp(source, caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

function collectHits(doc: ProseNode, re: RegExp): SearchHit[] {
  const hits: SearchHit[] = []
  doc.descendants((node, pos) => {
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

/**
 * 节点属性装饰：代码块/行内代码 spellcheck=false（拼写检查排除），图片 draggable（拖拽重定位）。
 * 用 ProseMirror 装饰而非外部 DOM 修改，避免与 ProseMirror 自身 DOM 同步互相触发导致死循环。
 */
function buildNodeAttrDecos(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { spellcheck: 'false' }))
      return false
    }
    if (node.type.name === 'image') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { draggable: 'true' }))
      return false
    }
    if (node.isText && node.marks.some((m) => m.type.name === 'code')) {
      decos.push(Decoration.inline(pos, pos + node.nodeSize, { spellcheck: 'false' }))
    }
  })
  return DecorationSet.create(doc, decos)
}

const nodeAttrsKey = new PluginKey('node-attrs')
const nodeAttrsPlugin = new Plugin({
  key: nodeAttrsKey,
  state: {
    init: (_config, state) => buildNodeAttrDecos(state.doc),
    apply: (tr, prev) => (tr.docChanged ? buildNodeAttrDecos(tr.doc) : prev),
  },
  props: {
    decorations(state) {
      return nodeAttrsKey.getState(state) as DecorationSet
    },
  },
})

/** 搜索高亮插件：装饰集通过 meta 更新 */
const searchPlugin = new Plugin({
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

/* ==================== 自定义语法扩展 ==================== */

/**
 * 自定义围栏输入规则（补充内置规则）：
 * 支持 ~~~ 围栏与大写语言名（如 ```Python），
 * 输入 ```python / ~~~python + 空格或回车即创建带语言的代码块。
 */
const customCodeFenceRule = $inputRule((ctx) => {
  return new InputRule(
    /^(```|~~~)([A-Za-z0-9+#.-]*)[\s\n]$/,
    (state, match, start, end) => {
      const codeBlockType = ctx.get(schemaCtx).nodes.code_block
      if (!codeBlockType) return null
      const language = (match[2] ?? '').toLowerCase()
      const node = codeBlockType.create({ language })
      const tr = state.tr.replaceRangeWith(start, end, node)
      return tr
        .setSelection(TextSelection.create(tr.doc, start + 1))
        .scrollIntoView()
    },
  )
})

/* ==================== 脚注支持 ==================== */

/** unified 插件：让 remark 解析/序列化 [^1] 脚注语法 */
interface UnifiedLike {
  data(): Record<string, unknown[] | undefined>
}
function footnoteRemarkPlugin(this: UnifiedLike) {
  const data = this.data()
  const add = (field: string, value: unknown) => {
    ;(data[field] = data[field] ?? []).push(value)
  }
  add('micromarkExtensions', footnoteSyntax)
  add('fromMarkdownExtensions', footnoteFromMarkdown)
  add('toMarkdownExtensions', footnoteToMarkdown)
}

/** 脚注引用 [^1]（行内原子节点，渲染为上标） */
const footnoteRefSchema = $node('footnote_ref', () => ({
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
const footnoteDefSchema = $node('footnote_def', () => ({
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
const footnoteDefInputRule = $inputRule((ctx) => {
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
const footnoteRefInputRule = $inputRule((ctx) => {
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

/* ==================== 组件 ==================== */

/** 编辑器对外暴露的命令式接口 */
export interface EditorHandle {
  /** 整体替换文档内容（切换文件时使用） */
  replaceContent: (markdown: string) => void
  /** 在光标处插入 Markdown 片段 */
  insertMd: (markdown: string) => void
  /** 执行 Milkdown 命令（如粗体、标题、表格） */
  runCommand: <T>(key: CmdKey<T>, payload?: T) => boolean
  /** 获取当前内容的 HTML（导出用） */
  getHtml: () => string
  /** 预览/导出用：编辑器真实 DOM 快照（含 Mermaid SVG、KaTeX 渲染结果，比 getHtml 更完整） */
  getPreviewHtml: () => string
  /** 编辑器聚焦 */
  focus: () => void
  /** 聚焦到文档末尾（点击正文下方空白区用） */
  focusEnd: () => void
  /** 编辑器是否已创建完成（会话/草稿恢复时判断时机） */
  isReady: () => boolean
  /** 搜索：返回匹配数与当前索引 */
  startSearch: (query: string, useRegex: boolean, caseSensitive: boolean) => {
    count: number
    current: number
  }
  /** 跳到上/下一个匹配 */
  searchNext: (backwards: boolean) => number
  /** 替换当前匹配并重新搜索，返回新匹配数 */
  replaceCurrent: (replacement: string) => { count: number; current: number }
  /** 全部替换，返回替换数量 */
  replaceAllMatches: (replacement: string) => number
  /** 结束搜索（清除高亮） */
  endSearch: () => void
}

interface EditorProps {
  /** 初始内容（仅首次挂载使用，后续切换通过 replaceContent） */
  initialContent: string
  /** 内容变化回调（返回最新 Markdown） */
  onChange: (markdown: string) => void
  /** 图片保存位置提示（当前文档路径 / 工作区路径） */
  imageHints?: { docPath?: string; workspacePath?: string }
  /** 光标位置变化回调（行/列 + 当前标题 + 标题索引 + 选中字数） */
  onCursorChange?: (
    line: number,
    col: number,
    heading: string,
    headingIndex: number,
    selectedChars: number,
  ) => void
}

/** 代码块悬浮层状态（语言输入 + 复制，悬停才出现） */
interface CodePanelState {
  pre: HTMLElement
  top: number
  left: number
  language: string
}

/**
 * Milkdown 编辑器主体
 * useEditor 只在挂载时执行一次，initialContent/onChange 通过 ref 透传，
 * 避免重渲染时重建编辑器导致光标丢失。
 */
const MilkdownInner = forwardRef<EditorHandle, EditorProps>(
  function MilkdownInner({ initialContent, onChange, imageHints, onCursorChange }, ref) {
    const editorRef = useRef<MilkdownCore | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const initialRef = useRef(initialContent)
    const changeRef = useRef(onChange)
    changeRef.current = onChange
    const imageHintsRef = useRef(imageHints)
    imageHintsRef.current = imageHints
    const cursorRef = useRef(onCursorChange)
    cursorRef.current = onCursorChange
    const [, bumpRender] = useState(0)

    // 拼写检查排除（代码块/行内代码 spellcheck=false）与图片 draggable：
    // 改用 nodeAttrsPlugin（ProseMirror 装饰）实现，不再外部修改 DOM

    /** 大插件懒加载状态（KaTeX / Mermaid） */
    const lazyRef = useRef({
      mathLoaded: false,
      diagramLoaded: false,
      mathLoading: false,
      diagramLoading: false,
    })

    /** 检测到公式/图表内容时动态加载对应插件（避免启动内存峰值） */
    const ensureLazyPlugins = (markdown: string) => {
      const ed = editorRef.current
      if (!ed || ed.status !== EditorStatus.Created) return
      const st = lazyRef.current
      if (!st.mathLoaded && !st.mathLoading && markdown.includes('$')) {
        st.mathLoading = true
        import('@milkdown/plugin-math')
          .then((m) => {
            // 延后到下一个事件循环，避免在 dispatch 期间重建编辑器状态
            setTimeout(() => {
              ed.use(m.math)
              st.mathLoaded = true
              // 重新解析当前文档，让已存在的公式生效
              setTimeout(() => {
                const md = ed.action(getMarkdown())
                ed.action(replaceAll(md))
              }, 50)
            }, 0)
          })
          .catch(() => {})
          .finally(() => {
            st.mathLoading = false
          })
      }
      if (
        !st.diagramLoaded &&
        !st.diagramLoading &&
        markdown.includes('```mermaid')
      ) {
        st.diagramLoading = true
        import('@milkdown/plugin-diagram')
          .then((m) => {
            setTimeout(() => {
              ed.use(m.diagram)
              st.diagramLoaded = true
              setTimeout(() => {
                const md = ed.action(getMarkdown())
                ed.action(replaceAll(md))
              }, 50)
            }, 0)
          })
          .catch(() => {})
          .finally(() => {
            st.diagramLoading = false
          })
      }
    }

    // 代码块悬浮层（语言输入 + 复制）
    const [codePanel, setCodePanel] = useState<CodePanelState | null>(null)
    const [langInput, setLangInput] = useState('')
    const [copied, setCopied] = useState(false)
    const copiedTimer = useRef<ReturnType<typeof setTimeout>>()
    const lastPreRef = useRef<HTMLElement | null>(null)

    useEditor((root) => {
      const editor = MilkdownCore.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialRef.current)
          // 关闭拼写检查：避免代码/中文内容出现红色波浪线
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            spellcheck: false,
          }))
          // 注册脚注语法解析（RemarkPlugin 为 { plugin, options } 结构）
          ctx.get(remarkPluginsCtx).push({
            plugin: footnoteRemarkPlugin as never,
            options: {},
          })
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            changeRef.current(markdown)
            ensureLazyPlugins(markdown)
          })
        })
        .onStatusChange((status) => {
          // 编辑器创建完成后，检查初始内容是否需要大插件
          if (status === EditorStatus.Created) {
            ensureLazyPlugins(initialRef.current)
          }
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        // 代码块语法高亮（保持轻量 pre>code 渲染）
        .use(prism)
        // 脚注（轻量自建节点；KaTeX/Mermaid 大插件改为按需动态加载）
        .use([
          footnoteRefSchema,
          footnoteDefSchema,
          footnoteDefInputRule,
          footnoteRefInputRule,
        ])
        .use(customCodeFenceRule)
        // 搜索高亮插件
        .use($prose(() => searchPlugin))
        // 代码块 spellcheck 排除 + 图片 draggable（装饰方式，避免 DOM 变异乒乓）
        .use($prose(() => nodeAttrsPlugin))
        // 光标位置上报（供状态栏/大纲高亮；rAF 节流，连续输入每帧只算一次）
        .use(
          $prose(() => {
            const key = new PluginKey('cursor-report')
            return new Plugin({
              key,
              view: () => {
                let raf = 0
                const report = (view: EditorView) => {
                  const fn = cursorRef.current
                  if (!fn) return
                  const { from } = view.state.selection
                  // 用块分隔符近似还原为行文本，再算行/列
                  const text = view.state.doc.textBetween(0, from, '\n', '\n')
                  const lines = text.split('\n')
                  // 找光标上方最近的标题（供状态栏显示当前所在章节）
                  let heading = ''
                  // 同时统计 h1-h4 序号（与 DOM querySelectorAll('h1-h4') 顺序一致，供大纲高亮）
                  let headingIndex = -1
                  let hCount = -1
                  view.state.doc.descendants((node, pos) => {
                    if (node.type.name === 'heading') {
                      const lv = node.attrs.level as number
                      if (lv >= 1 && lv <= 4) {
                        hCount++
                        if (pos <= from) {
                          headingIndex = hCount
                          heading = node.textContent
                        }
                      }
                    }
                  })
                  fn(
                    lines.length,
                    lines[lines.length - 1].length + 1,
                    heading,
                    headingIndex,
                    // 选中字数（去空白，无选区为 0）
                    (() => {
                      const { from: sf, to: st } = view.state.selection
                      if (sf >= st) return 0
                      return view.state.doc.textBetween(sf, st).replace(/\s/g, '').length
                    })(),
                  )
                }
                return {
                  update: (view, prevState) => {
                    if (prevState.selection.eq(view.state.selection)) return
                    // 已有调度则跳过，回调时读最新 state
                    if (raf) return
                    raf = requestAnimationFrame(() => {
                      raf = 0
                      report(view)
                    })
                  },
                  destroy: () => {
                    if (raf) cancelAnimationFrame(raf)
                  },
                }
              },
            })
          }),
        )
      editorRef.current = editor
      return editor
    }, [])

    /**
     * 方向键退出代码块（Typora 同款体验）：
     * 光标在代码块最后一行按 ↓ 跳到块后（无块则新建段落），
     * 在第一行按 ↑ 跳到块前。
     */
    const exitCodeBlock = (dir: 'up' | 'down'): boolean => {
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return false
      const view = ed.ctx.get(editorViewCtx)
      const { state, dispatch } = view
      const { $from } = state.selection
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d)
        if (node.type.name !== 'code_block') continue
        const start = $from.before(d)
        const end = start + node.nodeSize
        const text = node.textContent
        const offset = $from.pos - start - 1

        if (dir === 'down' && !text.slice(offset).includes('\n')) {
          let target = Selection.findFrom(state.doc.resolve(end), 1)
          let tr = state.tr
          if (!target) {
            const para = state.schema.nodes.paragraph.create()
            tr = tr.insert(end, para)
            target = TextSelection.create(tr.doc, end + 1)
          }
          dispatch(tr.setSelection(target).scrollIntoView())
          return true
        }
        if (dir === 'up' && !text.slice(0, offset).includes('\n')) {
          let tr = state.tr
          let target: Selection | null = null
          if (start > 0) {
            target = Selection.findFrom(tr.doc.resolve(start - 1), -1)
          }
          if (!target) {
            const para = state.schema.nodes.paragraph.create()
            tr = tr.insert(start, para)
            target = TextSelection.create(tr.doc, start + 1)
          }
          dispatch(tr.setSelection(target).scrollIntoView())
          return true
        }
        return false
      }
      return false
    }

    /** 编辑区键盘拦截：方向键退出代码块 */
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowDown' && exitCodeBlock('down')) e.preventDefault()
      else if (e.key === 'ArrowUp' && exitCodeBlock('up')) e.preventDefault()
    }

    /** 点击正文下方空白区：光标定位到文末（Typora 同款） */
    const handleBlankClick = (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return
      const view = ed.ctx.get(editorViewCtx)
      const { state, dispatch } = view
      dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView())
      view.focus()
    }

    /* ==================== 图片粘贴 / 拖入 ==================== */

    /** 保存本地图片并插入 Markdown 图片节点 */
    const insertImageFile = (file: File) => {
      if (!window.desktopAPI) return
      void (async () => {
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () =>
            resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(file)
        })
        if (!dataUrl) return
        const res = await window.desktopAPI.document.saveImage(
          dataUrl,
          imageHintsRef.current,
        )
        if (!res.ok || !res.data) return
        // 统一转为 mdimg 协议 URL（dev/生产环境均可渲染）
        const url = `mdimg:///${res.data.path.replace(/\\/g, '/')}`
        editorRef.current?.action(insert(`![${res.data.name}](${url})`))
        bumpRender((n) => n + 1)
      })()
    }

    /** 粘贴：含图片时保存并插入，否则交给 ProseMirror 默认文本粘贴 */
    const handlePaste = (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const file = items.find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (!file) return
      e.preventDefault()
      insertImageFile(file)
    }

    /** 拖入图片文件 */
    const handleDrop = (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      )
      if (files.length === 0) return
      e.preventDefault()
      files.forEach(insertImageFile)
    }

    const handleDragOver = (e: React.DragEvent) => {
      if (
        Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file')
      ) {
        e.preventDefault()
      }
    }

    /* ==================== 代码块悬浮层 ==================== */

    /** 鼠标悬停代码块：显示轻量操作层（事件委托） */
    const handleMouseOver = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // 悬停在操作层自身上时保持现状，避免闪烁
      if (target.closest('.code-panel')) return
      const pre = target.closest('pre')
      const scrollEl = scrollRef.current
      if (!pre || !scrollEl || !scrollEl.contains(pre)) {
        setCodePanel(null)
        lastPreRef.current = null
        return
      }
      // 切换到新代码块时同步输入框内容（同一块内不打断输入）
      if (lastPreRef.current !== pre) {
        lastPreRef.current = pre
        setLangInput(pre.getAttribute('data-language') || '')
      }
      const preRect = pre.getBoundingClientRect()
      const scrollRect = scrollEl.getBoundingClientRect()
      setCodePanel({
        pre,
        top: preRect.top - scrollRect.top + scrollEl.scrollTop + 8,
        left: preRect.right - scrollRect.left - 216,
        language: pre.getAttribute('data-language') || '',
      })
    }

    /** 修改代码块语言：定位 ProseMirror 节点并更新 language 属性 */
    const applyLanguage = (lang: string) => {
      if (!codePanel) return
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return
      const view = ed.ctx.get(editorViewCtx)
      const { state, dispatch } = view
      try {
        const pos = view.posAtDOM(codePanel.pre, 0)
        const $pos = state.doc.resolve(pos)
        for (let d = $pos.depth; d >= 0; d--) {
          const node = $pos.node(d)
          if (node.type.name !== 'code_block') continue
          dispatch(
            state.tr.setNodeMarkup($pos.before(d), undefined, {
              ...node.attrs,
              language: lang.trim(),
            }),
          )
          break
        }
      } catch {
        /* DOM 位置解析失败时静默放弃 */
      }
      const trimmed = lang.trim()
      setCodePanel((prev) => (prev ? { ...prev, language: trimmed } : prev))
    }

    const handleCopy = () => {
      if (!codePanel) return
      const text = codePanel.pre.textContent ?? ''
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true)
          clearTimeout(copiedTimer.current)
          copiedTimer.current = setTimeout(() => setCopied(false), 1500)
        })
        .catch(() => {})
    }

    useImperativeHandle(ref, () => {
      /** 编辑器就绪检查（创建完成前调用 action 会抛异常） */
      const ready = (): MilkdownCore | null =>
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null

      return {
        replaceContent: (markdown) => {
          ready()?.action(replaceAll(markdown))
        },
        insertMd: (markdown) => {
          ready()?.action(insert(markdown))
        },
        runCommand: (key, payload) => {
          const ed = ready()
          if (!ed) return false
          return ed.action(callCommand(key, payload))
        },
        getHtml: () => {
          return ready()?.action(getHTML()) ?? ''
        },
        getPreviewHtml: () => {
          // 直接取 ProseMirror 视图 DOM，保留 nodeView 渲染的图表/公式
          const ed = ready()
          if (!ed) return ''
          const view = ed.ctx.get(editorViewCtx)
          // 克隆后清理搜索高亮装饰，导出/预览更干净
          const clone = view.dom.cloneNode(true) as HTMLElement
          clone.querySelectorAll('.search-hit').forEach((el) => {
            el.classList.remove('search-hit', 'current')
          })
          return clone.innerHTML
        },
        focus: () => {
          containerRef.current?.querySelector<HTMLElement>('.milkdown .editor')?.focus()
        },
        focusEnd: () => {
          const ed = ready()
          if (!ed) return
          const view = ed.ctx.get(editorViewCtx)
          const { state, dispatch } = view
          dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView())
          view.focus()
        },
        isReady: () => ready() !== null,

        /* ---------- 搜索 ---------- */

        startSearch: (query, useRegex, caseSensitive) => {
          const ed = ready()
          if (!ed) return { count: 0, current: -1 }
          const view = ed.ctx.get(editorViewCtx)
          lastQuery = query
          lastUseRegex = useRegex
          lastCaseSensitive = caseSensitive
          const re = buildSearchRegex(query, useRegex, caseSensitive)
          if (!re) {
            searchHits = []
            searchCurrent = -1
            view.dispatch(view.state.tr.setMeta(searchKey, DecorationSet.empty))
            return { count: 0, current: -1 }
          }
          searchHits = collectHits(view.state.doc, re)
          // 定位到光标后的第一个匹配（没有则回绕到首个）
          const selPos = view.state.selection.from
          searchCurrent = searchHits.findIndex((h) => h.from >= selPos)
          if (searchCurrent === -1 && searchHits.length > 0) searchCurrent = 0
          const decos = searchHits.map((h, i) =>
            Decoration.inline(h.from, h.to, {
              class: i === searchCurrent ? 'search-hit current' : 'search-hit',
            }),
          )
          view.dispatch(
            view.state.tr.setMeta(searchKey, DecorationSet.create(view.state.doc, decos)),
          )
          return { count: searchHits.length, current: searchCurrent }
        },

        searchNext: (backwards) => {
          const ed = ready()
          if (!ed || searchHits.length === 0) return searchCurrent
          const view = ed.ctx.get(editorViewCtx)
          searchCurrent = backwards
            ? searchCurrent <= 0
              ? searchHits.length - 1
              : searchCurrent - 1
            : (searchCurrent + 1) % searchHits.length
          const decos = searchHits.map((h, i) =>
            Decoration.inline(h.from, h.to, {
              class: i === searchCurrent ? 'search-hit current' : 'search-hit',
            }),
          )
          const hit = searchHits[searchCurrent]
          view.dispatch(
            view.state.tr
              .setMeta(searchKey, DecorationSet.create(view.state.doc, decos))
              .setSelection(TextSelection.create(view.state.doc, hit.from))
              .scrollIntoView(),
          )
          return searchCurrent
        },

        replaceCurrent: (replacement) => {
          const ed = ready()
          const hit = searchHits[searchCurrent]
          if (!ed || !hit) return { count: searchHits.length, current: searchCurrent }
          const view = ed.ctx.get(editorViewCtx)
          view.dispatch(
            view.state.tr.insertText(replacement, hit.from, hit.to).scrollIntoView(),
          )
          // 替换后重新搜索（复用 startSearch 逻辑）
          const re = buildSearchRegex(lastQuery, lastUseRegex, lastCaseSensitive)
          if (!re) return { count: 0, current: -1 }
          searchHits = collectHits(view.state.doc, re)
          const selPos = view.state.selection.from
          searchCurrent = searchHits.findIndex((h) => h.from >= selPos)
          if (searchCurrent === -1 && searchHits.length > 0) searchCurrent = 0
          const decos = searchHits.map((h, i) =>
            Decoration.inline(h.from, h.to, {
              class: i === searchCurrent ? 'search-hit current' : 'search-hit',
            }),
          )
          view.dispatch(
            view.state.tr.setMeta(searchKey, DecorationSet.create(view.state.doc, decos)),
          )
          return { count: searchHits.length, current: searchCurrent }
        },

        replaceAllMatches: (replacement) => {
          const ed = ready()
          if (!ed || searchHits.length === 0) return 0
          const view = ed.ctx.get(editorViewCtx)
          let tr = view.state.tr
          // 从后往前替换，保证位置不回漂
          for (let i = searchHits.length - 1; i >= 0; i--) {
            const h = searchHits[i]
            tr = tr.insertText(replacement, h.from, h.to)
          }
          view.dispatch(tr.scrollIntoView())
          const n = searchHits.length
          searchHits = []
          searchCurrent = -1
          view.dispatch(view.state.tr.setMeta(searchKey, DecorationSet.empty))
          return n
        },

        endSearch: () => {
          searchHits = []
          searchCurrent = -1
          const ed = ready()
          if (!ed) return
          const view = ed.ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setMeta(searchKey, DecorationSet.empty))
        },
      }
    })

    return (
      <div className="editor-area" ref={containerRef}>
        <div
          className="editor-scroll"
          ref={scrollRef}
          onMouseOver={handleMouseOver}
          onMouseLeave={() => setCodePanel(null)}
        >
          <div
            className="editor-inner"
            onKeyDown={handleKeyDown}
            onClick={handleBlankClick}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <Milkdown />
          </div>
          {/* 代码块悬浮层：语言输入框 + 复制按钮（悬停才出现） */}
          {codePanel && (
            <div
              className="code-panel"
              style={{ top: codePanel.top, left: codePanel.left }}
              onMouseOver={(e) => e.stopPropagation()}
              contentEditable={false}
            >
              <input
                className="code-lang-input"
                placeholder="语言"
                value={langInput}
                spellCheck={false}
                onChange={(e) => setLangInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyLanguage(langInput)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setCodePanel(null)
                  }
                }}
                onBlur={() => {
                  if (codePanel && langInput !== codePanel.language) {
                    applyLanguage(langInput)
                  }
                }}
                title="输入语言后回车生效（如 python）"
              />
              <div
                className={`code-copy ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
                title={copied ? '已复制' : '复制代码'}
              >
                {copied ? (
                  <svg viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  },
)

/**
 * 所见即所得 Markdown 编辑器（Milkdown 内核）
 * 外层提供 MilkdownProvider 上下文，内层为真正的编辑器实例。
 */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  props,
  ref,
) {
  return (
    <MilkdownProvider>
      <MilkdownInner {...props} ref={ref} />
    </MilkdownProvider>
  )
})
