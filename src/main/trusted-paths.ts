import { isAbsolute, relative, resolve } from 'path'

/**
 * 信任根集合：mdimg 协议与文件 IPC 共用的授权目录（L2/L8）。
 * - 容量上限 + 最早淘汰：防止"打开过的目录永久累积"导致无界增长
 * - 子路径自动覆盖（相对路径判定），无需逐个登记 attachments 等子目录
 * - 渲染进程无法直接调用本模块，授权只发生在主进程校验后的流程中
 */

const trustedRoots = new Map<string, true>()

/** 信任根数量上限：超出时淘汰最早加入的（Map 保持插入顺序） */
const MAX_TRUSTED_ROOTS = 64

export function trustDirectory(directory: string): void {
  if (!directory) return
  const dir = resolve(directory)
  if (trustedRoots.has(dir)) return
  if (trustedRoots.size >= MAX_TRUSTED_ROOTS) {
    const oldest = trustedRoots.keys().next().value
    if (oldest !== undefined) trustedRoots.delete(oldest)
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
