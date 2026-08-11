import { net } from 'electron'
import { realpath } from 'fs/promises'
import { extname, isAbsolute, relative, resolve } from 'path'
import { pathToFileURL } from 'url'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const allowedImageRoots = new Set<string>()

/** 仅允许已由用户打开的文档或工作区目录作为本地图片来源。 */
export function allowImageDirectory(directory: string): void {
  if (!directory) return
  allowedImageRoots.add(resolve(directory))
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

/** 为 mdimg 协议建立受限的本地图片读取，拒绝目录外及非图片资源。 */
export async function fetchAllowedImage(requestUrl: string): Promise<Response> {
  try {
    const url = new URL(requestUrl)
    if (url.host) return notFound()

    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }
    const resolvedPath = resolve(filePath)
    if (!IMAGE_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) return notFound()

    const realFilePath = await realpath(resolvedPath)
    const roots = await Promise.all(
      Array.from(allowedImageRoots, async (root) => realpath(root).catch(() => null)),
    )
    if (!roots.some((root) => root && isPathWithinRoot(realFilePath, root))) {
      return notFound()
    }
    return net.fetch(pathToFileURL(realFilePath).toString())
  } catch {
    return notFound()
  }
}
