import { forwardRef, useImperativeHandle, useRef, useState, useEffect, type ReactNode } from 'react'
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
import {
  Selection,
  TextSelection,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import {
  gfm,
  addRowAfterCommand,
  addColAfterCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm'
import { deleteRow, deleteColumn, deleteTable } from '@milkdown/kit/prose/tables'
import { isImeComposing } from '../../lib/keyboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { prism } from '@milkdown/plugin-prism'
import { math } from '@milkdown/plugin-math'
import {
  replaceAll,
  insert,
  getHTML,
  getMarkdown,
  callCommand,
  $prose,
} from '@milkdown/kit/utils'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'

/* ==================== ProseMirror 插件与语法扩展（已拆分至 plugins/） ==================== */

import { searchPlugin } from './plugins/searchHighlight'
import { nodeAttrsPlugin } from './plugins/nodeAttrs'
import { lineNumKey, setLineNumbersEnabled, lineNumPlugin } from './plugins/codeLineNumbers'
import { blockContextPlugin } from './plugins/blockContext'
import { bracketMatchPlugin } from './plugins/bracketMatch'
import { sectionFoldKey, sectionFoldPlugin } from './plugins/sectionFold'
import { customCodeFenceRule, customCodeFenceKeymap } from './plugins/customCodeFence'
import {
  footnoteRemarkPlugin,
  footnoteRefSchema,
  footnoteDefSchema,
  footnoteDefInputRule,
  footnoteRefInputRule,
  footnoteDefKeymap,
} from './plugins/footnote'
import { frontmatterRemarkPlugin, frontmatterSchema, frontmatterKeymap } from './plugins/frontmatter'
import {
  wikiLinkSchema,
  wikiLinkInputRule,
  wikiLinkClickPlugin,
  wikiAutocompletePlugin,
  wikiTextConvertPlugin,
  convertWikiTextInDoc,
  setWikiLinkClickHandler,
  setWikiAutocompleteHandler,
  type WikiAutocompleteState,
} from './plugins/wikiLink'
import { filterWikiSuggestions, type WikiSuggestion } from './WikiAutocomplete'
import { tableColResizePlugin } from './plugins/tableColResize'
import {
  ensureMermaidRendered,
  mermaidPreviewPlugin,
  subscribeMermaidRender,
} from './plugins/mermaidCodeBlock'
import {
  EditorOverlays,
  type CodePanelState,
  type FullscreenCodeState,
  type TablePanelState,
} from './EditorOverlays'
import { createSearchController } from './searchController'
import { useImageInsertion, MAX_IMAGE_SIZE, type EditorImageHints } from './useImageInsertion'

/* ==================== 组件 ==================== */

/** 编辑器对外暴露的命令式接口 */
export interface EditorHandle {
  /** 整体替换文档内容（切换文件时使用，flush 重建、清空撤销历史） */
  replaceContent: (markdown: string) => void
  /** 程序性更新内容（属性面板等）：事务替换保留撤销历史，恢复选区与滚动 */
  updateContentPreservingHistory: (markdown: string) => void
  /** 获取当前编辑器状态对应的 Markdown；编辑器未就绪时返回 null */
  getMarkdown: () => string | null
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
  imageHints?: EditorImageHints
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
  /** Wiki 链接自动补全候选文件列表（工作区 .md 文件），为空不触发补全 */
  wikiLinkFiles?: WikiSuggestion[]
  /** Wiki 链接点击回调（target 为 [[...]] 中的 target 字符串） */
  onWikiLinkClick?: (target: string) => void
  /** 文档属性面板节点（仿 Obsidian：渲染在正文上方，随内容滚动，宽度与正文对齐） */
  frontmatterPanel?: ReactNode
  /** 代码块全屏开合回调（App 侧用于专注模式 Esc 协调） */
  onFullscreenChange?: (open: boolean) => void
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
      wikiLinkFiles,
      onWikiLinkClick,
      frontmatterPanel,
      onFullscreenChange,
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
    /**
     * C-3：IME 组合期间触发的文档替换（切文档/属性面板写入）。
     * 立即 replaceAll 会打断组合——未提交拼音丢失，严重时 PM 组合态与 DOM 错乱。
     * 挂起替换，compositionend 后执行；组合期间多次替换只保留最后一次。
     */
    const pendingReplaceRef = useRef<(() => void) | null>(null)
    const [, bumpRender] = useState(0)

    // compositionend 冒泡到编辑器宿主容器（组合可能发生在任何可编辑块内）
    useEffect(() => {
      const root = containerRef.current
      if (!root) return
      const onCompositionEnd = () => {
        const run = pendingReplaceRef.current
        if (!run) return
        pendingReplaceRef.current = null
        run()
      }
      root.addEventListener('compositionend', onCompositionEnd, true)
      return () => root.removeEventListener('compositionend', onCompositionEnd, true)
    }, [])

    useEffect(
      () =>
        subscribeMermaidRender(() => {
          richRenderRef.current?.()
        }),
      [],
    )

    // 拼写检查排除（代码块/行内代码 spellcheck=false）与图片 draggable：
    // 改用 nodeAttrsPlugin（ProseMirror 装饰）实现，不再外部修改 DOM

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
    // Wiki 链接自动补全浮层状态
    const [wikiAcState, setWikiAcState] = useState<WikiAutocompleteState | null>(null)
    /** E10：浮层内容坐标缓存（键为上报状态对象，收到新报告时重新换算） */
    const wikiAcPosRef = useRef<{ key: unknown; x: number; y: number } | null>(null)

    // 从 ProseMirror autocomplete 状态 + 候选文件列表派生 overlay 数据
    const wikiAcOverlay = wikiAcState && wikiLinkFiles && wikiLinkFiles.length > 0
      ? (() => {
          // E10：浮层渲染在 .editor-scroll 内（EditorOverlays 是其子节点），
          // position:absolute 的包含块是 .editor-scroll（position:relative，
          // editor.css:15）而非 .editor-host——按 .editor-host 换算会把浮层
          // 整体下移 TabBar 高度。锚点改用滚动容器自身，并把视口坐标换算为
          // 内容坐标（+scrollTop/scrollLeft）：滚动时浏览器将浮层随内容一起
          // 滚动，天然与光标保持粘连。换算结果按报告对象缓存：插件只在选区
          // 变化时上报新坐标，若滚动后因其它状态变化重渲染，复用缓存的内容
          // 坐标可避免浮层按新 scrollTop 错误偏移
          const anchor = scrollRef.current
          const anchorRect = anchor?.getBoundingClientRect()
          const cached = wikiAcPosRef.current
          const pos =
            cached && cached.key === wikiAcState
              ? cached
              : (wikiAcPosRef.current = anchorRect
                  ? {
                      key: wikiAcState,
                      x: wikiAcState.coords.left - anchorRect.left + (anchor?.scrollLeft ?? 0),
                      y: wikiAcState.coords.top - anchorRect.top + (anchor?.scrollTop ?? 0),
                    }
                  : {
                      key: wikiAcState,
                      x: wikiAcState.coords.left,
                      y: wikiAcState.coords.top,
                    })
          const { x, y } = pos
          return {
            query: wikiAcState.query,
            suggestions: filterWikiSuggestions(
              wikiLinkFiles as unknown as { name: string; path: string; children?: Array<{ name: string; path: string; children?: unknown[] }> }[],
              wikiAcState.query,
            ),
            x,
            y,
            onSelect: (path: string) => {
              setWikiAcState(null)
              // 通过事务替换 [[...]] 文本为 wiki_link 节点
              const ed = editorRef.current
              if (ed?.status === EditorStatus.Created) {
                const view = ed.ctx.get(editorViewCtx)
                // C-11：浮层显示后文档可能已变化（退格删掉 [[ 等），
                // 旧位置越界时丢弃本次选择，避免 replaceRangeWith 抛 RangeError
                const { from, to } = wikiAcState
                const docSize = view.state.doc.content.size
                if (from > docSize || to > docSize) return
                const schema = view.state.schema
                const nodeType = schema.nodes.wiki_link
                if (nodeType) {
                  const tr = view.state.tr.replaceRangeWith(
                    from,
                    to,
                    nodeType.create({
                      target: path.replace(/\\/g, '/'),
                      alias: '',
                    }),
                  )
                  view.dispatch(tr)
                }
              }
            },
            onClose: () => setWikiAcState(null),
          }
        })()
      : null

    // 全屏预览下 Esc 关闭；开合状态上报给 App（专注模式的 window Esc
    // 监听器注册更早会先触发，App 需知道全屏状态以跳过退出专注模式）
    useEffect(() => {
      if (!fullscreenCode) return
      onFullscreenChange?.(true)
      const h = (e: KeyboardEvent) => {
        if (isImeComposing(e)) return
        if (e.key === 'Escape') {
          e.preventDefault()
          setFullscreenCode(null)
        }
      }
      window.addEventListener('keydown', h)
      return () => {
        onFullscreenChange?.(false)
        window.removeEventListener('keydown', h)
      }
    }, [fullscreenCode, onFullscreenChange])

    // 行号开关同步：更新模块级标志并触发装饰重建（编辑器未创建时由 init 读标志）
    useEffect(() => {
      setLineNumbersEnabled(codeLineNumbers)
      const ed = editorRef.current
      if (ed?.status === EditorStatus.Created) {
        const view = ed.ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(lineNumKey, true))
      }
    }, [codeLineNumbers])

    // Wiki 链接自动补全：监听 ProseMirror 插件状态变化
    useEffect(() => {
      setWikiAutocompleteHandler((state) => {
        setWikiAcState(state)
      })
      return () => setWikiAutocompleteHandler(null)
    }, [])

    // Wiki 链接点击：传递 onWikiLinkClick 到插件
    const wikiClickRef = useRef(onWikiLinkClick)
    wikiClickRef.current = onWikiLinkClick
    useEffect(() => {
      setWikiLinkClickHandler((target) => {
        wikiClickRef.current?.(target)
      })
      return () => setWikiLinkClickHandler(null)
    }, [])

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
            // @ts-expect-error — remark-footnote 的类型与 Milkdown 的 RemarkPlugin 不完全匹配，但运行时兼容
            plugin: footnoteRemarkPlugin,
            options: {},
          })
          // 注册 YAML frontmatter 解析（文档头部 --- 元数据块）
          ctx.get(remarkPluginsCtx).push({
            // @ts-expect-error — remark-frontmatter 的类型与 Milkdown 的 RemarkPlugin 不完全匹配，但运行时兼容
            plugin: frontmatterRemarkPlugin,
            options: {},
          })
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            // listener 的 markdownUpdated 带有 200ms 防抖，App 会把该快照与
            // 当前 EditorState 再核对，避免旧文件内容串入新文件。
            changeRef.current(markdown)
          })
        })
        // frontmatter 内 Enter 行为（须先于 commonmark 预设注册才能抢先其 Enter 绑定）
        .use(frontmatterKeymap)
        // 脚注定义内 Enter 行为同样须先于 commonmark 的 Enter 绑定
        .use(footnoteDefKeymap)
        // 围栏 Enter 建代码块同样须先于 commonmark 的 Enter 绑定
        .use(customCodeFenceKeymap)
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        // 代码块语法高亮（保持轻量 pre>code 渲染）
        .use(prism)
        // KaTeX 必须在编辑器创建前注册；运行期 use() 不会执行插件初始化。
        .use(math)
        // 脚注（轻量自建节点）
        .use([
          footnoteRefSchema,
          footnoteDefSchema,
          footnoteDefInputRule,
          footnoteRefInputRule,
        ])
        // YAML frontmatter 元数据块（对标 Typora）
        .use(frontmatterSchema)
        // 围栏输入规则（空格建代码块；Enter 键位已在前方优先注册）
        .use(customCodeFenceRule)
        // 表格列宽可视化拖拽（视图级，不写入 Markdown）
        .use($prose(() => tableColResizePlugin))
        // 搜索高亮插件
        .use($prose(() => searchPlugin))
        // M11：剪贴板同时带 <img> 与图片文件（网页"复制图片"）时，
        // PM 原生 handlePaste 会解析 HTML 先插一张图，React 侧再保存文件插一张。
        // 有图片文件时返回 true 消费粘贴，交给 React 侧唯一插入。
        // M4：仅当 React 侧确实能插入图片时才消费——无 desktopAPI 或全部图片
        // 超限时放行 PM 默认粘贴，让剪贴板里的文字/HTML 正常插入
        .use(
          $prose(() => {
            const key = new PluginKey('block-pm-image-paste')
            return new Plugin({
              key,
              props: {
                handlePaste: (_view, event) => {
                  const dt = event.clipboardData
                  if (!dt) return false
                  if (!window.desktopAPI) return false
                  const files = Array.from(dt.files)
                  for (let i = 0; i < files.length; i++) {
                    const f = files[i]
                    if (f.type.startsWith('image/') && f.size <= MAX_IMAGE_SIZE) return true
                  }
                  return false
                },
              },
            })
          }),
        )
        // 代码块 spellcheck 排除 + 图片 draggable（装饰方式，避免 DOM 变异乒乓）
        .use($prose(() => nodeAttrsPlugin))
        // Mermaid 预览使用装饰组件，源码始终保留为 Milkdown 原生代码块。
        .use($prose(() => mermaidPreviewPlugin))
        // 代码块行号（开关由 codeLineNumbers prop 控制，装饰 widget 实现）
        .use($prose(() => lineNumPlugin))
        // 块级上下文标记（光标所在块高亮）
        .use($prose(() => blockContextPlugin))
        // 前后缀匹配高亮（括号/引号配对高亮）
        .use($prose(() => bracketMatchPlugin))
        // 标题段落折叠
        .use($prose(() => sectionFoldPlugin))
        // Wiki 链接 [[target]] 语法与点击跳转
        .use(wikiLinkSchema)
        .use(wikiLinkInputRule)
        .use(wikiLinkClickPlugin)
        .use(wikiAutocompletePlugin)
        .use(wikiTextConvertPlugin)
        // 光标位置上报（供状态栏/大纲高亮；rAF 节流，连续输入每帧只算一次）
        .use(
          $prose(() => {
            const key = new PluginKey('cursor-report')
            // L6：最近一次事务（state.apply 在 view.update 之前执行）。
            // update 只拿到新旧 state、拿不到 tr，事务范围判定只能经此中转
            let lastTr: Transaction | null = null
            return new Plugin({
              key,
              state: {
                init: () => null,
                apply(tr) {
                  lastTr = tr
                  return null
                },
              },
              view: () => {
                let raf = 0
                /**
                 * C-12：光标位置/章节信息按块缓存。光标在同一块内移动（每次按键、
                 * 方向键）只重算块内偏移，不再每次 textBetween(0, from) 拷贝全文、
                 * 不再遍历整篇文档统计标题——大文档上每次按键的扫描成本从 O(doc)
                 * 降到 O(块)。
                 */
                let blockCache: {
                  blockStart: number
                  /** 当前块之前已占用的完整行数（含块间分隔与图片/硬换行） */
                  prefixLines: number
                  /** 当前块之前是否还有文本内容（决定块首边界是否计一行） */
                  hasPrefixText: boolean
                  heading: string
                  headingIndex: number
                } | null = null

                /** 扫描到指定位置前的顶层标题（与旧实现一致：仅顶层，pos 即 offset） */
                const scanHeadings = (
                  view: EditorView,
                  upTo: number,
                ): { heading: string; headingIndex: number } => {
                  let heading = ''
                  let headingIndex = -1
                  let hCount = -1
                  let stopped = false
                  view.state.doc.forEach((node, offset) => {
                    if (stopped) return
                    if (offset > upTo) {
                      stopped = true
                      return
                    }
                    if (node.type.name === 'heading') {
                      const lv = node.attrs.level as number
                      if (lv >= 1 && lv <= 4) {
                        hCount++
                        if (offset <= upTo) {
                          headingIndex = hCount
                          heading = node.textContent
                        }
                      }
                    }
                  })
                  return { heading, headingIndex }
                }

                const report = (view: EditorView) => {
                  const fn = cursorRef.current
                  if (!fn) return
                  const { from } = view.state.selection
                  const $from = view.state.doc.resolve(from)
                  const block = $from.parent
                  if (!block.isTextblock) {
                    // 光标在块边界/非文本位置（图片等）：回退旧式全文计算，此场景不常见
                    blockCache = null
                    const text = view.state.doc.textBetween(0, from, '\n', '\n')
                    const lines = text.split('\n')
                    const heads = scanHeadings(view, from)
                    fn(
                      lines.length,
                      lines[lines.length - 1].length + 1,
                      heads.heading,
                      heads.headingIndex,
                      0,
                    )
                    return
                  }
                  const blockStart = $from.start()
                  if (!blockCache || blockCache.blockStart !== blockStart) {
                    const prefixText = view.state.doc.textBetween(0, blockStart, '\n', '\n')
                    const prefixLines = prefixText.split('\n').length - 1
                    const heads = scanHeadings(view, blockStart)
                    blockCache = {
                      blockStart,
                      prefixLines,
                      hasPrefixText: prefixText.length > 0,
                      heading: heads.heading,
                      headingIndex: heads.headingIndex,
                    }
                  }
                  // 与旧公式 textBetween(0, from) 等价：
                  // 行数 = 块前缀行数 + 块首边界行（光标已进入块内且块前有内容）+ 块内行数 + 1
                  const within = view.state.doc.textBetween(blockStart, from, '\n', '\n')
                  const withinLines = within.split('\n')
                  const boundaryLine =
                    from > blockStart && blockCache.hasPrefixText ? 1 : 0
                  const row = blockCache.prefixLines + boundaryLine + withinLines.length
                  const col = withinLines[withinLines.length - 1].length + 1
                  let heading = blockCache.heading
                  let headingIndex = blockCache.headingIndex
                  // 光标所在块自身是 h1-h4 标题时，标题文本随编辑实时更新
                  if (block.type.name === 'heading') {
                    const lv = block.attrs.level as number
                    if (lv >= 1 && lv <= 4) {
                      heading = block.textContent
                    }
                  }
                  fn(
                    row,
                    col,
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
                    // L6：光标块上方文档变化（搜索 replaceAll、wiki 自动转换、
                    // 属性面板保存等会改上方行数与标题）时，选区未动也能经
                    // blockStart 判缓存命中而沿用旧值，状态栏行号/所属标题过期。
                    // 事务起点在光标块之前即作废缓存并调度重算；起点在本块内/之后
                    // 不影响上方内容，保持 O(块) 快速路径
                    if (lastTr && lastTr.docChanged && blockCache) {
                      let changedAbove = false
                      for (let i = 0; i < lastTr.steps.length && !changedAbove; i++) {
                        const step = lastTr.steps[i] as { from?: number } | undefined
                        if (typeof step?.from === 'number' && step.from < blockCache.blockStart) {
                          changedAbove = true
                        }
                      }
                      if (changedAbove) {
                        blockCache = null
                        if (!raf) {
                          raf = requestAnimationFrame(() => {
                            raf = 0
                            report(view)
                          })
                        }
                      }
                    }
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
        // frontmatter 与 code_block 同样支持方向键跳出（H5）
        if (node.type.name !== 'code_block' && node.type.name !== 'frontmatter') continue
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
            if (node.type.name === 'frontmatter') {
              // frontmatter 必须保持文档首位：不插段落，直接回到文档开头
              dispatch(tr.setSelection(TextSelection.create(tr.doc, 0)).scrollIntoView())
              return true
            }
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

    /** 从 frontmatter 之后的正文首块按 ↑ 进入 frontmatter 末尾（H5：isolating 挡住反向穿越） */
    const enterFrontmatter = (): boolean => {
      const ed =
        editorRef.current?.status === EditorStatus.Created ? editorRef.current : null
      if (!ed) return false
      const view = ed.ctx.get(editorViewCtx)
      const { state, dispatch } = view
      const { $from } = state.selection
      if ($from.depth !== 1) return false
      const first = state.doc.child(0)
      if (first.type.name !== 'frontmatter') return false
      // 仅当光标在紧随 frontmatter 的正文首块最前面时触发
      if ($from.pos !== first.nodeSize + 1) return false
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, first.nodeSize - 1))
          .scrollIntoView(),
      )
      return true
    }

    /** 编辑区键盘拦截：方向键退出代码块 */
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (isImeComposing(e.nativeEvent)) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowDown' && exitCodeBlock('down')) e.preventDefault()
      else if (e.key === 'ArrowUp' && exitCodeBlock('up')) e.preventDefault()
      else if (e.key === 'ArrowUp' && enterFrontmatter()) e.preventDefault()
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

    const { handlePaste, handleDrop, handleDragOver } = useImageInsertion({
      imageHintsRef,
      insertMarkdown: (markdown) => {
        editorRef.current?.action(insert(markdown))
        bumpRender((count) => count + 1)
      },
      notify: (message) => notifyRef.current?.(message),
    })

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
      // L13：mermaid 源码块有自己的"编辑源码"工具栏，不再叠加通用代码面板；
      // 装饰类名是 mermaid-source-block（此前写 mermaid-source，守卫永不生效）
      if (pre.classList.contains('mermaid-source-block')) {
        setCodePanel(null)
        setTablePanel(null)
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

    /** 编辑器就绪检查（创建完成前调用 action 会抛异常） */
    const getReadyEditor = (): MilkdownCore | null =>
      editorRef.current?.status === EditorStatus.Created ? editorRef.current : null

    /**
     * 重建编辑器状态（flush=true 清空 undo/redo 历史，用于切换文档；
     * flush=false 保留历史，用于程序性更新）。
     * C-9：替换后清空代码块/表格/全屏/自动补全浮层——它们持有的 DOM 引用
     * 属于旧文档，不清会悬浮在新文档上指向过期节点。
     */
    const applyReplaceContent = (markdown: string, flush: boolean): void => {
      const ed = getReadyEditor()
      if (!ed) return
      ed.action(replaceAll(markdown, flush))
      const view = ed.ctx.get(editorViewCtx)
      // 重新转换新文档中的 [[...]] 文本为 wiki 链接
      // （wikiTextConvertPlugin 只在编辑器创建时运行一次，切换文档不会触发）
      convertWikiTextInDoc(view)
      // 清空折叠状态（兜底：replaceAll 解析失败时也把旧文档的折叠映射清除）
      view.dispatch(view.state.tr.setMeta(sectionFoldKey, { reset: true }))
      setCodePanel(null)
      setTablePanel(null)
      setFullscreenCode(null)
      setWikiAcState(null)
      lastPreRef.current = null
      setLangInput('')
      setCopied(false)
    }

    /**
     * C-3：IME 组合期间挂起替换（compositionend 后执行，见组件顶部监听）。
     * 组合中多次替换只保留最后一次；非组合态同步执行。
     */
    const replaceWhenNotComposing = (run: () => void): void => {
      const ed = getReadyEditor()
      if (!ed) return
      if (ed.ctx.get(editorViewCtx).composing) {
        pendingReplaceRef.current = run
        return
      }
      run()
    }

    useImperativeHandle(ref, () => {
      const searchController = createSearchController(() => {
        const editor = getReadyEditor()
        return editor ? editor.ctx.get(editorViewCtx) : null
      })

      return {
        replaceContent: (markdown) => {
          replaceWhenNotComposing(() => applyReplaceContent(markdown, true))
        },
        /** 属性面板等程序性更新：事务替换保留撤销历史，并恢复选区与滚动位置 */
        updateContentPreservingHistory: (markdown) => {
          replaceWhenNotComposing(() => {
            const ed = getReadyEditor()
            if (!ed) return
            const view = ed.ctx.get(editorViewCtx)
            const prevFrom = view.state.selection.from
            const scrollParent = containerRef.current?.querySelector<HTMLElement>('.editor-scroll')
            const prevScroll = scrollParent?.scrollTop ?? 0
            // flush=false：dispatch 单条全文替换事务，undo/redo 历史保留（Ctrl+Z 可回退本次修改）
            applyReplaceContent(markdown, false)
            // 恢复选区与滚动位置，避免光标跳回文档开头
            const { state, dispatch } = view
            const pos = Math.min(prevFrom, state.doc.content.size)
            dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))))
            requestAnimationFrame(() => {
              if (scrollParent) scrollParent.scrollTop = prevScroll
            })
          })
        },
        getMarkdown: () => {
          const ed = getReadyEditor()
          return ed ? ed.action(getMarkdown()) : null
        },
        insertMd: (markdown) => {
          getReadyEditor()?.action(insert(markdown))
        },
        runCommand: (key, payload) => {
          const ed = getReadyEditor()
          if (!ed) return false
          return ed.action(callCommand(key, payload))
        },
        getHtml: () => {
          return getReadyEditor()?.action(getHTML()) ?? ''
        },
        getHeadings: () => {
          const ed = getReadyEditor()
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
          const ed = getReadyEditor()
          if (!ed) return ''
          const view = ed.ctx.get(editorViewCtx)
          // 克隆后清理编辑器态装饰：搜索高亮、光标块高亮、括号配对，
          // 及行号 widget（避免预览/导出混入行号）
          const clone = view.dom.cloneNode(true) as HTMLElement
          clone.querySelectorAll('.search-hit').forEach((el) => {
            el.classList.remove('search-hit', 'current')
          })
          clone
            .querySelectorAll('.block-active, .bracket-match')
            .forEach((el) => el.classList.remove('block-active', 'bracket-match'))
          // 折叠章节在编辑器内 display:none；预览/导出必须完整展示，
          // 否则折叠状态下导出会丢失整段内容
          clone
            .querySelectorAll('.folded-hidden')
            .forEach((el) => el.classList.remove('folded-hidden'))
          clone
            .querySelectorAll('.code-line-numbers, .fold-toggle')
            .forEach((el) => el.remove())
          clone
            .querySelectorAll('.mermaid-toolbar')
            .forEach((el) => el.remove())
          // C-10：源码编辑态的 mermaid 块——已有渲染 SVG 时切回预览态导出图表；
          // 尚无 SVG（未渲染/语法失败）则保留源码态，其源码 pre 随后保留，
          // 避免导出/预览在源码编辑态下整块空白
          clone
            .querySelectorAll('.mermaid-block.is-editing-source')
            .forEach((el) => {
              if (el.querySelector('.mermaid-preview svg')) {
                el.classList.remove('is-editing-source')
              }
            })
          clone.querySelectorAll('pre[data-language]').forEach((el) => {
            if (el.getAttribute('data-language')?.trim().toLowerCase() !== 'mermaid') return
            const prev = el.previousElementSibling
            const stillSourceEditing =
              prev instanceof Element &&
              prev.classList.contains('mermaid-block') &&
              prev.classList.contains('is-editing-source')
            // 预览态删除 pre（SVG 已展示）；源码态保留 pre（以源码文本导出）
            if (!stillSourceEditing) el.remove()
          })
          return clone.innerHTML
        },
        focus: () => {
          containerRef.current?.querySelector<HTMLElement>('.milkdown .editor')?.focus()
        },
        focusEnd: () => {
          const ed = getReadyEditor()
          if (!ed) return
          const view = ed.ctx.get(editorViewCtx)
          const { state, dispatch } = view
          dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView())
          view.focus()
        },
        isReady: () => getReadyEditor() !== null,

        /* ---------- 富内容就绪（导出/预览前等待图表 SVG） ---------- */

        ensureRichContent: async () => {
          await ensureMermaidRendered()
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        },

        /* ---------- 搜索 ---------- */

        startSearch: searchController.start,
        searchNext: searchController.next,
        replaceCurrent: searchController.replaceCurrent,
        replaceAllMatches: searchController.replaceAll,
        endSearch: searchController.end,
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
          {/* 文档属性面板：随内容滚动，宽度与正文对齐 */}
          {frontmatterPanel && <div className="fm-panel-wrap">{frontmatterPanel}</div>}
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
          <EditorOverlays
            codePanel={codePanel}
            tablePanel={tablePanel}
            fullscreenCode={fullscreenCode}
            wikiAutocomplete={wikiAcOverlay}
            language={langInput}
            copied={copied}
            onLanguageChange={setLangInput}
            onApplyLanguage={applyLanguage}
            onCloseCodePanel={() => setCodePanel(null)}
            onOpenFullscreen={() => {
              if (!codePanel) return
              setFullscreenCode({
                language: codePanel.language,
                text: getCodeText(codePanel.pre),
              })
            }}
            onCopyCode={handleCopy}
            onTableAction={runTableAction}
            onCloseFullscreen={() => setFullscreenCode(null)}
            onCopyFullscreen={() => {
              if (!fullscreenCode) return
              navigator.clipboard.writeText(fullscreenCode.text).catch(() => {})
            }}
          />
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
