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

/** 在工作区中按名称查找文件（大小写不敏感） */
export function findFileByName(
  tree: FolderTreeNode[],
  name: string,
): string | null {
  const targetName = name.endsWith('.md') ? name : `${name}.md`
  const lower = targetName.toLowerCase()
  const walk = (nodes: FolderTreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.children) {
        const found = walk(node.children)
        if (found) return found
      } else {
        if (node.name.toLowerCase() === lower) {
          return node.path
        }
      }
    }
    return null
  }
  return walk(tree)
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

  // 1. 若以 / 开头，从工作区根目录拼接
  if (normalizedTarget.startsWith('/')) {
    const rel = normalizedTarget.slice(1)
    const withExt = rel.endsWith('.md') ? rel : `${rel}.md`
    const abs = `${workspacePath.replace(/\\/g, '/')}/${withExt}`
    const found = findFileByPathInTree(tree, abs)
    if (found) return { resolved: true, path: found }
    // 尝试不加扩展名（允许指向非 .md 文件）
    const absNoExt = `${workspacePath.replace(/\\/g, '/')}/${rel}`
    const foundNoExt = findFileByPathInTree(tree, absNoExt)
    if (foundNoExt) return { resolved: true, path: foundNoExt }
    return { resolved: false, path: '' }
  }

  // 2. 在当前文件目录及上级目录中查找
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
      const candidate = `${dir}/${normalizedTarget}`
      const found = findFileByPathInTree(tree, candidate)
      if (found) return { resolved: true, path: found }
    } else {
      // target 不含扩展名
      // 先尝试作为目录下的 index.md
      const indexPath = `${dir}/${normalizedTarget}/index.md`
      const indexFound = findFileByPathInTree(tree, indexPath)
      if (indexFound) return { resolved: true, path: indexFound }

      // 再尝试 target.md
      const mdPath = `${dir}/${normalizedTarget}.md`
      const mdFound = findFileByPathInTree(tree, mdPath)
      if (mdFound) return { resolved: true, path: mdFound }
    }
  }

  // 3. 全树逐文件模糊匹配（大小写不敏感的文件名匹配）
  const nameMatch = findFileByName(tree, normalizedTarget)
  if (nameMatch) return { resolved: true, path: nameMatch }

  return { resolved: false, path: '' }
}

/** 检查给定路径是否在文件树中（规范化比较） */
function findFileByPathInTree(
  tree: FolderTreeNode[],
  targetPath: string,
): string | null {
  const normalized = targetPath.replace(/\\/g, '/')
  const walk = (nodes: FolderTreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.children) {
        const found = walk(node.children)
        if (found) return found
      } else {
        const nodePath = node.path.replace(/\\/g, '/')
        if (nodePath === normalized) return node.path
      }
    }
    return null
  }
  return walk(tree)
}
