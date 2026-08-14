import { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue } from 'react'
import katexCss from 'katex/dist/katex.min.css?inline'
import type { CSSProperties } from 'react'
import { MenuBar } from './src/components/MenuBar'
import type { RecentFile } from './src/components/MenuBar'
import { Sidebar } from './src/components/Sidebar'
import type { OpenFile, WorkspaceInfo } from './src/components/Sidebar'
import { Editor } from './src/components/Editor'
import type { EditorHandle } from './src/components/Editor'
import { StatusBar } from './src/components/StatusBar'
import { ThemeSwitcher } from './src/components/ThemeSwitcher'
import { SearchBar } from './src/components/SearchBar'
import { SettingsDialog } from './src/components/SettingsDialog'
import type { FontSize, ContentWidth, LineHeight, ContentFont } from './src/components/SettingsDialog'
import { HelpDialog } from './src/components/HelpDialog'
import type { HelpView, WritingStats } from './src/components/HelpDialog'
import { ImagesDialog } from './src/components/ImagesDialog'
import { ExportPdfDialog } from './src/components/ExportPdfDialog'
import type { PdfOptions } from './src/components/ExportPdfDialog'
import { WorkspaceSearchDialog } from './src/components/WorkspaceSearchDialog'
import { TabBar } from './src/components/TabBar'
import { StartScreen } from './src/components/StartScreen'
import { DEFAULT_SHORTCUTS, mergeShortcuts, comboFromEvent } from './src/data/shortcuts'
import type { ShortcutMap } from './src/data/shortcuts'
import { DEMO_FILES, DEMO_TREE, DEFAULT_FILE_ID } from './src/data/demo-files'
import type { DraftMap } from './src/lib/drafts'
import { rollStatsDate, EMPTY_STATS } from './src/lib/stats'
import { injectToc } from './src/lib/pdf'
import { toEditorImages, toStoredImages } from './src/lib/image-path'
import {
  findDiscardablePreview,
  getNeighborTabId,
  isDocumentDirty,
  pinPreviewOpenFile,
  reorderTabs,
  requiresCloseConfirmation,
} from './src/lib/document-tabs'
import { isEditableShortcutTarget, isImeComposing } from './src/lib/keyboard'
import { shouldRestoreEditorFocus } from './src/lib/editor-focus'
import { isCurrentEditorChange } from './src/lib/editor-sync'
import { usePersistedSetting } from './src/hooks/usePersistedSetting'
import { useWritingStats } from './src/hooks/useWritingStats'
import { useRecentFiles } from './src/hooks/useRecentFiles'
import { useEditorViewState } from './src/hooks/useEditorViewState'
import { useDraftPersistence } from './src/hooks/useDraftPersistence'
import {
  useDocumentSessionPersistence,
  type SessionData,
} from './src/hooks/useDocumentSessionPersistence'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  insertHrCommand,
  turnIntoTextCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  insertTableCommand,
  toggleStrikethroughCommand,
  addRowAfterCommand,
  addColAfterCommand,
  deleteSelectedCellsCommand,
} from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { resolveWikiTarget } from './src/lib/wiki-resolver'
import { collectMdFiles } from './src/lib/wiki-resolver'
import {
  getFrontmatterPropertyKeys,
  isValidFrontmatterPropertyKey,
  parseFrontmatterYaml,
  setFrontmatterProperty,
  deleteFrontmatterProperty,
  extractFrontmatterRaw,
} from './src/lib/frontmatter-parser'
import { FrontmatterProperties } from './src/components/Editor/FrontmatterProperties'

/** 每套主题对应的标题栏覆盖层颜色（Windows 系统窗口按钮区域） */
const TITLEBAR_COLORS: Record<string, { bg: string; symbol: string }> = {
  default: { bg: '#F0EDEA', symbol: '#5C5850' },
  dark: { bg: '#1A1918', symbol: '#A09B93' },
  ocean: { bg: '#E6ECF3', symbol: '#4A6070' },
  rose: { bg: '#F5EDED', symbol: '#6B4F4F' },
  github: { bg: '#161B22', symbol: '#8B949E' },
  atom: { bg: '#20242B', symbol: '#8E8E90' },
  typewriter: { bg: '#E4DCC8', symbol: '#595959' },
}

/** 初始只打开「欢迎」一篇样例文档；其余样例文件留在左侧文件夹树中点击打开，
 * 避免启动时一次性铺开一堆标签页（标签页只在编辑器区域呈现）。 */
const INITIAL_FILES: OpenFile[] = [{ id: DEFAULT_FILE_ID, name: DEMO_FILES[DEFAULT_FILE_ID].name }]

/** 新窗口模式（#fresh）：跳过会话恢复与写入，避免多窗口间会话互相覆盖 */
const FRESH_MODE =
  typeof window !== 'undefined' && window.location.hash.includes('fresh')

/** fresh 窗口携带的文件路径（#fresh?file=...）：启动后自动打开（右键"在新窗口打开"，U7） */
const FRESH_FILE_PATH = ((): string | null => {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash.includes('fresh')) return null
  const qs = hash.split('?')[1]
  if (!qs) return null
  return new URLSearchParams(qs).get('file')
})()

const INITIAL_CONTENTS: Record<string, string> = Object.fromEntries(
  Object.values(DEMO_FILES).map((f) => [f.id, f.content]),
)

const INITIAL_SAVED: Record<string, boolean> = Object.fromEntries(
  Object.values(DEMO_FILES).map((f) => [f.id, true]),
)

const DEMO_FILE_IDS = new Set(Object.keys(DEMO_FILES))

let untitledCounter = 1

/** HTML 特殊字符转义（导出 HTML 的 title 来自文件名，可能含 & < >） */
const escapeHtmlText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function App(): JSX.Element {
  const editorRef = useRef<EditorHandle>(null)
  const editorAreaRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  const [openFiles, setOpenFiles] = useState<OpenFile[]>(INITIAL_FILES)
  const [contents, setContents] = useState<Record<string, string>>(INITIAL_CONTENTS)
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>(INITIAL_SAVED)
  const [activeFileId, setActiveFileId] = useState(DEFAULT_FILE_ID)
  const [docTitle, setDocTitle] = useState(DEMO_FILES[DEFAULT_FILE_ID].name)

  const {
    theme,
    setTheme,
    sidebarCollapsed,
    setSidebarCollapsed,
    focusMode,
    setFocusMode,
    typewriter,
    setTypewriter,
    previewMode,
    setPreviewMode,
    settingsOpen,
    setSettingsOpen,
    helpView,
    setHelpView,
    imagesOpen,
    setImagesOpen,
    autosave,
    setAutosave,
    spellcheck,
    setSpellcheck,
    multiWindow,
    setMultiWindow,
    fontSize,
    setFontSize,
    contentWidth,
    setContentWidth,
    lineHeight,
    setLineHeight,
    contentFont,
    setContentFont,
  } = useEditorViewState()
  const [focusOutlineTick, setFocusOutlineTick] = useState(0)
  const [searchMode, setSearchMode] = useState<'none' | 'find' | 'replace'>('none')
  const [searchCount, setSearchCount] = useState(0)
  const [searchCurrent, setSearchCurrent] = useState(-1)

  /** 编辑区缩放（0.7–1.8，Ctrl+滚轮 / Ctrl+= / Ctrl+-） */
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  /** 侧栏宽度（可拖拽调整） */
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const sidebarWidthRef = useRef(260)
  sidebarWidthRef.current = sidebarWidth

  /** 每个磁盘文件的已知最后修改时间（外部冲突检测用） */
  const [fileMtime, setFileMtime] = useState<Record<string, number>>({})
  /** 轻提示 */
  const [toast, setToast] = useState('')
  /** 打开的工作区文件夹 */
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  /** 光标位置（行/列 + 当前标题 + 标题索引 + 选中字数） */
  const [cursorPos, setCursorPos] = useState<{
    line: number
    col: number
    heading: string
    headingIndex: number
    selected: number
  }>({ line: 1, col: 1, heading: '', headingIndex: -1, selected: 0 })
  /** 拖入 .md 文件提示层 */
  const [dragFileOver, setDragFileOver] = useState(false)
  /** 自定义快捷键 */
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({ ...DEFAULT_SHORTCUTS })
  /** 持久化搜索状态（U4：重新打开搜索栏时保留查询词/选项/替换文本） */
  const [searchPref, setSearchPref] = useState<{
    query: string
    useRegex: boolean
    caseSensitive: boolean
    wholeWord: boolean
    replacement: string
  }>({ query: '', useRegex: false, caseSensitive: false, wholeWord: false, replacement: '' })
  /** 点击正文下方空白区跳到文末（U8，默认开启，可在设置关闭） */
  const [blankClickToEnd, setBlankClickToEnd] = useState(true)
  /** 代码块行号开关（装饰 widget 实现，默认关） */
  const [codeLineNumbers, setCodeLineNumbers] = useState(false)
  /** PDF 导出选项弹窗 */
  const [pdfOptsOpen, setPdfOptsOpen] = useState(false)
  /** 自定义主题 CSS（用户导入，注入 <style> 生效） */
  const [customCss, setCustomCss] = useState<{ name: string; content: string } | null>(null)
  /** 图床状态：访问令牌仅由主进程持久化，渲染端不读取其明文。 */
  const [imageHost, setImageHost] = useState<{ provider: 'local' | 'smms'; configured: boolean }>({
    provider: 'local',
    configured: false,
  })
  /** 拼写检查语言（B4 部分改善：可选 Electron 内置词典语言） */
  const [spellcheckLang, setSpellcheckLang] = useState('en-US')
  /** 每个文件的源编码（自动探测，状态栏展示；保存统一写回 UTF-8） */
  const [encodingMap, setEncodingMap] = useState<Record<string, string>>({})
  /** 工作区全文搜索弹窗 */
  const [wsSearchOpen, setWsSearchOpen] = useState(false)
  /** 搜索栏强制重挂载计数（工作区搜索结果带入时，确保查询词重新生效） */
  const [searchEpoch, setSearchEpoch] = useState(0)
  /** 工作区搜索结果点击序号：连续点击时只采纳最后一次，避免后发请求被先发覆盖 */
  const wsSelectSeqRef = useRef(0)
  /** 组合键 → 动作 反查表（keydown 中读 ref，避免频繁重建监听） */
  const shortcutLookupRef = useRef<Record<string, string>>({})
  /** 弹窗打开标志镜像（M4）：对话框打开期间禁用全局快捷键，
   *  避免 Ctrl+S/Ctrl+N 等在弹窗按钮聚焦时误触发（ref 镜像避免重建监听器） */
  const modalOpenRef = useRef(false)
  modalOpenRef.current =
    settingsOpen ||
    helpView !== null ||
    imagesOpen ||
    pdfOptsOpen ||
    wsSearchOpen

  useEffect(() => {
    if (!focusMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isImeComposing(event)) return
      if (event.key !== 'Escape') return
      if (searchMode !== 'none' || settingsOpen || helpView || imagesOpen || pdfOptsOpen || wsSearchOpen) {
        return
      }
      setFocusMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusMode, searchMode, settingsOpen, helpView, imagesOpen, pdfOptsOpen, wsSearchOpen, setFocusMode])

  // 无打开文件（已全部关闭）时内容视为空，避免状态栏/大纲沿用上一份文档的残留内容
  const activeContent = openFiles.length > 0 ? (contents[activeFileId] ?? '') : ''
  // 大文档连续输入时，状态栏统计让出渲染优先级；文件 ID 与内容作为一个值延后，
  // 防止切换文档时把旧内容的字数记到新文档。
  const statsSource = useMemo(
    () => ({ fileId: activeFileId, content: activeContent }),
    [activeFileId, activeContent],
  )
  const deferredStatsSource = useDeferredValue(statsSource)

  // 字数统计（先剥离 Markdown 语法符号，只统计正文）
  const { wordCount, lineCount } = useMemo(() => {
    const plain = deferredStatsSource.content
      // 头部 YAML frontmatter 元数据不计入正文
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+\[[ x]\]\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`|]/g, '')
    const text = plain.trim()
    return {
      wordCount: text.replace(/\s/g, '').length,
      lineCount: text ? text.split('\n').length : 0,
    }
  }, [deferredStatsSource])
  const saved = savedMap[activeFileId] ?? true
  const activeFile = openFiles.find((f) => f.id === activeFileId)

  /** 演示文件名映射（id → 显示名），供侧栏渲染 */
  const demoFileNames = useMemo(
    () => Object.fromEntries(Object.values(DEMO_FILES).map((f) => [f.id, f.name])),
    [],
  )

  /**
   * activeFileId 的同步镜像。
   * 切换文件时 replaceAll 会同步触发编辑器回调，而 React state 尚未更新，
   * 回调必须读这个 ref 才能把内容写到正确的文件。
   */
  const activeFileIdRef = useRef(activeFileId)
  /** 内容同步镜像：异步保存完成时用于判断用户是否已继续输入。 */
  const contentsRef = useRef(contents)
  contentsRef.current = contents

  /** 镜像 openFiles/workspace，供 dirOfFile 等在不重建的回调中读取 */
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  /** 同一路径的文件树单击/双击只共享一次读取请求，避免慢磁盘下出现重复标签。 */
  const openingWorkspaceFilesRef = useRef(new Map<string, Promise<boolean>>())
  /** 最后一次文件选择意图；较早的慢读取完成后不得反向抢占当前文件。 */
  const latestWorkspaceSelectionRef = useRef('')
  const workspacePathRef = useRef<string | undefined>(undefined)
  workspacePathRef.current = workspace?.path

  /** 求某文件所在目录（图片相对路径解析用），未命中回退工作区目录 */
  const dirOfFile = useCallback((fileId: string): string | undefined => {
    const f = openFilesRef.current.find((x) => x.id === fileId)
    if (f?.path) return f.path.replace(/[\\/][^\\/]+$/, '')
    return workspacePathRef.current
  }, [])

  // 启动时加载持久化设置，并恢复会话与草稿（加载完成前不写回）
  const [settingsReady, setSettingsReady] = useState(false)
  const settingsInitRef = useRef(false)

  /* ==================== 写作统计与最近文件（垂直 hook） ==================== */
  const { writingStats, setWritingStats } = useWritingStats(
    wordCount,
    deferredStatsSource.fileId,
    settingsReady,
  )
  const { recentFiles, setRecentFiles, recordRecent } = useRecentFiles(settingsReady)

  useEffect(() => {
    // 防 StrictMode 双执行：会话恢复只跑一次（去重后重复执行无害，但避免双倍 IPC 读取）
    if (settingsInitRef.current) return
    settingsInitRef.current = true
    if (!window.desktopAPI) {
      setSettingsReady(true)
      return
    }
    const api = window.desktopAPI.settings
    Promise.all([
      api.get('theme'),
      api.get('autosave'),
      api.get('spellcheck'),
      api.get('multiWindow'),
      api.get('fontSize'),
      api.get('zoom'),
      api.get('sidebarWidth'),
      api.get('contentWidth'),
      api.get('lineHeight'),
      api.get('contentFont'),
      api.get('writingStats'),
      api.get('recentFiles'),
      api.get('shortcuts'),
      api.get('session'),
      api.get('drafts'),
      api.get('searchState'),
      api.get('blankClickToEnd'),
      api.get('codeLineNumbers'),
      api.get('customCss'),
      window.desktopAPI.imageHost.getStatus(),
      api.get('spellcheckLang'),
      api.get('sidebarCollapsedKeys'),
      api.get('sidebarActiveTab'),
      api.get('showFrontmatterProps'),
    ])
      .then(async ([t, a, sp, mw, f, z, sw, cw, lh, cf, ws, rf, sc, s, dr, srch, bce, cln, ccs, ih, scl, sck, sat, sfmp]) => {
        if (t?.ok && typeof t.data === 'string') setTheme(t.data)
        if (a?.ok && typeof a.data === 'boolean') setAutosave(a.data)
        if (sp?.ok && typeof sp.data === 'boolean') setSpellcheck(sp.data)
        if (mw?.ok && typeof mw.data === 'boolean') setMultiWindow(mw.data)
        if (f?.ok) {
          const v =
            typeof f.data === 'number'
              ? f.data
              : f.data === 'sm'
                ? 14
                : f.data === 'lg'
                  ? 18
                  : 16
          setFontSize(v)
        }
        if (z?.ok && typeof z.data === 'number') {
          setZoom(Math.min(1.8, Math.max(0.7, z.data)))
        }
        if (sw?.ok && typeof sw.data === 'number') {
          setSidebarWidth(Math.min(480, Math.max(180, sw.data)))
        }
        if (cw?.ok) {
          const v =
            typeof cw.data === 'number'
              ? cw.data
              : cw.data === 'narrow'
                ? 640
                : cw.data === 'wide'
                  ? 1200
                  : 900
          setContentWidth(v)
        }
        if (lh?.ok) {
          const v =
            typeof lh.data === 'number'
              ? lh.data
              : lh.data === 'compact'
                ? 1.65
                : lh.data === 'loose'
                  ? 2.1
                  : 1.85
          setLineHeight(v)
        }
        if (
          cf?.ok &&
          (cf.data === 'default' || cf.data === 'serif' || cf.data === 'mono')
        ) {
          setContentFont(cf.data)
        }
        if (ws?.ok && ws.data && typeof ws.data === 'object') {
          const loaded = ws.data as WritingStats
          if (typeof loaded.words === 'number' && Array.isArray(loaded.history)) {
            setWritingStats(rollStatsDate({ ...EMPTY_STATS, ...loaded }))
          }
        }
        if (rf?.ok && Array.isArray(rf.data)) {
          const rec = (rf.data as RecentFile[])
            .filter((r) => r && typeof r.path === 'string' && typeof r.name === 'string')
            .slice(0, 10)
          setRecentFiles(rec)
        }
        if (sc?.ok) {
          setShortcuts(mergeShortcuts(sc.data))
        }
        // U4：恢复上次的搜索状态
        if (srch?.ok && srch.data && typeof srch.data === 'object') {
          const v = srch.data as {
            query?: unknown
            useRegex?: unknown
            caseSensitive?: unknown
            wholeWord?: unknown
            replacement?: unknown
          }
          setSearchPref({
            query: typeof v.query === 'string' ? v.query : '',
            useRegex: v.useRegex === true,
            caseSensitive: v.caseSensitive === true,
            wholeWord: v.wholeWord === true,
            replacement: typeof v.replacement === 'string' ? v.replacement : '',
          })
        }
        // U8：空白区点击行为开关
        if (bce?.ok && typeof bce.data === 'boolean') setBlankClickToEnd(bce.data)
        // 代码块行号开关
        if (cln?.ok && typeof cln.data === 'boolean') setCodeLineNumbers(cln.data)
        // 自定义主题 CSS
        if (ccs?.ok && ccs.data && typeof ccs.data === 'object') {
          const v = ccs.data as { name?: unknown; content?: unknown }
          if (typeof v.content === 'string' && v.content) {
            setCustomCss({ name: typeof v.name === 'string' ? v.name : 'custom.css', content: v.content })
          }
        }
        // 图床配置
        if (ih?.ok && ih.data && typeof ih.data === 'object') {
          const v = ih.data as { provider?: unknown; configured?: unknown }
          setImageHost({
            provider: v.provider === 'smms' ? 'smms' : 'local',
            configured: v.configured === true,
          })
        }
        // 拼写检查语言
        if (scl?.ok && typeof scl.data === 'string') setSpellcheckLang(scl.data)
        // 侧边栏折叠状态恢复
        if (sck?.ok && Array.isArray(sck.data)) setSidebarCollapsedKeys(sck.data as string[])
        // 侧边栏活动标签页恢复
        if (sat?.ok && (sat.data === 'files' || sat.data === 'outline'))
          setSidebarActiveTab(sat.data)
        // frontmatter 属性面板开关恢复
        if (sfmp?.ok && typeof sfmp.data === 'boolean') setShowFrontmatterProps(sfmp.data)

        // fresh 窗口（多窗口模式新建）不恢复会话，避免多窗口互相覆盖
        const session = FRESH_MODE
          ? null
          : ((s?.ok ? s.data : null) as SessionData | null)
        // fresh 窗口也不恢复全局草稿：草稿属于主窗口会话，灌入未打开文件的脏状态会让新窗口"天生未保存"且无法关闭
        const drafts = FRESH_MODE ? {} : (((dr?.ok ? dr.data : null) ?? {}) as DraftMap)

        /* ---- 会话恢复：重新打开上次的磁盘文件与未命名文档 ---- */
        const restoredFiles: OpenFile[] = []
        const restoredContents: Record<string, string> = {}
        const restoredMtimes: Record<string, number> = {}
        const restoredEncodings: Record<string, string> = {}
        const seenIds = new Set<string>()
        // 防御：会话文件列表去重 + 上限（历史上曾因重复累积膨胀到几十万条导致启动 OOM）
        const sessionFiles = (session?.files ?? []).slice(0, 200)
        for (const entry of sessionFiles) {
          if (!entry || !entry.id || seenIds.has(entry.id)) continue
          seenIds.add(entry.id)
          if (DEMO_FILES[entry.id]) continue
          if (entry.path) {
            const res = await window.desktopAPI.document.read(entry.path)
            if (res.ok && res.data) {
              restoredFiles.push({ id: entry.id, name: res.data.name, path: entry.path })
              restoredContents[entry.id] = res.data.content
              restoredMtimes[entry.id] = res.data.modifiedTime
              if (res.data.encoding) restoredEncodings[entry.id] = res.data.encoding
            }
          } else if (entry.name) {
            restoredFiles.push({ id: entry.id, name: entry.name })
            restoredContents[entry.id] = ''
          }
        }
        if (Object.keys(restoredEncodings).length) {
          setEncodingMap((prev) => ({ ...prev, ...restoredEncodings }))
        }
        // H7：会话恢复的未命名标签（untitled-N）可能占用新标签 ID，
        // 启动时把自增计数推进到已恢复的最大编号，避免 Ctrl+N 创建重复 ID
        for (const f of restoredFiles) {
          const match = /^untitled-(\d+)$/.exec(f.id)
          if (match) {
            const n = Number(match[1])
            if (n >= untitledCounter) untitledCounter = n + 1
          }
        }

        /* ---- 草稿恢复：未保存的编辑内容回滚 ---- */
        const dirtyIds: string[] = []
        const baselineById: Record<string, string> = {}
        for (const [id, d] of Object.entries(drafts)) {
          // 基线：磁盘文件用读到的内容，演示文件用初始内容
          const baseline =
            id in restoredContents ? restoredContents[id] : INITIAL_CONTENTS[id]
          if (baseline === undefined || d.content === baseline) continue
          // B6：恢复草稿前重新 stat 磁盘文件；若读取后又被外部修改，
          // 则丢弃草稿以磁盘最新内容为准，避免旧草稿覆盖新修改
          const fl = restoredFiles.find((x) => x.id === id)
          if (fl?.path) {
            const st = await window.desktopAPI.document.stat(fl.path)
            if (
              st.ok &&
              st.data &&
              Math.abs(st.data.modifiedTime - (restoredMtimes[id] ?? 0)) > 3000
            ) {
              continue
            }
          }
          baselineById[id] = baseline
          restoredContents[id] = d.content
          dirtyIds.push(id)
        }

        if (restoredFiles.length) {
          // 同步更新 ref，首次替换编辑器内容时才能正确解析恢复文件的相对图片路径。
          const existing = new Set(openFilesRef.current.map((file) => file.id))
          const nextOpenFiles = [
            ...openFilesRef.current,
            ...restoredFiles.filter((file) => !existing.has(file.id)),
          ]
          openFilesRef.current = nextOpenFiles
          setOpenFiles(nextOpenFiles)
        }
        if (Object.keys(restoredContents).length) {
          setContents((prev) => ({ ...prev, ...restoredContents }))
        }
        // 脏检查基线：干净文件用恢复内容，脏文件用草稿应用前的基线
        Object.assign(INITIAL_OR_SAVED.current, restoredContents)
        Object.assign(INITIAL_OR_SAVED.current, baselineById)
        setSavedMap((prev) => {
          const next = { ...prev }
          restoredFiles.forEach((fl) => {
            next[fl.id] = !dirtyIds.includes(fl.id)
          })
          dirtyIds.forEach((id) => {
            next[id] = false
          })
          return next
        })
        if (Object.keys(restoredMtimes).length) {
          setFileMtime((prev) => ({ ...prev, ...restoredMtimes }))
        }
        if (dirtyIds.length) {
          setToast(`已恢复 ${dirtyIds.length} 篇未保存草稿`)
        }

        /* ---- 恢复上次激活的文档 ---- */
        const allIds = new Set([
          ...INITIAL_FILES.map((fl) => fl.id),
          ...restoredFiles.map((fl) => fl.id),
        ])

        /* ---- 恢复上次的工作区文件夹（静默：空文件夹不重复新建文档） ---- */
        if (session?.workspacePath) {
          void handleOpenFolder(session.workspacePath, true)
        }
        const target =
          session?.activeFileId && allIds.has(session.activeFileId)
            ? session.activeFileId
            : DEFAULT_FILE_ID
        if (target !== activeFileIdRef.current) {
          activeFileIdRef.current = target
          setActiveFileId(target)
          const file =
            restoredFiles.find((fl) => fl.id === target) ??
            INITIAL_FILES.find((fl) => fl.id === target)
          setDocTitle(file?.name ?? '未命名文档')
        }
        // 等编辑器就绪后应用最终内容（创建是异步的，重试至多 2 秒）
        const finalContent = restoredContents[target] ?? INITIAL_CONTENTS[target] ?? ''
        let tries = 0
        const tryApply = () => {
          if (editorRef.current?.isReady()) {
            // 渲染前解析相对路径图片；此时 openFilesRef 已含恢复文件
            replaceEditorContent(
              target,
              finalContent,
              dirtyIds.includes(target) ? 'ignore' : 'initialize',
            )
          } else if (tries++ < 20) {
            setTimeout(tryApply, 100)
          }
        }
        tryApply()

        /* ---- fresh 窗口携带的文件：直接打开（右键"在新窗口打开"，U7） ---- */
        if (FRESH_FILE_PATH) {
          // 等编辑器创建完成再打开，避免 replaceContent 被静默跳过（重试至多 2 秒）
          let openTries = 0
          const openWhenReady = () => {
            if (editorRef.current?.isReady()) {
              void handleSelectWorkspaceFile(FRESH_FILE_PATH)
            } else if (openTries++ < 20) {
              setTimeout(openWhenReady, 100)
            }
          }
          openWhenReady()
        }
      })
      .catch(() => {})
      .finally(() => {
        setSettingsReady(true)
      })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // 同步 Windows 标题栏覆盖层颜色，让系统按钮区与顶栏融为一体
    const colors = TITLEBAR_COLORS[theme] ?? TITLEBAR_COLORS.default
    window.desktopAPI?.window.setTitlebarColor(colors.bg, colors.symbol).catch(() => {})
  }, [theme])
  usePersistedSetting('theme', theme, settingsReady)

  usePersistedSetting('autosave', autosave, settingsReady)

  // 拼写检查：同步会话级开关 + 语言，并持久化
  useEffect(() => {
    window.desktopAPI?.window.setSpellcheck(spellcheck, spellcheckLang).catch(() => {})
  }, [spellcheck, spellcheckLang])
  usePersistedSetting('spellcheck', spellcheck, settingsReady)
  usePersistedSetting('spellcheckLang', spellcheckLang, settingsReady)

  // 多窗口模式持久化（主进程下次启动时读取，决定是否跳过单实例锁）
  usePersistedSetting('multiWindow', multiWindow, settingsReady)

  // 快捷键反查表更新
  useEffect(() => {
    const lookup: Record<string, string> = {}
    for (const [action, combo] of Object.entries(shortcuts)) {
      if (combo) lookup[combo] = action
    }
    shortcutLookupRef.current = lookup
  }, [shortcuts])
  usePersistedSetting('shortcuts', shortcuts, settingsReady)

  useEffect(() => {
    document.documentElement.style.setProperty('--efs', `${fontSize}px`)
  }, [fontSize])
  usePersistedSetting('fontSize', fontSize, settingsReady)

  useEffect(() => {
    document.documentElement.style.setProperty('--ecw', `${contentWidth}px`)
  }, [contentWidth])
  usePersistedSetting('contentWidth', contentWidth, settingsReady)

  useEffect(() => {
    document.documentElement.style.setProperty('--elh', String(lineHeight))
  }, [lineHeight])
  usePersistedSetting('lineHeight', lineHeight, settingsReady)

  // 内容字体：data 属性 + 持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-contentfont', contentFont)
  }, [contentFont])
  usePersistedSetting('contentFont', contentFont, settingsReady)

  // 缩放：写入 CSS 变量并持久化
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-zoom', String(zoom))
  }, [zoom])
  usePersistedSetting('zoom', zoom, settingsReady)

  // Ctrl/Cmd + 滚轮缩放编辑区
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (!(e.target instanceof Element) || !e.target.closest('.editor-content')) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.1 : -0.1
      setZoom((z) => Math.min(1.8, Math.max(0.7, +(z + step).toFixed(2))))
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [])

  // 侧栏宽度持久化（拖拽中高频变化，防抖写入）
  usePersistedSetting('sidebarWidth', sidebarWidth, settingsReady, 500)

  /** 拖拽调整侧栏宽度 */
  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidthRef.current
    const move = (ev: MouseEvent) => {
      // 侧栏带 zoom 缩放，屏幕像素增量需除以倍率
      const delta = (ev.clientX - startX) / zoomRef.current
      setSidebarWidth(Math.min(480, Math.max(180, startW + delta)))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }, [])

  // 窗口标题随文档与保存状态变化
  useEffect(() => {
    document.title = `${saved ? '' : '● '}${docTitle} — MarkdownSoft`
  }, [docTitle, saved])

  // 有未保存内容时，关闭窗口前确认
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.values(savedMap).some((s) => !s)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [savedMap])

  /* ==================== 自动保存 ==================== */

  /** encodingMap 的 ref 镜像：供稳定回调（不随状态重建）读取最新编码 */
  const encodingMapRef = useRef(encodingMap)
  encodingMapRef.current = encodingMap

  /**
   * 带 GBK 降级的保存：主进程发现内容含 GBK 无法表示的字符（如 emoji）时
   * 返回 ENCODING_LOSS，此时降级为 UTF-8 保存（内容永不丢失，仅文件编码变化）。
   * interactive=true 先询问（手动保存）；否则自动降级 + 轻提示（自动保存等后台路径）。
   */
  const saveWithEncodingFallback = useCallback(
    async (
      path: string,
      content: string,
      expectedMtime: number | undefined,
      fileId: string,
      interactive = false,
    ) => {
      if (!window.desktopAPI) {
        return { ok: false, error: { code: 'NO_API' } }
      }
      let res = await window.desktopAPI.document.save(
        path,
        content,
        expectedMtime,
        encodingMapRef.current[fileId],
      )
      if (!res.ok && res.error?.code === 'ENCODING_LOSS') {
        if (interactive) {
          const convert = window.confirm(
            '内容包含 GBK 无法表示的字符（如 emoji）。\n转为 UTF-8 保存会改变文件编码，是否继续？',
          )
          if (!convert) return res
        }
        res = await window.desktopAPI.document.save(path, content, expectedMtime)
        if (res.ok) {
          setEncodingMap((prev) => ({ ...prev, [fileId]: 'UTF-8' }))
          setToast('文件含 GBK 无法表示的字符，已转为 UTF-8 保存')
        }
      }
      return res
    },
    [],
  )

  const { clearDraft, draftPendingRef, saveDraft } = useDraftPersistence({
    activeFileId,
    content: activeContent,
    ready: settingsReady,
  })

  // 用 ref 镜像最新状态，供定时器读取（避免闭包捕获旧值）
  const autoSaveRef = useRef({ contents, openFiles, savedMap, autosave, fileMtime })
  autoSaveRef.current = { contents, openFiles, savedMap, autosave, fileMtime }
  const autoSaveInFlightRef = useRef(false)

  useEffect(() => {
    // 浏览器调试环境（无 Electron API）没有落盘能力，直接不创建定时器，避免 30 秒空转
    if (!window.desktopAPI) return
    // 每 30 秒将已落盘的未保存文档自动写回（演示文件无路径，不参与）。
    // 写入尚未结束时跳过本轮，避免并发保存使用过期 mtime 造成误冲突或旧内容覆盖。
    const runAutoSave = async () => {
      if (autoSaveInFlightRef.current) return
      if (!window.desktopAPI) return
      const {
        contents: cs,
        openFiles: fs,
        savedMap: sm,
        autosave: enabled,
        fileMtime: mt,
      } = autoSaveRef.current
      if (!enabled) return
      autoSaveInFlightRef.current = true
      try {
        for (const f of fs) {
          if (!f.path || sm[f.id] !== false) continue
          let content = cs[f.id] ?? ''
          // A-M4:contents state 滞后编辑器 ≤200ms(防抖回调未落账)。
          // 活动文件直接读编辑器实时内容,避免把旧内容写盘后错标"已保存"
          if (f.id === activeFileIdRef.current && editorRef.current?.isReady()) {
            const live = editorRef.current.getMarkdown()
            if (live !== null) {
              content = toStoredImages(live, dirOfFile(f.id))
              if (contentsRef.current[f.id] !== content) {
                contentsRef.current = { ...contentsRef.current, [f.id]: content }
              }
            }
          }
          // 带冲突检测：外部修改过的文件不自动覆盖；GBK 文件写回原编码（含字符降级保护）
          const result = await saveWithEncodingFallback(f.path, content, mt[f.id], f.id)
          if (result.ok && result.data) {
            if (!openFilesRef.current.some((file) => file.id === f.id)) continue
            INITIAL_OR_SAVED.current[f.id] = content
            const isCurrentContent = contentsRef.current[f.id] === content
            setSavedMap((prev) => ({ ...prev, [f.id]: isCurrentContent }))
            setFileMtime((prev) => ({ ...prev, [f.id]: result.data!.modifiedTime }))
            if (isCurrentContent) void clearDraft(f.id)
            continue
          }
          if (result.error?.code === 'CONFLICT') {
            setToast(`自动保存已跳过：${f.name} 已被外部修改`)
          }
        }
      } catch {
        setToast('自动保存失败，请手动保存')
      } finally {
        autoSaveInFlightRef.current = false
      }
    }
    const timer = setInterval(() => {
      void runAutoSave()
    }, 30000)
    return () => clearInterval(timer)
  }, [clearDraft, saveWithEncodingFallback])

  /* ==================== 会话与草稿持久化 ==================== */

  useDocumentSessionPersistence({
    activeFileId,
    demoFileIds: DEMO_FILE_IDS,
    freshMode: FRESH_MODE,
    openFiles,
    ready: settingsReady,
    workspace,
  })

  /** 轻提示自动消失 */
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  // 搜索状态持久化（U4：查询词/选项/替换文本，防抖 1 秒）
  usePersistedSetting('searchState', searchPref, settingsReady, 1_000)

  // 空白区点击行为开关持久化（U8）
  usePersistedSetting('blankClickToEnd', blankClickToEnd, settingsReady)

  // 代码块行号开关持久化
  usePersistedSetting('codeLineNumbers', codeLineNumbers, settingsReady)

  // 侧边栏折叠键持久化。null = 没有任何持久化记录（从未折叠/展开过），
  // 此时新打开的工作区默认全部折叠；有记录时按记录恢复
  const [sidebarCollapsedKeys, setSidebarCollapsedKeys] = useState<string[] | null>(null)
  usePersistedSetting('sidebarCollapsedKeys', sidebarCollapsedKeys, settingsReady, 500)
  // 侧边栏活动标签页持久化
  const [sidebarActiveTab, setSidebarActiveTab] = useState<'files' | 'outline'>('files')
  usePersistedSetting('sidebarActiveTab', sidebarActiveTab, settingsReady)

  // frontmatter 属性面板开关持久化
  const [showFrontmatterProps, setShowFrontmatterProps] = useState(true)
  usePersistedSetting('showFrontmatterProps', showFrontmatterProps, settingsReady)

  // 自定义主题：注入/移除 <style> 标签
  useEffect(() => {
    const STYLE_ID = 'custom-theme-css'
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (customCss?.content) {
      if (!el) {
        el = document.createElement('style')
        el.id = STYLE_ID
        document.head.appendChild(el)
      }
      el.textContent = customCss.content
    } else if (el) {
      el.remove()
    }
  }, [customCss])

  // 自定义主题持久化
  usePersistedSetting('customCss', customCss, settingsReady)

  // Wiki 链接自动补全候选文件列表
  const wikiLinkFileList = useMemo(() => {
    if (!workspace?.tree) return []
    const files = collectMdFiles(workspace.tree)
    return files.map((path) => ({
      name: path.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? '',
      path,
    }))
  }, [workspace?.tree])

  // Wiki 链接点击处理 — 通过 ref 避免 handleSelectWorkspaceFile 循环依赖
  const wikiClickOpenRef = useRef(
    (path: string) => { void handleSelectWorkspaceFile(path) },
  )
  const handleWikiLinkClick = useCallback(
    (target: string) => {
      if (!workspace?.tree) return
      const result = resolveWikiTarget(
        target,
        workspace.path,
        activeFile?.path,
        workspace.tree,
      )
      if (result.resolved) {
        wikiClickOpenRef.current(result.path)
      } else {
        setToast(`无法找到链接的目标文件：${target}`)
      }
    },
    [workspace, activeFile],
  )

  const handleImageHostProviderChange = useCallback(
    async (provider: 'local' | 'smms') => {
      const result = await window.desktopAPI?.imageHost.setConfig(provider)
      if (!result?.ok || !result.data) {
        setToast('图床配置保存失败')
        return
      }
      setImageHost(result.data)
    },
    [],
  )

  const handleImageHostTokenSave = useCallback(async (token: string): Promise<boolean> => {
    const result = await window.desktopAPI?.imageHost.setConfig('smms', token)
    if (!result?.ok || !result.data) {
      setToast('Token 保存失败')
      return false
    }
    setImageHost(result.data)
    setToast('Token 已保存')
    return true
  }, [])

  /** 光标位置变化（无变化时返回原对象避免多余渲染） */
  const handleCursorChange = useCallback(
    (
      line: number,
      col: number,
      heading: string,
      headingIndex: number,
      selected: number,
    ) => {
      setCursorPos((prev) =>
        prev.line === line &&
        prev.col === col &&
        prev.heading === heading &&
        prev.headingIndex === headingIndex &&
        prev.selected === selected
          ? prev
          : { line, col, heading, headingIndex, selected },
      )
    },
    [],
  )

  /* ==================== 编辑内容同步 ==================== */

  // 记录每个文件"最后一次保存时"的内容，用于脏检查
  const INITIAL_OR_SAVED = useRef<Record<string, string>>({ ...INITIAL_CONTENTS })
  /** 将预览标签升级为固定标签，并同步 React 状态与供同步回调读取的镜像。 */
  const pinPreviewTab = useCallback((fileId: string) => {
    const previewFile = openFilesRef.current.find((file) => file.id === fileId)
    if (!previewFile?.preview) return
    openFilesRef.current = pinPreviewOpenFile(openFilesRef.current, fileId)
    setOpenFiles((prev) => pinPreviewOpenFile(prev, fileId))
  }, [])

  const handleEditorChange = useCallback((md: string) => {
    // 读 ref 而非闭包 state：切换文件时 replaceAll 同步触发本回调，
    // 此时 React state 还是旧文件 ID
    const fileId = activeFileIdRef.current
    // 全部标签页关闭后编辑器处于隐藏态，丢弃此期间的任何回调，避免写入已移除的文件
    if (!openFilesRef.current.some((f) => f.id === fileId)) return
    // Milkdown listener 的防抖回调可能晚于文档切换到达。旧回调不能按当前文件 ID 写入，
    // 否则会把上一个文件的内容混入当前文件，随后撤销还可能继续放大这个错误。
    if (!isCurrentEditorChange(md, editorRef.current?.getMarkdown() ?? null)) return
    // 存储前把 mdimg 绝对路径回写为相对路径（保证 .md 可移植）
    const stored = toStoredImages(md, dirOfFile(fileId))
    if (contentsRef.current[fileId] !== stored) {
      contentsRef.current = { ...contentsRef.current, [fileId]: stored }
    }
    setContents((prev) =>
      prev[fileId] === stored ? prev : { ...prev, [fileId]: stored },
    )
    setSavedMap((prev) => {
      const isSaved = !isDocumentDirty(stored, INITIAL_OR_SAVED.current[fileId] ?? '')
      if (prev[fileId] === isSaved) return prev
      return { ...prev, [fileId]: isSaved }
    })
    if (isDocumentDirty(stored, INITIAL_OR_SAVED.current[fileId] ?? '')) {
      // 预览标签一旦被编辑就自动固定，下一次侧栏单击不会替换它。
      pinPreviewTab(fileId)
    }
  }, [dirOfFile, pinPreviewTab])

  /** 用于打开/切换文件的统一替换入口，避免程序性更新被当作用户输入。 */
  const replaceEditorContent = useCallback(
    (
      fileId: string,
      content: string,
      mode: 'ignore' | 'initialize' | 'update' = 'ignore',
    ) => {
      if (!editorRef.current?.isReady()) return
      if (mode === 'update') {
        const stored = toStoredImages(content, dirOfFile(fileId))
        contentsRef.current = { ...contentsRef.current, [fileId]: stored }
        setContents((prev) => ({ ...prev, [fileId]: stored }))
        const isSaved = !isDocumentDirty(
          stored,
          INITIAL_OR_SAVED.current[fileId] ?? '',
        )
        setSavedMap((prev) => ({ ...prev, [fileId]: isSaved }))
        if (!isSaved) pinPreviewTab(fileId)
      }
      // update 模式（属性面板等程序性更新）：保留撤销历史并恢复光标；
      // 其余模式（切换/打开文件）flush 重建，避免旧文档内容混入撤销栈
      if (mode === 'update') {
        editorRef.current.updateContentPreservingHistory(toEditorImages(content, dirOfFile(fileId)))
      } else {
        editorRef.current.replaceContent(toEditorImages(content, dirOfFile(fileId)))
      }
    },
    [dirOfFile, pinPreviewTab],
  )

  /** 把编辑器实时内容同步落账（不等 200ms 防抖回调）。
   *  listener 的 markdownUpdated 带 200ms 防抖：此窗口内切换/新建/打开文件，
   *  旧文档的最近输入尚未写入 contents 就被替换掉，切回时静默丢失。
   *  所有切换内容前必须先调用本函数，把活动文档的最新内容读入 state。 */
  const flushEditorContent = useCallback(() => {
    if (!editorRef.current?.isReady()) return
    const fileId = activeFileIdRef.current
    if (!fileId || !openFilesRef.current.some((f) => f.id === fileId)) return
    const md = editorRef.current.getMarkdown()
    if (md === null) return
    const stored = toStoredImages(md, dirOfFile(fileId))
    if (contentsRef.current[fileId] !== stored) {
      contentsRef.current = { ...contentsRef.current, [fileId]: stored }
    }
    setContents((prev) => (prev[fileId] === stored ? prev : { ...prev, [fileId]: stored }))
    const isSaved = !isDocumentDirty(stored, INITIAL_OR_SAVED.current[fileId] ?? '')
    setSavedMap((prev) => (prev[fileId] === isSaved ? prev : { ...prev, [fileId]: isSaved }))
  }, [dirOfFile])

  /** 侧栏打开下一个预览前丢弃前一个未修改的预览标签。 */
  const discardPreviewTab = useCallback((nextFileId: string) => {
    const previous = findDiscardablePreview(openFilesRef.current, nextFileId)
    if (!previous) return
    openFilesRef.current = openFilesRef.current.filter((file) => file.id !== previous.id)
    setOpenFiles((prev) => prev.filter((file) => file.id !== previous.id))
    setContents((prev) => {
      const next = { ...prev }
      delete next[previous.id]
      return next
    })
    setSavedMap((prev) => {
      const next = { ...prev }
      delete next[previous.id]
      return next
    })
    setFileMtime((prev) => {
      const next = { ...prev }
      delete next[previous.id]
      return next
    })
    setEncodingMap((prev) => {
      const next = { ...prev }
      delete next[previous.id]
      return next
    })
    delete INITIAL_OR_SAVED.current[previous.id]
  }, [])

  /* ==================== 文件操作 ==================== */

  /**
   * 延迟聚焦编辑器（U6）：新建/打开文件后等内容替换与渲染完成再聚焦，
   * 确保用户可直接开始输入，无需手动点击编辑区
   */
  const focusEditorSoon = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        // 用户已在关闭面板后转去其他输入控件时，不再抢回焦点。
        if (!shouldRestoreEditorFocus(document.activeElement, document.body)) return
        editorRef.current?.focus()
      }, 60)
    })
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    focusEditorSoon()
  }, [focusEditorSoon])

  const closeHelp = useCallback(() => {
    setHelpView(null)
    focusEditorSoon()
  }, [focusEditorSoon])

  const closeImages = useCallback(() => {
    setImagesOpen(false)
    focusEditorSoon()
  }, [focusEditorSoon])

  const closePdfOptions = useCallback(() => {
    setPdfOptsOpen(false)
    focusEditorSoon()
  }, [focusEditorSoon])

  const closeWorkspaceSearch = useCallback(() => {
    setWsSearchOpen(false)
    focusEditorSoon()
  }, [focusEditorSoon])

  const switchFile = useCallback(
    (id: string) => {
      if (id === activeFileId) return
      latestWorkspaceSelectionRef.current = ''
      // 防御：目标不在打开列表中不切换，避免激活文件悬空的幽灵状态
      if (!openFiles.some((f) => f.id === id)) return
      // 切换前把当前文档实时内容落账（防抖窗口内的最近输入不能丢）
      flushEditorContent()
      // 先让标题输入框失焦：确保标题编辑保存到旧文件，不会串到新文件
      titleRef.current?.blur()
      // 先同步 ref，再替换内容（replaceAll 会同步触发 onChange）
      activeFileIdRef.current = id
      setActiveFileId(id)
      const file = openFiles.find((f) => f.id === id)
      setDocTitle(file?.name ?? '未命名文档')
      // 切换编辑器内容（保持同一编辑器实例，避免重建丢光标历史）
      // 渲染前把相对路径图片解析为 mdimg 协议
      replaceEditorContent(id, contents[id] ?? '')
      focusEditorSoon()
    },
    [activeFileId, openFiles, contents, dirOfFile, focusEditorSoon, flushEditorContent],
  )

  const handleNew = useCallback(() => {
    flushEditorContent()
    titleRef.current?.blur()
    const id = `untitled-${untitledCounter++}`
    const name = `未命名 ${untitledCounter - 1}.md`
    const file = { id, name }
    openFilesRef.current = [...openFilesRef.current, file]
    setOpenFiles((prev) => [...prev, file])
    setContents((prev) => ({ ...prev, [id]: '' }))
    setSavedMap((prev) => ({ ...prev, [id]: true }))
    INITIAL_OR_SAVED.current[id] = ''
    activeFileIdRef.current = id
    setActiveFileId(id)
    setDocTitle(name)
    replaceEditorContent(id, '', 'initialize')
    focusEditorSoon()
  }, [focusEditorSoon, replaceEditorContent, flushEditorContent])

  /**
   * 点击左侧文件夹树中的样例文件：已打开则切换，未打开则打开为新标签页。
   * 启动时只预开「欢迎」一篇，其余样例文件通过此函数按需打开，
   * 标签页统一只在编辑器区域呈现。
   */
  const handleSelectDemoFile = useCallback(
    (id: string, pinned = true) => {
      if (!DEMO_FILES[id]) return
      const existed = openFiles.find((file) => file.id === id)
      if (existed) {
        if (pinned && existed.preview) {
          pinPreviewTab(id)
        }
        switchFile(id)
        return
      }
      const name = DEMO_FILES[id].name
      const content = DEMO_FILES[id].content
      if (!pinned) discardPreviewTab(id)
      flushEditorContent()
      const file = { id, name, preview: !pinned }
      openFilesRef.current = [...openFilesRef.current, file]
      activeFileIdRef.current = id
      setOpenFiles((prev) => [...prev, file])
      setContents((prev) => ({ ...prev, [id]: content }))
      setSavedMap((prev) => ({ ...prev, [id]: true }))
      INITIAL_OR_SAVED.current[id] = content
      setActiveFileId(id)
      setDocTitle(name)
      replaceEditorContent(id, content, 'initialize')
      focusEditorSoon()
    },
    [openFiles, switchFile, discardPreviewTab, replaceEditorContent, focusEditorSoon, pinPreviewTab, flushEditorContent],
  )

  const handleOpen = useCallback(async () => {
    if (!window.desktopAPI) return
    latestWorkspaceSelectionRef.current = ''
    const result = await window.desktopAPI.document.open()
    if (!result.ok || !result.data) {
      if (result.error?.code === 'TOO_LARGE') {
        setToast(result.error.message ?? 'Markdown 文件超过 20MB，无法打开')
      } else if (result.error?.code !== 'CANCELLED') {
        setToast('文件打开失败')
      }
      return
    }
    // 打开新文件前先落账当前文档（防抖窗口内的最近输入不能丢）
    flushEditorContent()
    titleRef.current?.blur()
    const { path, name, content } = result.data
    if (result.data.encoding) {
      setEncodingMap((prev) => ({ ...prev, [`file-${path}`]: result.data!.encoding! }))
    }
    // 已打开则直接切换
    const existed = openFiles.find((f) => f.path === path)
    if (existed) {
      if (existed.preview) {
        pinPreviewTab(existed.id)
      }
      switchFile(existed.id)
      return
    }
    const id = `file-${path}`
    const file = { id, name, path }
    openFilesRef.current = [...openFilesRef.current, file]
    setOpenFiles((prev) => [...prev, file])
    setContents((prev) => ({ ...prev, [id]: content }))
    setSavedMap((prev) => ({ ...prev, [id]: true }))
    INITIAL_OR_SAVED.current[id] = content
    setFileMtime((prev) => ({ ...prev, [id]: result.data!.modifiedTime }))
    activeFileIdRef.current = id
    setActiveFileId(id)
    setDocTitle(name)
    recordRecent(path, name)
    replaceEditorContent(id, content, 'initialize')
    focusEditorSoon()
  }, [openFiles, switchFile, recordRecent, replaceEditorContent, focusEditorSoon, pinPreviewTab, flushEditorContent])

  /* ==================== 打开文件夹 / 工作区 ==================== */

  /** 打开文件夹（path 传入时跳过对话框，用于会话恢复） */
  const handleOpenFolder = useCallback(
    async (path?: string, silent = false) => {
      if (!window.desktopAPI) return
      const result = await window.desktopAPI.document.openFolder(path)
      if (!result.ok || !result.data) {
        if (path) setToast('工作区文件夹无法访问，已跳过恢复')
        return
      }
      const { path: folderPath, name, tree } = result.data
      setWorkspace({ path: folderPath, name, tree })
      // 空文件夹：自动创建一篇空白文档供书写（会话静默恢复时不创建）
      if (tree.length === 0 && !silent) {
        handleNew()
      }
    },
    [handleNew],
  )

  /** 点击工作区/外部磁盘文件：首次打开时读盘，之后直接切换；返回是否成功（工作区搜索带入等场景需感知失败） */
  const handleSelectWorkspaceFile = useCallback(
    async (path: string, pinned = true): Promise<boolean> => {
      latestWorkspaceSelectionRef.current = path
      const id = `file-${path}`
      const existed = openFilesRef.current.find((file) => file.id === id)
      if (existed) {
        if (pinned && existed.preview) {
          pinPreviewTab(id)
        }
        switchFile(id)
        return true
      }
      if (!window.desktopAPI) return false
      const opening = openingWorkspaceFilesRef.current.get(path)
      if (opening) {
        const opened = await opening
        if (opened && pinned) pinPreviewTab(id)
        return opened
      }
      const openRequest = (async (): Promise<boolean> => {
        const result = await window.desktopAPI!.document.read(path)
        if (!result.ok || !result.data) {
          if (result.error?.code === 'TOO_LARGE') {
            setToast(result.error.message ?? 'Markdown 文件超过 20MB，无法打开')
          } else {
            setToast('文件读取失败')
          }
          return false
        }
        if (latestWorkspaceSelectionRef.current !== path) return false
        // 异步读取期间，其他入口可能已先打开同一文件；此时复用已有标签。
        const openedMeanwhile = openFilesRef.current.find((file) => file.id === id)
        if (openedMeanwhile) {
          if (pinned && openedMeanwhile.preview) pinPreviewTab(id)
          return true
        }
        // 打开新文件前先落账当前文档（防抖窗口内的最近输入不能丢）
        flushEditorContent()
        titleRef.current?.blur()
        const { name, content } = result.data
        if (result.data.encoding) {
          setEncodingMap((prev) => ({ ...prev, [id]: result.data!.encoding! }))
        }
        if (!pinned) discardPreviewTab(id)
        const file = { id, name, path, preview: !pinned }
        openFilesRef.current = [...openFilesRef.current, file]
        activeFileIdRef.current = id
        setOpenFiles((prev) => [...prev, file])
        setContents((prev) => ({ ...prev, [id]: content }))
        setSavedMap((prev) => ({ ...prev, [id]: true }))
        INITIAL_OR_SAVED.current[id] = content
        setFileMtime((prev) => ({ ...prev, [id]: result.data!.modifiedTime }))
        setActiveFileId(id)
        setDocTitle(name)
        recordRecent(path, name)
        replaceEditorContent(id, content, 'initialize')
        focusEditorSoon()
        return true
      })()
      openingWorkspaceFilesRef.current.set(path, openRequest)
      try {
        return await openRequest
      } finally {
        if (openingWorkspaceFilesRef.current.get(path) === openRequest) {
          openingWorkspaceFilesRef.current.delete(path)
        }
      }
    },
    [switchFile, recordRecent, focusEditorSoon, discardPreviewTab, replaceEditorContent, pinPreviewTab, flushEditorContent],
  )

  /* ==================== 拖入 .md 文件直接打开 ==================== */

  useEffect(() => {
    // 拖入含 .md/.markdown 文件时显示提示层
    const hasMdFile = (e: DragEvent): boolean => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      return files.some((f) => /\.(md|markdown)$/i.test(f.name))
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (hasMdFile(e)) setDragFileOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      // 只有离开窗口时才隐藏（避免子元素拖拽闪炼）
      if (!e.relatedTarget) setDragFileOver(false)
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      setDragFileOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const mds = files.filter((f) => /\.(md|markdown)$/i.test(f.name))
      // 串行打开：并行时读盘完成顺序随机，激活标签与打开顺序不一致
      for (const f of mds) {
        // Electron 为拖入的 File 附加了 path 属性
        const p = (f as File & { path?: string }).path
        if (p) await handleSelectWorkspaceFile(p)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleSelectWorkspaceFile])

  // 更新 wiki link click handler 引用的 ref
  wikiClickOpenRef.current = (path: string) => { void handleSelectWorkspaceFile(path) }

  const handleSaveAs = useCallback(async () => {
    if (!window.desktopAPI) return
    const oldId = activeFileId
    // M1：与 handleSave 一致，从编辑器同步读取最新内容
    const editorMd = editorRef.current?.isReady() ? editorRef.current.getMarkdown() : null
    const content =
      editorMd != null
        ? toStoredImages(editorMd, dirOfFile(oldId))
        : (contents[oldId] ?? '')
    const result = await window.desktopAPI.document.saveAs(content)
    if (!result.ok || !result.data) {
      if (result.error?.code !== 'CANCELLED') {
        setToast('另存为失败，请检查目标文件权限或磁盘空间')
      }
      return
    }
    const { path, name } = result.data
    const newId = `file-${path}`
    const targetFile =
      newId !== oldId
        ? openFilesRef.current.find((file) => file.id === newId)
        : undefined
    const targetAlreadyOpen = Boolean(targetFile)
    const retainUnsavedTarget = Boolean(targetFile && savedMap[newId] === false)
    const retainedTargetId = retainUnsavedTarget ? `untitled-${untitledCounter++}` : ''
    const retainedTargetName = retainUnsavedTarget
      ? `${targetFile!.name.replace(/\.(md|markdown)$/i, '')} 未保存副本.md`
      : ''
    const retainedTargetContent = retainUnsavedTarget ? contents[newId] ?? '' : ''
    const retainedTargetBaseline = retainUnsavedTarget
      ? INITIAL_OR_SAVED.current[newId] ?? ''
      : ''
    const modifiedTime = result.data.modifiedTime || Date.now()

    // 文件身份以磁盘路径为准。另存为后若仍沿用 untitled-/旧路径 ID，
    // 从工作区再次打开同一文件会生成重复标签，重命名和移动也无法命中它。
    if (retainUnsavedTarget) {
      // 保存对话框只感知磁盘文件，无法得知另一个已打开标签中的未保存内容。
      // 目标路径被覆盖后，把该标签转为无路径副本，避免内容被静默丢弃。
      INITIAL_OR_SAVED.current[retainedTargetId] = retainedTargetBaseline
    }
    INITIAL_OR_SAVED.current[newId] = content
    if (newId !== oldId) delete INITIAL_OR_SAVED.current[oldId]
    const nextOpenFiles = (() => {
      const current = openFilesRef.current
      if (newId === oldId) {
        return current.map((file) => (file.id === oldId ? { ...file, path, name } : file))
      }
      if (targetAlreadyOpen && retainUnsavedTarget) {
        return current.flatMap((file) => {
          if (file.id === oldId) return []
          if (file.id !== newId) return [file]
          return [
            { id: newId, name, path },
            { ...file, id: retainedTargetId, name: retainedTargetName, path: undefined, preview: false },
          ]
        })
      }
      if (targetAlreadyOpen) return current.filter((file) => file.id !== oldId)
      return current.map((file) =>
        file.id === oldId ? { id: newId, name, path } : file,
      )
    })()
    // 另存为会改变文件 ID，必须立即同步镜像，避免编辑器回调写入旧 ID。
    openFilesRef.current = nextOpenFiles
    setOpenFiles(nextOpenFiles)
    setContents((prev) => {
      const next = { ...prev, [newId]: content }
      if (newId !== oldId) delete next[oldId]
      if (retainUnsavedTarget) next[retainedTargetId] = retainedTargetContent
      return next
    })
    setSavedMap((prev) => {
      const next = { ...prev, [newId]: true }
      if (newId !== oldId) delete next[oldId]
      if (retainUnsavedTarget) next[retainedTargetId] = false
      return next
    })
    // 优先用主进程返回的真实落盘 mtime，缺失时降级用当前时间（下次保存用于冲突检测）
    setFileMtime((prev) => {
      const next = { ...prev, [newId]: modifiedTime }
      if (newId !== oldId) delete next[oldId]
      return next
    })
    // 另存为统一写 UTF-8，重置编码记录，避免后续保存误用旧编码
    setEncodingMap((prev) => {
      const next = { ...prev, [newId]: 'UTF-8' }
      if (newId !== oldId) delete next[oldId]
      return next
    })
    if (draftPendingRef.current?.id === oldId) draftPendingRef.current = null
    activeFileIdRef.current = newId
    setActiveFileId(newId)
    setDocTitle(name)
    // M7：另存为改变文档目录后，编辑器内 mdimg 仍按旧目录解析；
    // 按新目录重新迁移并重渲染，否则下一键保存就把旧目录绝对路径写进新文件
    if (newId !== oldId) {
      replaceEditorContent(newId, content, 'update')
    }
    void clearDraft(oldId)
    if (newId !== oldId) void clearDraft(newId)
    if (retainUnsavedTarget) {
      void saveDraft(retainedTargetId, retainedTargetContent).catch(() => {})
      setToast('已覆盖目标文件，原未保存内容已保留为副本')
      return
    }
    if (targetAlreadyOpen) setToast('已覆盖并切换到已打开的同名文件')
  }, [activeFileId, contents, savedMap, clearDraft, saveDraft, replaceEditorContent])

  const handleSave = useCallback(async () => {
    const file = openFiles.find((f) => f.id === activeFileId)
    // M1：Milkdown onChange 经过防抖，contents state 可能滞后最后几键。
    // 保存时直接从编辑器同步读取最新内容（回写 mdimg 相对路径），避免丢失末次输入
    const editorMd = editorRef.current?.isReady() ? editorRef.current.getMarkdown() : null
    const content =
      editorMd != null
        ? toStoredImages(editorMd, dirOfFile(activeFileId))
        : (contents[activeFileId] ?? '')
    if (!file) return
    // 同步回填 state，保证后续 savedMap/INITIAL_OR_SAVED 比对基于最新内容
    if (contentsRef.current[activeFileId] !== content) {
      contentsRef.current = { ...contentsRef.current, [activeFileId]: content }
      setContents((prev) => (prev[activeFileId] === content ? prev : { ...prev, [activeFileId]: content }))
    }

    // 有磁盘路径：直接保存（带外部冲突检测）
    if (file.path && window.desktopAPI) {
      const doSave = (withCheck: boolean) =>
        saveWithEncodingFallback(
          file.path!,
          content,
          withCheck ? fileMtime[activeFileId] : undefined,
          activeFileId,
          true,
        )
      let result = await doSave(true)
      if (!result.ok && result.error?.code === 'CONFLICT') {
        const overwrite = window.confirm(
          '该文件已被其他程序修改，仍然要覆盖保存吗？\n\n选择"取消"可保留当前编辑内容，稍后另存为。',
        )
        if (!overwrite) return
        result = await doSave(false)
      }
      if (result.ok && result.data) {
        if (!openFilesRef.current.some((openFile) => openFile.id === activeFileId)) return
        INITIAL_OR_SAVED.current[activeFileId] = content
        const isCurrentContent = contentsRef.current[activeFileId] === content
        setSavedMap((prev) => ({ ...prev, [activeFileId]: isCurrentContent }))
        setFileMtime((prev) => ({ ...prev, [activeFileId]: result.data!.modifiedTime }))
        if (isCurrentContent) void clearDraft(activeFileId)
      } else if (result.error?.code !== 'ENCODING_LOSS') {
        setToast(
          result.error?.code === 'NOT_FOUND'
            ? '原文件已不存在，请使用另存为保存当前内容'
            : '保存失败，请检查文件权限或磁盘空间',
        )
      }
      return
    }
    // 无路径：另存为
    await handleSaveAs()
  }, [openFiles, activeFileId, contents, fileMtime, saveWithEncodingFallback, handleSaveAs, clearDraft])

  /**
   * 保存全部未保存文件（窗口关闭"保存并关闭"用），返回保存失败的文件名清单。
   * 失败的文件（外部冲突等）与无磁盘路径的未命名文档：内容写入草稿兜底，
   * destroy 后重启可恢复为未保存状态，编辑永不丢失。
   */
  const saveAll = useCallback(async (): Promise<string[]> => {
    if (!window.desktopAPI) return []
    const failed: string[] = []
    const dirty = openFiles.filter((f) => savedMap[f.id] === false)
    for (const f of dirty) {
      // M1：活动文件的编辑器内容可能尚未走到 state，关闭窗口前同步读取
      let content = contents[f.id] ?? ''
      if (f.id === activeFileIdRef.current && editorRef.current?.isReady()) {
        const editorMd = editorRef.current.getMarkdown()
        if (editorMd != null) content = toStoredImages(editorMd, dirOfFile(f.id))
      }
      if (contentsRef.current[f.id] !== content) {
        contentsRef.current = { ...contentsRef.current, [f.id]: content }
      }
      let ok = false
      if (f.path) {
        const res = await saveWithEncodingFallback(f.path, content, fileMtime[f.id], f.id)
        if (res.ok && res.data) {
          INITIAL_OR_SAVED.current[f.id] = content
          setSavedMap((prev) => ({ ...prev, [f.id]: true }))
          setFileMtime((prev) => ({ ...prev, [f.id]: res.data!.modifiedTime }))
          void clearDraft(f.id)
          ok = true
        }
      }
      if (!ok) {
        failed.push(f.name)
        // 兜底：写入草稿（串行 await，确保 destroy 前全部落盘）
        try {
          await saveDraft(f.id, content)
        } catch {
          /* 草稿写入失败仅影响兜底能力，不阻断关闭流程 */
        }
      }
    }
    return failed
  }, [openFiles, savedMap, contents, fileMtime, saveWithEncodingFallback, clearDraft, saveDraft])

  // 未保存状态同步到主进程（关闭时弹原生确认框，避免静默阻止关闭）
  const hasUnsaved = useMemo(() => Object.values(savedMap).some((s) => !s), [savedMap])
  useEffect(() => {
    window.desktopAPI?.window.setUnsaved(hasUnsaved)
  }, [hasUnsaved])

  // 暴露 saveAll 供主进程关闭流程调用（返回保存失败的文件名清单）
  useEffect(() => {
    const w = window as unknown as { __markdownsoft_saveAll?: () => Promise<string[]> }
    w.__markdownsoft_saveAll = saveAll
    return () => {
      delete w.__markdownsoft_saveAll
    }
  }, [saveAll])

  /** 构建导出用完整 HTML（HTML/PDF 共用；withToc 时插入目录页） */
  const buildDocHtml = useCallback(
    (withToc = false) => {
      // 用编辑器真实 DOM 快照：保留 Mermaid SVG / KaTeX 渲染结果
      let body = editorRef.current?.getPreviewHtml() ?? ''
      if (withToc) body = injectToc(body)
      const title = docTitle.replace(/\.md$/, '')
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlText(title)}</title>
<style>
${katexCss}
</style>
<style>
body{font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.8;color:#1d1b18}
h1{font-size:1.9em}h2{font-size:1.4em;border-bottom:1px solid #eee;padding-bottom:.3em}h3{font-size:1.15em}
pre{background:#f5f2ee;padding:16px;border-radius:8px;overflow-x:auto}
code{font-family:Consolas,monospace;font-size:.9em}
blockquote{border-left:3px solid #7c6f5b;margin:1em 0;padding:.4em 1.2em;color:#5c5850;background:#faf8f5}
table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px 12px}th{background:#f5f2ee}
img{max-width:100%}
.footnote-def{color:#5c5850;font-size:.92em}
.doc-toc{page-break-after:always}
.doc-toc-title{font-size:1.3em;font-weight:700;margin-bottom:.6em}
.doc-toc-list{list-style:none;padding-left:0;line-height:2}
.doc-toc-list a{color:inherit;text-decoration:none}
.toc-l2{padding-left:1.2em}.toc-l3{padding-left:2.4em;font-size:.94em}
</style>
</head>
<body>${body}</body>
</html>`
    },
    [docTitle],
  )

  /** 导出预处理：把 mdimg 本地图片内联为 base64，导出的 HTML/PDF 自包含可移植 */
  const inlineImagesInHtml = useCallback(async (html: string): Promise<string> => {
    const imgRe = /<img\s+[^>]*src="([^"]+)"[^>]*>/g
    const srcs: string[] = []
    let m: RegExpExecArray | null
    while ((m = imgRe.exec(html)) !== null) {
      if (m[1].startsWith('mdimg://')) srcs.push(m[1])
    }
    let result = html
    for (const src of srcs) {
      try {
        const resp = await fetch(src)
        if (!resp.ok) continue
        const blob = await resp.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result as string)
          // 读取失败需 reject：否则 Promise 永不 settle，导出流程永久挂起
          fr.onerror = () => reject(new Error('read failed'))
          fr.readAsDataURL(blob)
        })
        result = result.split(src).join(dataUrl)
      } catch {
        /* 失败保留原路径 */
      }
    }
    return result
  }, [])

  const handleExportHtml = useCallback(async () => {
    if (!window.desktopAPI) return
    try {
      const title = docTitle.replace(/\.md$/, '')
      // B1：导出前强制等待 KaTeX/Mermaid 懒加载插件就绪，确保快照含渲染结果
      setToast('导出中：等待公式/图表渲染…')
      await editorRef.current?.ensureRichContent()
      const html = await inlineImagesInHtml(buildDocHtml())
      const res = await window.desktopAPI.document.saveAs(html, {
        filters: [{ name: 'HTML', extensions: ['html'] }],
        defaultPath: `${title}.html`,
      })
      if (res.ok) setToast('HTML 已导出')
      else if (res.error?.code !== 'CANCELLED') setToast('HTML 导出失败，请检查文件权限或磁盘空间')
    } catch {
      setToast('HTML 导出失败，请稍后重试')
    }
  }, [docTitle, buildDocHtml, inlineImagesInHtml])

  /** 导出 PDF：先弹选项窗（纸张/页边距/页眉页脚） */
  const handleExportPdf = useCallback(() => {
    setPdfOptsOpen(true)
  }, [])

  /** 确认选项后执行 PDF 导出 */
  const handleDoExportPdf = useCallback(
    async (options: PdfOptions) => {
      setPdfOptsOpen(false)
      if (!window.desktopAPI) return
      try {
        const title = docTitle.replace(/\.md$/, '')
        // B1：先等富内容渲染完成
        setToast('导出中：等待公式/图表渲染…')
        await editorRef.current?.ensureRichContent()
        const html = await inlineImagesInHtml(buildDocHtml(options.toc === true))
        const res = await window.desktopAPI.document.exportPdf(
          html,
          `${title}.pdf`,
          options,
        )
        if (res.ok) setToast('PDF 导出成功')
        else if (res.error?.code !== 'CANCELLED') setToast('PDF 导出失败，请检查文件权限或磁盘空间')
      } catch {
        setToast('PDF 导出失败，请稍后重试')
      }
    },
    [docTitle, buildDocHtml, inlineImagesInHtml],
  )

  /** 导出 Markdown：把当前文档另存为新的 .md 文件 */
  const handleExportMarkdown = useCallback(async () => {
    if (!window.desktopAPI) return
    try {
      const title = docTitle.replace(/\.md$/, '')
      // A-L1：与 handleSave 一致，读编辑器实时内容（防抖窗口内 state 滞后）
      const editorMd = editorRef.current?.isReady() ? editorRef.current.getMarkdown() : null
      const content =
        editorMd != null
          ? toStoredImages(editorMd, dirOfFile(activeFileId))
          : (contents[activeFileId] ?? '')
      // 默认名加"-导出"后缀，避免与同名源文件混淆直接覆盖
      const res = await window.desktopAPI.document.saveAs(content, {
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        defaultPath: `${title}-导出.md`,
      })
      if (res.ok) setToast('Markdown 已导出')
      else if (res.error?.code !== 'CANCELLED') setToast('Markdown 导出失败，请检查文件权限或磁盘空间')
    } catch {
      setToast('Markdown 导出失败，请稍后重试')
    }
  }, [docTitle, contents, activeFileId, dirOfFile])

  /** pandoc 多格式导出（Word/EPUB/LaTeX/纯文本）；未安装 pandoc 时提示安装 */
  const handleExportPandoc = useCallback(async () => {
    if (!window.desktopAPI) return
    try {
      const title = docTitle.replace(/\.md$/, '')
      // A-L1：与 handleSave 一致，读编辑器实时内容（防抖窗口内 state 滞后）
      const editorMd = editorRef.current?.isReady() ? editorRef.current.getMarkdown() : null
      const content =
        editorMd != null
          ? toStoredImages(editorMd, dirOfFile(activeFileId))
          : (contents[activeFileId] ?? '')
      const res = await window.desktopAPI.document.exportPandoc(content, title)
      if (res.ok) setToast('导出成功')
      else if (res.error?.code === 'PANDOC_NOT_FOUND') {
        setToast('未检测到 pandoc：请先安装（pandoc.org）后重启应用')
      } else if (res.error?.code !== 'CANCELLED') {
        setToast(`导出失败：${res.error?.message ?? ''}`)
      }
    } catch {
      setToast('导出失败，请稍后重试')
    }
  }, [docTitle, contents, activeFileId, dirOfFile])

  /* ==================== 自定义主题 ==================== */

  /** 导入自定义主题 CSS（选择文件 → 注入生效 → 持久化） */
  const handleImportCss = useCallback(async () => {
    if (!window.desktopAPI) return
    const res = await window.desktopAPI.document.pickCss()
    if (res.ok && res.data) {
      setCustomCss({ name: res.data.name, content: res.data.content })
      setToast(`已应用自定义主题：${res.data.name}`)
    } else if (res.error?.code === 'TOO_LARGE') {
      setToast(res.error.message ?? 'CSS 文件过大')
    } else if (res.error?.code === 'IO_ERROR') {
      setToast('CSS 读取失败')
    }
  }, [])

  /** 移除自定义主题 */
  const handleRemoveCss = useCallback(() => {
    setCustomCss(null)
    setToast('已移除自定义主题')
  }, [])

  /* ==================== 工作区文件操作 ==================== */

  /** 重新扫描工作区目录（增删改后刷新文件树） */
  const refreshWorkspace = useCallback(async () => {
    if (!workspace) return
    await handleOpenFolder(workspace.path, true)
  }, [workspace, handleOpenFolder])

  const handleCreateFile = useCallback(
    async (dirPath: string) => {
      if (!window.desktopAPI) return
      const res = await window.desktopAPI.workspace.createFile(dirPath, '新文档.md')
      if (!res.ok) {
        setToast(res.error?.code === 'EXISTS' ? '同名文件已存在' : '新建失败')
        return
      }
      await refreshWorkspace()
      if (res.data) await handleSelectWorkspaceFile(res.data.path)
    },
    [refreshWorkspace, handleSelectWorkspaceFile],
  )

  const handleRenameFile = useCallback(
    async (path: string, newName: string) => {
      if (!newName.trim()) {
        setToast('文件名不能为空')
        return
      }
      if (!window.desktopAPI) return
      // 先写回未保存内容，避免重命名丢失编辑（带冲突检测：外部修改过的不静默覆盖，中止重命名）
      const oldId = `file-${path}`
      let pending: string | undefined
      if (savedMap[oldId] === false && contents[oldId] !== undefined) {
        pending = contents[oldId]
        const saveRes = await saveWithEncodingFallback(path, pending, fileMtime[oldId], oldId)
        if (!saveRes.ok) {
          setToast(
            saveRes.error?.code === 'CONFLICT'
              ? `「${path.split(/[\\/]/).pop()}」已被外部修改，已中止重命名`
              : '重命名前保存失败，已中止',
          )
          return
        }
        if (saveRes.data) {
          INITIAL_OR_SAVED.current[oldId] = pending
          setFileMtime((prev) => ({ ...prev, [oldId]: saveRes.data!.modifiedTime }))
        }
      }
      const res = await window.desktopAPI.workspace.renameFile(path, newName)
      if (!res.ok || !res.data) {
        if (res.error?.code === 'EXISTS') {
          setToast('同名文件已存在')
          return
        }
        if (res.error?.code === 'INVALID_NAME') {
          setToast('文件名不能包含 \\ / : * ? " < > |')
          return
        }
        setToast('重命名失败')
        return
      }
      // 就地迁移打开记录/内容/基线/mtime 到新 id，避免旧路径幽灵标签残留
      const newPath = res.data.path
      const finalName = res.data.name
      const newId = `file-${newPath}`
      const renamedFiles = openFilesRef.current.map((file) =>
        file.id === oldId
          ? { ...file, id: newId, name: finalName, path: newPath }
          : file,
      )
      openFilesRef.current = renamedFiles
      setOpenFiles(renamedFiles)
      setContents((prev) => {
        if (prev[oldId] === undefined) return prev
        const next = { ...prev }
        next[newId] = next[oldId]
        delete next[oldId]
        return next
      })
      // 基线：若刚写回了 pending，则基线即 pending（磁盘已是该内容），否则沿用旧基线
      INITIAL_OR_SAVED.current[newId] =
        pending !== undefined ? pending : (INITIAL_OR_SAVED.current[oldId] ?? '')
      delete INITIAL_OR_SAVED.current[oldId]
      // mtime 用重命名后的新值，避免旧值导致下次保存误报"外部修改"
      setFileMtime((prev) => {
        const next = { ...prev }
        if (res.data && res.data.modifiedTime > 0) next[newId] = res.data.modifiedTime
        else if (prev[oldId] !== undefined) next[newId] = prev[oldId]
        delete next[oldId]
        return next
      })
      // 源编码同步迁移（GBK 文件重命名后保存仍写回原编码）
      setEncodingMap((prev) => {
        if (prev[oldId] === undefined) return prev
        const next = { ...prev }
        next[newId] = next[oldId]
        delete next[oldId]
        return next
      })
      if (activeFileId === oldId) {
        activeFileIdRef.current = newId
        setActiveFileId(newId)
        setDocTitle(finalName)
      }
      // 重命名前内容已写盘，旧草稿清除（含防抖中未落盘的待写项，避免写回旧 id）
      if (draftPendingRef.current?.id === oldId) draftPendingRef.current = null
      void clearDraft(oldId)
      await refreshWorkspace()
    },
    [contents, savedMap, fileMtime, activeFileId, saveWithEncodingFallback, refreshWorkspace, clearDraft],
  )

  const handleDocumentTitleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const currentFile = openFiles.find((file) => file.id === activeFileId)
      const previousName = currentFile?.name ?? docTitle
      const nextName = (event.currentTarget.textContent ?? '').trim()
      // contentEditable 不会自动受 React 控制；先还原显示，等待真实重命名成功后再更新状态。
      event.currentTarget.textContent = previousName
      if (!nextName) {
        setToast('文件名不能为空')
        return
      }
      if (nextName === previousName) return
      if (currentFile?.path) {
        void handleRenameFile(currentFile.path, nextName)
        return
      }
      setDocTitle(nextName)
      const renamedFiles = openFilesRef.current.map((file) =>
        file.id === activeFileId ? { ...file, name: nextName } : file,
      )
      openFilesRef.current = renamedFiles
      setOpenFiles(renamedFiles)
    },
    [activeFileId, docTitle, handleRenameFile, openFiles],
  )

  const handleDocumentTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isImeComposing(event.nativeEvent)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.currentTarget.textContent = docTitle
      event.currentTarget.blur()
    },
    [docTitle],
  )

  const handleDeleteFile = useCallback(
    async (path: string) => {
      if (!window.desktopAPI) return
      const delId = `file-${path}`
      // 删除前先写回未保存内容，避免编辑丢失（与 rename/move 保持一致）
      if (savedMap[delId] === false) {
        const saveRes = await saveWithEncodingFallback(
          path,
          contents[delId] ?? '',
          fileMtime[delId],
          delId,
        )
        if (!saveRes.ok) {
          setToast(
            saveRes.error?.code === 'CONFLICT'
              ? `「${path.split(/[\\/]/).pop()}」已被外部修改，已取消删除`
              : '删除前保存失败，已取消删除',
          )
          return
        }
        if (saveRes.data) {
          INITIAL_OR_SAVED.current[delId] = contents[delId] ?? ''
          setFileMtime((prev) => ({ ...prev, [delId]: saveRes.data!.modifiedTime }))
        }
      }
      const res = await window.desktopAPI.workspace.deleteFile(path)
      if (!res.ok) {
        setToast('删除失败')
        return
      }
      // 立即同步供编辑器异步回调读取的镜像，避免状态提交前继续写入已删除文件。
      openFilesRef.current = openFilesRef.current.filter((file) => file.id !== delId)
      setOpenFiles((prev) => prev.filter((f) => f.id !== delId))
      setContents((prev) => {
        const next = { ...prev }
        delete next[delId]
        return next
      })
      setSavedMap((prev) => {
        const next = { ...prev }
        delete next[delId]
        return next
      })
      setFileMtime((prev) => {
        const next = { ...prev }
        delete next[delId]
        return next
      })
      setEncodingMap((prev) => {
        const next = { ...prev }
        delete next[delId]
        return next
      })
      // 清理残留草稿/基线，避免重启后恢复已删除文件的内容
      if (draftPendingRef.current?.id === delId) draftPendingRef.current = null
      void clearDraft(delId)
      delete INITIAL_OR_SAVED.current[delId]
      await refreshWorkspace()
      if (activeFileId === delId) {
        // 切到相邻标签；删掉的是最后一个标签时进入"开始"界面（不再强制新建空白文档）
        const idx = openFiles.findIndex((f) => f.id === delId)
        const neighbor = openFiles[idx + 1] ?? openFiles[idx - 1] ?? null
        if (neighbor) switchFile(neighbor.id)
      }
    },
    [activeFileId, refreshWorkspace, switchFile, clearDraft, savedMap, contents, fileMtime, saveWithEncodingFallback, openFiles],
  )

  /** 关闭标签页：从打开列表移除（不删磁盘文件）；有未保存内容时先确认 */
  const handleCloseTab = useCallback(
    (id: string) => {
      const list = openFiles
      const idx = list.findIndex((f) => f.id === id)
      if (idx === -1) return
      const neighborId = getNeighborTabId(list, id)
      if (requiresCloseConfirmation(savedMap, id)) {
        const name = list[idx]?.name ?? '未命名文档'
        if (!window.confirm(`「${name}」有未保存的修改，确定关闭该标签页吗？`)) return
      }
      openFilesRef.current = openFilesRef.current.filter((file) => file.id !== id)
      setOpenFiles((prev) => prev.filter((f) => f.id !== id))
      setContents((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setSavedMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      delete INITIAL_OR_SAVED.current[id]
      // 防抖中的待写草稿一并作废（内容已确认丢弃），避免在 clearDraft 之后又写回
      if (draftPendingRef.current?.id === id) draftPendingRef.current = null
      void clearDraft(id)
      if (activeFileId === id) {
        // 关掉最后一个标签页后不再自动新建空白文档：进入"开始"界面（左侧文件夹树保留）
        if (neighborId) switchFile(neighborId)
      }
    },
    [openFiles, savedMap, activeFileId, switchFile, clearDraft],
  )

  /** 拖拽重排标签页顺序 */
  const handleReorderTabs = useCallback((from: number, to: number) => {
    const nextOpenFiles = reorderTabs(openFilesRef.current, from, to)
    if (nextOpenFiles === openFilesRef.current) return
    openFilesRef.current = nextOpenFiles
    setOpenFiles(nextOpenFiles)
  }, [])

  /** 拖拽移动文件/文件夹到目标目录（U5） */
  const handleMoveFile = useCallback(
    async (path: string, targetDir: string) => {
      if (!window.desktopAPI) return
      const normalizePathForCompare = (value: string) => {
        const normalized = value.replace(/\\/g, '/')
        return window.desktopAPI?.platform === 'win32' ? normalized.toLowerCase() : normalized
      }
      const sourceForCompare = normalizePathForCompare(path)
      const isUnder = (value: string) => {
        const candidate = normalizePathForCompare(value)
        return candidate === sourceForCompare || candidate.startsWith(`${sourceForCompare}/`)
      }
      // 先写回受影响文件的未保存内容，避免移动后编辑丢失（带冲突检测，外部修改过的不静默覆盖）
      const dirty = openFiles.filter(
        (f) => f.path && isUnder(f.path) && savedMap[f.id] === false,
      )
      for (const f of dirty) {
        const saveRes = await saveWithEncodingFallback(
          f.path!,
          contents[f.id] ?? '',
          fileMtime[f.id],
          f.id,
        )
        if (!saveRes.ok) {
          setToast(
            saveRes.error?.code === 'CONFLICT'
              ? `「${f.name}」已被外部修改，已中止移动`
              : '移动前保存失败，已中止',
          )
          return
        }
        // 写回成功后同步基线与 mtime（用旧 id，后续迁移会按序搬走）；
        // 否则陈旧基线造成"假脏状态"，且移动文件夹时子文件的旧 mtime 会导致下次保存误报 CONFLICT
        if (saveRes.data) {
          INITIAL_OR_SAVED.current[f.id] = contents[f.id] ?? ''
          setFileMtime((prev) => ({ ...prev, [f.id]: saveRes.data!.modifiedTime }))
        }
      }
      const res = await window.desktopAPI.workspace.moveFile(path, targetDir)
      if (!res.ok || !res.data) {
        setToast(res.error?.code === 'EXISTS' ? '目标目录已存在同名文件' : '移动失败')
        return
      }
      const newPath = res.data.path
      const mapPath = (p: string) =>
        p === path ? newPath : newPath + p.slice(path.length)
      // 迁移已打开文件的 id（file-旧路径 → file-新路径），文件夹移动时子文件一并迁移
      const movedFiles = openFilesRef.current.map((file) => {
        if (!file.path || !isUnder(file.path)) return file
        const nextPath = mapPath(file.path)
        return {
          ...file,
          id: `file-${nextPath}`,
          name: nextPath.split(/[\\/]/).pop() ?? file.name,
          path: nextPath,
        }
      })
      openFilesRef.current = movedFiles
      setOpenFiles(movedFiles)
      setContents((prev) => {
        let changed = false
        const next: Record<string, string> = {}
        for (const [id, val] of Object.entries(prev)) {
          if (id.startsWith('file-') && isUnder(id.slice(5))) {
            next[`file-${mapPath(id.slice(5))}`] = val
            changed = true
          } else {
            next[id] = val
          }
        }
        return changed ? next : prev
      })
      // 脏检查基线与 mtime 同步迁移
      for (const [id, val] of Object.entries({ ...INITIAL_OR_SAVED.current })) {
        if (id.startsWith('file-') && isUnder(id.slice(5))) {
          INITIAL_OR_SAVED.current[`file-${mapPath(id.slice(5))}`] = val
          delete INITIAL_OR_SAVED.current[id]
        }
      }
      // 保存状态迁移：脏文件已在移动前写盘，新 id 直接标记为干净；
      // 不迁移会导致旧 id 的未保存状态永久残留，每次关窗都误弹确认框
      setSavedMap((prev) => {
        let changed = false
        const next: Record<string, boolean> = {}
        for (const [id, val] of Object.entries(prev)) {
          if (id.startsWith('file-') && isUnder(id.slice(5))) {
            next[`file-${mapPath(id.slice(5))}`] = true
            changed = true
          } else {
            next[id] = val
          }
        }
        return changed ? next : prev
      })
      // 清理被移动文件的旧路径草稿（内容已写盘，避免重启后恢复已不存在的旧路径）；
      // 防抖中的待写草稿随 id 迁移到新路径，避免写回旧路径后残留
      const dp = draftPendingRef.current
      if (dp && dp.id.startsWith('file-') && isUnder(dp.id.slice(5))) {
        draftPendingRef.current = { id: `file-${mapPath(dp.id.slice(5))}`, content: dp.content }
      }
      for (const f of openFiles) {
        if (f.path && isUnder(f.path)) void clearDraft(`file-${f.path}`)
      }
      // 源编码映射同步迁移（GBK 文件移动后状态栏仍显示真实源编码）
      setEncodingMap((prev) => {
        let changed = false
        const next: Record<string, string> = {}
        for (const [id, val] of Object.entries(prev)) {
          if (id.startsWith('file-') && isUnder(id.slice(5))) {
            next[`file-${mapPath(id.slice(5))}`] = val
            changed = true
          } else {
            next[id] = val
          }
        }
        return changed ? next : prev
      })
      setFileMtime((prev) => {
        const next: Record<string, number> = {}
        for (const [id, val] of Object.entries(prev)) {
          if (id.startsWith('file-') && isUnder(id.slice(5))) {
            next[`file-${mapPath(id.slice(5))}`] = val
          } else {
            next[id] = val
          }
        }
        // 移动项自身用主进程返回的最新 mtime
        next[`file-${newPath}`] = res.data!.modifiedTime || next[`file-${newPath}`] || 0
        return next
      })
      // 激活文件若在被移动范围内，同步切换 id
      if (activeFileId.startsWith('file-') && isUnder(activeFileId.slice(5))) {
        const nid = `file-${mapPath(activeFileId.slice(5))}`
        activeFileIdRef.current = nid
        setActiveFileId(nid)
        // M7：移动改变了文档目录，编辑器内 mdimg 仍按旧目录解析；
        // 按新目录重新迁移并重渲染，否则下一键保存就把 mdimg:///旧目录/ 绝对路径写进文件
        replaceEditorContent(nid, contentsRef.current[activeFileId] ?? '', 'update')
      }
      setToast('已移动')
      await refreshWorkspace()
    },
    [openFiles, savedMap, contents, fileMtime, saveWithEncodingFallback, activeFileId, refreshWorkspace, clearDraft, replaceEditorContent],
  )

  /** 右键在新窗口打开文件（U7） */
  const handleOpenInNewWindow = useCallback((path: string) => {
    void window.desktopAPI?.window.newWindowWithFile(path)
  }, [])

  /* ==================== 搜索回调 ==================== */

  const handleSearchQuery = useCallback(
    (q: string, regex: boolean, caseSensitive: boolean, wholeWord: boolean) => {
      const info =
        editorRef.current?.startSearch(q, regex, caseSensitive, wholeWord) ?? {
          count: 0,
          current: -1,
        }
      setSearchCount(info.count)
      setSearchCurrent(info.current)
      // U4：同步持久化搜索选项
      setSearchPref((prev) =>
        prev.query === q &&
        prev.useRegex === regex &&
        prev.caseSensitive === caseSensitive &&
        prev.wholeWord === wholeWord
          ? prev
          : { ...prev, query: q, useRegex: regex, caseSensitive, wholeWord },
      )
    },
    [],
  )

  /** U4：替换文本变化时同步到持久化状态 */
  const handleSearchReplacementChange = useCallback((r: string) => {
    setSearchPref((prev) => (prev.replacement === r ? prev : { ...prev, replacement: r }))
  }, [])

  const handleSearchNext = useCallback((backwards: boolean) => {
    setSearchCurrent(editorRef.current?.searchNext(backwards) ?? -1)
  }, [])

  const handleSearchReplace = useCallback((replacement: string) => {
    const info = editorRef.current?.replaceCurrent(replacement) ?? {
      count: 0,
      current: -1,
    }
    setSearchCount(info.count)
    setSearchCurrent(info.current)
  }, [])

  const handleSearchReplaceAll = useCallback((replacement: string) => {
    editorRef.current?.replaceAllMatches(replacement)
    setSearchCount(0)
    setSearchCurrent(-1)
  }, [])

  const closeSearch = useCallback(() => {
    editorRef.current?.endSearch()
    setSearchMode('none')
    setSearchCount(0)
    setSearchCurrent(-1)
    focusEditorSoon()
  }, [focusEditorSoon])

  /* ==================== 分栏预览 ==================== */

  /** 预览内容容器（直接 DOM 注入，绕开 React 协调，大文档不触发全树重渲染） */
  const previewContentRef = useRef<HTMLDivElement>(null)
  /** 预览栏滚动容器 */
  const previewPaneRef = useRef<HTMLDivElement>(null)
  /** renderPreview 程序化滚动标记：同步监听需吞掉该回显，避免反向拉动编辑区 */
  const previewProgScrollRef = useRef(false)

  /** 取编辑器 DOM 快照写入预览栏；前后保持滚动比例，内容刷新后不跳动 */
  const renderPreview = useCallback(() => {
    const pane = previewPaneRef.current
    const content = previewContentRef.current
    if (!pane || !content) return
    const max = pane.scrollHeight - pane.clientHeight
    const ratio = max > 0 ? pane.scrollTop / max : 0
    // 信任边界：内容来自 ProseMirror 编辑器自身 DOM（Markdown 经 schema 渲染，无原始 HTML 透传）。
    // 若未来引入用户可控的原始 HTML 渲染，此处必须先经 DOMPurify 清理再注入。
    content.innerHTML = editorRef.current?.getPreviewHtml() ?? ''
    const nextMax = pane.scrollHeight - pane.clientHeight
    if (nextMax > 0) {
      const target = ratio * nextMax
      if (Math.abs(target - pane.scrollTop) > 1) {
        previewProgScrollRef.current = true
        pane.scrollTop = target
      }
    }
  }, [])

  // 打开预览时立即渲染一次
  useEffect(() => {
    if (!previewMode) return
    renderPreview()
  }, [previewMode, renderPreview])

  // 内容变化防抖刷新（350ms）：大文档连续输入不再逐键触发全量快照与 DOM 重建
  useEffect(() => {
    if (!previewMode) return
    const timer = setTimeout(renderPreview, 350)
    return () => clearTimeout(timer)
  }, [previewMode, activeContent, renderPreview])

  /** B1/B2：懒加载插件（KaTeX/Mermaid）渲染完成后立即刷新预览 */
  const handleRichRender = useCallback(() => {
    renderPreview()
  }, [renderPreview])

  // 编辑区 ↔ 预览区按比例同步滚动
  // 性能优化：rAF 节流（每帧最多同步一次）+ 一次性回显抑制（防程序化滚动乒乓回环）
  useEffect(() => {
    if (!previewMode) return
    const editorScroll = editorAreaRef.current?.querySelector(
      '.editor-scroll',
    ) as HTMLElement | null
    const previewEl = previewPaneRef.current
    if (!editorScroll || !previewEl) return

    let pendingFrom: 'editor' | 'preview' | null = null
    let suppressPane: 'editor' | 'preview' | null = null
    let suppressTimer = 0
    let raf = 0

    const applySync = () => {
      raf = 0
      const from = pendingFrom
      pendingFrom = null
      if (!from) return
      const src = from === 'editor' ? editorScroll : previewEl
      const dst = from === 'editor' ? previewEl : editorScroll
      const maxSrc = src.scrollHeight - src.clientHeight
      const maxDst = dst.scrollHeight - dst.clientHeight
      if (maxSrc <= 0 || maxDst <= 0) return
      // 标记对侧下一次滚动事件为回显，直接吞掉
      suppressPane = from === 'editor' ? 'preview' : 'editor'
      window.clearTimeout(suppressTimer)
      suppressTimer = window.setTimeout(() => {
        suppressPane = null
      }, 150)
      dst.scrollTop = (src.scrollTop / maxSrc) * maxDst
    }

    const requestSync = (from: 'editor' | 'preview') => {
      if (suppressPane === from) {
        suppressPane = null
        window.clearTimeout(suppressTimer)
        return
      }
      pendingFrom = from
      if (!raf) raf = requestAnimationFrame(applySync)
    }

    const onEditorScroll = () => requestSync('editor')
    const onPreviewScroll = () => {
      // renderPreview 刷新内容后的比例恢复滚动是程序化的，不属于用户操作
      if (previewProgScrollRef.current) {
        previewProgScrollRef.current = false
        return
      }
      requestSync('preview')
    }
    editorScroll.addEventListener('scroll', onEditorScroll, { passive: true })
    previewEl.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      editorScroll.removeEventListener('scroll', onEditorScroll)
      previewEl.removeEventListener('scroll', onPreviewScroll)
      if (raf) cancelAnimationFrame(raf)
      window.clearTimeout(suppressTimer)
    }
  }, [previewMode])

  /** 图片管理扫描目录：当前文档旁 attachments → 工作区 attachments → 应用数据目录 */
  const imageDirs = useMemo(() => {
    const dirs: string[] = []
    if (activeFile?.path) {
      dirs.push(`${activeFile.path.replace(/[\\/][^\\/]+$/, '')}/attachments`)
    }
    if (workspace) dirs.push(`${workspace.path}/attachments`)
    return dirs
  }, [activeFile?.path, workspace])

  /* ==================== 大纲定位 ==================== */

  const openOutlinePanel = useCallback(() => {
    setSidebarCollapsed(false)
    // M5：侧栏折叠时组件重新挂载，挂载时 lastOutlineTickRef 初始化为当前 tick，
    // 同一批渲染内递增的 tick 会被新实例当作"已消费"，Tab 永远切不过去。
    // 延迟一拍再递增，保证展开后的新实例能消费到这次切换
    setTimeout(() => setFocusOutlineTick((t) => t + 1), 0)
  }, [])

  const handleOutlineClick = useCallback((index: number) => {
    const root = editorAreaRef.current
    if (!root) return
    const headings = root.querySelectorAll('h1, h2, h3, h4')
    const target = headings[index] as HTMLElement | undefined
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.style.transition = 'background 300ms'
    target.style.background = 'var(--accent-bg)'
    setTimeout(() => {
      target.style.background = ''
    }, 800)
  }, [])

  /* ==================== 打字机模式 ==================== */

  /** 把光标所在行滚动到可视区中央 */
  const centerCaret = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return
    const root = editorAreaRef.current
    if (!root) return
    const editorEl = root.querySelector('.milkdown .editor')
    const scrollEl = root.querySelector('.editor-scroll') as HTMLElement | null
    if (!editorEl || !scrollEl) return
    const scrollRect = scrollEl.getBoundingClientRect()

    // U1：优先用光标所在行的矩形居中（比块级居中精度更高）
    const range = sel.getRangeAt(0)
    let lineRect: DOMRect | null = null
    const rects = range.getClientRects()
    if (rects.length > 0) lineRect = rects[0] as DOMRect
    if (!lineRect || lineRect.height === 0) {
      const r = range.getBoundingClientRect()
      if (r.height > 0 || r.width > 0) lineRect = r
    }
    if (lineRect && lineRect.height > 0) {
      const target =
        scrollEl.scrollTop +
        (lineRect.top + lineRect.height / 2 - scrollRect.top) -
        scrollRect.height / 2
      // 偏移很小时不滚动，避免连续输入时抖动
      if (Math.abs(scrollEl.scrollTop - target) > 2) {
        scrollEl.scrollTo({ top: target, behavior: 'smooth' })
      }
      return
    }

    // 兜底：无法取到光标矩形时，将光标所在顶层块居中
    let block: HTMLElement | null =
      sel.anchorNode.nodeType === 1
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement
    while (block && block.parentElement !== editorEl) block = block.parentElement
    if (!block || block.parentElement !== editorEl) return
    const blockRect = block.getBoundingClientRect()
    const target =
      scrollEl.scrollTop +
      (blockRect.top - scrollRect.top) -
      scrollRect.height / 2 +
      blockRect.height / 2
    if (Math.abs(scrollEl.scrollTop - target) > 2) {
      scrollEl.scrollTo({ top: target, behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    if (!typewriter) return
    // rAF 节流：连续输入时 selectionchange 高频触发，每帧最多滚动一次
    let raf = 0
    const handler = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(centerCaret)
    }
    document.addEventListener('selectionchange', handler)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', handler)
    }
  }, [typewriter, centerCaret])

  /* ==================== 菜单动作分发 ==================== */

  const handleAction = useCallback(
    (action: string) => {
      const ed = editorRef.current
      const shouldFocusEditor = ![
        'find',
        'replace',
        'wsSearch',
        'images',
        'exportPdf',
        'shortcuts',
        'markdown',
        'about',
        'stats',
        'settings',
      ].includes(action)
      switch (action) {
        // 文件
        case 'new': handleNew(); break
        case 'newWindow': void window.desktopAPI?.window.newWindow(); break
        // open/openFolder/saveAs/exportHtml/exportMarkdown/exportPandoc
        // 打开原生对话框：不在此同步分发，统一在 L20 异步块处理
        case 'images': setImagesOpen(true); break
        case 'save': void handleSave(); break
        case 'exportPdf': void handleExportPdf(); break
        // 编辑
        case 'undo': ed?.runCommand(undoCommand.key); break
        case 'redo': ed?.runCommand(redoCommand.key); break
        case 'bold': ed?.runCommand(toggleStrongCommand.key); break
        case 'italic': ed?.runCommand(toggleEmphasisCommand.key); break
        case 'strike': ed?.runCommand(toggleStrikethroughCommand.key); break
        case 'find': setSearchMode('find'); break
        case 'replace': setSearchMode('replace'); break
        case 'wsSearch':
          // 用 ref 镜像而非 workspace 状态：handleAction 依赖数组不含 workspace，
          // 直接读状态会因陈旧闭包导致打开文件夹后菜单仍提示未打开
          if (workspacePathRef.current) setWsSearchOpen(true)
          else setToast('请先打开文件夹（工作区）后再使用全文搜索')
          break
        case 'insertLink': ed?.insertMd('[链接文字](https://)'); break
        case 'insertImage': ed?.insertMd('![图片描述](https://)'); break
        // 段落
        case 'text': ed?.runCommand(turnIntoTextCommand.key); break
        case 'h1': ed?.runCommand(wrapInHeadingCommand.key, 1); break
        case 'h2': ed?.runCommand(wrapInHeadingCommand.key, 2); break
        case 'h3': ed?.runCommand(wrapInHeadingCommand.key, 3); break
        case 'ul': ed?.runCommand(wrapInBulletListCommand.key); break
        case 'ol': ed?.runCommand(wrapInOrderedListCommand.key); break
        case 'task': ed?.insertMd('- [ ] '); break
        case 'quote': ed?.runCommand(wrapInBlockquoteCommand.key); break
        case 'code': ed?.runCommand(createCodeBlockCommand.key); break
        case 'table': ed?.runCommand(insertTableCommand.key, { row: 3, col: 3 }); break
        case 'tableRow': ed?.runCommand(addRowAfterCommand.key); break
        case 'tableCol': ed?.runCommand(addColAfterCommand.key); break
        case 'tableDel': ed?.runCommand(deleteSelectedCellsCommand.key); break
        case 'hr': ed?.runCommand(insertHrCommand.key); break
        // 视图
        case 'toggleSidebar': setSidebarCollapsed((v) => !v); break
        case 'toggleFocus': setFocusMode((v) => !v); break
        case 'togglePreview': setPreviewMode((v) => !v); break
        case 'zoomIn': setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2))); break
        case 'zoomOut': setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2))); break
        case 'zoomReset': setZoom(1); break
        case 'typewriter':
          setTypewriter((v) => {
            const next = !v
            if (next) setTimeout(centerCaret, 0)
            return next
          })
          break
        case 'outline':
          openOutlinePanel()
          break
        // 帮助
        case 'shortcuts': setHelpView('shortcuts'); break
        case 'markdown': setHelpView('syntax'); break
        case 'about': setHelpView('about'); break
        case 'stats': setHelpView('stats'); break
        case 'settings': setSettingsOpen(true); break
        default:
          if (action.startsWith('openRecent:')) {
            const p = action.slice('openRecent:'.length)
            void handleSelectWorkspaceFile(p)
          }
          break
      }
      // L20：打开原生对话框的动作不能在对话框打开前同步 focus——
      // 焦点先被菜单按钮拿走，同步 focus 又被对话框打断，取消后
      // 焦点落在窗口 chrome 上。改为等 promise 结束（对话框关闭）
      // 再聚焦：成功路径自身会聚焦编辑器，这里补取消对话框的路径。
      if (shouldFocusEditor) {
        if (
          action === 'open' ||
          action === 'openFolder' ||
          action === 'saveAs' ||
          action === 'exportHtml' ||
          action === 'exportMarkdown' ||
          action === 'exportPandoc'
        ) {
          void (async () => {
            switch (action) {
              case 'open': await handleOpen(); break
              case 'openFolder': await handleOpenFolder(); break
              case 'saveAs': await handleSaveAs(); break
              case 'exportHtml': await handleExportHtml(); break
              case 'exportMarkdown': await handleExportMarkdown(); break
              case 'exportPandoc': await handleExportPandoc(); break
              default: break
            }
            ed?.focus()
          })()
        } else {
          ed?.focus()
        }
      }
    },
    [handleNew, handleOpen, handleOpenFolder, handleSelectWorkspaceFile, handleSave, handleSaveAs, handleExportHtml, handleExportPdf, handleExportMarkdown, handleExportPandoc, openOutlinePanel, centerCaret],
  )

  /* ==================== 全局快捷键（可自定义，查表分发） ==================== */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // M4：弹窗/对话框打开时全局快捷键一律不响应（焦点可能在按钮上，
      // isEditableShortcutTarget 拦不住），由弹窗自身的键位处理接管
      if (modalOpenRef.current) return
      if (isImeComposing(e)) return
      // M6：事件已被更优先的处理者消费（defaultPrevented）或长按自动重复时不再触发动作
      if (e.defaultPrevented) return
      if (e.repeat) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = shortcutLookupRef.current[combo]
      if (!action) return
      if (isEditableShortcutTarget(e.target)) return
      e.preventDefault()
      switch (action) {
        case 'new': handleNew(); break
        case 'open': void handleOpen(); break
        case 'openFolder': void handleOpenFolder(); break
        case 'save': void handleSave(); break
        case 'saveAs': void handleSaveAs(); break
        case 'find': setSearchMode('find'); break
        case 'replace': setSearchMode('replace'); break
        case 'strike': editorRef.current?.runCommand(toggleStrikethroughCommand.key); break
        case 'link': editorRef.current?.insertMd('[链接文字](https://)'); break
        case 'image': editorRef.current?.insertMd('![图片描述](https://)'); break
        case 'codeBlock': editorRef.current?.runCommand(createCodeBlockCommand.key); break
        case 'quote': editorRef.current?.runCommand(wrapInBlockquoteCommand.key); break
        case 'hr': editorRef.current?.runCommand(insertHrCommand.key); break
        case 'h1': editorRef.current?.runCommand(wrapInHeadingCommand.key, 1); break
        case 'h2': editorRef.current?.runCommand(wrapInHeadingCommand.key, 2); break
        case 'h3': editorRef.current?.runCommand(wrapInHeadingCommand.key, 3); break
        case 'text': editorRef.current?.runCommand(turnIntoTextCommand.key); break
        case 'toggleSidebar': setSidebarCollapsed((v) => !v); break
        case 'outline': openOutlinePanel(); break
        case 'preview': setPreviewMode((v) => !v); break
        case 'zoomIn': setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2))); break
        case 'zoomOut': setZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2))); break
        case 'focusMode': setFocusMode((v) => !v); break
        default: break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, handleSaveAs, handleNew, handleOpen, handleOpenFolder, openOutlinePanel])

  /* ==================== 渲染 ==================== */

  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''} ${typewriter ? 'typewriter-mode' : ''}`}>
      {/* 顶部栏：品牌区 + 菜单 + 文档标题 + 操作按钮（无独立系统标题栏，已合二为一） */}
      <div className="topbar">
        <div className="brand" title="MarkdownSoft">
          <img className="brand-icon" src="/icon.png" alt="" />
          <span className="brand-name">MarkdownSoft</span>
        </div>
        <MenuBar onAction={handleAction} recentFiles={recentFiles} />
        <div className="topbar-spacer" />
        {openFiles.length > 0 && (
          <div
            ref={titleRef}
            className="doc-title"
            contentEditable
            role="textbox"
            aria-label="文档文件名"
            aria-multiline={false}
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={handleDocumentTitleBlur}
            onKeyDown={handleDocumentTitleKeyDown}
          >
            {docTitle}
          </div>
        )}
        <div className="act-group">
          <button
            type="button"
            className={`act-btn ${!sidebarCollapsed ? 'active' : ''}`}
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label="切换侧栏"
            aria-pressed={!sidebarCollapsed}
            title="切换侧栏 (Ctrl+J)"
          >
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
          </button>
          <button
            type="button"
            className={`act-btn ${focusMode ? 'active' : ''}`}
            onClick={() => setFocusMode((v) => !v)}
            aria-label="切换专注模式"
            aria-pressed={focusMode}
            title="专注模式 (F11)"
          >
            <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></svg>
          </button>
          <ThemeSwitcher currentTheme={theme} onThemeChange={setTheme} />
          <button
            type="button"
            className={`act-btn ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            aria-label="打开设置"
            title="设置"
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </button>
        </div>
      </div>

      {/* 工作区：侧栏 + 编辑器 */}
      <div
        className="workspace"
        ref={editorAreaRef}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
      >
        {/* L16：侧栏始终挂载，折叠只改宽度（保留滚动位置/重命名状态） */}
        <Sidebar
          collapsed={sidebarCollapsed}
          demoTree={DEMO_TREE}
            demoFileNames={demoFileNames}
            workspace={workspace}
            openFiles={openFiles}
            activeFileId={activeFileId}
            content={activeContent}
            onSelectDemoFile={handleSelectDemoFile}
            onSelectWorkspaceFile={(path, pinned) =>
              void handleSelectWorkspaceFile(path, pinned)
            }
            onOutlineClick={handleOutlineClick}
            focusOutlineTick={focusOutlineTick}
            activeOutlineIndex={cursorPos.headingIndex}
            onCreateFile={(dir) => void handleCreateFile(dir)}
            onRenameFile={(path, name) => void handleRenameFile(path, name)}
            onDeleteFile={(path) => void handleDeleteFile(path)}
            onMoveFile={(path, targetDir) => void handleMoveFile(path, targetDir)}
            onOpenInNewWindow={handleOpenInNewWindow}
            initialCollapsedKeys={sidebarCollapsedKeys}
            onCollapsedKeysChange={setSidebarCollapsedKeys}
            activeTab={sidebarActiveTab}
            onActiveTabChange={setSidebarActiveTab}
          />
        <button
          type="button"
          className={`sidebar-toggle ${sidebarCollapsed ? 'flipped' : ''}`}
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          aria-pressed={!sidebarCollapsed}
          title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        >
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        {/* 侧栏宽度拖拽条 */}
        {!sidebarCollapsed && (
          <div className="sidebar-resizer" onMouseDown={startSidebarResize} />
        )}
        {/* 查找替换栏（key 变化时重挂载，用于工作区搜索结果带入时重新执行搜索） */}
        {searchMode !== 'none' && (
          <SearchBar
            key={searchEpoch}
            withReplace={searchMode === 'replace'}
            onClose={closeSearch}
            count={searchCount}
            current={searchCurrent}
            initial={searchPref}
            onQueryChange={handleSearchQuery}
            onNext={handleSearchNext}
            onReplace={handleSearchReplace}
            onReplaceAll={handleSearchReplaceAll}
            onReplacementChange={handleSearchReplacementChange}
          />
        )}
        <div className="editor-host">
          {/* 标签栏属于编辑器区域，不占用左侧文件树和大纲的顶部空间。 */}
          <TabBar
            openFiles={openFiles}
            activeFileId={activeFileId}
            savedMap={savedMap}
            onSwitch={switchFile}
            onClose={handleCloseTab}
            onReorder={handleReorderTabs}
          />
          <div className="editor-content">
            <Editor
              ref={editorRef}
              initialContent={DEMO_FILES[DEFAULT_FILE_ID].content}
              onChange={handleEditorChange}
              onCursorChange={handleCursorChange}
              onRichRender={handleRichRender}
              blankClickToEnd={blankClickToEnd}
              codeLineNumbers={codeLineNumbers}
              onNotify={setToast}
              wikiLinkFiles={wikiLinkFileList}
              onWikiLinkClick={handleWikiLinkClick}
              /* frontmatter 属性面板：渲染在正文上方（仿 Obsidian） */
              frontmatterPanel={
                activeFile?.path && activeContent ? (
                  <FrontmatterProperties
                    properties={(() => {
                      const extracted = extractFrontmatterRaw(activeContent)
                      return extracted ? parseFrontmatterYaml(extracted.text) : null
                    })()}
                    show={showFrontmatterProps}
                    onToggle={() => setShowFrontmatterProps((v) => !v)}
                    onUpdateProperty={(key, value) => {
                      const newMarkdown = setFrontmatterProperty(activeContent, key, value)
                      replaceEditorContent(activeFileId, newMarkdown, 'update')
                    }}
                    onDeleteProperty={(key) => {
                      const newMarkdown = deleteFrontmatterProperty(activeContent, key)
                      replaceEditorContent(activeFileId, newMarkdown, 'update')
                    }}
                    onAddProperty={(key, value) => {
                      if (!isValidFrontmatterPropertyKey(key)) {
                        setToast('属性名只能包含字母、数字、下划线和连字符')
                        return
                      }
                      const extracted = extractFrontmatterRaw(activeContent)
                      if (extracted && getFrontmatterPropertyKeys(extracted.text).includes(key)) {
                        setToast(`属性“${key}”已存在；请编辑现有属性或正文 YAML`)
                        return
                      }
                      const newMarkdown = setFrontmatterProperty(activeContent, key, value)
                      replaceEditorContent(activeFileId, newMarkdown, 'update')
                    }}
                  />
                ) : undefined
              }
              imageHints={{
                documentId: activeFileId,
                docPath: activeFile?.path,
                workspacePath: workspace?.path,
                imageHost,
              }}
            />
            {/* 分栏预览（内容由 renderPreview 直接写入 DOM，避免 React 协调开销） */}
            {previewMode && (
              <div className="preview-pane" ref={previewPaneRef}>
                <div className="editor-inner preview-content" ref={previewContentRef} />
              </div>
            )}
            {/* 全部标签页关闭后显示开始界面（左侧文件夹树仍保留） */}
            {openFiles.length === 0 && (
              <StartScreen
                onNew={handleNew}
                onOpen={() => void handleOpen()}
                onOpenFolder={() => void handleOpenFolder()}
              />
            )}
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <StatusBar
        saved={saved}
        wordCount={wordCount}
        lineCount={lineCount}
        readTime={wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 500))}
        cursorLine={cursorPos.line}
        cursorCol={cursorPos.col}
        currentHeading={cursorPos.heading}
        modifiedTime={fileMtime[activeFileId]}
        selectedChars={cursorPos.selected}
        encoding={encodingMap[activeFileId] ?? 'UTF-8'}
      />

      {/* 弹窗：设置 / 帮助 */}
      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        theme={theme}
        onThemeChange={setTheme}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        contentWidth={contentWidth}
        onContentWidthChange={setContentWidth}
        lineHeight={lineHeight}
        onLineHeightChange={setLineHeight}
        contentFont={contentFont}
        onContentFontChange={setContentFont}
        zoom={zoom}
        onZoomChange={setZoom}
        autosave={autosave}
        onAutosaveChange={setAutosave}
        typewriter={typewriter}
        onTypewriterChange={setTypewriter}
        spellcheck={spellcheck}
        onSpellcheckChange={setSpellcheck}
        spellcheckLang={spellcheckLang}
        onSpellcheckLangChange={setSpellcheckLang}
        multiWindow={multiWindow}
        onMultiWindowChange={setMultiWindow}
        blankClickToEnd={blankClickToEnd}
        onBlankClickToEndChange={setBlankClickToEnd}
        codeLineNumbers={codeLineNumbers}
        onCodeLineNumbersChange={setCodeLineNumbers}
        customCssName={customCss?.name ?? null}
        onImportCss={() => void handleImportCss()}
        onRemoveCss={handleRemoveCss}
        imageHost={imageHost}
        onImageHostProviderChange={handleImageHostProviderChange}
        onImageHostTokenSave={handleImageHostTokenSave}
        shortcuts={shortcuts}
        onShortcutsChange={setShortcuts}
      />
      <HelpDialog view={helpView} onClose={closeHelp} stats={writingStats} shortcuts={shortcuts} />
      <ImagesDialog
        open={imagesOpen}
        onClose={closeImages}
        dirs={imageDirs}
        onNotify={setToast}
      />
      <ExportPdfDialog
        open={pdfOptsOpen}
        onClose={closePdfOptions}
        onExport={(opts) => void handleDoExportPdf(opts)}
      />
      {workspace && (
        <WorkspaceSearchDialog
          open={wsSearchOpen}
          workspacePath={workspace.path}
          workspaceName={workspace.name}
          onClose={closeWorkspaceSearch}
          onSelect={(path, query, opts) => {
            setWsSearchOpen(false)
            // 必须等文件内容替换完成后再开搜索栏，否则搜索会作用在旧文档上；
            // 序号防护连续点击的竞态；打开失败时不弹搜索栏
            const seq = ++wsSelectSeqRef.current
            void (async () => {
              const ok = await handleSelectWorkspaceFile(path)
              if (seq !== wsSelectSeqRef.current || !ok) return
              if (query) {
                setSearchPref((prev) => ({
                  ...prev,
                  query,
                  useRegex: opts?.useRegex ?? prev.useRegex,
                  caseSensitive: opts?.caseSensitive ?? prev.caseSensitive,
                }))
                setSearchEpoch((e) => e + 1)
                setSearchMode('find')
              }
            })()
          }}
        />
      )}

      {/* 轻提示 */}
      {toast && <div className="toast">{toast}</div>}

      {/* 拖入 .md 文件提示层 */}
      {dragFileOver && (
        <div className="file-drop-overlay">
          <div className="file-drop-inner">
            <span className="file-drop-icon">⇪</span>
            松开以打开 Markdown 文件
          </div>
        </div>
      )}
    </div>
  )
}
