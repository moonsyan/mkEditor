import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
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
import { DEFAULT_SHORTCUTS, mergeShortcuts, comboFromEvent } from './src/data/shortcuts'
import type { ShortcutMap } from './src/data/shortcuts'
import { DEMO_FILES, DEMO_TREE, DEFAULT_FILE_ID } from './src/data/demo-files'
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

/** 会话数据（重启后恢复上次打开的文件） */
interface SessionData {
  activeFileId?: string
  files?: { id: string; name: string; path?: string }[]
  /** 上次打开的工作区文件夹路径 */
  workspacePath?: string
}

/** 每套主题对应的标题栏覆盖层颜色（Windows 系统窗口按钮区域） */
const TITLEBAR_COLORS: Record<string, { bg: string; symbol: string }> = {
  default: { bg: '#F0EDEA', symbol: '#5C5850' },
  dark: { bg: '#1A1918', symbol: '#A09B93' },
  ocean: { bg: '#E6ECF3', symbol: '#4A6070' },
  rose: { bg: '#F5EDED', symbol: '#6B4F4F' },
}

/** 草稿数据（崩溃/退出后恢复未保存内容） */
type DraftMap = Record<string, { content: string; savedAt: number }>

/** 读取全部草稿 */
async function loadDrafts(): Promise<DraftMap> {
  if (!window.desktopAPI) return {}
  const res = await window.desktopAPI.settings.get('drafts')
  return (res?.ok && res.data ? res.data : {}) as DraftMap
}

/** 写回全部草稿 */
async function saveDrafts(drafts: DraftMap): Promise<void> {
  await window.desktopAPI?.settings.set('drafts', drafts)
}

/** 今天日期 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** 跨天滚动：旧日期数据归档到 history（保留 30 天） */
function rollStatsDate(stats: WritingStats): WritingStats {
  const today = todayStr()
  if (stats.date === today) return stats
  const history = [
    ...stats.history.filter((h) => h.date !== today),
    { date: stats.date, words: stats.words, minutes: stats.minutes },
  ].slice(-30)
  return { date: today, words: 0, minutes: 0, history }
}

const EMPTY_STATS: WritingStats = { date: '', words: 0, minutes: 0, history: [] }

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 渲染前：把文档相对路径的图片解析为 mdimg 协议（编辑器才能加载本地图）
 * 仅处理非 mdimg/http/data 开头的相对路径
 */
function toEditorImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  // 允许路径含空格（Typora 迁移文档常见）；仅排除已带协议的 src
  return md.replace(
    /!\[([^\]]*)\]\((?!mdimg:\/\/|https?:\/\/|data:)([^)]+)\)/g,
    (_m, alt: string, src: string) => {
      // 去掉尾部 title（"..."）与首尾空白
      const clean = src.trim().replace(/\s+"[^"]*"$/, '').replace(/^\.\//, '')
      return `![${alt}](mdimg:///${base}/${clean})`
    },
  )
}

/**
 * 存储前：把 mdimg 绝对路径回写为相对路径（保证 .md 可移植，其它编辑器也能显示）
 * 仅回写落在当前文档目录下的图片
 */
function toStoredImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  const prefix = `mdimg:///${base}/`
  const re = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(prefix)}([^)]+)\\)`, 'g')
  return md.replace(re, (_m, alt: string, rel: string) => `![${alt}](${rel})`)
}

/** 初始打开的文件列表（按文件树顺序） */
const INITIAL_FILES: OpenFile[] = DEMO_TREE.flatMap((folder) =>
  folder.fileIds.map((id) => ({ id, name: DEMO_FILES[id].name })),
)

/** 新窗口模式（#fresh）：跳过会话恢复与写入，避免多窗口间会话互相覆盖 */
const FRESH_MODE =
  typeof window !== 'undefined' && window.location.hash.includes('fresh')

const INITIAL_CONTENTS: Record<string, string> = Object.fromEntries(
  Object.values(DEMO_FILES).map((f) => [f.id, f.content]),
)

const INITIAL_SAVED: Record<string, boolean> = Object.fromEntries(
  Object.values(DEMO_FILES).map((f) => [f.id, true]),
)

let untitledCounter = 1

export default function App(): JSX.Element {
  const editorRef = useRef<EditorHandle>(null)
  const editorAreaRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  const [openFiles, setOpenFiles] = useState<OpenFile[]>(INITIAL_FILES)
  const [contents, setContents] = useState<Record<string, string>>(INITIAL_CONTENTS)
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>(INITIAL_SAVED)
  const [activeFileId, setActiveFileId] = useState(DEFAULT_FILE_ID)
  const [docTitle, setDocTitle] = useState(DEMO_FILES[DEFAULT_FILE_ID].name)

  const [theme, setTheme] = useState('default')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriter, setTypewriter] = useState(false)
  const [focusOutlineTick, setFocusOutlineTick] = useState(0)
  const [searchMode, setSearchMode] = useState<'none' | 'find' | 'replace'>('none')
  const [searchCount, setSearchCount] = useState(0)
  const [searchCurrent, setSearchCurrent] = useState(-1)
  /** 分栏预览 */
  const [previewMode, setPreviewMode] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpView, setHelpView] = useState<HelpView>(null)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [autosave, setAutosave] = useState(true)
  const [spellcheck, setSpellcheck] = useState(false)
  const [multiWindow, setMultiWindow] = useState(false)
  const [fontSize, setFontSize] = useState<FontSize>('md')
  const [contentWidth, setContentWidth] = useState<ContentWidth>('standard')
  const [lineHeight, setLineHeight] = useState<LineHeight>('standard')
  const [contentFont, setContentFont] = useState<ContentFont>('default')

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
  /** 写作统计 */
  const [writingStats, setWritingStats] = useState<WritingStats>(() => ({
    date: todayStr(),
    words: 0,
    minutes: 0,
    history: [],
  }))
  /** 最近打开的磁盘文件 */
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
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
  /** 组合键 → 动作 反查表（keydown 中读 ref，避免频繁重建监听） */
  const shortcutLookupRef = useRef<Record<string, string>>({})

  const activeContent = contents[activeFileId] ?? ''
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

  /** 镜像 openFiles/workspace，供 dirOfFile 等在不重建的回调中读取 */
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  const workspacePathRef = useRef<string | undefined>(undefined)
  workspacePathRef.current = workspace?.path

  /** 求某文件所在目录（图片相对路径解析用），未命中回退工作区目录 */
  const dirOfFile = useCallback((fileId: string): string | undefined => {
    const f = openFilesRef.current.find((x) => x.id === fileId)
    if (f?.path) return f.path.replace(/[\\/][^\\/]+$/, '')
    return workspacePathRef.current
  }, [])

  // 启动时加载持久化设置，并恢复会话与草稿（加载完成前不写回）
  const settingsReadyRef = useRef(false)
  const settingsInitRef = useRef(false)
  useEffect(() => {
    // 防 StrictMode 双执行：会话恢复只跑一次（去重后重复执行无害，但避免双倍 IPC 读取）
    if (settingsInitRef.current) return
    settingsInitRef.current = true
    if (!window.desktopAPI) {
      settingsReadyRef.current = true
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
    ])
      .then(async ([t, a, sp, mw, f, z, sw, cw, lh, cf, ws, rf, sc, s, dr]) => {
        if (t?.ok && typeof t.data === 'string') setTheme(t.data)
        if (a?.ok && typeof a.data === 'boolean') setAutosave(a.data)
        if (sp?.ok && typeof sp.data === 'boolean') setSpellcheck(sp.data)
        if (mw?.ok && typeof mw.data === 'boolean') setMultiWindow(mw.data)
        if (f?.ok && (f.data === 'sm' || f.data === 'md' || f.data === 'lg')) {
          setFontSize(f.data)
        }
        if (z?.ok && typeof z.data === 'number') {
          setZoom(Math.min(1.8, Math.max(0.7, z.data)))
        }
        if (sw?.ok && typeof sw.data === 'number') {
          setSidebarWidth(Math.min(480, Math.max(180, sw.data)))
        }
        if (
          cw?.ok &&
          (cw.data === 'narrow' || cw.data === 'standard' || cw.data === 'wide')
        ) {
          setContentWidth(cw.data)
        }
        if (
          lh?.ok &&
          (lh.data === 'compact' || lh.data === 'standard' || lh.data === 'loose')
        ) {
          setLineHeight(lh.data)
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
            }
          } else if (entry.name) {
            restoredFiles.push({ id: entry.id, name: entry.name })
            restoredContents[entry.id] = ''
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
          baselineById[id] = baseline
          restoredContents[id] = d.content
          dirtyIds.push(id)
        }

        if (restoredFiles.length) {
          // 函数式更新内去重：防止 StrictMode 双执行/重复恢复导致列表膨胀
          setOpenFiles((prev) => {
            const existing = new Set(prev.map((f) => f.id))
            return [...prev, ...restoredFiles.filter((f) => !existing.has(f.id))]
          })
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
            editorRef.current.replaceContent(toEditorImages(finalContent, dirOfFile(target)))
          } else if (tries++ < 20) {
            setTimeout(tryApply, 100)
          }
        }
        tryApply()
      })
      .catch(() => {})
      .finally(() => {
        settingsReadyRef.current = true
      })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // 同步 Windows 标题栏覆盖层颜色，让系统按钮区与顶栏融为一体
    const colors = TITLEBAR_COLORS[theme] ?? TITLEBAR_COLORS.default
    window.desktopAPI?.window.setTitlebarColor(colors.bg, colors.symbol).catch(() => {})
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('theme', theme).catch(() => {})
    }
  }, [theme])

  useEffect(() => {
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('autosave', autosave).catch(() => {})
    }
  }, [autosave])

  // 拼写检查：同步会话级开关 + 持久化
  useEffect(() => {
    window.desktopAPI?.window.setSpellcheck(spellcheck).catch(() => {})
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('spellcheck', spellcheck).catch(() => {})
    }
  }, [spellcheck])

  // 多窗口模式持久化（主进程下次启动时读取，决定是否跳过单实例锁）
  useEffect(() => {
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('multiWindow', multiWindow).catch(() => {})
    }
  }, [multiWindow])

  // 快捷键持久化 + 反查表更新
  useEffect(() => {
    const lookup: Record<string, string> = {}
    for (const [action, combo] of Object.entries(shortcuts)) {
      if (combo) lookup[combo] = action
    }
    shortcutLookupRef.current = lookup
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('shortcuts', shortcuts).catch(() => {})
    }
  }, [shortcuts])

  useEffect(() => {
    document.documentElement.setAttribute('data-fontsize', fontSize)
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('fontSize', fontSize).catch(() => {})
    }
  }, [fontSize])

  useEffect(() => {
    document.documentElement.setAttribute('data-contentwidth', contentWidth)
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('contentWidth', contentWidth).catch(() => {})
    }
  }, [contentWidth])

  useEffect(() => {
    document.documentElement.setAttribute('data-lineheight', lineHeight)
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('lineHeight', lineHeight).catch(() => {})
    }
  }, [lineHeight])

  // 内容字体持久化 + data 属性
  useEffect(() => {
    document.documentElement.setAttribute('data-contentfont', contentFont)
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('contentFont', contentFont).catch(() => {})
    }
  }, [contentFont])

  // 缩放：写入 CSS 变量并持久化
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-zoom', String(zoom))
    if (settingsReadyRef.current) {
      window.desktopAPI?.settings.set('zoom', zoom).catch(() => {})
    }
  }, [zoom])

  // Ctrl/Cmd + 滚轮缩放编辑区
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.1 : -0.1
      setZoom((z) => Math.min(1.8, Math.max(0.7, +(z + step).toFixed(2))))
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [])

  // 侧栏宽度持久化（拖拽中高频变化，防抖写入）
  useEffect(() => {
    if (!settingsReadyRef.current) return
    const timer = setTimeout(() => {
      window.desktopAPI?.settings.set('sidebarWidth', sidebarWidth).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [sidebarWidth])

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

  /** 保存成功后清除对应草稿（声明在自动保存之前，供其依赖） */
  const clearDraft = useCallback(async (id: string) => {
    try {
      const drafts = await loadDrafts()
      if (drafts[id]) {
        delete drafts[id]
        await saveDrafts(drafts)
      }
    } catch {
      /* 草稿清理失败不影响主流程 */
    }
  }, [])

  // 用 ref 镜像最新状态，供定时器读取（避免闭包捕获旧值）
  const autoSaveRef = useRef({ contents, openFiles, savedMap, autosave, fileMtime })
  autoSaveRef.current = { contents, openFiles, savedMap, autosave, fileMtime }

  useEffect(() => {
    // 每 30 秒将已落盘的未保存文档自动写回（演示文件无路径，不参与）
    const timer = setInterval(async () => {
      if (!window.desktopAPI) return
      const {
        contents: cs,
        openFiles: fs,
        savedMap: sm,
        autosave: enabled,
        fileMtime: mt,
      } = autoSaveRef.current
      if (!enabled) return
      for (const f of fs) {
        if (!f.path || sm[f.id] !== false) continue
        const content = cs[f.id] ?? ''
        // 带冲突检测：外部修改过的文件不自动覆盖
        const result = await window.desktopAPI.document.save(f.path, content, mt[f.id])
        if (result.ok && result.data) {
          INITIAL_OR_SAVED.current[f.id] = content
          setSavedMap((prev) => ({ ...prev, [f.id]: true }))
          setFileMtime((prev) => ({ ...prev, [f.id]: result.data!.modifiedTime }))
          void clearDraft(f.id)
        } else if (result.error?.code === 'CONFLICT') {
          setToast(`自动保存已跳过：${f.name} 已被外部修改`)
        }
      }
    }, 30000)
    return () => clearInterval(timer)
  }, [clearDraft])

  /* ==================== 会话与草稿持久化 ==================== */

  // 会话持久化：记录当前打开的非演示文件、激活文档与工作区，重启后恢复
  useEffect(() => {
    // fresh 窗口不写入会话，避免覆盖主窗口的会话
    if (FRESH_MODE) return
    if (!settingsReadyRef.current) return
    // 去重 + 上限，防止历史数据或异常累积导致会话膨胀
    const seen = new Set<string>()
    const files = openFiles
      .filter((f) => !DEMO_FILES[f.id] && f.id && !seen.has(f.id) && seen.add(f.id))
      .slice(0, 200)
      .map((f) => ({ id: f.id, name: f.name, path: f.path }))
    const data: SessionData = {
      activeFileId,
      workspacePath: workspace?.path,
      files,
    }
    window.desktopAPI?.settings.set('session', data).catch(() => {})
  }, [openFiles, activeFileId, workspace])

  // 草稿持久化：内容变化 1 秒后写入（崩溃/重启可恢复）
  useEffect(() => {
    if (!settingsReadyRef.current) return
    const timer = setTimeout(() => {
      loadDrafts()
        .then((drafts) => {
          if (drafts[activeFileId]?.content === activeContent) return
          drafts[activeFileId] = { content: activeContent, savedAt: Date.now() }
          return saveDrafts(drafts)
        })
        .catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [activeContent, activeFileId])

  /** 轻提示自动消失 */
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  // 字数统计（先剥离 Markdown 语法符号，只统计正文）
  const { wordCount, lineCount } = useMemo(() => {
    const plain = activeContent
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
  }, [activeContent])

  /* ==================== 写作统计 ==================== */

  /** 每个文件上次的字数（切换文件不计入增减） */
  const lastWordCountRef = useRef<Record<string, number>>({})
  /** 最近一次编辑时间（用于写作时长累计） */
  const lastEditTimeRef = useRef(0)

  // 字数净增追踪：同一文件字数增加才计入今日字数
  useEffect(() => {
    const prev = lastWordCountRef.current[activeFileId]
    lastWordCountRef.current[activeFileId] = wordCount
    if (prev === undefined) return // 首次打开该文件，不计
    lastEditTimeRef.current = Date.now()
    const delta = wordCount - prev
    if (delta > 0) {
      setWritingStats((s) => {
        const rolled = rollStatsDate(s)
        return { ...rolled, words: rolled.words + delta }
      })
    }
  }, [wordCount, activeFileId])

  // 写作时长：每 60 秒检查一次，最近 90 秒内有编辑则 +1 分钟
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      if (Date.now() - lastEditTimeRef.current < 90_000) {
        setWritingStats((s) => {
          const rolled = rollStatsDate(s)
          return { ...rolled, minutes: rolled.minutes + 1 }
        })
      }
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  // 统计持久化（防抖 10 秒；设置加载完成前不写，避免空值覆盖）
  useEffect(() => {
    if (!settingsReadyRef.current) return
    const timer = setTimeout(() => {
      window.desktopAPI?.settings.set('writingStats', writingStats).catch(() => {})
    }, 10_000)
    return () => clearTimeout(timer)
  }, [writingStats])

  // 最近文件持久化（防抖 2 秒；设置加载完成前不写，避免空列表覆盖）
  useEffect(() => {
    if (!settingsReadyRef.current) return
    const timer = setTimeout(() => {
      window.desktopAPI?.settings.set('recentFiles', recentFiles).catch(() => {})
    }, 2_000)
    return () => clearTimeout(timer)
  }, [recentFiles])

  /** 记录最近打开的磁盘文件（置顶 + 去重 + 上限 10） */
  const recordRecent = useCallback((path: string, name: string) => {
    setRecentFiles((prev) => {
      const rest = prev.filter((r) => r.path !== path)
      return [{ path, name }, ...rest].slice(0, 10)
    })
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

  const handleEditorChange = useCallback((md: string) => {
    // 读 ref 而非闭包 state：切换文件时 replaceAll 同步触发本回调，
    // 此时 React state 还是旧文件 ID
    const fileId = activeFileIdRef.current
    // 存储前把 mdimg 绝对路径回写为相对路径（保证 .md 可移植）
    const stored = toStoredImages(md, dirOfFile(fileId))
    setContents((prev) => ({ ...prev, [fileId]: stored }))
    setSavedMap((prev) => {
      const isSaved = stored === INITIAL_OR_SAVED.current[fileId]
      if (prev[fileId] === isSaved) return prev
      return { ...prev, [fileId]: isSaved }
    })
  }, [dirOfFile])

  /* ==================== 文件操作 ==================== */

  const switchFile = useCallback(
    (id: string) => {
      if (id === activeFileId) return
      // 先让标题输入框失焦：确保标题编辑保存到旧文件，不会串到新文件
      titleRef.current?.blur()
      // 先同步 ref，再替换内容（replaceAll 会同步触发 onChange）
      activeFileIdRef.current = id
      setActiveFileId(id)
      const file = openFiles.find((f) => f.id === id)
      setDocTitle(file?.name ?? '未命名文档')
      // 切换编辑器内容（保持同一编辑器实例，避免重建丢光标历史）
      // 渲染前把相对路径图片解析为 mdimg 协议
      editorRef.current?.replaceContent(toEditorImages(contents[id] ?? '', dirOfFile(id)))
      editorRef.current?.focus()
    },
    [activeFileId, openFiles, contents, dirOfFile],
  )

  const handleNew = useCallback(() => {
    titleRef.current?.blur()
    const id = `untitled-${untitledCounter++}`
    const name = `未命名 ${untitledCounter - 1}.md`
    setOpenFiles((prev) => [...prev, { id, name }])
    setContents((prev) => ({ ...prev, [id]: '' }))
    setSavedMap((prev) => ({ ...prev, [id]: true }))
    INITIAL_OR_SAVED.current[id] = ''
    activeFileIdRef.current = id
    setActiveFileId(id)
    setDocTitle(name)
    editorRef.current?.replaceContent('')
    editorRef.current?.focus()
  }, [])

  const handleOpen = useCallback(async () => {
    if (!window.desktopAPI) return
    const result = await window.desktopAPI.document.open()
    if (!result.ok || !result.data) return
    titleRef.current?.blur()
    const { path, name, content } = result.data
    // 已打开则直接切换
    const existed = openFiles.find((f) => f.path === path)
    if (existed) {
      switchFile(existed.id)
      return
    }
    const id = `file-${path}`
    setOpenFiles((prev) => [...prev, { id, name, path }])
    setContents((prev) => ({ ...prev, [id]: content }))
    setSavedMap((prev) => ({ ...prev, [id]: true }))
    INITIAL_OR_SAVED.current[id] = content
    setFileMtime((prev) => ({ ...prev, [id]: result.data!.modifiedTime }))
    activeFileIdRef.current = id
    setActiveFileId(id)
    setDocTitle(name)
    recordRecent(path, name)
    editorRef.current?.replaceContent(
      toEditorImages(content, path.replace(/[\\/][^\\/]+$/, '')),
    )
  }, [openFiles, switchFile, recordRecent])

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

  /** 点击工作区/外部磁盘文件：首次打开时读盘，之后直接切换 */
  const handleSelectWorkspaceFile = useCallback(
    async (path: string) => {
      const id = `file-${path}`
      if (openFiles.some((f) => f.id === id)) {
        switchFile(id)
        return
      }
      if (!window.desktopAPI) return
      const result = await window.desktopAPI.document.read(path)
      if (!result.ok || !result.data) {
        setToast('文件读取失败')
        return
      }
      titleRef.current?.blur()
      const { name, content } = result.data
      activeFileIdRef.current = id
      setOpenFiles((prev) => [...prev, { id, name, path }])
      setContents((prev) => ({ ...prev, [id]: content }))
      setSavedMap((prev) => ({ ...prev, [id]: true }))
      INITIAL_OR_SAVED.current[id] = content
      setFileMtime((prev) => ({ ...prev, [id]: result.data!.modifiedTime }))
      setActiveFileId(id)
      setDocTitle(name)
      recordRecent(path, name)
      editorRef.current?.replaceContent(
        toEditorImages(content, path.replace(/[\\/][^\\/]+$/, '')),
      )
      editorRef.current?.focus()
    },
    [openFiles, switchFile, recordRecent],
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
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragFileOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const mds = files.filter((f) => /\.(md|markdown)$/i.test(f.name))
      // Electron 为拖入的 File 附加了 path 属性
      for (const f of mds) {
        const p = (f as File & { path?: string }).path
        if (p) void handleSelectWorkspaceFile(p)
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

  const handleSaveAs = useCallback(async () => {
    if (!window.desktopAPI) return
    const content = contents[activeFileId] ?? ''
    const result = await window.desktopAPI.document.saveAs(content)
    if (!result.ok || !result.data) return
    const { path, name } = result.data
    INITIAL_OR_SAVED.current[activeFileId] = content
    setSavedMap((prev) => ({ ...prev, [activeFileId]: true }))
    // 新写入的文件，mtime 用当前时间近似（下次保存用于冲突检测）
    setFileMtime((prev) => ({ ...prev, [activeFileId]: Date.now() }))
    setOpenFiles((prev) =>
      prev.map((f) => (f.id === activeFileId ? { ...f, path, name } : f)),
    )
    setDocTitle(name)
    void clearDraft(activeFileId)
  }, [activeFileId, contents, clearDraft])

  const handleSave = useCallback(async () => {
    const file = openFiles.find((f) => f.id === activeFileId)
    const content = contents[activeFileId] ?? ''
    if (!file) return

    // 有磁盘路径：直接保存（带外部冲突检测）
    if (file.path && window.desktopAPI) {
      const doSave = (withCheck: boolean) =>
        window.desktopAPI.document.save(
          file.path!,
          content,
          withCheck ? fileMtime[activeFileId] : undefined,
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
        INITIAL_OR_SAVED.current[activeFileId] = content
        setSavedMap((prev) => ({ ...prev, [activeFileId]: true }))
        setFileMtime((prev) => ({ ...prev, [activeFileId]: result.data!.modifiedTime }))
        void clearDraft(activeFileId)
      }
      return
    }
    // 无路径：另存为
    await handleSaveAs()
  }, [openFiles, activeFileId, contents, fileMtime, handleSaveAs, clearDraft])

  /** 保存全部未保存的磁盘文件（窗口关闭"保存并关闭"用） */
  const saveAll = useCallback(async () => {
    if (!window.desktopAPI) return
    const dirty = openFiles.filter((f) => f.path && savedMap[f.id] === false)
    for (const f of dirty) {
      const content = contents[f.id] ?? ''
      const res = await window.desktopAPI.document.save(f.path!, content, fileMtime[f.id])
      if (res.ok && res.data) {
        INITIAL_OR_SAVED.current[f.id] = content
        setSavedMap((prev) => ({ ...prev, [f.id]: true }))
        setFileMtime((prev) => ({ ...prev, [f.id]: res.data!.modifiedTime }))
        void clearDraft(f.id)
      }
    }
  }, [openFiles, savedMap, contents, fileMtime, clearDraft])

  // 未保存状态同步到主进程（关闭时弹原生确认框，避免静默阻止关闭）
  const hasUnsaved = useMemo(() => Object.values(savedMap).some((s) => !s), [savedMap])
  useEffect(() => {
    window.desktopAPI?.window.setUnsaved(hasUnsaved)
  }, [hasUnsaved])

  // 暴露 saveAll 供主进程关闭流程调用
  useEffect(() => {
    const w = window as unknown as { __markdownsoft_saveAll?: () => Promise<void> }
    w.__markdownsoft_saveAll = saveAll
    return () => {
      delete w.__markdownsoft_saveAll
    }
  }, [saveAll])

  /** 构建导出用完整 HTML（HTML/PDF 共用） */
  const buildDocHtml = useCallback(() => {
    // 用编辑器真实 DOM 快照：保留 Mermaid SVG / KaTeX 渲染结果
    const body = editorRef.current?.getPreviewHtml() ?? ''
    const title = docTitle.replace(/\.md$/, '')
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
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
</style>
</head>
<body>${body}</body>
</html>`
  }, [docTitle])

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
        const dataUrl = await new Promise<string>((resolve) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result as string)
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
    const title = docTitle.replace(/\.md$/, '')
    const html = await inlineImagesInHtml(buildDocHtml())
    await window.desktopAPI.document.saveAs(html, {
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: `${title}.html`,
    })
  }, [docTitle, buildDocHtml, inlineImagesInHtml])

  /** 导出 PDF：主进程隐藏窗口渲染后 printToPDF */
  const handleExportPdf = useCallback(async () => {
    if (!window.desktopAPI) return
    const title = docTitle.replace(/\.md$/, '')
    const html = await inlineImagesInHtml(buildDocHtml())
    const res = await window.desktopAPI.document.exportPdf(
      html,
      `${title}.pdf`,
    )
    if (res.ok) setToast('PDF 导出成功')
    else if (res.error?.code !== 'CANCELLED') setToast('PDF 导出失败')
  }, [docTitle, buildDocHtml, inlineImagesInHtml])

  /** 导出 Markdown：把当前文档另存为新的 .md 文件 */
  const handleExportMarkdown = useCallback(async () => {
    if (!window.desktopAPI) return
    const title = docTitle.replace(/\.md$/, '')
    const content = contents[activeFileId] ?? ''
    // 默认名加"-导出"后缀，避免与同名源文件混淆直接覆盖
    const res = await window.desktopAPI.document.saveAs(content, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      defaultPath: `${title}-导出.md`,
    })
    if (res.ok) setToast('Markdown 已导出')
  }, [docTitle, contents, activeFileId])

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
      if (!window.desktopAPI || !newName.trim()) return
      // 先写回未保存内容，避免重命名丢失编辑
      const oldId = `file-${path}`
      const pending = contents[oldId]
      if (pending !== undefined) {
        await window.desktopAPI.document.save(path, pending)
      }
      const res = await window.desktopAPI.workspace.renameFile(path, newName)
      if (!res.ok || !res.data) {
        setToast(res.error?.code === 'EXISTS' ? '同名文件已存在' : '重命名失败')
        return
      }
      // 就地迁移打开记录/内容/基线/mtime 到新 id，避免旧路径幽灵标签残留
      const newPath = res.data.path
      const finalName = res.data.name
      const newId = `file-${newPath}`
      setOpenFiles((prev) =>
        prev.map((f) => (f.id === oldId ? { id: newId, name: finalName, path: newPath } : f)),
      )
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
      if (activeFileId === oldId) {
        activeFileIdRef.current = newId
        setActiveFileId(newId)
        setDocTitle(finalName)
      }
      // 重命名前内容已写盘，旧草稿清除
      void clearDraft(oldId)
      await refreshWorkspace()
    },
    [contents, activeFileId, refreshWorkspace, clearDraft],
  )

  const handleDeleteFile = useCallback(
    async (path: string) => {
      if (!window.desktopAPI) return
      const res = await window.desktopAPI.workspace.deleteFile(path)
      if (!res.ok) {
        setToast('删除失败')
        return
      }
      const delId = `file-${path}`
      setOpenFiles((prev) => prev.filter((f) => f.id !== delId))
      setContents((prev) => {
        const next = { ...prev }
        delete next[delId]
        return next
      })
      // 清理残留草稿/基线，避免重启后恢复已删除文件的内容
      void clearDraft(delId)
      delete INITIAL_OR_SAVED.current[delId]
      await refreshWorkspace()
      if (activeFileId === delId) switchFile(DEFAULT_FILE_ID)
    },
    [activeFileId, refreshWorkspace, switchFile, clearDraft],
  )

  /* ==================== 搜索回调 ==================== */

  const handleSearchQuery = useCallback((q: string, regex: boolean, caseSensitive: boolean) => {
    const info = editorRef.current?.startSearch(q, regex, caseSensitive) ?? { count: 0, current: -1 }
    setSearchCount(info.count)
    setSearchCurrent(info.current)
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
  }, [])

  /* ==================== 分栏预览 ==================== */

  useEffect(() => {
    if (!previewMode) return
    const timer = setTimeout(() => {
      // DOM 快照：预览中完整呈现图表/公式渲染结果
      setPreviewHtml(editorRef.current?.getPreviewHtml() ?? '')
    }, 200)
    return () => clearTimeout(timer)
  }, [previewMode, activeContent])

  /** 预览栏滚动容器 */
  const previewPaneRef = useRef<HTMLDivElement>(null)

  // 编辑区 ↔ 预览区按比例同步滚动（lock 防止互相触发回环）
  useEffect(() => {
    if (!previewMode) return
    const editorScroll = editorAreaRef.current?.querySelector(
      '.editor-scroll',
    ) as HTMLElement | null
    const previewEl = previewPaneRef.current
    if (!editorScroll || !previewEl) return
    let lock = false
    const syncTo = (from: HTMLElement, to: HTMLElement) => {
      if (lock) return
      lock = true
      const max = from.scrollHeight - from.clientHeight
      const ratio = max > 0 ? from.scrollTop / max : 0
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
      requestAnimationFrame(() => {
        lock = false
      })
    }
    const onEditorScroll = () => syncTo(editorScroll, previewEl)
    const onPreviewScroll = () => syncTo(previewEl, editorScroll)
    editorScroll.addEventListener('scroll', onEditorScroll, { passive: true })
    previewEl.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      editorScroll.removeEventListener('scroll', onEditorScroll)
      previewEl.removeEventListener('scroll', onPreviewScroll)
    }
  }, [previewMode])

  /** 图片管理扫描目录：当前文档旁 attachments → 工作区 attachments */
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
    setFocusOutlineTick((t) => t + 1)
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

  /** 把光标所在块滚动到可视区中央 */
  const centerCaret = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return
    const root = editorAreaRef.current
    if (!root) return
    const editorEl = root.querySelector('.milkdown .editor')
    const scrollEl = root.querySelector('.editor-scroll') as HTMLElement | null
    if (!editorEl || !scrollEl) return
    // 向上找到编辑器顶层块元素
    let block: HTMLElement | null =
      sel.anchorNode.nodeType === 1
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement
    while (block && block.parentElement !== editorEl) block = block.parentElement
    if (!block || block.parentElement !== editorEl) return
    const blockRect = block.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()
    const target =
      scrollEl.scrollTop +
      (blockRect.top - scrollRect.top) -
      scrollRect.height / 2 +
      blockRect.height / 2
    scrollEl.scrollTo({ top: target, behavior: 'smooth' })
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
      switch (action) {
        // 文件
        case 'new': handleNew(); break
        case 'newWindow': void window.desktopAPI?.window.newWindow(); break
        case 'open': void handleOpen(); break
        case 'openFolder': void handleOpenFolder(); break
        case 'images': setImagesOpen(true); break
        case 'save': void handleSave(); break
        case 'saveAs': void handleSaveAs(); break
        case 'exportHtml': void handleExportHtml(); break
        case 'exportPdf': void handleExportPdf(); break
        case 'exportMarkdown': void handleExportMarkdown(); break
        // 编辑
        case 'undo': ed?.runCommand(undoCommand.key); break
        case 'redo': ed?.runCommand(redoCommand.key); break
        case 'bold': ed?.runCommand(toggleStrongCommand.key); break
        case 'italic': ed?.runCommand(toggleEmphasisCommand.key); break
        case 'strike': ed?.runCommand(toggleStrikethroughCommand.key); break
        case 'find': setSearchMode('replace'); break
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
      ed?.focus()
    },
    [handleNew, handleOpen, handleOpenFolder, handleSelectWorkspaceFile, handleSave, handleSaveAs, handleExportHtml, handleExportPdf, handleExportMarkdown, openOutlinePanel, centerCaret],
  )

  /* ==================== 全局快捷键（可自定义，查表分发） ==================== */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = shortcutLookupRef.current[combo]
      if (!action) return
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
        <div
          ref={titleRef}
          className="doc-title"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(e) => {
            const name = (e.currentTarget.textContent || '').trim() || '未命名文档'
            setDocTitle(name)
            setOpenFiles((prev) =>
              prev.map((f) => (f.id === activeFileId ? { ...f, name } : f)),
            )
          }}
        >
          {docTitle}
        </div>
        <div className="act-group">
          <div
            className={`act-btn ${!sidebarCollapsed ? 'active' : ''}`}
            onClick={() => setSidebarCollapsed((v) => !v)}
            title="切换侧栏 (Ctrl+J)"
          >
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
          </div>
          <div
            className={`act-btn ${focusMode ? 'active' : ''}`}
            onClick={() => setFocusMode((v) => !v)}
            title="专注模式 (F11)"
          >
            <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></svg>
          </div>
          <ThemeSwitcher currentTheme={theme} onThemeChange={setTheme} />
          <div
            className={`act-btn ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
          </div>
        </div>
      </div>

      {/* 工作区：侧栏 + 编辑器 */}
      <div
        className="workspace"
        ref={editorAreaRef}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
      >
        {sidebarCollapsed ? (
          <div className="sidebar collapsed" />
        ) : (
          <Sidebar
            demoTree={DEMO_TREE}
            demoFileNames={demoFileNames}
            workspace={workspace}
            openFiles={openFiles}
            activeFileId={activeFileId}
            content={activeContent}
            onSelectDemoFile={switchFile}
            onSelectWorkspaceFile={(path) => void handleSelectWorkspaceFile(path)}
            onOutlineClick={handleOutlineClick}
            focusOutlineTick={focusOutlineTick}
            activeOutlineIndex={cursorPos.headingIndex}
            onCreateFile={(dir) => void handleCreateFile(dir)}
            onRenameFile={(path, name) => void handleRenameFile(path, name)}
            onDeleteFile={(path) => void handleDeleteFile(path)}
          />
        )}
        <div
          className={`sidebar-toggle ${sidebarCollapsed ? 'flipped' : ''}`}
          onClick={() => setSidebarCollapsed((v) => !v)}
        >
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
        </div>
        {/* 侧栏宽度拖拽条 */}
        {!sidebarCollapsed && (
          <div className="sidebar-resizer" onMouseDown={startSidebarResize} />
        )}
        {/* 查找替换栏 */}
        {searchMode !== 'none' && (
          <SearchBar
            withReplace={searchMode === 'replace'}
            onClose={closeSearch}
            count={searchCount}
            current={searchCurrent}
            onQueryChange={handleSearchQuery}
            onNext={handleSearchNext}
            onReplace={handleSearchReplace}
            onReplaceAll={handleSearchReplaceAll}
          />
        )}
        <Editor
          ref={editorRef}
          initialContent={DEMO_FILES[DEFAULT_FILE_ID].content}
          onChange={handleEditorChange}
          onCursorChange={handleCursorChange}
          imageHints={{
            docPath: activeFile?.path,
            workspacePath: workspace?.path,
          }}
        />
        {/* 分栏预览 */}
        {previewMode && (
          <div className="preview-pane" ref={previewPaneRef}>
            <div
              className="editor-inner preview-content"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
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
      />

      {/* 弹窗：设置 / 帮助 */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
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
        multiWindow={multiWindow}
        onMultiWindowChange={setMultiWindow}
        shortcuts={shortcuts}
        onShortcutsChange={setShortcuts}
      />
      <HelpDialog view={helpView} onClose={() => setHelpView(null)} stats={writingStats} shortcuts={shortcuts} />
      <ImagesDialog
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        dirs={imageDirs}
        onNotify={setToast}
      />

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
