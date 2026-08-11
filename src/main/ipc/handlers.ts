import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron'
import { readFile, writeFile, stat, readdir, mkdir, rename, unlink } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, dirname, basename, sep, extname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Worker } from 'worker_threads'
import iconv from 'iconv-lite'
import { CHANNELS } from '../../shared/ipc/channels'
import {
  deleteDraft,
  getSetting,
  setSetting,
  SettingsStoreError,
  upsertDraft,
} from '../settings/settings-store'
import { createWindow } from '../window/window-manager'

const execFileAsync = promisify(execFile)

/**
 * 工作区搜索行缓存（基础索引）：path → { mtimeMs, size, lines }。
 * mtime+size 均未变时直接复用已拆分的行，重复搜索免重读磁盘；
 * 文件修改/删除/移动后缓存自动失效或不再被树命中，无需主动清理。
 */
const searchLineCache = new Map<
  string,
  { mtimeMs: number; size: number; lines: string[]; bytes: number }
>()
/** 缓存条目上限：超出时淘汰最早插入的条目（Map 保持插入顺序） */
const SEARCH_CACHE_MAX = 1000
/** 搜索行缓存总大小上限，防止大量中等大小 Markdown 长期占用主进程内存 */
const SEARCH_CACHE_MAX_BYTES = 32 * 1024 * 1024
/** 单文件超过该体积不入缓存，控制最坏内存占用（1000 × 512KB） */
const SEARCH_CACHE_FILE_MAX = 512 * 1024
/** 剪贴板/拖入图片的最大体积，与图床上传限制保持一致 */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
/** 单篇 Markdown 文档读取上限，避免误选超大文件拖垮主进程与编辑器。 */
const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024
/** Base64 解码前的长度上限，避免超大 IPC 载荷先造成主进程内存峰值 */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_IMAGE_SIZE * 4) / 3) + 4
/** 自定义主题 CSS 上限，防止误选大文件阻塞主进程或渲染进程。 */
const MAX_CSS_FILE_SIZE = 1024 * 1024
/** 工作区搜索查询长度上限，避免正则与逐行匹配消耗失控 */
const MAX_SEARCH_QUERY_LENGTH = 256
/** 单个文件的正则匹配时间上限，防止灾难性回溯阻塞主进程 */
const MAX_REGEX_FILE_TIME_MS = 500

let searchLineCacheBytes = 0

const WORKSPACE_REGEX_WORKER_SOURCE = `
const { parentPort } = require('worker_threads')

parentPort.on('message', ({ content, query, caseSensitive, limit }) => {
  try {
    const regex = new RegExp(query, caseSensitive ? '' : 'i')
    const matches = []
    const lines = content.split(/\\r?\\n/)
    for (let index = 0; index < lines.length; index++) {
      regex.lastIndex = 0
      if (!regex.test(lines[index])) continue
      matches.push({ line: index + 1, preview: lines[index].trim().slice(0, 120) })
      if (matches.length >= limit) break
    }
    parentPort.postMessage({ ok: true, matches })
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error) })
  }
})
`

interface WorkspaceRegexMatch {
  line: number
  preview: string
}

function searchRegexInWorker(
  worker: Worker,
  content: string,
  query: string,
  caseSensitive: boolean,
  limit: number,
): Promise<WorkspaceRegexMatch[]> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      worker.removeListener('message', handleMessage)
      worker.removeListener('error', handleError)
    }
    const handleMessage = (result: {
      ok?: boolean
      matches?: WorkspaceRegexMatch[]
      error?: string
    }) => {
      cleanup()
      if (!result.ok) {
        reject(new Error(result.error ?? 'REGEX_WORKER_ERROR'))
        return
      }
      resolve(result.matches ?? [])
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      cleanup()
      void worker.terminate()
      reject(new Error('REGEX_TIMEOUT'))
    }, MAX_REGEX_FILE_TIME_MS)

    worker.once('message', handleMessage)
    worker.once('error', handleError)
    worker.postMessage({ content, query, caseSensitive, limit })
  })
}

function cacheSearchLines(
  path: string,
  entry: { mtimeMs: number; size: number; lines: string[] },
): void {
  if (entry.size > SEARCH_CACHE_FILE_MAX || entry.size > SEARCH_CACHE_MAX_BYTES) return
  const existing = searchLineCache.get(path)
  if (existing) {
    searchLineCacheBytes -= existing.bytes
    searchLineCache.delete(path)
  }

  while (
    searchLineCache.size >= SEARCH_CACHE_MAX ||
    searchLineCacheBytes + entry.size > SEARCH_CACHE_MAX_BYTES
  ) {
    const oldest = searchLineCache.keys().next().value
    if (oldest === undefined) break
    const removed = searchLineCache.get(oldest)
    if (removed) searchLineCacheBytes -= removed.bytes
    searchLineCache.delete(oldest)
  }

  searchLineCache.set(path, { ...entry, bytes: entry.size })
  searchLineCacheBytes += entry.size
}

/**
 * 自动探测编码读取文本（低优14）：先按 UTF-8 严格解码，
 * 失败则尝试 GBK（Electron 内置 full-icu，TextDecoder 支持）；
 * 均失败时按 UTF-8 宽松解码兜底。保存时统一写回 UTF-8。
 */
async function readTextAutoEncoding(
  filePath: string,
): Promise<{ content: string; encoding: string }> {
  const buf = await readFile(filePath)
  try {
    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(buf),
      encoding: 'UTF-8',
    }
  } catch {
    /* 非严格 UTF-8，尝试 GBK */
  }
  try {
    return { content: new TextDecoder('gbk').decode(buf), encoding: 'GBK' }
  } catch {
    return { content: buf.toString('utf-8'), encoding: 'UTF-8' }
  }
}

/** 目录树节点（只含 .md 文件与含 .md 的文件夹） */
interface FolderTreeNode {
  name: string
  path: string
  children?: FolderTreeNode[]
}

const MAX_TREE_DEPTH = 5

/** 递归扫描目录，只保留 Markdown 文件与含 Markdown 的文件夹 */
async function walkMarkdownTree(dir: string, depth: number): Promise<FolderTreeNode[]> {
  if (depth > MAX_TREE_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'zh-CN')
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .sort(byName)
  const files = entries
    .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
    .sort(byName)

  const nodes: FolderTreeNode[] = []
  for (const d of dirs) {
    const children = await walkMarkdownTree(join(dir, d.name), depth + 1)
    // 空文件夹（无 Markdown 内容）不展示
    if (children.length > 0) {
      nodes.push({ name: d.name, path: join(dir, d.name), children })
    }
  }
  for (const f of files) {
    nodes.push({ name: f.name, path: join(dir, f.name) })
  }
  return nodes
}

export function registerIpcHandlers(): void {
  // pandoc 可用性探测结果缓存（缓存 Promise 本身，避免首次探测期间的并发误报）
  let pandocCheck: Promise<boolean> | null = null

  // 打开文件
  ipcMain.handle(CHANNELS.FILE_OPEN, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELLED' } }
    }

    const filePath = result.filePaths[0]
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        return { ok: false, error: { code: 'NOT_FILE' } }
      }
      if (fileStat.size > MAX_DOCUMENT_FILE_SIZE) {
        return {
          ok: false,
          error: { code: 'TOO_LARGE', message: 'Markdown 文件超过 20MB，无法打开' },
        }
      }
      const { content, encoding } = await readTextAutoEncoding(filePath)
      return {
        ok: true,
        data: {
          path: filePath,
          name: filePath.split(/[/\\]/).pop() || 'untitled.md',
          content,
          modifiedTime: fileStat.mtimeMs,
          encoding,
        },
      }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 打开文件夹（会话恢复时可直接传 path 跳过对话框）
  ipcMain.handle(
    CHANNELS.FILE_OPEN_FOLDER,
    async (event, args?: { path?: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      let folderPath = args?.path
      if (!folderPath) {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, error: { code: 'CANCELLED' } }
        }
        folderPath = result.filePaths[0]
      }

      if (typeof folderPath !== 'string' || !folderPath) {
        return { ok: false, error: { code: 'INVALID_PATH' } }
      }
      const folderStat = await stat(folderPath).catch(() => null)
      if (!folderStat) {
        return { ok: false, error: { code: 'NOT_FOUND' } }
      }
      if (!folderStat.isDirectory()) {
        return { ok: false, error: { code: 'NOT_DIRECTORY' } }
      }

      try {
        const children = await walkMarkdownTree(folderPath, 0)
        return {
          ok: true,
          data: {
            path: folderPath,
            name: folderPath.split(/[/\\]/).pop() || 'workspace',
            tree: children,
          },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 按路径读取文件（会话恢复用，不弹对话框）
  ipcMain.handle(CHANNELS.FILE_READ, async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false, error: { code: 'INVALID_PATH' } }
    }
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        return { ok: false, error: { code: 'NOT_FILE' } }
      }
      if (fileStat.size > MAX_DOCUMENT_FILE_SIZE) {
        return {
          ok: false,
          error: { code: 'TOO_LARGE', message: 'Markdown 文件超过 20MB，无法打开' },
        }
      }
      const { content, encoding } = await readTextAutoEncoding(filePath)
      return {
        ok: true,
        data: {
          path: filePath,
          name: filePath.split(/[/\\]/).pop() || 'untitled.md',
          content,
          modifiedTime: fileStat.mtimeMs,
          encoding,
        },
      }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 保存文件（带外部冲突检测：磁盘 mtime 比预期新则拒绝，避免静默覆盖）
  ipcMain.handle(
    CHANNELS.FILE_SAVE,
    async (
      _event,
      args: {
        path: string
        content: string
        expectedMtime?: number
        /** 源文件编码：GBK 文件写回原编码，其余/缺省为 UTF-8 */
        encoding?: string
      },
    ) => {
      try {
        const pre = await stat(args.path).catch(() => null)
        if (!pre) {
          return { ok: false, error: { code: 'NOT_FOUND' } }
        }
        // 容差 3 秒，避开低精度文件系统（FAT32 为 2 秒）的时间戳误差，减少误报
        if (
          typeof args.expectedMtime === 'number' &&
          pre.mtimeMs > args.expectedMtime + 3000
        ) {
          return {
            ok: false,
            error: { code: 'CONFLICT', message: '文件已被外部修改' },
          }
        }
        // GBK 源文件写回原编码，避免其他编辑器打开乱码；其余统一 UTF-8
        if (args.encoding === 'GBK') {
          const encoded = iconv.encode(args.content, 'gbk')
          // 往返校验：GBK 无法映射的字符（emoji 等）会被 iconv 替换为 '?'，
          // 静默写入即不可逆数据丢失，拒绝并由渲染端决定降级方案
          if (iconv.decode(encoded, 'gbk') !== args.content) {
            return {
              ok: false,
              error: {
                code: 'ENCODING_LOSS',
                message: '内容包含 GBK 无法表示的字符',
              },
            }
          }
          await writeFile(args.path, encoded)
        } else {
          await writeFile(args.path, args.content, 'utf-8')
        }
        const fileStat = await stat(args.path)
        return { ok: true, data: { modifiedTime: fileStat.mtimeMs } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 另存为（支持自定义过滤器，用于导出 HTML 等）
  ipcMain.handle(
    CHANNELS.FILE_SAVE_AS,
    async (
      event,
      args: {
        content: string
        filters?: { name: string; extensions: string[] }[]
        defaultPath?: string
      },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      const result = await dialog.showSaveDialog(window, {
        filters: args.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: args.defaultPath ?? 'untitled.md',
      })

      if (result.canceled || !result.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      try {
        await writeFile(result.filePath, args.content, 'utf-8')
        // 返回真实落盘 mtime（渲染端用于下次保存的冲突检测，比 Date.now() 更准）
        let modifiedTime = 0
        try {
          modifiedTime = (await stat(result.filePath)).mtimeMs
        } catch {
          /* stat 失败不阻断，渲染端会降级用当前时间 */
        }
        return {
          ok: true,
          data: {
            path: result.filePath,
            name: result.filePath.split(/[/\\]/).pop() || 'untitled.md',
            modifiedTime,
          },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 保存剪贴板/拖入的图片，返回磁盘路径
  ipcMain.handle(
    CHANNELS.FILE_SAVE_IMAGE,
    async (
      _event,
      args: { dataUrl: string; docPath?: string; workspacePath?: string },
    ) => {
      try {
        const match = args.dataUrl.match(
          /^data:(image\/(png|jpe?g|gif|webp|bmp));base64,(.+)$/i,
        )
        if (!match) {
          return { ok: false, error: { code: 'UNSUPPORTED' } }
        }
        if (match[3].length > MAX_IMAGE_BASE64_LENGTH) {
          return {
            ok: false,
            error: { code: 'TOO_LARGE', message: '图片超过 20MB，无法保存' },
          }
        }
        const ext = match[2].toLowerCase().replace('jpeg', 'jpg')
        const buffer = Buffer.from(match[3], 'base64')
        if (buffer.length > MAX_IMAGE_SIZE) {
          return {
            ok: false,
            error: { code: 'TOO_LARGE', message: '图片超过 20MB，无法保存' },
          }
        }

        // 存储位置：文档旁 attachments/ → 工作区 attachments/ → 用户数据目录
        let dir: string
        if (args.docPath) {
          dir = join(dirname(args.docPath), 'attachments')
        } else if (args.workspacePath) {
          dir = join(args.workspacePath, 'attachments')
        } else {
          dir = join(app.getPath('userData'), 'images')
        }
        await mkdir(dir, { recursive: true })
        const name = `image-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`
        const filePath = join(dir, name)
        await writeFile(filePath, buffer)
        return { ok: true, data: { path: filePath, name } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 同步标题栏覆盖层颜色（Windows 无边框窗口，跟随主题）
  ipcMain.handle(
    CHANNELS.WINDOW_SET_TITLEBAR,
    (event, args: { color: string; symbolColor?: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false }
      if (process.platform === 'win32') {
        try {
          window.setTitleBarOverlay({
            color: args.color,
            symbolColor: args.symbolColor ?? '#5C5850',
            height: 42,
          })
        } catch {
          /* 部分平台不支持 titleBarOverlay，忽略 */
        }
      }
      return { ok: true }
    },
  )

  // 开关拼写检查（会话级；支持选择语言，未提供/不可用时回退 en-US）
  ipcMain.handle(
    CHANNELS.WINDOW_SET_SPELLCHECK,
    (event, args: { enabled: boolean; language?: string } | boolean) => {
      try {
        // 兼容旧版布尔参数调用
        const normalized =
          typeof args === 'boolean' ? { enabled: args } : args
        event.sender.session.setSpellCheckerEnabled(Boolean(normalized.enabled))
        if (normalized.enabled) {
          const avail = event.sender.session.availableSpellCheckerLanguages
          const lang =
            normalized.language && avail.includes(normalized.language)
              ? normalized.language
              : 'en-US'
          event.sender.session.setSpellCheckerLanguages([lang])
        }
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  // 新建窗口（fresh 模式：不恢复/不写入会话，避免多窗口互相覆盖）
  ipcMain.handle(CHANNELS.WINDOW_NEW, () => {
    try {
      createWindow(true)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // 新建窗口并打开指定文件（fresh 模式 + URL 携带文件路径）
  ipcMain.handle(CHANNELS.WINDOW_NEW_WITH_FILE, (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { ok: false, error: { code: 'INVALID_PATH' } }
      }
      createWindow(true, filePath)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // 渲染端同步未保存状态到主进程（关闭时弹原生确认框用，避免静默阻止关闭）
  ipcMain.on(CHANNELS.WINDOW_SET_UNSAVED, (event, unsaved: boolean) => {
    ;(event.sender as unknown as { __unsaved?: boolean }).__unsaved = !!unsaved
  })

  // 导出 PDF：隐藏窗口渲染 HTML 后 printToPDF（支持纸张/页边距/页眉页脚选项）
  ipcMain.handle(
    CHANNELS.FILE_EXPORT_PDF,
    async (
      event,
      args: {
        html: string
        defaultName: string
        options?: {
          pageSize?: 'A4' | 'Letter' | 'A5' | 'Legal'
          margins?: 'narrow' | 'standard' | 'wide'
          headerFooter?: boolean
        }
      },
    ) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      const save = await dialog.showSaveDialog(parent, {
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        defaultPath: args.defaultName,
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      // 隐藏窗口加载文档 HTML，等待渲染完成后打印
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })
      try {
        await printWin.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(args.html)}`,
        )
        // 等图片/字体等资源就绪
        await printWin.webContents.executeJavaScript(
          `new Promise(r => {
            const imgs = Array.from(document.images)
            if (imgs.length === 0) return r(true)
            Promise.all(imgs.map(i => i.complete ? 1 : new Promise(res => {
              i.onload = i.onerror = res
            }))).then(() => r(true))
          })`,
        )
        // 页边距档位 → 英寸（Chromium printToPDF 单位）
        const marginsByLevel = {
          narrow: { top: 0.3, bottom: 0.3, left: 0.35, right: 0.35 },
          standard: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 },
          wide: { top: 1.0, bottom: 1.0, left: 1.0, right: 1.0 },
        } as const
        const margins = marginsByLevel[args.options?.margins ?? 'standard']
        const headerFooter = args.options?.headerFooter ?? false
        // 文件名可能含 HTML 特殊字符，页眉模板拼接前做最小转义
        const title = args.defaultName
          .replace(/\.pdf$/i, '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
        const hfStyle = 'font-size:8px;color:#888;width:100%;padding:0 24px;'
        const pdf = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: args.options?.pageSize ?? 'A4',
          margins,
          displayHeaderFooter: headerFooter,
          headerTemplate: headerFooter
            ? `<div style="${hfStyle}text-align:center;">${title}</div>`
            : '',
          footerTemplate: headerFooter
            ? `<div style="${hfStyle}text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
            : '',
        })
        await writeFile(save.filePath, pdf)
        return { ok: true, data: { path: save.filePath } }
      } catch (err) {
        return { ok: false, error: { code: 'PDF_ERROR', message: String(err) } }
      } finally {
        printWin.close()
      }
    },
  )

  /* ==================== 工作区文件操作 ==================== */

  /** 文件名安全校验：禁止路径分隔符、非法字符和 Windows 保留文件名。 */
  const safeName = (name: unknown): string | null => {
    if (typeof name !== 'string') return null
    const trimmed = name.trim()
    if (
      !trimmed ||
      trimmed === '.' ||
      trimmed === '..' ||
      /[\\/:*?"<>|]/.test(trimmed) ||
      /[. ]$/.test(trimmed) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(trimmed)
    ) {
      return null
    }
    return trimmed
  }

  // 新建文件
  ipcMain.handle(
    CHANNELS.FILE_CREATE,
    async (_event, args: { dir: string; name: string }) => {
      if (!args || typeof args.dir !== 'string' || !args.dir) {
        return { ok: false, error: { code: 'INVALID_TARGET' } }
      }
      const base = safeName(args.name)
      if (!base) return { ok: false, error: { code: 'INVALID_NAME' } }
      const dirStat = await stat(args.dir).catch(() => null)
      if (!dirStat?.isDirectory()) {
        return { ok: false, error: { code: 'INVALID_TARGET' } }
      }
      // 重名时自动编号：新文档.md → 新文档 2.md → 新文档 3.md ...
      const extMatch = base.match(/\.(md|markdown)$/i)
      const ext = extMatch ? extMatch[0] : '.md'
      const stem = extMatch ? base.slice(0, -ext.length) : base
      const initialName = extMatch ? base : `${base}${ext}`
      let name = initialName
      let target = join(args.dir, name)
      let available = false
      for (let index = 1; index <= 1000; index++) {
        name = index === 1 ? initialName : `${stem} ${index}${ext}`
        target = join(args.dir, name)
        try {
          await stat(target)
        } catch {
          available = true
          break
        }
      }
      if (!available) return { ok: false, error: { code: 'NAME_EXHAUSTED' } }
      try {
        const title = name.replace(/\.(md|markdown)$/i, '')
        // 排他创建，防止检查后被其他进程抢先创建时覆盖对方文件。
        await writeFile(target, `# ${title}\n\n`, { encoding: 'utf-8', flag: 'wx' })
        return { ok: true, data: { path: target, name } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 重命名
  ipcMain.handle(
    CHANNELS.FILE_RENAME,
    async (_event, args: { path: string; newName: string }) => {
      if (!args || typeof args.path !== 'string' || !args.path) {
        return { ok: false, error: { code: 'INVALID_PATH' } }
      }
      const name = safeName(args.newName)
      if (!name) return { ok: false, error: { code: 'INVALID_NAME' } }
      const target = join(dirname(args.path), name)
      if (target !== args.path) {
        try {
          await stat(target)
          return { ok: false, error: { code: 'EXISTS' } }
        } catch {
          /* 目标不存在，可以重命名 */
        }
      }
      try {
        await rename(args.path, target)
        // 返回重命名后的 mtime，供渲染端更新冲突检测基线，避免误报"外部修改"
        const modifiedTime = (await stat(target).catch(() => null))?.mtimeMs ?? 0
        return { ok: true, data: { path: target, name, modifiedTime } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 移动文件/文件夹到目标目录（文件树拖拽用）
  ipcMain.handle(
    CHANNELS.FILE_MOVE,
    async (_event, args: { path: string; targetDir: string }) => {
      try {
        if (
          !args ||
          typeof args.path !== 'string' ||
          !args.path ||
          typeof args.targetDir !== 'string' ||
          !args.targetDir
        ) {
          return { ok: false, error: { code: 'INVALID_TARGET' } }
        }
        const src = args.path
        const dir = args.targetDir
        // 目标目录必须存在且不能是源自身/源的子目录（防止移入自身内部）
        const dirStat = await stat(dir).catch(() => null)
        if (!dirStat?.isDirectory()) {
          return { ok: false, error: { code: 'INVALID_TARGET' } }
        }
        const normalizePathForCompare = (value: string) => {
          const normalized = value.replace(/[\\/]+/g, sep)
          return process.platform === 'win32' ? normalized.toLowerCase() : normalized
        }
        const sourceForCompare = normalizePathForCompare(src)
        const targetDirForCompare = normalizePathForCompare(dir)
        if (
          targetDirForCompare === sourceForCompare ||
          targetDirForCompare.startsWith(sourceForCompare + sep)
        ) {
          return { ok: false, error: { code: 'INVALID_TARGET' } }
        }
        const target = join(dir, basename(src))
        if (target !== src) {
          const exists = await stat(target).catch(() => null)
          if (exists) return { ok: false, error: { code: 'EXISTS' } }
        }
        await rename(src, target)
        const modifiedTime = (await stat(target).catch(() => null))?.mtimeMs ?? 0
        return {
          ok: true,
          data: { path: target, name: basename(target), modifiedTime },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 仅读取文件 mtime（草稿恢复前校验基线新鲜度用，避免整文件重读）
  ipcMain.handle(CHANNELS.FILE_STAT, async (_event, filePath: string) => {
    try {
      const st = await stat(filePath)
      return { ok: true, data: { modifiedTime: st.mtimeMs } }
    } catch {
      return { ok: false, error: { code: 'NOT_FOUND' } }
    }
  })

  // 删除（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE, async (_event, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return { ok: true, data: { name: basename(filePath) } }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 列出指定目录下的图片文件（图片管理面板）
  ipcMain.handle(CHANNELS.FILE_LIST_IMAGES, async (_event, dirs: string[]) => {
    const images: { path: string; name: string; size: number }[] = []
    const scanned = new Set<string>()
    for (const dir of dirs) {
      if (scanned.has(dir)) continue
      scanned.add(dir)
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (!e.isFile()) continue
          if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(e.name)) continue
          const p = join(dir, e.name)
          const st = await stat(p).catch(() => null)
          images.push({ path: p, name: e.name, size: st?.size ?? 0 })
        }
      } catch {
        /* 目录不存在则跳过 */
      }
    }
    return { ok: true, data: { images } }
  })

  // 删除图片（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE_IMAGE, async (_event, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 工作区全文搜索（基础版，低优15）：扫描全部 .md 文件，逐行子串/正则匹配
  ipcMain.handle(
    CHANNELS.FILE_SEARCH_WORKSPACE,
    async (
      _event,
      args: {
        dir: string
        query: string
        caseSensitive?: boolean
        regex?: boolean
      },
    ) => {
      try {
        if (
          !args ||
          typeof args.dir !== 'string' ||
          !args.dir ||
          typeof args.query !== 'string'
        ) {
          return { ok: false, error: { code: 'INVALID_TARGET' } }
        }
        const dirStat = await stat(args.dir).catch(() => null)
        if (!dirStat) {
          return { ok: false, error: { code: 'NOT_FOUND' } }
        }
        if (!dirStat.isDirectory()) {
          return { ok: false, error: { code: 'NOT_DIRECTORY' } }
        }

        const q = args.query.trim()
        if (!q) return { ok: true, data: { matches: [], truncated: false } }
        if (q.length > MAX_SEARCH_QUERY_LENGTH) {
          return {
            ok: false,
            error: { code: 'QUERY_TOO_LONG', message: '搜索关键词不能超过 256 个字符' },
          }
        }
        // 正则模式：先验证表达式合法性，非法时直接报错由渲染端提示
        if (args.regex) {
          try {
            new RegExp(q, args.caseSensitive ? '' : 'i')
          } catch {
            return {
              ok: false,
              error: { code: 'INVALID_REGEX', message: '正则表达式不合法' },
            }
          }
        }
        const tree = await walkMarkdownTree(args.dir, 0)
        // 展平树取全部文件路径
        const paths: string[] = []
        const flatten = (nodes: FolderTreeNode[]) => {
          for (const n of nodes) {
            if (n.children) flatten(n.children)
            else paths.push(n.path)
          }
        }
        flatten(tree)

        const needle = args.caseSensitive ? q : q.toLowerCase()
        const matches: { path: string; line: number; preview: string }[] = []
        let truncated = false
        const regexWorker = args.regex
          ? new Worker(WORKSPACE_REGEX_WORKER_SOURCE, { eval: true })
          : null
        try {
          // 规模守卫：最多扫 500 个文件、单文件 2MB、总命中 200 条
          for (const p of paths.slice(0, 500)) {
            const st = await stat(p).catch(() => null)
            if (!st || st.size > 2 * 1024 * 1024) continue

            if (regexWorker) {
              const { content } = await readTextAutoEncoding(p)
              const regexMatches = await searchRegexInWorker(
                regexWorker,
                content,
                q,
                Boolean(args.caseSensitive),
                200 - matches.length,
              )
              for (const match of regexMatches) {
                matches.push({ path: p, ...match })
              }
              if (matches.length >= 200) {
                truncated = true
                break
              }
              continue
            }

            // 索引缓存：mtime 与 size 均未变时复用已拆分的行，避免重复读盘解码
            let lines: string[]
            const cached = searchLineCache.get(p)
            if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
              lines = cached.lines
            } else {
              const { content } = await readTextAutoEncoding(p)
              lines = content.split(/\r?\n/)
              if (st.size <= SEARCH_CACHE_FILE_MAX) {
                cacheSearchLines(p, { mtimeMs: st.mtimeMs, size: st.size, lines })
              }
            }
            for (let i = 0; i < lines.length; i++) {
              const candidate = args.caseSensitive ? lines[i] : lines[i].toLowerCase()
              if (!candidate.includes(needle)) continue
              matches.push({
                path: p,
                line: i + 1,
                preview: lines[i].trim().slice(0, 120),
              })
              if (matches.length >= 200) {
                truncated = true
                break
              }
            }
            if (truncated) break
          }
          return { ok: true, data: { matches, truncated } }
        } catch (err) {
          if (err instanceof Error && err.message === 'REGEX_TIMEOUT') {
            return {
              ok: false,
              error: {
                code: 'REGEX_TIMEOUT',
                message: '正则表达式匹配超时，请简化表达式',
              },
            }
          }
          throw err
        } finally {
          void regexWorker?.terminate()
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 读取设置
  ipcMain.handle(CHANNELS.SETTINGS_GET, async (_event, key: string) => {
    try {
      return { ok: true, data: await getSetting(key) }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 写入设置
  ipcMain.handle(
    CHANNELS.SETTINGS_SET,
    async (_event, args: { key: string; value: unknown }) => {
      try {
        await setSetting(args.key, args.value)
        return { ok: true }
      } catch (err) {
        if (err instanceof SettingsStoreError) {
          return { ok: false, error: { code: err.code } }
        }
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 草稿逐篇原子更新，避免多个标签或窗口以旧草稿字典覆盖彼此内容
  ipcMain.handle(
    CHANNELS.SETTINGS_UPSERT_DRAFT,
    async (_event, args: { id: string; content: string }) => {
      if (
        !args ||
        typeof args.id !== 'string' ||
        !args.id ||
        args.id.length > 512 ||
        typeof args.content !== 'string'
      ) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      try {
        await upsertDraft(args.id, args.content)
        return { ok: true }
      } catch (err) {
        if (err instanceof SettingsStoreError) {
          return { ok: false, error: { code: err.code } }
        }
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  ipcMain.handle(CHANNELS.SETTINGS_DELETE_DRAFT, async (_event, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 512) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
    }
    try {
      await deleteDraft(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  /* ==================== 多格式导出（pandoc 基础框架） ==================== */

  // 通过 pandoc 导出 Word/LaTeX/纯文本/EPUB；未安装 pandoc 时返回 PANDOC_NOT_FOUND
  ipcMain.handle(
    CHANNELS.FILE_EXPORT_PANDOC,
    async (
      event,
      args: { markdown: string; defaultTitle: string },
    ) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      // 检测 pandoc 是否可用（首次调用时探测，结果缓存；并发调用共享同一探测）
      pandocCheck ??= execFileAsync('pandoc', ['--version'])
        .then(() => true)
        .catch(() => false)
      if (!(await pandocCheck)) {
        return { ok: false, error: { code: 'PANDOC_NOT_FOUND' } }
      }

      const save = await dialog.showSaveDialog(parent, {
        filters: [
          { name: 'Word', extensions: ['docx'] },
          { name: 'EPUB', extensions: ['epub'] },
          { name: 'LaTeX', extensions: ['tex'] },
          { name: '纯文本', extensions: ['txt'] },
        ],
        defaultPath: `${args.defaultTitle}.docx`,
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      // 扩展名 → pandoc 输出格式
      const fmtMap: Record<string, string> = {
        docx: 'docx',
        epub: 'epub',
        tex: 'latex',
        txt: 'plain',
      }
      const fmt = fmtMap[extname(save.filePath).slice(1).toLowerCase()]
      if (!fmt) return { ok: false, error: { code: 'UNSUPPORTED' } }

      // 写入临时 .md 后调用 pandoc（避免超长命令行参数）
      const tmpIn = join(app.getPath('temp'), `mdsoft-${Date.now()}.md`)
      try {
        await writeFile(tmpIn, args.markdown, 'utf-8')
        await execFileAsync('pandoc', [
          '-f',
          'markdown',
          '-t',
          fmt,
          tmpIn,
          '-o',
          save.filePath,
        ])
        return { ok: true, data: { path: save.filePath } }
      } catch (err) {
        return { ok: false, error: { code: 'PANDOC_ERROR', message: String(err) } }
      } finally {
        await unlink(tmpIn).catch(() => {})
      }
    },
  )

  // 选择本地 CSS 文件并读取内容（自定义主题导入）
  ipcMain.handle(CHANNELS.FILE_PICK_CSS, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }
    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'CSS', extensions: ['css'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELLED' } }
    }
    try {
      const filePath = result.filePaths[0]
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        return { ok: false, error: { code: 'IO_ERROR', message: '选择的不是普通文件' } }
      }
      // 必须在 readFile 前检查，避免误选超大文件造成内存峰值。
      if (fileStat.size > MAX_CSS_FILE_SIZE) {
        return { ok: false, error: { code: 'TOO_LARGE', message: 'CSS 文件过大（>1MB）' } }
      }
      const content = await readFile(filePath, 'utf-8')
      // 读取期间文件可能被替换，再次校验避免超限内容进入渲染进程。
      if (Buffer.byteLength(content, 'utf-8') > MAX_CSS_FILE_SIZE) {
        return { ok: false, error: { code: 'TOO_LARGE', message: 'CSS 文件过大（>1MB）' } }
      }
      return {
        ok: true,
        data: { name: basename(filePath), content },
      }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 图床上传（基础框架：支持 SM.MS，未配置时返回 NOT_CONFIGURED 由渲染端降级本地）
  ipcMain.handle(
    CHANNELS.IMAGE_UPLOAD,
    async (_event, args: { dataUrl: string }) => {
      try {
        const match = args.dataUrl.match(
          /^data:(image\/(png|jpe?g|gif|webp|bmp));base64,(.+)$/i,
        )
        if (!match) return { ok: false, error: { code: 'UNSUPPORTED' } }
        if (match[3].length > MAX_IMAGE_BASE64_LENGTH) {
          return {
            ok: false,
            error: { code: 'TOO_LARGE', message: '图片超过 20MB，无法上传图床' },
          }
        }
        // 配置存于主进程 settings，避免 token 在渲染进程暴露
        const cfg = (await getSetting('imageHost')) as
          | { provider?: string; token?: string }
          | undefined
        if (cfg?.provider !== 'smms' || !cfg.token) {
          return { ok: false, error: { code: 'NOT_CONFIGURED' } }
        }
        const ext = match[2].toLowerCase().replace('jpeg', 'jpg')
        const buffer = Buffer.from(match[3], 'base64')
        // 体积守卫：超大图片拒绝上传，避免内存峰值与图床拒绝
        if (buffer.length > 20 * 1024 * 1024) {
          return { ok: false, error: { code: 'TOO_LARGE', message: '图片超过 20MB，无法上传图床' } }
        }
        const form = new FormData()
        form.append(
          'smfile',
          new Blob([buffer], { type: match[1] }),
          `image-${Date.now()}.${ext}`,
        )
        const resp = await fetch('https://sm.ms/api/v2/upload', {
          method: 'POST',
          headers: { Authorization: cfg.token },
          body: form,
        })
        const json = (await resp.json()) as {
          success?: boolean
          data?: { url?: string }
          message?: string
          images?: string
        }
        if (json.success && json.data?.url) {
          return { ok: true, data: { url: json.data.url } }
        }
        // 重复图片：SM.MS 会在 message 中返回已有链接
        const dup = json.message?.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp)/i)
        if (dup) return { ok: true, data: { url: dup[0] } }
        return {
          ok: false,
          error: { code: 'UPLOAD_FAILED', message: json.message ?? '上传失败' },
        }
      } catch (err) {
        return { ok: false, error: { code: 'UPLOAD_FAILED', message: String(err) } }
      }
    },
  )
}
