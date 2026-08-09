import { app } from 'electron'
import { readFile, writeFile, mkdir, rename, stat, copyFile } from 'fs/promises'
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

/** settings.json 允许的最大体积（字节），超限视为损坏 */
const MAX_FILE_SIZE = 8 * 1024 * 1024
/** 单个设置值序列化后的最大体积（字节），超限拒绝写入 */
const MAX_VALUE_SIZE = 4 * 1024 * 1024
/** session.files 上限 */
const SESSION_MAX_FILES = 200
/** drafts 保留条数上限（按最近保存时间） */
const DRAFTS_MAX = 50

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
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

async function load(): Promise<Record<string, unknown>> {
  if (cache) return cache
  const path = settingsPath()
  try {
    // 体积守卫：超限文件不加载，备份后自愈为空对象，避免启动卡顿/OOM
    const st = await stat(path).catch(() => null)
    if (st && st.size > MAX_FILE_SIZE) {
      await backupCorrupt(path)
      cache = {}
      return cache
    }
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // 读取端也清洗一次，兜底历史脏数据
    for (const key of Object.keys(parsed)) {
      parsed[key] = sanitize(key, parsed[key])
    }
    cache = parsed
  } catch {
    cache = {}
  }
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
  const task = writeQueue.then(() => applySetSetting(key, value))
  // 队列保活：单次写入失败不阻断后续写入；
  // 但返回给调用方的是未吞错的 task，IPC 层仍能感知磁盘写失败
  writeQueue = task.catch(() => undefined)
  return task
}

async function applySetSetting(key: string, value: unknown): Promise<void> {
  const all = await load()
  const clean = sanitize(key, value)
  // 写入体积守卫：单个值超限则拒绝，防止任何键再次膨胀
  try {
    if (JSON.stringify(clean).length > MAX_VALUE_SIZE) {
      console.warn(`[settings] 拒绝写入过大的设置项: ${key}`)
      return
    }
  } catch {
    return
  }
  all[key] = clean
  cache = all
  const path = settingsPath()
  await mkdir(dirname(path), { recursive: true })
  // 先写临时文件再替换，避免写一半损坏
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf-8')
  await rename(tmp, path)
}
