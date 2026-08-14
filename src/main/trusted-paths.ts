import { isAbsolute, relative, resolve } from 'path'

/**
 * 信任根集合：mdimg 协议与文件 IPC 共用的授权目录（L2/L8）。
 * - 容量上限 + 最早淘汰：防止"打开过的目录永久累积"导致无界增长
 * - 子路径自动覆盖（相对路径判定），无需逐个登记 attachments 等子目录
 * - 渲染进程无法直接调用本模块，授权只发生在主进程校验后的流程中
 */

const trustedRoots = new Map<string, true>()

/** 可淘汰信任根数量上限：超出时淘汰最早加入的（Map 保持插入顺序） */
const MAX_TRUSTED_ROOTS = 64
/** 保底信任根（工作区、应用图片目录）：永不被容量淘汰 */
const essentialRoots = new Set<string>()

export interface TrustDirectoryOptions {
  /**
   * 保底根：只登记不淘汰。用于工作区与应用自有目录——
   * 若这些根因"打开过 64+ 个其它目录"被最早淘汰，
   * 工作区内的保存/搜索将开始返回 INVALID_PATH（B-M1）。
   */
  essential?: boolean
}

export function trustDirectory(
  directory: string,
  options?: TrustDirectoryOptions,
): void {
  if (!directory) return
  const dir = resolve(directory)
  if (options?.essential) {
    trustedRoots.set(dir, true)
    essentialRoots.add(dir)
    return
  }
  if (trustedRoots.has(dir)) return
  if (trustedRoots.size >= MAX_TRUSTED_ROOTS) {
    // 只淘汰可淘汰根：容量打满且全部为保底根时，停止登记新根（L7），
    // 否则每开一个新工作区都会让集合继续无界增长
    const roots = Array.from(trustedRoots.keys())
    let evicted = false
    for (let i = 0; i < roots.length && !evicted; i++) {
      if (!essentialRoots.has(roots[i])) {
        trustedRoots.delete(roots[i])
        evicted = true
      }
    }
    if (!evicted) return
  }
  trustedRoots.set(dir, true)
}

/** 路径是否位于任一信任根内（含根自身与所有子路径） */
export function isPathTrusted(filePath: string): boolean {
  const resolved = resolve(filePath)
  const roots = Array.from(trustedRoots.keys())
  for (let i = 0; i < roots.length; i++) {
    const pathFromRoot = relative(roots[i], resolved)
    if (
      pathFromRoot === '' ||
      (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
    ) {
      return true
    }
  }
  return false
}

export function getTrustedRoots(): string[] {
  return Array.from(trustedRoots.keys())
}

/** 保底信任根（工作区、应用自有目录）：供持久化快照区分可恢复的工作区 */
export function getEssentialRoots(): string[] {
  return Array.from(essentialRoots)
}

/**
 * 文件级保存白名单（H1 修复）：FILE_READ 读过的 .md 精确路径。
 * FILE_SAVE 允许写回这些文件，但不再向其所在目录授予任何其它权限。
 */
const trustedFiles = new Map<string, true>()

/** 文件级白名单数量上限：超出时淘汰最早加入的 */
const MAX_TRUSTED_FILES = 128

export function trustFileForSave(filePath: string): void {
  if (!filePath) return
  const p = resolve(filePath)
  if (trustedFiles.has(p)) return
  if (trustedFiles.size >= MAX_TRUSTED_FILES) {
    const oldest = trustedFiles.keys().next().value
    if (oldest !== undefined) trustedFiles.delete(oldest)
  }
  trustedFiles.set(p, true)
}

/** 该精确文件是否可写回（仅 FILE_SAVE 使用；目录其它操作仍需完整信任根） */
export function isFileTrustedForSave(filePath: string): boolean {
  if (!filePath) return false
  return trustedFiles.has(resolve(filePath))
}

/** 文件级保存白名单全量（供跨启动信任持久化） */
export function getTrustedFiles(): string[] {
  return Array.from(trustedFiles.keys())
}
