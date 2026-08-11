/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function encodeMdimgPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * 渲染前：把文档相对路径的图片解析为 mdimg 协议（编辑器才能加载本地图）
 * 仅处理非 mdimg/http/data 开头的相对路径
 */
export function toEditorImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  // 允许路径含空格（Typora 迁移文档常见）；仅排除已带协议的 src
  return md.replace(
    /!\[([^\]]*)\]\((?!mdimg:\/\/|https?:\/\/|data:)([^)]+)\)/g,
    (_m, alt: string, src: string) => {
      // 去掉尾部 title（"..."）与首尾空白
      const clean = src.trim().replace(/\s+"[^"]*"$/, '').replace(/^\.\//, '')
      return `![${alt}](mdimg:///${encodeMdimgPath(`${base}/${clean}`)})`
    },
  )
}

/**
 * 存储前：把 mdimg 绝对路径回写为相对路径（保证 .md 可移植，其它编辑器也能显示）
 * 仅回写落在当前文档目录下的图片
 */
export function toStoredImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  const prefixes = [`mdimg:///${encodeMdimgPath(base)}/`, `mdimg:///${base}/`]
  let result = md
  for (const prefix of prefixes) {
    if (!result.includes(prefix)) continue
    const re = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(prefix)}([^)]+)\\)`, 'g')
    result = result.replace(re, (_m, alt: string, rel: string) => {
      try {
        return `![${alt}](${decodeURIComponent(rel)})`
      } catch {
        return `![${alt}](${rel})`
      }
    })
  }
  return result
}
