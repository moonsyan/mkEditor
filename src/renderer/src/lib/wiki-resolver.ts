import type { FolderTreeNode } from '../../../preload/api'

export interface WikiResolveResult {
  resolved: boolean
  path: string
}

/**
 * 在工作区文件树中解析 Wiki 链接 target。
 *
 * 解析规则（按顺序）：
 * 1. 在工作区树中查找精确路径匹配
 * 2. 若 target 不含扩展名，自动追加 .md
 * 3. 若 target 以 / 开头，从工作区根目录查找
 * 4. 否则从当前文件所在目录开始逐级向上查找
 */

/** 扁平化工作区树中所有 .md 文件路径为集合 */
export function collectMdFiles(tree: FolderTreeNode[]): string[] {
  const result: string[] = []
  const walk = (nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      if (node.children) {
        walk(node.children)
      } else {
        // 仅收集 .md 文件
        if (node.name.endsWith('.md')) {
          result.push(node.path)
        }
      }
    }
  }
  walk(tree)
  return result
}

/**
 * 规范化路径中的 ./ 与 ../ 段（纯字符串处理，不触文件系统）。
 * 保留前导 /（POSIX 绝对）与盘符（D:/），`..` 越出根时被忽略
 */
function normalizePathSegments(p: string): string {
  const isAbs = p.startsWith('/')
  const out: string[] = []
  const segs = p.split('/')
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(s)
  }
  return (isAbs ? '/' : '') + out.join('/')
}

/**
 * 在工作区中按名称查找文件（大小写不敏感）。
 * L8：多个同名文件并存时按与 currentDir 的目录距离排序（同目录 > 父目录 > 其它），
 * 而不是按树遍历顺序"先到先得"——两个目录各有一个同名 .md 时可能打开错误文件
 */
export function findFileByName(
  tree: FolderTreeNode[],
  name: string,
  currentDir?: string,
): string | null {
  const targetName = name.endsWith('.md') ? name : `${name}.md`
  const lower = targetName.toLowerCase()
  const matches: string[] = []
  const walk = (nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      if (node.children) {
        walk(node.children)
      } else if (node.name.toLowerCase() === lower) {
        matches.push(node.path)
      }
    }
  }
  walk(tree)
  if (matches.length === 0) return null
  if (matches.length === 1 || !currentDir) return matches[0]
  // 距离 = 与当前文件目录公共前缀之外的目录段数；同距离保持树顺序（稳定排序）
  const base = currentDir.replace(/\\/g, '/')
  const depth = (p: string): number => {
    const segs = p.replace(/\\/g, '/').split('/').filter(Boolean)
    const baseSegs = base.split('/').filter(Boolean)
    let common = 0
    while (
      common < segs.length &&
      common < baseSegs.length &&
      segs[common] === baseSegs[common]
    ) {
      common++
    }
    return segs.length - common
  }
  matches.sort((a, b) => depth(a) - depth(b))
  return matches[0]
}

/**
 * 解析 Wiki 链接 target 为绝对文件路径。
 * @param target - [[...]] 中的目标字符串（如 "folder/doc" 或 "doc"）
 * @param workspacePath - 工作区根目录的绝对路径
 * @param currentFilePath - 当前文档的绝对路径（可为 undefined）
 * @param tree - 工作区文件树
 */
export function resolveWikiTarget(
  target: string,
  workspacePath: string,
  currentFilePath: string | undefined,
  tree: FolderTreeNode[],
): WikiResolveResult {
  if (!target) return { resolved: false, path: '' }

  const normalizedTarget = target.replace(/\\/g, '/')

  // 1. Windows 绝对路径 target（[[D:/notes/a.md]]，跨工作区）：规范化后
  //    在本工作区树中精确查找；不在本工作区内的直接判定未解析
  if (/^[A-Za-z]:\//.test(normalizedTarget)) {
    const abs = normalizePathSegments(normalizedTarget)
    const withExt = abs.endsWith('.md') ? abs : `${abs}.md`
    const found = findFileByPathInTree(tree, withExt) ?? findFileByPathInTree(tree, abs)
    if (found) return { resolved: true, path: found }
    return { resolved: false, path: '' }
  }

  // 2. 若以 / 开头，从工作区根目录拼接（../ 与 ./ 段规范化）
  if (normalizedTarget.startsWith('/')) {
    const rel = normalizedTarget.slice(1)
    const abs = normalizePathSegments(`${workspacePath.replace(/\\/g, '/')}/${rel}`)
    const withExt = abs.endsWith('.md') ? abs : `${abs}.md`
    const found = findFileByPathInTree(tree, withExt)
    if (found) return { resolved: true, path: found }
    // 尝试不加扩展名（允许指向非 .md 文件）
    const foundNoExt = findFileByPathInTree(tree, abs)
    if (foundNoExt) return { resolved: true, path: foundNoExt }
    return { resolved: false, path: '' }
  }

  // 3. 在当前文件目录及上级目录中查找
  const searchDirs: string[] = []
  if (currentFilePath) {
    const normalized = currentFilePath.replace(/\\/g, '/')
    let dir = normalized.substring(0, normalized.lastIndexOf('/'))
    while (dir.length >= workspacePath.replace(/\\/g, '/').length) {
      searchDirs.push(dir)
      const parentIdx = dir.lastIndexOf('/')
      if (parentIdx < 0) break
      dir = dir.substring(0, parentIdx)
    }
  }
  // 也搜索工作区根目录
  if (!searchDirs.includes(workspacePath.replace(/\\/g, '/'))) {
    searchDirs.push(workspacePath.replace(/\\/g, '/'))
  }

  for (const dir of searchDirs) {
    // 精确 target（已有扩展名）
    if (normalizedTarget.includes('.')) {
      // L8：../ 与 ./ 段规范化——此前 `${dir}/../x` 的 `..` 是字面量，
      // 树内路径不含 `..` 段，[[../x]] 永远匹配不上
      const candidate = normalizePathSegments(`${dir}/${normalizedTarget}`)
      const found = findFileByPathInTree(tree, candidate)
      if (found) return { resolved: true, path: found }
    } else {
      // target 不含扩展名
      // 先尝试作为目录下的 index.md
      const indexPath = normalizePathSegments(`${dir}/${normalizedTarget}/index.md`)
      const indexFound = findFileByPathInTree(tree, indexPath)
      if (indexFound) return { resolved: true, path: indexFound }

      // 再尝试 target.md
      const mdPath = normalizePathSegments(`${dir}/${normalizedTarget}.md`)
      const mdFound = findFileByPathInTree(tree, mdPath)
      if (mdFound) return { resolved: true, path: mdFound }
    }
  }

  // 4. 全树逐文件模糊匹配（大小写不敏感的文件名匹配；
  //    L8：同名文件多个时返回距离当前文件目录最近的）
  const currentDir = currentFilePath
    ? currentFilePath.replace(/\\/g, '/').replace(/[^/]+$/, '')
    : undefined
  const nameMatch = findFileByName(tree, normalizedTarget, currentDir)
  if (nameMatch) return { resolved: true, path: nameMatch }

  return { resolved: false, path: '' }
}

/** 检查给定路径是否在文件树中（规范化比较） */
function findFileByPathInTree(
  tree: FolderTreeNode[],
  targetPath: string,
): string | null {
  const normalized = targetPath.replace(/\\/g, '/')
  // L19：先精确匹配（大小写敏感，兼容大小写敏感文件系统）；
  // 未命中再大小写不敏感匹配——Windows 文件系统大小写不敏感，
  // 用户手写 [[Sub/Doc]] 目录部分大小写不符时精确命中失败，
  // findFileByName 只兜底文件名、兜不住目录段，链接就解析不了
  const lower = normalized.toLowerCase()
  const walk = (nodes: FolderTreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.children) {
        const found = walk(node.children)
        if (found) return found
      } else {
        const nodePath = node.path.replace(/\\/g, '/')
        if (nodePath === normalized) return node.path
        if (nodePath.toLowerCase() === lower) return node.path
      }
    }
    return null
  }
  return walk(tree)
}
