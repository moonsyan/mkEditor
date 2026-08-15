/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function encodeMdimgPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** 将本地绝对路径转换为可安全写入 Markdown 的 mdimg URL。 */
export function toMdimgUrl(path: string): string {
  return `mdimg:///${encodeMdimgPath(path.replace(/\\/g, '/'))}`
}

/**
 * 图片 src 匹配模式：括号配对（支持一层嵌套，如 Windows 重复下载命名的
 * screenshot(1).png）。原实现 `[^)]+` 在文件名第一个 `)` 处截断——src 被
 * 截为 `screenshot(1`，剩余 `).png)` 变成正文裸文本，保存回写后文件名
 * 永久损坏且垃圾文本写进 .md。嵌套两层及以上无法匹配时保留原文（不损坏）。
 */
const IMAGE_SRC_PATTERN = /((?:[^()\r\n]|\([^()\r\n]*\))*)/

/**
 * 渲染前：把文档相对路径的图片解析为 mdimg 协议（编辑器才能加载本地图）
 * 仅处理非 mdimg/http/data 开头的相对路径
 */
export function toEditorImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  // 允许路径含空格（Typora 迁移文档常见）；仅排除已带协议的 src
  return md.replace(
    /!\[([^\]]*)\]\((?!mdimg:\/\/|https?:\/\/|data:)((?:[^()\r\n]|\([^()\r\n]*\))*)\)/g,
    (_m, alt: string, src: string) => {
      // 去掉尾部 title（"..."）与首尾空白
      const clean = src.trim().replace(/\s+"[^"]*"$/, '').replace(/^\.\//, '')
      return `![${alt}](${toMdimgUrl(`${base}/${clean}`)})`
    },
  )
}

/**
 * 存储前：把 mdimg 绝对路径回写为相对路径（保证 .md 可移植，其它编辑器也能显示）
 * 仅回写落在当前文档目录下的图片；目录外的 mdimg 兜底落盘为可移植的绝对路径
 */
export function toStoredImages(md: string, docDir: string | undefined): string {
  if (!docDir) return md
  const base = docDir.replace(/\\/g, '/')
  const prefixes = [`mdimg:///${encodeMdimgPath(base)}/`, `mdimg:///${base}/`]
  let result = md
  for (const prefix of prefixes) {
    if (!result.includes(prefix)) continue
    const re = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(prefix)}((?:[^()\\r\\n]|\\([^()\\r\\n]*\\))*)\\)`, 'g')
    result = result.replace(re, (_m, alt: string, rel: string) => {
      try {
        return `![${alt}](${decodeURIComponent(rel)})`
      } catch {
        return `![${alt}](${rel})`
      }
    })
  }
  // 兜底：目录外粘贴/文档移动等场景残留的 mdimg:/// 无法还原为相对路径，
  // 至少落盘为绝对路径（mdimg 协议对其它 Markdown 工具不可读，绝不允许写进文件）
  if (result.includes('mdimg:///')) {
    result = result.replace(/(!\[[^\]]*\]\()mdimg:\/\/((?:[^()\r\n]|\([^()\r\n]*\))*)(\))/g, (_m, pre: string, encoded: string, post: string) => {
      try {
        return `${pre}${decodeURIComponent(encoded)}${post}`
      } catch {
        return `${pre}${encoded}${post}`
      }
    })
  }
  return result
}
