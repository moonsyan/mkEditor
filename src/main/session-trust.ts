import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getEssentialRoots,
  getTrustedFiles,
  trustDirectory,
  trustFileForSave,
} from './trusted-paths'
import { allowImageDirectory, getImageReadDirs } from './image-protocol'

/**
 * 跨启动信任持久化（H：会话预信任伪造）。
 * 会话恢复的信任此前直接采信渲染层可写的 settings.json（session.workspacePath），
 * 渲染层一旦被 XSS，可伪造路径使任意目录（如 C:\）在重启后获得完整信任。
 * 本模块把信任清单改为主进程私有文件（userData/trusted-roots.json）：
 * 只有主进程在用户真实授权后（对话框选择 / 拖入读取 / 保存图片）才登记并写盘，
 * 渲染层没有任何 IPC 能写入该文件。
 */

const TRUST_FILE_NAME = 'trusted-roots.json'
/** 持久化工作区上限：保留最近打开的若干个，防止长期使用后清单无界增长 */
const MAX_PERSISTED_WORKSPACES = 8

interface TrustSnapshot {
  workspaces: string[]
  files: string[]
  imageDirs: string[]
}

const trustFile = (): string => join(app.getPath('userData'), TRUST_FILE_NAME)

/** 启动时从主进程私有清单恢复信任；返回 true 表示快照存在（否则调用方走迁移回退） */
export async function restoreTrustFromDisk(): Promise<boolean> {
  try {
    const raw = await readFile(trustFile(), 'utf-8')
    const snapshot = JSON.parse(raw) as TrustSnapshot
    if (!snapshot || typeof snapshot !== 'object') return false
    const lists: { items: unknown; apply: (item: string) => void }[] = [
      { items: snapshot.workspaces, apply: (w) => trustDirectory(w, { essential: true }) },
      { items: snapshot.files, apply: trustFileForSave },
      { items: snapshot.imageDirs, apply: allowImageDirectory },
    ]
    for (const { items, apply } of lists) {
      if (!Array.isArray(items)) continue
      for (let i = 0; i < items.length; i++) {
        if (typeof items[i] === 'string' && items[i]) apply(items[i])
      }
    }
    return true
  } catch {
    return false
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 授信变更后调用：防抖写盘，合并高频操作（保存图片 / 打开文件等） */
export function schedulePersistTrust(immediate = false): void {
  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    void persistTrustSnapshot()
    return
  }
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistTrustSnapshot()
  }, 1000)
}

async function persistTrustSnapshot(): Promise<void> {
  try {
    // 应用自有图片目录每次启动都会重新授信，无需持久化
    const appImagesDir = join(app.getPath('userData'), 'images')
    const workspaces = getEssentialRoots().filter((root) => root !== appImagesDir)
    const snapshot: TrustSnapshot = {
      workspaces: workspaces.slice(-MAX_PERSISTED_WORKSPACES),
      files: getTrustedFiles(),
      imageDirs: getImageReadDirs(),
    }
    const file = trustFile()
    await mkdir(app.getPath('userData'), { recursive: true })
    const tmp = `${file}.${process.pid}-${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(snapshot), 'utf-8')
    await rename(tmp, file)
  } catch {
    /* 持久化失败不影响本次会话的信任状态 */
  }
}
