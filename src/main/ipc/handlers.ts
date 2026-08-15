import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron'
import { chmod, readFile, writeFile, stat, lstat, readdir, mkdir, rename, unlink, realpath, open } from 'fs/promises'
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
import { allowImageDirectory, isImageDirAllowed, readImageAsDataUrl } from '../image-protocol'
import { isFileTrustedForSave, isPathTrusted, trustDirectory, trustFileForSave } from '../trusted-paths'
import { restoreTrustFromDisk, schedulePersistTrust } from '../session-trust'
import { setWebContentsUnsaved } from '../unsaved'

const execFileAsync = promisify(execFile)

/**
 * L8：路径必须属于已授权根（已打开的文档/工作区、会话恢复路径、
 * 用户经原生对话框选择的目录、应用自有目录）。渲染进程无法自行授权，
 * 阻断未来 XSS 把文件 IPC 变成全盘读写删。
 */
const ensureTrusted = (path: unknown): boolean =>
  typeof path === 'string' && path.length > 0 && isPathTrusted(path)

/**
 * 工作区搜索行缓存（基础索引）：path → { mtimeMs, size, lines }。
 * mtime+size 均未变时直接复用已拆分的行，重复搜索免重读磁盘；
 * 文件修改/删除/移动后缓存自动失效或不再被树命中，无需主动清理。
 */
const searchLineCache = new Map<
  string,
  { mtimeMs: number; size: number; lines: string[]; bytes: number }
>()
/** 最近读取/写入的文件状态（保存冲突检测用）：path → { mtimeMs, size }。
 *  主进程是唯一读写入口，读时建立、写后更新；mtime 或 size 与记录不符即为外部修改。 */
const lastKnownFileState = new Map<string, { mtimeMs: number; size: number }>()
/** 冲突检测状态条目上限：防止长会话里被改名/删除的旧路径无限累积 */
const MAX_FILE_STATE_ENTRIES = 4096
/** 同路径并发保存互斥（T-OCTOU）：按 path 串行化 FILE_SAVE 的完整写盘流程 */
const saveLocks = new Map<string, Promise<unknown>>()

// ---- Y-M3：跨进程保存锁 ----
// 多窗口模式（multiWindowMode=true）下多个主进程并存，各自的 saveLocks
// 互相不可见，同路径并发保存仍会互相覆盖。用独占创建 <path>.mkedit-save-lock
// 文件实现跨进程互斥：创建成功者持锁（写入 pid + 时间戳），竞争者轮询等待；
// 锁 mtime 超时且持有者进程不存活（崩溃残留）→ 删除抢锁；总等待超时放弃。
const SAVE_LOCK_STALE_MS = 10_000
const SAVE_LOCK_WAIT_MS = 30_000
const SAVE_LOCK_POLL_MS = 60

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireCrossProcessSaveLock(
  filePath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.mkedit-save-lock`
  const deadline = Date.now() + SAVE_LOCK_WAIT_MS
  for (;;) {
    try {
      const fh = await open(lockPath, 'wx')
      try {
        await fh.writeFile(`${process.pid}\n${Date.now()}\n`)
      } finally {
        await fh.close()
      }
      return async () => {
        await unlink(lockPath).catch(() => {})
      }
    } catch {
      // 创建失败 = 锁已被占用；检查是否崩溃残留（持有者已退出）
      try {
        const lockStat = await stat(lockPath)
        if (Date.now() - lockStat.mtimeMs > SAVE_LOCK_STALE_MS) {
          const raw = await readFile(lockPath, 'utf-8').catch(() => '')
          const holderPid = Number.parseInt(raw.split('\n')[0] ?? '', 10)
          if (!isProcessAlive(holderPid)) {
            await unlink(lockPath).catch(() => {})
            continue // 已删除残留锁，重试竞争
          }
        }
      } catch {
        // 锁文件已被对方正常释放，继续竞争
      }
      if (Date.now() >= deadline) {
        throw new Error('SAVE_LOCK_TIMEOUT')
      }
      await new Promise((resolve) => setTimeout(resolve, SAVE_LOCK_POLL_MS))
    }
  }
}
const rememberFileState = (
  path: string,
  state: { mtimeMs: number; size: number },
): void => {
  if (lastKnownFileState.has(path)) {
    lastKnownFileState.set(path, state)
    return
  }
  if (lastKnownFileState.size >= MAX_FILE_STATE_ENTRIES) {
    const oldest = lastKnownFileState.keys().next().value
    if (oldest !== undefined) lastKnownFileState.delete(oldest)
  }
  lastKnownFileState.set(path, state)
}
/** 缓存条目上限：超出时淘汰最早插入的条目（Map 保持插入顺序） */
const SEARCH_CACHE_MAX = 1000
/** 搜索行缓存总大小上限，防止大量中等大小 Markdown 长期占用主进程内存 */
const SEARCH_CACHE_MAX_BYTES = 32 * 1024 * 1024
/** 单文件超过该体积不入缓存，控制最坏内存占用（1000 × 512KB） */
const SEARCH_CACHE_FILE_MAX = 512 * 1024
/** 剪贴板/拖入图片的最大体积，与图床上传限制保持一致 */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
/**
 * Base64 载荷严格校验（L6）：Buffer.from 会静默忽略非法字符，
 * 损坏的剪贴板数据会写出截断图片却报保存成功。要求标准字母表 +
 * 尾部 0-2 个填充符 + 长度对齐；应用自身生成的 data URL 均为标准
 * 带填充 base64，过严只影响本就不应存在的损坏数据。
 */
const isValidBase64Payload = (payload: string): boolean => {
  if (!payload || payload.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(payload)
}
/** 单篇 Markdown 文档读取上限，避免误选超大文件拖垮主进程与编辑器。 */
const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024
/** 导出载荷上限（PDF/HTML 等）：内联 base64 图片后远超原文，放宽到 100MB 仅防失控写出 */
const MAX_EXPORT_FILE_SIZE = 100 * 1024 * 1024
/** Base64 解码前的长度上限，避免超大 IPC 载荷先造成主进程内存峰值 */
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_IMAGE_SIZE * 4) / 3) + 4
/** 自定义主题 CSS 上限，防止误选大文件阻塞主进程或渲染进程。 */
const MAX_CSS_FILE_SIZE = 1024 * 1024
/** 工作区搜索查询长度上限，避免正则与逐行匹配消耗失控 */
const MAX_SEARCH_QUERY_LENGTH = 256
/** 单个文件的正则匹配时间上限，防止灾难性回溯阻塞主进程 */
const MAX_REGEX_FILE_TIME_MS = 500
/** 图片管理最多扫描的目录数，避免异常 IPC 参数导致大量目录遍历 */
const MAX_IMAGE_LIST_DIRS = 20
/** 图片管理最多返回的图片数，避免大量缩略图阻塞渲染进程 */
const MAX_IMAGE_LIST_COUNT = 1000
const MAX_IMAGE_HOST_TOKEN_LENGTH = 2048

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

/** UTF-32 等无法安全往返的编码：拒绝打开而非静默乱码后不可逆改写（见 readTextAutoEncoding） */
class UnsupportedEncodingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedEncodingError'
  }
}

/**
 * 无 BOM UTF-16 探测（Y-L2）：0x00 字节占比集中在一侧时判定为 UTF-16。
 * 无 BOM UTF-16 文件若落入 GBK 宽松解码会乱码，保存时写回 GBK 编码把
 * 原文件不可逆损坏。抽样前 8KB 统计（大文件全量统计收益有限）。
 * UTF-16LE 的零字节在奇数位（ASCII/标点的高字节），BE 反之。
 */
function detectUtf16NoBom(buf: Buffer): 'UTF-16LE' | 'UTF-16BE' | null {
  if (buf.length < 4 || buf.length % 2 !== 0) return null
  const sampleLen = Math.min(buf.length, 8192)
  let evenZeros = 0
  let oddZeros = 0
  const pairs = Math.floor(sampleLen / 2)
  for (let i = 0; i < pairs; i++) {
    if (buf[i * 2] === 0) evenZeros++
    if (buf[i * 2 + 1] === 0) oddZeros++
  }
  const le = oddZeros / pairs
  const be = evenZeros / pairs
  // 一侧占主导（≥30%）且另一侧 ≤5%：ASCII/中文混合 UTF-16 的零字节
  // 集中在同一侧；纯中文场景零字节占比低（仅换行符），由 GBK 分支的
  // NUL 兜底检测补上
  if (le >= 0.3 && be <= 0.05) return 'UTF-16LE'
  if (be >= 0.3 && le <= 0.05) return 'UTF-16BE'
  return null
}

/**
 * 自动探测编码读取文本：优先按 BOM 判定（UTF-8 / UTF-16LE / UTF-16BE / UTF-32），
 * 无 BOM 时先按严格 UTF-8 解码，失败则按 GBK 宽松解码（带替换符）。
 * UTF-16 正确解码并标记编码，保存时写回原编码（BOM 保留）；UTF-32 无法用
 * 原生/iconv 往返，明确拒绝打开——否则乱码解码后一次保存就把原文件
 * 不可逆地改写为乱码内容。
 */
async function readTextAutoEncoding(
  filePath: string,
): Promise<{ content: string; encoding: string }> {
  const buf = await readFile(filePath)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00) {
    throw new UnsupportedEncodingError('UTF-32LE 编码暂不支持，请先转为 UTF-8')
  }
  if (buf.length >= 4 && buf[0] === 0xfe && buf[1] === 0xff && buf[2] === 0x00 && buf[3] === 0x00) {
    throw new UnsupportedEncodingError('UTF-32BE 编码暂不支持，请先转为 UTF-8')
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16LE' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { content: iconv.decode(buf.subarray(2), 'utf-16be'), encoding: 'UTF-16BE' }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    // Y-L1：带 BOM 的 UTF-8 记独立编码，保存时写回 BOM——
    // 原实现剥 BOM 后按 'UTF-8' 保存，BOM 被静默丢弃（字节级改写文件，
    // 依赖 BOM 的工具链会误判编码）
    return { content: buf.subarray(3).toString('utf-8'), encoding: 'UTF-8-BOM' }
  }
  // Y-L2：无 BOM 的 UTF-16（Windows 记事本"UTF-16 LE"另存等来源）
  const utf16 = detectUtf16NoBom(buf)
  if (utf16 === 'UTF-16LE') {
    return { content: buf.toString('utf16le'), encoding: 'UTF-16LE' }
  }
  if (utf16 === 'UTF-16BE') {
    return { content: iconv.decode(buf, 'utf-16be'), encoding: 'UTF-16BE' }
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' }
  } catch {
    const decoded = new TextDecoder('gbk').decode(buf)
    // Y-L2 兜底：GBK 解码出 NUL 控制字符 = 原始字节含大量 0x00（UTF-16 特征）。
    // 纯中文无 BOM UTF-16 零字节占比低（仅换行符 0A 00），直接探测漏检，
    // 但 GBK 解码必产生 NUL；正常 GBK 文件不含 NUL
    if (decoded.includes('\u0000')) {
      const fallback = detectUtf16NoBom(buf)
      if (fallback === 'UTF-16LE') {
        return { content: buf.toString('utf16le'), encoding: 'UTF-16LE' }
      }
      if (fallback === 'UTF-16BE') {
        return { content: iconv.decode(buf, 'utf-16be'), encoding: 'UTF-16BE' }
      }
    }
    // 非严格 UTF-8：按 GBK 宽松解码（无 BOM 时的旧行为；GBK 解码永不抛错，
    // 此分支即为最终兜底，不再需要"宽松 UTF-8"第三分支）
    return { content: decoded, encoding: 'GBK' }
  }
}

/** 同目录临时文件替换，避免写入中断时损坏用户原文。 */
async function writeFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  mode?: number,
): Promise<void> {
  // L7：符号链接保存写穿——rename 替换的是链接本身，真实目标收不到新内容。
  // 检测到链接时解析真实路径，原子替换真实目标，链接保持不变。
  let target = filePath
  try {
    const linkStat = await lstat(filePath)
    if (linkStat.isSymbolicLink()) {
      const real = await realpath(filePath).catch(() => null)
      if (real) target = real
    }
  } catch {
    /* 文件不存在则按普通文件处理 */
  }
  const tempPath = join(
    dirname(target),
    `.${basename(target)}.${process.pid}-${Date.now()}-${Math.random()}.tmp`,
  )
  try {
    await writeFile(tempPath, content)
    if (mode !== undefined && process.platform !== 'win32') {
      await chmod(tempPath, mode & 0o777).catch(() => {})
    }
    await rename(tempPath, target)
  } catch (err) {
    await unlink(tempPath).catch(() => {})
    throw err
  }
}

/** 目录树节点（只含 .md 文件与含 .md 的文件夹） */
interface FolderTreeNode {
  name: string
  path: string
  children?: FolderTreeNode[]
}

const MAX_TREE_DEPTH = 5
/** 目录树节点总量上限：数万目录时主进程长时间阻塞，全部 IPC 卡死（保存排队、自动保存基线过期） */
const MAX_TREE_NODES = 2000

interface TreeBudget {
  nodes: number
  truncated: boolean
}

/** 递归扫描目录，只保留 Markdown 文件与含 Markdown 的文件夹 */
async function walkMarkdownTree(
  dir: string,
  depth: number,
  budget: TreeBudget,
): Promise<FolderTreeNode[]> {
  if (depth > MAX_TREE_DEPTH || budget.truncated) return []
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
    if (budget.truncated) break
    const children = await walkMarkdownTree(join(dir, d.name), depth + 1, budget)
    // 空文件夹（无 Markdown 内容）不展示
    if (children.length > 0) {
      nodes.push({ name: d.name, path: join(dir, d.name), children })
      budget.nodes++
      if (budget.nodes >= MAX_TREE_NODES) {
        budget.truncated = true
        break
      }
    }
  }
  if (budget.truncated) return nodes
  for (const f of files) {
    nodes.push({ name: f.name, path: join(dir, f.name) })
    budget.nodes++
    if (budget.nodes >= MAX_TREE_NODES) {
      budget.truncated = true
      break
    }
  }
  return nodes
}

export function registerIpcHandlers(): void {
  // 应用自有图片目录（未保存文档的粘贴图片存储处）始终授信；
  // 它在每个新进程中由保存流程重建信任，此处显式登记避免图片管理面板 404。
  trustDirectory(join(app.getPath('userData'), 'images'), { essential: true })
  // 会话恢复路径预授权——新进程的信任根初始为空，渲染端恢复会话时
  // FILE_READ/SEARCH 等必须能命中上次会话已打开的文档与工作区。
  // H 修复：信任清单来自主进程私有的 trusted-roots.json（用户真实授权后
  // 由主进程写入，渲染层无法伪造），而非渲染层可写的 settings.json 会话字段——
  // 否则 XSS 可伪造 workspacePath 使任意目录在重启后获得完整信任。
  void restoreTrustFromDisk().then((restored) => {
    if (restored) return
    // 升级迁移兜底：首次升级无持久化清单时，回退到会话文件的文件级信任
    // （散档可恢复）；绝不信任会话里的工作区路径——那是渲染层可写的字段
    void getSetting('session').then((raw) => {
      const session = raw as { files?: { path?: string }[] } | undefined
      const files = session?.files ?? []
      for (let i = files.length - 1; i >= 0; i--) {
        const p = files[i]?.path
        if (typeof p === 'string' && p) {
          allowImageDirectory(dirname(p))
          trustFileForSave(p)
        }
      }
    })
  })

  // pandoc 可用性探测结果缓存（缓存 Promise 本身，避免首次探测期间的并发误报）。
  // 带 TTL：会话中途安装/修复 pandoc 后能再次探测，不必等重启
  let pandocCheck: Promise<boolean> | null = null
  let pandocCheckAt = 0
  const PANDOC_CHECK_TTL_MS = 60_000
  const getImageHostStatus = async (): Promise<{
    provider: 'local' | 'smms'
    configured: boolean
  }> => {
    const config = (await getSetting('imageHost')) as
      | { provider?: unknown; token?: unknown }
      | undefined
    const provider = config?.provider === 'smms' ? 'smms' : 'local'
    return {
      provider,
      configured: provider === 'smms' && typeof config?.token === 'string' && Boolean(config.token),
    }
  }

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
      // H1 修复：对话框选择 = 用户明确授权，授完整信任根；
      // 该文件本身另加入文件级保存白名单
      trustDirectory(dirname(filePath))
      // Y-L4：目录信任根非保底（64 上限，最早淘汰）——打开第 65 个目录后
      // 最早的根被淘汰，已打开文件的 mdimg 图片读取随之失效（图片破图）。
      // 图片读取白名单独立于 trustedRoots 再登记一份（只读权限，不扩大攻击面），
      // 即使目录信任被淘汰，文档里的图片仍可显示
      allowImageDirectory(dirname(filePath))
      trustFileForSave(filePath)
      schedulePersistTrust()
      rememberFileState(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size })
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
      if (err instanceof UnsupportedEncodingError) {
        return { ok: false, error: { code: 'UNSUPPORTED_ENCODING', message: err.message } }
      }
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
      // L8：带路径打开（会话恢复）必须属于已授权根；对话框选择的目录在下方授信
      if (args?.path && !ensureTrusted(folderPath)) {
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
        const budget: TreeBudget = { nodes: 0, truncated: false }
        const children = await walkMarkdownTree(folderPath, 0, budget)
        // H1 修复：工作区目录授完整信任（树内文件需读/写/删/搜/图）。
        // essential：工作区是本次会话的操作中心，不能因随后打开过 64+ 个
        // 其它目录被容量淘汰而失效（B-M1）
        trustDirectory(folderPath, { essential: true })
        // 立即持久化：工作区是会话恢复的关键路径，等防抖可能赶上进程退出
        schedulePersistTrust(true)
        return {
          ok: true,
          data: {
            path: folderPath,
            name: folderPath.split(/[/\\]/).pop() || 'workspace',
            tree: children,
            // L3：超出节点上限时截断并告知渲染端
            truncated: budget.truncated,
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
    // L8：仅 .md/.markdown 允许"拖入/会话恢复"的首次授信路径
    // （真实 OS 拖拽才带 File.path，会话路径已在启动时预授权）；
    // 其余扩展名必须已属于授权根
    if (!/\.(md|markdown)$/i.test(filePath) && !ensureTrusted(filePath)) {
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
      // H1 修复：拖入/会话恢复的 .md 只授其目录"图片读取"权限（allowImageDirectory），
      // 该文件本身加入文件级保存白名单——不再因读取一个 .md 而获得目录写/删/搜权限
      allowImageDirectory(dirname(filePath))
      trustFileForSave(filePath)
      schedulePersistTrust()
      rememberFileState(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size })
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
      if (err instanceof UnsupportedEncodingError) {
        return { ok: false, error: { code: 'UNSUPPORTED_ENCODING', message: err.message } }
      }
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 导出 HTML/PDF 内联图片：把受信任 mdimg:// URL 读为 base64（只读）。
  // 渲染层 fetch() 自定义 scheme 被 Blink 拒绝（TypeError），必须走主进程；
  // 信任校验与 mdimg 协议完全一致（readImageAsDataUrl 内部 realpath 双重校验）
  ipcMain.handle(CHANNELS.FILE_READ_IMAGE_INLINE, async (_event, src: string) => {
    if (typeof src !== 'string' || !src.startsWith('mdimg://')) {
      return { ok: false, error: { code: 'INVALID_PATH' } }
    }
    try {
      const dataUrl = await readImageAsDataUrl(src)
      if (!dataUrl) return { ok: false, error: { code: 'INVALID_PATH' } }
      return { ok: true, data: { dataUrl } }
    } catch {
      return { ok: false, error: { code: 'IO_ERROR' } }
    }
  })

  // 保存文件（带外部冲突检测：磁盘 mtime 比预期新则拒绝，避免静默覆盖）
  type SaveArgs = {
    path: string
    content: string
    expectedMtime?: number
    /** 源文件编码：GBK/UTF-16 文件写回原编码，其余/缺省为 UTF-8 */
    encoding?: string
  }
  type SaveResult =
    | { ok: true; data: { modifiedTime: number } }
    | { ok: false; error: { code: string; message?: string } }

  /** FILE_SAVE 的完整写盘流程（stat 校验 → 编码写回 → 更新基线）。
   *  经 saveLocks 按 path 串行执行，防止同路径双窗口并发保存互相覆盖（T-OCTOU）；
   *  外层再加跨进程文件锁，覆盖多窗口模式（多个主进程并存）下的并发保存。 */
  const performFileSave = async (args: SaveArgs): Promise<SaveResult> => {
    let releaseLock: (() => Promise<void>) | null = null
    try {
      releaseLock = await acquireCrossProcessSaveLock(args.path)
    } catch {
      return {
        ok: false,
        error: { code: 'SAVE_LOCKED', message: '另一个窗口正在保存该文件，请稍后重试' },
      }
    }
    try {
      const pre = await stat(args.path).catch(() => null)
      if (!pre) {
        return { ok: false, error: { code: 'NOT_FOUND' } }
      }
      // 冲突检测（H6）：磁盘 mtime 明显比预期新、或文件尺寸与最近一次读/写不一致，
      // 均视为被外部修改，拒绝写入避免静默覆盖。
      // - mtime 容差 500ms 仅吸收本应用连续保存的时间戳抖动（NTFS 纳秒精度无需大容差）；
      // - 尺寸维度可捕获 FAT32 同时间片内被编辑、以及 git checkout / cp -p 等
      //   旧 mtime 的外部修改（此前 3 秒无条件容差会让这些修改被静默覆盖）。
      const known = lastKnownFileState.get(args.path)
      const conflict =
        (typeof args.expectedMtime === 'number' &&
          pre.mtimeMs > args.expectedMtime + 500) ||
        (known !== undefined && pre.size !== known.size)
      if (conflict) {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: '文件已被外部修改' },
        }
      }
      // 编码写回：UTF-16 保持原编码（BOM 保留）；GBK 写回原编码并做往返校验，
      // 无法映射的字符拒绝写入；带 BOM 的 UTF-8 写回 BOM（Y-L1，读取时记
      // 'UTF-8-BOM' 保存时不丢失）；其余统一 UTF-8
      if (args.encoding === 'UTF-8-BOM') {
        await writeFileAtomically(args.path, `\uFEFF${args.content}`, pre.mode)
      } else if (args.encoding === 'UTF-16LE' || args.encoding === 'UTF-16BE') {
        const bom =
          args.encoding === 'UTF-16LE'
            ? Buffer.from([0xff, 0xfe])
            : Buffer.from([0xfe, 0xff])
        const body =
          args.encoding === 'UTF-16LE'
            ? Buffer.from(args.content, 'utf16le')
            : iconv.encode(args.content, 'utf-16be')
        await writeFileAtomically(args.path, Buffer.concat([bom, body]), pre.mode)
      } else if (args.encoding === 'GBK') {
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
        await writeFileAtomically(args.path, encoded, pre.mode)
      } else {
        await writeFileAtomically(args.path, args.content, pre.mode)
      }
      const fileStat = await stat(args.path)
      rememberFileState(args.path, { mtimeMs: fileStat.mtimeMs, size: fileStat.size })
      return { ok: true, data: { modifiedTime: fileStat.mtimeMs } }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    } finally {
      await releaseLock?.()
    }
  }

  ipcMain.handle(
    CHANNELS.FILE_SAVE,
    async (_event, args: SaveArgs) => {
      try {
        // L8：保存目标必须属于已授权根（打开的文档/对话框另存的位置），
        // 或为本应用读取过的 .md 精确文件（拖入/会话恢复，见 trusted-paths.ts）
        if (!ensureTrusted(args.path) && !isFileTrustedForSave(args.path)) {
          return { ok: false, error: { code: 'INVALID_PATH' } }
        }
        // L6：写入前校验体积，与打开上限保持一致——
        // 渲染端异常（内存溢出回写、循环拼接）不能写出超限文件
        if (Buffer.byteLength(args.content ?? '', 'utf-8') > MAX_DOCUMENT_FILE_SIZE) {
          return {
            ok: false,
            error: { code: 'TOO_LARGE', message: 'Markdown 文件超过 20MB，无法保存' },
          }
        }
        // 同路径并发保存互斥：双窗口（同进程）保存同一文件时，双方的冲突检测
        // stat 都落在对方写入之前，最后写入者会静默覆盖对方内容（T-OCTOU）。
        // 按 path 串行化完整写盘流程；互斥条目随任务结束清理，不累积。
        const previous = saveLocks.get(args.path) ?? Promise.resolve()
        const task = previous.then(() => performFileSave(args))
        const tracked = task.catch(() => undefined)
        saveLocks.set(args.path, tracked)
        try {
          return await task
        } finally {
          if (saveLocks.get(args.path) === tracked) saveLocks.delete(args.path)
        }
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

      // 载荷与参数前置校验（args 为 null 时返回错误结构而非抛错，与全项目约定一致）
      const content = args?.content
      if (typeof content !== 'string') {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      const filters = args?.filters ?? [{ name: 'Markdown', extensions: ['md'] }]
      const defaultPath = args?.defaultPath ?? 'untitled.md'
      // 另存上限：.md 类与文档打开上限一致；导出（HTML 等，内联图片可远超原文）
      // 放宽到导出上限，仅阻止失控写出
      const cap = /\.(md|markdown)$/i.test(defaultPath)
        ? MAX_DOCUMENT_FILE_SIZE
        : MAX_EXPORT_FILE_SIZE
      if (Buffer.byteLength(content, 'utf-8') > cap) {
        return {
          ok: false,
          error: { code: 'TOO_LARGE', message: '导出内容过大，无法保存' },
        }
      }

      const result = await dialog.showSaveDialog(window, {
        filters,
        defaultPath,
      })

      if (result.canceled || !result.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      try {
        // L8：用户经原生对话框选择的位置即授权（写穿与后续保存均可用）
        trustDirectory(dirname(result.filePath))
        await writeFileAtomically(result.filePath, content)
        // 返回真实落盘 mtime（渲染端用于下次保存的冲突检测，比 Date.now() 更准）
        let modifiedTime = 0
        try {
          const fileStat = await stat(result.filePath)
          modifiedTime = fileStat.mtimeMs
          rememberFileState(result.filePath, {
            mtimeMs: fileStat.mtimeMs,
            size: fileStat.size,
          })
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
        // L8：文档/工作区路径必须已授信；未提供（未保存文档）时回退用户数据目录
        // F-M：FILE_READ 为分散文件（拖入/会话恢复的 .md）授予 trustFileForSave，
        // 这里只认完整信任根会让分散文件粘贴图片被 INVALID_PATH 拒绝——与 FILE_SAVE 一致
        if (args.docPath && !ensureTrusted(args.docPath) && !isFileTrustedForSave(args.docPath)) {
          return { ok: false, error: { code: 'INVALID_PATH' } }
        }
        if (args.workspacePath && !ensureTrusted(args.workspacePath)) {
          return { ok: false, error: { code: 'INVALID_PATH' } }
        }
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
        // L6：解码前校验，损坏的 base64 不再静默写出截断图片
        if (!isValidBase64Payload(match[3])) {
          return { ok: false, error: { code: 'INVALID_DATA', message: '图片数据损坏，无法保存' } }
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
        let name = ''
        let filePath = ''
        let created = false
        for (let attempt = 0; attempt < 100; attempt++) {
          name = `image-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`
          filePath = join(dir, name)
          try {
            await writeFile(filePath, buffer, { flag: 'wx' })
            created = true
            break
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          }
        }
        if (!created) {
          return { ok: false, error: { code: 'NAME_EXHAUSTED' } }
        }
        allowImageDirectory(dir)
        schedulePersistTrust()
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

  // 新建窗口（fresh 模式：不恢复/不写入会话，避免多窗口互相覆盖）。
  // L2：窗口数量上限——多窗口各自持有主进程 IPC/索引，数量失控会放大内存与文件句柄占用
  const MAX_WINDOWS = 8
  const windowCapacityOk = (): boolean =>
    BrowserWindow.getAllWindows().length < MAX_WINDOWS

  ipcMain.handle(CHANNELS.WINDOW_NEW, () => {
    try {
      if (!windowCapacityOk()) {
        return { ok: false, error: { code: 'WINDOW_LIMIT' } }
      }
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
      if (!windowCapacityOk()) {
        return { ok: false, error: { code: 'WINDOW_LIMIT' } }
      }
      // L8：新窗口打开的文件必须已由当前窗口/会话授权
      // （含工作区外散档的文件级保存白名单，如拖入/会话恢复的文档）
      if (!ensureTrusted(filePath) && !isFileTrustedForSave(filePath)) {
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
    setWebContentsUnsaved(event.sender, !!unsaved)
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

      // 载荷与参数前置校验（args 为 null 时返回错误结构而非抛错）
      const html = args?.html
      const defaultName = args?.defaultName
      if (typeof html !== 'string' || typeof defaultName !== 'string' || !defaultName) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      if (Buffer.byteLength(html, 'utf-8') > MAX_EXPORT_FILE_SIZE) {
        return {
          ok: false,
          error: { code: 'TOO_LARGE', message: '导出内容过大，无法打印 PDF' },
        }
      }

      const save = await dialog.showSaveDialog(parent, {
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        defaultPath: defaultName,
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      // 隐藏窗口加载文档 HTML，等待渲染完成后打印。
      // M2：data: URL 在 Chromium 中超过 ~2MB 会被截断/拒绝（内联图片后 HTML 很容易超限），
      // 改为写入临时文件后 loadFile，finally 中清理
      const tmpHtml = join(app.getPath('temp'), `mk-editor-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
      // F-L2：临时文件写入原在 try 外，磁盘满/权限不足时异常直接抛出 IPC，
      // 渲染层收不到错误结构。移入保护并返回结构化错误
      try {
        await writeFile(tmpHtml, html, 'utf8')
      } catch {
        return { ok: false, error: { code: 'IO_ERROR', message: '无法写入临时文件' } }
      }
      const printWin = new BrowserWindow({
        show: false,
        // B-M4：与主窗口一致开启沙箱，打印窗口只渲染受信 HTML，无需完整 Node 能力
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      })
      try {
        await printWin.loadFile(tmpHtml)
        // 等图片/字体等资源就绪；M4：加载挂起的资源会让 executeJavaScript
        // 永不 resolve（图片 onload/onerror 都不触发时），15s 超时兜底后继续打印
        const waitImages = printWin.webContents.executeJavaScript(
          `new Promise(r => {
            const imgs = Array.from(document.images)
            if (imgs.length === 0) return r(true)
            Promise.all(imgs.map(i => i.complete ? 1 : new Promise(res => {
              i.onload = i.onerror = res
            }))).then(() => r(true))
          })`,
        )
        await Promise.race([
          waitImages,
          new Promise((resolve) => setTimeout(resolve, 15_000)),
        ])
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
        unlink(tmpHtml).catch(() => {})
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

  /**
   * Windows/macOS 常见的大小写不敏感文件系统中，文件名仅变更大小写时，
   * target 会被 stat 到同一个文件。真实同名冲突仍必须拒绝，避免 rename 覆盖目标。
  */
  const isCaseOnlyRename = async (source: string, target: string): Promise<boolean> => {
    if (source === target) return true
    const [sourceRealPath, targetRealPath] = await Promise.all([
      realpath(source),
      realpath(target),
    ])
    const normalizeForCaseCompare = (value: string) => value.replace(/[\\/]+/g, sep).toLowerCase()
    return (
      sourceRealPath === targetRealPath &&
      normalizeForCaseCompare(source) === normalizeForCaseCompare(target)
    )
  }

  // 新建文件
  ipcMain.handle(
    CHANNELS.FILE_CREATE,
    async (_event, args: { dir: string; name: string }) => {
      if (!args || typeof args.dir !== 'string' || !args.dir) {
        return { ok: false, error: { code: 'INVALID_TARGET' } }
      }
      // L8：创建位置必须属于已授权根（工作区树节点目录）
      if (!ensureTrusted(args.dir)) {
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
      // L8：重命名源必须已授权（目标位于同一目录，同受信任根覆盖）
      if (!ensureTrusted(args.path)) {
        return { ok: false, error: { code: 'INVALID_PATH' } }
      }
      const name = safeName(args.newName)
      if (!name) return { ok: false, error: { code: 'INVALID_NAME' } }
      const target = join(dirname(args.path), name)
      if (target !== args.path) {
        const targetStat = await stat(target).catch(() => null)
        if (targetStat) {
          const sameFile = await isCaseOnlyRename(args.path, target).catch(() => false)
          if (!sameFile) {
            return { ok: false, error: { code: 'EXISTS' } }
          }
        }
      }
      try {
        await rename(args.path, target)
        // 返回重命名后的 mtime，供渲染端更新冲突检测基线，避免误报"外部修改"；
        // 旧路径的冲突检测条目一并迁移，防止残留条目与重建文件尺寸不符而误报冲突
        const targetStat = await stat(target).catch(() => null)
        lastKnownFileState.delete(args.path)
        if (targetStat) {
          rememberFileState(target, { mtimeMs: targetStat.mtimeMs, size: targetStat.size })
        }
        return {
          ok: true,
          data: { path: target, name, modifiedTime: targetStat?.mtimeMs ?? 0 },
        }
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
        // L8：源与目标目录都必须属于已授权根（工作区内移动）
        if (!ensureTrusted(args.path) || !ensureTrusted(args.targetDir)) {
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
        lastKnownFileState.delete(src)
        const targetStat = await stat(target).catch(() => null)
        if (targetStat) {
          rememberFileState(target, { mtimeMs: targetStat.mtimeMs, size: targetStat.size })
        }
        return {
          ok: true,
          data: { path: target, name: basename(target), modifiedTime: targetStat?.mtimeMs ?? 0 },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 仅读取文件 mtime（草稿恢复前校验基线新鲜度用，避免整文件重读）
  ipcMain.handle(CHANNELS.FILE_STAT, async (_event, filePath: string) => {
    // 散档（工作区外、仅文件级保存白名单）的草稿恢复同样需要基线校验
    if (!ensureTrusted(filePath) && !isFileTrustedForSave(filePath)) {
      return { ok: false, error: { code: 'INVALID_PATH' } }
    }
    try {
      const st = await stat(filePath)
      return { ok: true, data: { modifiedTime: st.mtimeMs } }
    } catch {
      return { ok: false, error: { code: 'NOT_FOUND' } }
    }
  })

  // 删除（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE, async (_event, filePath: string) => {
    if (!ensureTrusted(filePath)) {
      return { ok: false, error: { code: 'INVALID_PATH' } }
    }
    try {
      // M3：仅允许删除文件——trashItem 对目录会整棵移入回收站，
      // 渲染端只对文件调用删除，防御未来的误用
      const st = await stat(filePath)
      if (!st.isFile()) {
        return { ok: false, error: { code: 'NOT_FILE' } }
      }
      await shell.trashItem(filePath)
      // 清理冲突检测条目，避免旧路径被外部重建时误报"外部修改"
      lastKnownFileState.delete(filePath)
      return { ok: true, data: { name: basename(filePath) } }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 列出指定目录下的图片文件（图片管理面板）
  ipcMain.handle(CHANNELS.FILE_LIST_IMAGES, async (_event, dirs: string[]) => {
    if (
      !Array.isArray(dirs) ||
      dirs.length > MAX_IMAGE_LIST_DIRS ||
      dirs.some(
        (dir) =>
          typeof dir !== 'string' ||
          !dir ||
          dir.length > 4096 ||
          (!ensureTrusted(dir) && !isImageDirAllowed(dir)),
      )
    ) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
    }
    const images: { path: string; name: string; size: number }[] = []
    // 未保存文档的粘贴图片会保存到用户数据目录，图片管理也应当可见。
    const imageDirs = [...dirs, join(app.getPath('userData'), 'images')]
    const scanned = new Set<string>()
    for (const dir of imageDirs) {
      if (scanned.has(dir)) continue
      scanned.add(dir)
      try {
        // L2：不再对任意传入目录授信。图片目录都是工作区/文档目录或
        // userData/images 的子路径，打开文档/工作区与保存图片时已授信，
        // 信任根对子路径自动覆盖，此处无需（也不应）扩展授权。
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (!e.isFile()) continue
          if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(e.name)) continue
          const p = join(dir, e.name)
          const st = await stat(p).catch(() => null)
          images.push({ path: p, name: e.name, size: st?.size ?? 0 })
          if (images.length >= MAX_IMAGE_LIST_COUNT) {
            return { ok: true, data: { images, truncated: true } }
          }
        }
      } catch {
        /* 目录不存在则跳过 */
      }
    }
    return { ok: true, data: { images, truncated: false } }
  })

  // 删除图片（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE_IMAGE, async (_event, filePath: string) => {
    if (!ensureTrusted(filePath)) {
      return { ok: false, error: { code: 'INVALID_PATH' } }
    }
    try {
      // M3：仅允许删除文件（同 FILE_DELETE）
      const st = await stat(filePath)
      if (!st.isFile()) {
        return { ok: false, error: { code: 'NOT_FILE' } }
      }
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
        // L8：搜索根必须属于已授权根（工作区/文档目录）
        if (!ensureTrusted(args.dir)) {
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
        // 搜索已有 500 文件上限，树遍历用一次性预算即可
        const tree = await walkMarkdownTree(args.dir, 0, { nodes: 0, truncated: false })
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

            // 索引缓存：mtime 与 size 均未变时复用已拆分的行，避免重复读盘解码。
            // L4：FAT32/exFAT 的 mtime 精度仅 2 秒，文件刚被编辑过时
            // mtime/size 可能均未变化但内容已不同，mtime 落定前跳过缓存。
            let lines: string[]
            const cached = searchLineCache.get(p)
            const mtimeSettled = Date.now() - st.mtimeMs > 2500
            if (cached && mtimeSettled && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
              lines = cached.lines
            } else {
              const { content } = await readTextAutoEncoding(p)
              lines = content.split(/\r?\n/)
              // 只在 mtime 落定后写缓存，避免 2 秒窗口内的第二次编辑命中旧内容
              if (st.size <= SEARCH_CACHE_FILE_MAX && mtimeSettled) {
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
    if (key === 'imageHost') {
      return { ok: false, error: { code: 'RESTRICTED_KEY' } }
    }
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
      if (args?.key === 'imageHost') {
        return { ok: false, error: { code: 'RESTRICTED_KEY' } }
      }
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
  ipcMain.handle(CHANNELS.IMAGE_HOST_GET_STATUS, async () => {
    try {
      return { ok: true, data: await getImageHostStatus() }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(
    CHANNELS.IMAGE_HOST_SET_CONFIG,
    async (_event, args: { provider: 'local' | 'smms'; token?: string }) => {
      if (!args || (args.provider !== 'local' && args.provider !== 'smms')) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      if (args.token !== undefined && typeof args.token !== 'string') {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      if (args.token && args.token.length > MAX_IMAGE_HOST_TOKEN_LENGTH) {
        return { ok: false, error: { code: 'VALUE_TOO_LARGE' } }
      }
      try {
        const current = (await getSetting('imageHost')) as
          | { token?: unknown }
          | undefined
        const token = args.token === undefined
          ? (typeof current?.token === 'string' ? current.token : '')
          : args.token.trim()
        await setSetting(
          'imageHost',
          args.provider === 'smms' ? { provider: 'smms', token } : { provider: 'local' },
        )
        return { ok: true, data: await getImageHostStatus() }
      } catch (err) {
        if (err instanceof SettingsStoreError) {
          return { ok: false, error: { code: err.code } }
        }
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

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

      // 载荷与参数前置校验（args 为 null 时返回错误结构而非抛错）
      const markdown = args?.markdown
      const defaultTitle = args?.defaultTitle
      if (typeof markdown !== 'string' || typeof defaultTitle !== 'string' || !defaultTitle) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT' } }
      }
      if (Buffer.byteLength(markdown, 'utf-8') > MAX_DOCUMENT_FILE_SIZE) {
        return {
          ok: false,
          error: { code: 'TOO_LARGE', message: 'Markdown 超过 20MB，无法导出' },
        }
      }

      // 检测 pandoc 是否可用（首次调用时探测，结果缓存带 TTL；并发调用共享同一探测）。
      // L4：探测带 10s 超时——pandoc 挂起时不能阻塞导出入口
      const now = Date.now()
      if (!pandocCheck || now - pandocCheckAt > PANDOC_CHECK_TTL_MS) {
        pandocCheckAt = now
        pandocCheck = execFileAsync('pandoc', ['--version'], { timeout: 10_000 })
          .then(() => true)
          .catch(() => false)
      }
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
        defaultPath: `${defaultTitle}.docx`,
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
      const tmpIn = join(
        app.getPath('temp'),
        `mdsoft-${process.pid}-${Date.now()}-${Math.random()}.md`,
      )
      try {
        await writeFile(tmpIn, markdown, 'utf-8')
        // L4：60s 超时——大文档或 hung 的 pandoc 进程不能无限阻塞 IPC
        await execFileAsync(
          'pandoc',
          [
            '-f',
            'markdown',
            '-t',
            fmt,
            tmpIn,
            '-o',
            save.filePath,
          ],
          { timeout: 60_000 },
        )
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
      // L8：用户经原生对话框选择即授权（文件在对话框之外不可读）
      trustDirectory(dirname(filePath))
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
        // L6：解码前校验，损坏数据不再以截断内容上传
        if (!isValidBase64Payload(match[3])) {
          return { ok: false, error: { code: 'INVALID_DATA', message: '图片数据损坏，无法上传' } }
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
        // 30 秒超时：图床 API 挂起时不能让 IPC 调用无限期阻塞
        const controller = new AbortController()
        const timeoutTimer = setTimeout(() => controller.abort(), 30_000)
        let resp: Response
        try {
          resp = await fetch('https://sm.ms/api/v2/upload', {
            method: 'POST',
            headers: { Authorization: cfg.token },
            body: form,
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutTimer)
        }
        // L5：5xx/429 等错误响应不是 JSON，resp.json() 会抛原始解析文本；
        // 先检查 resp.ok 并给出稳定文案
        if (!resp.ok) {
          return {
            ok: false,
            error: {
              code: 'UPLOAD_FAILED',
              message: `图床服务暂不可用（HTTP ${resp.status}），请稍后重试`,
            },
          }
        }
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
