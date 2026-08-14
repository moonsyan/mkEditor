import { app } from 'electron'
import { readFile, writeFile, mkdir, open, rename, stat, copyFile, unlink } from 'fs/promises'
import { dirname, join } from 'path'

/**
 * 轻量设置持久化：JSON 文件存储于用户数据目录
 * 正式版可替换为 electron-store，接口保持不变
 *
 * 防御性设计（防止历史数据膨胀导致启动 OOM）：
 * - 加载前检查文件体积，超限则备份原文件并自愈为空对象
 * - 写入单个值前检查序列化体积，超限拒绝写入
 * - session / drafts 等易膨胀键在读写两端都做去重 + 上限清洗
 */

let cache: Record<string, unknown> | null = null
/**
 * M14：多窗口（多主进程）下，其他窗口写入的 settings.json 无法通知本进程。
 * 读路径短 TTL 失效：缓存超过该时长后重新读盘，保证图床 token、主题等
 * 配置变更能及时生效，又不至于每次 getSetting 都读盘。
 */
const CACHE_TTL_MS = 1500
let cacheLoadedAt = 0

export class SettingsStoreError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_VALUE'
      | 'VALUE_TOO_LARGE'
      | 'FILE_TOO_LARGE'
      | 'LOCK_TIMEOUT',
  ) {
    super(code)
  }
}

/** settings.json 允许的最大体积（字节），超限视为损坏。
 *  与文档打开上限（20MB）对齐：drafts 存于本文件，若上限低于单篇文档，
 *  超大文档的草稿保存会被拒绝、下次启动还可能把含大草稿的整个文件判为损坏。 */
const MAX_FILE_SIZE = 40 * 1024 * 1024
/** 单个设置值序列化后的最大体积（字节），超限拒绝写入。
 *  与文档上限对齐：drafts 存于本文件，若上限低于单篇文档，
 *  超大文档的草稿保存会被拒绝、下次启动还可能把含大草稿的整个文件判为损坏。
 *  取文档上限的 1.5 倍：JSON.stringify 有转义膨胀（引号/换行/反斜杠 ×2），
 *  20MB 文档序列化后可能超 20MB 原始上限而静默拒绝草稿保存 */
const MAX_VALUE_SIZE = 30 * 1024 * 1024
/** session.files 上限 */
const SESSION_MAX_FILES = 200
/** drafts 保留条数上限（按最近保存时间） */
const DRAFTS_MAX = 50
/** 跨进程写锁等待上限，避免崩溃后残留锁永久阻塞设置保存。
 *  B-L1：重试窗口（上限×间隔）必须覆盖陈旧判定阈值——
 *  此前重试 4s 即放弃，而陈旧锁 60s 后才被清理，崩溃残留锁会让
 *  之后整整一分钟内的所有设置写入失败。现在陈旧 4s、重试 5s，
 *  残留锁约 4s 内自愈，正常写入（持锁远小于 4s）不受影响。 */
const SETTINGS_LOCK_MAX_RETRIES = 100
const SETTINGS_LOCK_RETRY_DELAY_MS = 50
const SETTINGS_LOCK_STALE_MS = 4_000

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

/**
 * 多窗口模式会启动多个 Electron 主进程。本地队列只能串行当前进程，
 * 因此需要文件锁来保护跨进程的“读取 - 合并 - 写入”完整操作。
 */
async function acquireSettingsLock(): Promise<() => Promise<void>> {
  const path = settingsPath()
  const lockPath = `${path}.lock`
  const token = `${process.pid}-${Date.now()}-${Math.random()}`
  await mkdir(dirname(path), { recursive: true })

  for (let retry = 0; retry < SETTINGS_LOCK_MAX_RETRIES; retry++) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(token, 'utf-8')
      } catch (err) {
        await handle.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        throw err
      }
      await handle.close()
      return async () => {
        try {
          if ((await readFile(lockPath, 'utf-8')) === token) {
            await unlink(lockPath)
          }
        } catch {
          /* 锁已被清理或替换时不影响主写入结果。 */
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const lockStat = await stat(lockPath).catch(() => null)
      if (lockStat && Date.now() - lockStat.mtimeMs > SETTINGS_LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => {})
        continue
      }
      await wait(SETTINGS_LOCK_RETRY_DELAY_MS)
    }
  }

  throw new SettingsStoreError('LOCK_TIMEOUT')
}

/** 损坏/超限时备份原文件，便于排查与恢复 */
async function backupCorrupt(path: string): Promise<void> {
  try {
    await copyFile(path, `${path}.corrupt-${Date.now()}.bak`)
  } catch {
    /* 备份失败不影响自愈 */
  }
}

/** session 清洗：files 数组按 id 去重 + 上限 */
function sanitizeSession(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const s = value as { files?: unknown; [k: string]: unknown }
  if (Array.isArray(s.files)) {
    const seen = new Set<string>()
    const out: unknown[] = []
    for (const f of s.files) {
      if (out.length >= SESSION_MAX_FILES) break
      if (!f || typeof f !== 'object') continue
      const id = (f as { id?: unknown }).id
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      seen.add(id)
      out.push(f)
    }
    s.files = out
  }
  return s
}

/** drafts 清洗：超过上限时按 savedAt 保留最近的 */
function sanitizeDrafts(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, { savedAt?: number } | undefined>)
  if (entries.length <= DRAFTS_MAX) return value
  entries.sort((a, b) => (b[1]?.savedAt ?? 0) - (a[1]?.savedAt ?? 0))
  return Object.fromEntries(entries.slice(0, DRAFTS_MAX))
}

/** 按 key 应用对应清洗规则 */
function sanitize(key: string, value: unknown): unknown {
  if (key === 'session') return sanitizeSession(value)
  if (key === 'drafts') return sanitizeDrafts(value)
  return value
}

/** 从磁盘读取最新快照。写入方必须在持有跨进程锁后调用。 */
async function readSettingsFile(): Promise<Record<string, unknown>> {
  const path = settingsPath()
  try {
    const fileStat = await stat(path).catch(() => null)
    if (fileStat && fileStat.size > MAX_FILE_SIZE) {
      await backupCorrupt(path)
      return {}
    }
    const raw = await readFile(path, 'utf-8')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // M2：JSON 损坏（截断/手改）时先备份原文件再返回空——
      // 否则下一次写入会把仅含新键的 {} 原子写回，草稿/图床 token/全部设置永久丢失
      await backupCorrupt(path).catch(() => {})
      return {}
    }
    for (const key of Object.keys(parsed)) {
      parsed[key] = sanitize(key, parsed[key])
    }
    return parsed
  } catch {
    // 文件不存在等读取失败：无备份可言，直接返回空
    return {}
  }
}

async function load(): Promise<Record<string, unknown>> {
  const now = Date.now()
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache
  cache = await readSettingsFile()
  cacheLoadedAt = now
  return cache
}

export async function getSetting(key: string): Promise<unknown> {
  const all = await load()
  return all[key]
}

/**
 * 写入串行队列（B7）：多窗口同时写 settings 时，读-改-写必须串行执行，
 * 避免并发写入互相覆盖或临时文件替换交错导致 JSON 损坏。
 * 设置读写统一经由主进程，此处即为全局单点串行化。
 */
let writeQueue: Promise<void> = Promise.resolve()

export function setSetting(key: string, value: unknown): Promise<void> {
  const task = writeQueue.then(() => applySettingUpdate(key, () => value))
  // 队列保活：单次写入失败不阻断后续写入；
  // 但返回给调用方的是未吞错的 task，IPC 层仍能感知磁盘写失败
  writeQueue = task.catch(() => undefined)
  return task
}

/**
 * 原子写入一篇草稿。草稿字典只在主进程队列中读取和更新，
 * 防止多个渲染进程持有旧副本并相互覆盖。
 */
export function upsertDraft(id: string, content: string): Promise<void> {
  const task = writeQueue.then(async () => {
    await applySettingUpdate('drafts', (current) => {
      const drafts: Record<string, unknown> =
        current && typeof current === 'object' ? { ...current } : {}
      drafts[id] = { content, savedAt: Date.now() }
      return drafts
    })
  })
  writeQueue = task.catch(() => undefined)
  return task
}

/** 以原子方式删除单篇草稿，保留其他标签或窗口刚写入的草稿。 */
export function deleteDraft(id: string): Promise<void> {
  const task = writeQueue.then(async () => {
    await applySettingUpdate('drafts', (current) => {
      if (!current || typeof current !== 'object' || !(id in current)) return current
      const drafts: Record<string, unknown> = { ...current }
      delete drafts[id]
      return drafts
    })
  })
  writeQueue = task.catch(() => undefined)
  return task
}

type SettingUpdater = (current: unknown) => unknown

async function writeSettingUpdate(key: string, update: SettingUpdater): Promise<void> {
  const all = await readSettingsFile()
  const clean = sanitize(key, update(all[key]))
  // 写入前检查单项和完整快照体积，避免下次启动将超限设置判为损坏。
  let serializedValue: string
  let serializedSettings: string
  let next: Record<string, unknown>
  try {
    serializedValue = JSON.stringify(clean)
    next = { ...all, [key]: clean }
    serializedSettings = JSON.stringify(next, null, 2)
  } catch {
    throw new SettingsStoreError('INVALID_VALUE')
  }
  if (Buffer.byteLength(serializedValue, 'utf-8') > MAX_VALUE_SIZE) {
    throw new SettingsStoreError('VALUE_TOO_LARGE')
  }
  if (Buffer.byteLength(serializedSettings, 'utf-8') > MAX_FILE_SIZE) {
    throw new SettingsStoreError('FILE_TOO_LARGE')
  }
  const path = settingsPath()
  await mkdir(dirname(path), { recursive: true })
  // 先写临时文件再替换，避免写一半损坏
  const tmp = `${path}.${process.pid}-${Date.now()}-${Math.random()}.tmp`
  try {
    await writeFile(tmp, serializedSettings, 'utf-8')
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
  // 仅在磁盘落盘成功后更新缓存，避免写失败时内存与文件状态不一致。
  cache = next
  cacheLoadedAt = Date.now()
}

async function applySettingUpdate(key: string, update: SettingUpdater): Promise<void> {
  const release = await acquireSettingsLock()
  try {
    await writeSettingUpdate(key, update)
  } finally {
    await release()
  }
}
