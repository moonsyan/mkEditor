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
import {
  gfm,
  addRowAfterCommand,
  addColAfterCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm'
import { deleteRow, deleteColumn, deleteTable } from '@milkdown/kit/prose/tables'
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
let lastWholeWord = false

function buildSearchRegex(
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

function collectHits(doc: ProseNode, re: RegExp): SearchHit[] {
  const hits: SearchHit[] = []
  doc.descendants((node, pos) => {
    // B3：搜索跳过代码块（与 Typora 对齐，避免误匹配代码内容）
    if (node.type.name === 'code_block') return false
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

/* ==================== 代码块行号（装饰 widget，不修改文档） ==================== */

const lineNumKey = new PluginKey('code-line-numbers')
/** 行号开关（模块级：插件只在编辑器创建时实例化一次，开关变化通过 meta 触发重建） */
let lineNumbersEnabled = false

/** 为每个代码块生成行号 widget + 节点 class 装饰 */
function buildLineNumDecos(doc: ProseNode): DecorationSet {
  if (!lineNumbersEnabled) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return
    const lineCount = Math.max(1, node.textContent.split('\n').length)
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
    return false
  })
  return DecorationSet.create(doc, decos)
}

const lineNumPlugin = new Plugin({
  key: lineNumKey,
  state: {
    init: (_config, state) => buildLineNumDecos(state.doc),
    apply(tr, prev) {
      // 文档变化或开关切换（带 lineNumKey meta）时重建
      if (tr.docChanged || tr.getMeta(lineNumKey) !== undefined) {
        return buildLineNumDecos(tr.doc)
      }
      return (prev as DecorationSet).map(tr.mapping, tr.doc)
    },
  },
  props: {
    decorations(state) {
      return lineNumKey.getState(state) as DecorationSet
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
  /** 获取文档标题列表（PDF 目录页生成用） */
  getHeadings: () => { level: number; text: string }[]
  /** 预览/导出用：编辑器真实 DOM 快照（含 Mermaid SVG、KaTeX 渲染结果，比 getHtml 更完整） */
  getPreviewHtml: () => string
  /** 编辑器聚焦 */
  focus: () => void
  /** 聚焦到文档末尾（点击正文下方空白区用） */
  focusEnd: () => void
  /** 编辑器是否已创建完成（会话/草稿恢复时判断时机） */
  isReady: () => boolean
  /** 搜索：返回匹配数与当前索引 */
  startSearch: (
    query: string,
    useRegex: boolean,
    caseSensitive: boolean,
    wholeWord?: boolean,
  ) => {
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
  /**
   * 等待富内容就绪（B1）：若文档含公式/图表则确保懒加载插件已装载并重新渲染，
   * 导出 HTML/PDF 前调用，避免快照中缺少 SVG/KaTeX 渲染结果。最多等待 4 秒。
   */
  ensureRichContent: () => Promise<void>
}

interface EditorProps {
  /** 初始内容（仅首次挂载使用，后续切换通过 replaceContent） */
  initialContent: string
  /** 内容变化回调（返回最新 Markdown） */
  onChange: (markdown: string) => void
  /** 图片保存位置提示（当前文档路径 / 工作区路径 / 图床配置） */
  imageHints?: {
    docPath?: string
    workspacePath?: string
    imageHost?: { provider: 'local' | 'smms'; token: string }
  }
  /** 光标位置变化回调（行/列 + 当前标题 + 标题索引 + 选中字数） */
  onCursorChange?: (
    line: number,
    col: number,
    heading: string,
    headingIndex: number,
    selectedChars: number,
  ) => void
  /** 懒加载插件（KaTeX/Mermaid）完成渲染后的回调（分栏预览刷新用，B1/B2） */
  onRichRender?: () => void
  /** 点击正文下方空白区是否跳到文末（默认 true，可在设置关闭，U8） */
  blankClickToEnd?: boolean
  /** 代码块行号开关 */
  codeLineNumbers?: boolean
  /** 轻提示回调（图床上传失败降级等场景） */
  onNotify?: (message: string) => void
}

/** 代码块悬浮层状态（语言输入 + 复制，悬停才出现） */
interface CodePanelState {
  pre: HTMLElement
  top: number
  left: number
  language: string
}

/** 表格悬浮工具栏状态（行列增删，悬停才出现） */
interface TablePanelState {
  table: HTMLElement
  top: number
  left: number
}

/** 代码块全屏预览状态 */
interface FullscreenCodeState {
  language: string
  text: string
}

/**
 * Milkdown 编辑器主体
 * useEditor 只在挂载时执行一次，initialContent/onChange 通过 ref 透传，
 * 避免重渲染时重建编辑器导致光标丢失。
 */
const MilkdownInner = forwardRef<EditorHandle, EditorProps>(
  function MilkdownInner(
    {
      initialContent,
      onChange,
      imageHints,
      onCursorChange,
      onRichRender,
      blankClickToEnd = true,
      codeLineNumbers = false,
      onNotify,
    },
    ref,
  ) {
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
    const richRenderRef = useRef(onRichRender)
    richRenderRef.current = onRichRender
    const notifyRef = useRef(onNotify)
    notifyRef.current = onNotify
    const [, bumpRender] = useState(0)

    // 拼写检查排除（代码块/行内代码 spellcheck=false）与图片 draggable：
    // 改用 nodeAttrsPlugin（ProseMirror 装饰）实现，不再外部修改 DOM

    /** 大插件懒加载状态（KaTeX / Mermaid）；Promise 供导出前等待就绪（B1） */
    const lazyRef = useRef({
      mathLoaded: false,
      diagramLoaded: false,
      mathPromise: null as Promise<void> | null,
      diagramPromise: null as Promise<void> | null,
    })

    /** 检测到公式/图表内容时动态加载对应插件（避免启动内存峰值） */
    const ensureLazyPlugins = (markdown: string) => {
      const ed = editorRef.current
      if (!ed || ed.status !== EditorStatus.Created) return
      const st = lazyRef.current
      if (!st.mathLoaded && !st.mathPromise && markdown.includes('$')) {
        st.mathPromise = import('@milkdown/plugin-math')
          .then(
            (m) =>
              new Promise<void>((resolve) => {
                // 延后到下一个事件循环，避免在 dispatch 期间重建编辑器状态
                setTimeout(() => {
                  ed.use(m.math)
                  st.mathLoaded = true
                  // 重新解析当前文档，让已存在的公式生效
                  setTimeout(() => {
                    try {
                      const md = ed.action(getMarkdown())
                      ed.action(replaceAll(md))
                    } catch {
                      /* 编辑器销毁等异常不影响主流程 */
                    }
                    richRenderRef.current?.()
                    resolve()
                  }, 50)
                }, 0)
              }),
          )
          .catch(() => {})
      }
      if (
        !st.diagramLoaded &&
        !st.diagramPromise &&
        markdown.includes('```mermaid')
      ) {
        st.diagramPromise = import('@milkdown/plugin-diagram')
          .then(
            (m) =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  ed.use(m.diagram)
                  st.diagramLoaded = true
                  setTimeout(() => {
                    try {
                      const md = ed.action(getMarkdown())
                      ed.action(replaceAll(md))
                    } catch {
                      /* 同上 */
                    }
                    // Mermaid SVG 为异步渲染，多等一拍再通知
                    setTimeout(() => {
                      richRenderRef.current?.()
                      resolve()
                    }, 120)
                  }, 50)
                }, 0)
              }),
          )
          .catch(() => {})
      }
    }

    // 代码块悬浮层（语言输入 + 复制）
    const [codePanel, setCodePanel] = useState<CodePanelState | null>(null)
    const [langInput, setLangInput] = useState('')
    const [copied, setCopied] = useState(false)
    const copiedTimer = useRef<ReturnType<typeof setTimeout>>()
    const lastPreRef = useRef<HTMLElement | null>(null)
    // 表格悬浮工具栏（行列增删）
    const [tablePanel, setTablePanel] = useState<TablePanelState | null>(null)
    // 代码块全屏预览
    const [fullscreenCode, setFullscreenCode] = useState<FullscreenCodeState | null>(null)

    // 全屏预览下 Esc 关闭
    useEffect(() => {
      if (!fullscreenCode) return
      const h = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setFullscreenCode(null)
        }
      }
      window.addEventListener('keydown', h)
      return () => window.removeEventListener('keydown', h)
    }, [fullscreenCode])

    // 行号开关同步：更新模块级标志并触发装饰重建（编辑器未创建时由 init 读标志）
    useEffect(() => {
      lineNumbersEnabled = codeLineNumbers
      const ed = editorRef.current
      if (ed?.status === EditorStatus.Created) {
        const view = ed.ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(lineNumKey, true))
      }
    }, [codeLineNumbers])

    /** 元素相对滚动容器的内容坐标（不受整体缩放影响） */
    const offsetInScroll = (el: HTMLElement): { top: number; left: number } => {
      const scrollEl = scrollRef.current
      let top = 0
      let left = 0
      let cur: HTMLElement | null = el
      while (cur && cur !== scrollEl) {
        top += cur.offsetTop
        left += cur.offsetLeft
        cur = cur.offsetParent as HTMLElement | null
      }
      return { top, left }
    }

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
        // 代码块行号（开关由 codeLineNumbers prop 控制，装饰 widget 实现）
        .use($prose(() => lineNumPlugin))
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

    /** 点击正文下方空白区：光标定位到文末（Typora 同款，可在设置关闭，U8） */
    const handleBlankClick = (e: React.MouseEvent) => {
      if (!blankClickToEnd) return
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

    /** 保存图片并插入 Markdown 图片节点（优先图床，未配置/失败时降级本地） */
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
        // 图床路径：配置了 SM.MS 且 token 非空时先尝试上传
        const host = imageHintsRef.current?.imageHost
        if (host?.provider === 'smms' && host.token) {
          const up = await window.desktopAPI.document.uploadImage(dataUrl)
          if (up.ok && up.data?.url) {
            const alt = file.name.replace(/\.[^.]+$/, '')
            editorRef.current?.action(insert(`![${alt}](${up.data.url})`))
            bumpRender((n) => n + 1)
            return
          }
          // 上传失败：提示后降级本地附件
          notifyRef.current?.('图床上传失败，已改为保存到本地')
        }
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

    /** 鼠标悬停代码块/表格：显示轻量操作层（事件委托） */
    const handleMouseOver = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      // 悬停在操作层自身上时保持现状，避免闪烁
      if (target.closest('.code-panel') || target.closest('.table-panel')) return
      const scrollEl = scrollRef.current
      if (!scrollEl) return

      // 悬停表格：显示表格工具栏
      const table = target.closest('table')
      if (table && scrollEl.contains(table)) {
        setCodePanel(null)
        lastPreRef.current = null
        const { top, left } = offsetInScroll(table)
        setTablePanel({
          table,
          top: top + 4,
          // 贴表格右上角；窄表格时避免负坐标（工具栏含对齐按钮，宽约 340px）
          left: Math.max(8, left + table.offsetWidth - 340),
        })
        return
      }

      const pre = target.closest('pre')
      if (!pre || !scrollEl.contains(pre)) {
        setCodePanel(null)
        setTablePanel(null)
        lastPreRef.current = null
        return
      }
      setTablePanel(null)
      // 切换到新代码块时同步输入框内容（同一块内不打断输入）
      if (lastPreRef.current !== pre) {
        lastPreRef.current = pre
        setLangInput(pre.getAttribute('data-language') || '')
      }
      // U2：内容坐标定位而非 getBoundingClientRect，不受缩放/侧栏宽度影响
      const { top, left } = offsetInScroll(pre)
      setCodePanel({
        pre,
        top: top + 8,
        left: left + pre.offsetWidth - 216,
        language: pre.getAttribute('data-language') || '',
      })
    }

    /** 把光标定位到悬停表格内（表格命令要求选区在单元格中） */
    const ensureSelectionInTable = (table: HTMLElement): boolean => {
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return false
      const view = ed.ctx.get(editorViewCtx)
      try {
        const pos = view.posAtDOM(table, 0)
        const $pos = view.state.doc.resolve(pos)
        let tablePos = -1
        let tableNode: ProseNode | null = null
        for (let d = $pos.depth; d >= 0; d--) {
          if ($pos.node(d).type.name === 'table') {
            tablePos = $pos.before(d)
            tableNode = $pos.node(d)
            break
          }
        }
        if (!tableNode) return false
        const sel = view.state.selection
        const inside = sel.from > tablePos && sel.from < tablePos + tableNode.nodeSize
        if (!inside) {
          const target = Selection.findFrom(view.state.doc.resolve(tablePos + 1), 1)
          if (!target) return false
          view.dispatch(view.state.tr.setSelection(target))
        }
        return true
      } catch {
        return false
      }
    }

    /** 表格工具栏动作：作用于光标所在单元格（光标不在表内时先移入） */
    const runTableAction = (
      action:
        | 'addRow'
        | 'addCol'
        | 'delRow'
        | 'delCol'
        | 'delTable'
        | 'alignLeft'
        | 'alignCenter'
        | 'alignRight',
    ) => {
      if (!tablePanel) return
      if (!ensureSelectionInTable(tablePanel.table)) return
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return
      const view = ed.ctx.get(editorViewCtx)
      switch (action) {
        case 'addRow':
          ed.action(callCommand(addRowAfterCommand.key))
          break
        case 'addCol':
          ed.action(callCommand(addColAfterCommand.key))
          break
        case 'delRow':
          deleteRow(view.state, view.dispatch)
          break
        case 'delCol':
          deleteColumn(view.state, view.dispatch)
          break
        case 'delTable':
          deleteTable(view.state, view.dispatch)
          setTablePanel(null)
          break
        case 'alignLeft':
          ed.action(callCommand(setAlignCommand.key, 'left'))
          break
        case 'alignCenter':
          ed.action(callCommand(setAlignCommand.key, 'center'))
          break
        case 'alignRight':
          ed.action(callCommand(setAlignCommand.key, 'right'))
          break
      }
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
      const text = getCodeText(codePanel.pre)
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true)
          clearTimeout(copiedTimer.current)
          copiedTimer.current = setTimeout(() => setCopied(false), 1500)
        })
        .catch(() => {})
    }

    /** 取代码块纯文本：先剔除行号 widget，避免开启行号后复制/预览混入行号 */
    function getCodeText(pre: HTMLElement): string {
      const clone = pre.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.code-line-numbers').forEach((el) => el.remove())
      return clone.textContent ?? ''
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
        getHeadings: () => {
          const ed = ready()
          if (!ed) return []
          const out: { level: number; text: string }[] = []
          ed.ctx.get(editorViewCtx).state.doc.descendants((node) => {
            if (node.type.name === 'heading') {
              out.push({ level: node.attrs.level as number, text: node.textContent })
            }
          })
          return out
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

        /* ---------- 富内容就绪（B1：导出/预览前强制等待插件加载） ---------- */

        ensureRichContent: async () => {
          const ed = ready()
          if (!ed) return
          let md = ''
          try {
            md = ed.action(getMarkdown())
          } catch {
            return
          }
          ensureLazyPlugins(md)
          const st = lazyRef.current
          const waits: Promise<void>[] = []
          if (md.includes('$') && st.mathPromise) waits.push(st.mathPromise)
          if (md.includes('```mermaid') && st.diagramPromise) {
            waits.push(st.diagramPromise)
          }
          if (waits.length === 0) return
          // 最多等 4 秒，避免插件加载异常时永久阻塞导出
          await Promise.race([
            Promise.all(waits),
            new Promise<void>((r) => setTimeout(r, 4000)),
          ])
          // 再等一帧，确保 DOM 已完成重排
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        },

        /* ---------- 搜索 ---------- */

        startSearch: (query, useRegex, caseSensitive, wholeWord = false) => {
          const ed = ready()
          if (!ed) return { count: 0, current: -1 }
          const view = ed.ctx.get(editorViewCtx)
          lastQuery = query
          lastUseRegex = useRegex
          lastCaseSensitive = caseSensitive
          lastWholeWord = wholeWord
          const re = buildSearchRegex(query, useRegex, caseSensitive, wholeWord)
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
          const re = buildSearchRegex(
            lastQuery,
            lastUseRegex,
            lastCaseSensitive,
            lastWholeWord,
          )
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
          onMouseLeave={() => {
            setCodePanel(null)
            setTablePanel(null)
          }}
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
                className={`code-copy`}
                onClick={() => {
                  if (!codePanel) return
                  setFullscreenCode({
                    language: codePanel.language,
                    text: getCodeText(codePanel.pre),
                  })
                }}
                title="全屏预览代码"
              >
                <svg viewBox="0 0 24 24">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                </svg>
              </div>
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
          {/* 表格悬浮工具栏：行列增删（悬停才出现） */}
          {tablePanel && (
            <div
              className="table-panel"
              style={{ top: tablePanel.top, left: tablePanel.left }}
              onMouseOver={(e) => e.stopPropagation()}
              contentEditable={false}
            >
              <div className="table-act" onClick={() => runTableAction('addRow')} title="在光标所在行下方加行">
                +行
              </div>
              <div className="table-act" onClick={() => runTableAction('addCol')} title="在光标所在列右侧加列">
                +列
              </div>
              <div className="table-act" onClick={() => runTableAction('delRow')} title="删除光标所在行">
                −行
              </div>
              <div className="table-act" onClick={() => runTableAction('delCol')} title="删除光标所在列">
                −列
              </div>
              <div className="table-act danger" onClick={() => runTableAction('delTable')} title="删除整个表格">
                删表
              </div>
              <span className="table-act-sep" />
              <div className="table-act" onClick={() => runTableAction('alignLeft')} title="当前列左对齐">
                左
              </div>
              <div className="table-act" onClick={() => runTableAction('alignCenter')} title="当前列居中">
                中
              </div>
              <div className="table-act" onClick={() => runTableAction('alignRight')} title="当前列右对齐">
                右
              </div>
            </div>
          )}
        </div>

        {/* 代码块全屏预览（只读 + 复制，Esc 关闭） */}
        {fullscreenCode && (
          <div
            className="code-fullscreen-overlay"
            onClick={() => setFullscreenCode(null)}
          >
            <div className="code-fullscreen" onClick={(e) => e.stopPropagation()}>
              <div className="code-fullscreen-head">
                <span className="code-fullscreen-lang">
                  {fullscreenCode.language || 'text'}
                </span>
                <div className="code-fullscreen-actions">
                  <div
                    className="sc-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(fullscreenCode.text).catch(() => {})
                    }}
                  >
                    复制
                  </div>
                  <div className="sc-btn" onClick={() => setFullscreenCode(null)}>
                    关闭（Esc）
                  </div>
                </div>
              </div>
              <pre className="code-fullscreen-pre">
                <code>{fullscreenCode.text}</code>
              </pre>
            </div>
          </div>
        )}
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
