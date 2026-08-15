import { net } from 'electron'
import { readFile, realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import { getTrustedRoots, isPathTrusted } from './trusted-paths'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

/**
 * 图片读取白名单目录（H1 修复）：FILE_READ 读取 .md 后仅授其目录的
 * "图片读取"权限，不再升级为完整信任（写/删/搜）。
 * 工作区打开与原生对话框选择仍走完整信任根（trusted-paths.ts）。
 */
const imageReadDirs = new Map<string, true>()

/** 图片读取白名单数量上限：超出时淘汰最早加入的 */
const MAX_IMAGE_READ_DIRS = 64

/** FILE_READ 读取 .md 后调用：仅允许该目录下的图片经 mdimg 协议读取 */
export function allowImageDirectory(directory: string): void {
  if (!directory) return
  const dir = resolve(directory)
  if (imageReadDirs.has(dir)) return
  if (imageReadDirs.size >= MAX_IMAGE_READ_DIRS) {
    const oldest = imageReadDirs.keys().next().value
    if (oldest !== undefined) imageReadDirs.delete(oldest)
  }
  imageReadDirs.set(dir, true)
}

export function getImageReadDirs(): string[] {
  return Array.from(imageReadDirs.keys())
}

/** 路径是否位于任一图片读取白名单目录内（供 mdimg 协议与只读 IPC 使用） */
export function isImageDirAllowed(filePath: string): boolean {
  const resolved = resolve(filePath)
  const dirs = Array.from(imageReadDirs.keys())
  for (let i = 0; i < dirs.length; i++) {
    const pathFromRoot = relative(dirs[i], resolved)
    if (
      pathFromRoot === '' ||
      (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
    ) {
      return true
    }
  }
  return false
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const pathFromRoot = relative(rootPath, filePath)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  )
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

/**
 * 解析 mdimg:// URL 并执行完整信任校验（词汇级根目录/白名单 + realpath 防
 * 符号链接逃逸）。任一环节失败返回 null。协议读取与导出内联 IPC 共用，
 * 保证两条读取路径的权限边界完全一致。
 */
async function resolveAllowedImagePath(requestUrl: string): Promise<string | null> {
  try {
    const url = new URL(requestUrl)
    if (url.host) return null

    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    const resolvedPath = resolve(filePath)
    if (!IMAGE_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) return null
    // L2：先做词汇级信任检查快速拒绝，再走 realpath 防符号链接逃逸。
    // 完整信任根 + 图片读取白名单两处均可放行读取
    if (!isPathTrusted(resolvedPath) && !isImageDirAllowed(resolvedPath)) {
      return null
    }

    const realFilePath = await realpath(resolvedPath)
    const roots = await Promise.all(
      [...getTrustedRoots(), ...getImageReadDirs()].map(async (root) =>
        realpath(root).catch(() => null),
      ),
    )
    if (!roots.some((root) => root && isPathWithinRoot(realFilePath, root))) {
      return null
    }
    return realFilePath
  } catch {
    return null
  }
}

/** 为 mdimg 协议建立受限的本地图片读取，拒绝目录外及非图片资源。 */
export async function fetchAllowedImage(requestUrl: string): Promise<Response> {
  const realFilePath = await resolveAllowedImagePath(requestUrl)
  if (!realFilePath) return notFound()
  return net.fetch(pathToFileURL(realFilePath).toString())
}

/** 导出内联单张图片大小上限：base64 经 IPC 一次性传输且写进导出文件，超限拒绝防 OOM */
const MAX_INLINE_IMAGE_BYTES = 64 * 1024 * 1024

/**
 * 导出 HTML/PDF 内联用：把受信任的 mdimg:// URL 读为 base64 data URL。
 * 渲染层 fetch() 自定义 scheme 被 Blink 拒绝（TypeError），图片内联必须
 * 走主进程（只读 IPC 入口，信任校验与 mdimg 协议完全一致）。
 */
export async function readImageAsDataUrl(requestUrl: string): Promise<string | null> {
  try {
    const realFilePath = await resolveAllowedImagePath(requestUrl)
    if (!realFilePath) return null
    const data = await readFile(realFilePath)
    if (data.length > MAX_INLINE_IMAGE_BYTES) return null
    const ext = extname(realFilePath).slice(1).toLowerCase()
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}
