/* ==================== YAML Frontmatter 简单解析器 ==================== */

const FRONTMATTER_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

type ScalarQuote = 'single' | 'double' | null

interface SafePropertyLine {
  key: string
  value: string
  quote: ScalarQuote
}

export function isValidFrontmatterPropertyKey(key: string): boolean {
  return FRONTMATTER_KEY_PATTERN.test(key)
}

const parseSafePropertyLine = (line: string): SafePropertyLine | null => {
  const match = /^([A-Za-z0-9_-]+)[ \t]*:(?:[ \t]+(.*))?$/.exec(line)
  if (!match) return null

  const rawValue = match[2]?.trim() ?? ''
  if (!rawValue) return null
  if (/^(?:\[|\{|[|>&*!?]|-\s)/.test(rawValue)) return null

  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"') || rawValue.length < 2) return null
    // L10：此前值里含 \ 或 " 一律拒绝（→ null），formatFrontmatterLine 写入的
    // "a\nb"（换行转义）读不回来，属性从面板消失且无法再编辑。
    // 改为解码常见转义（\\、\"、\n、\t、\r），未知转义原样保留——往返无损
    const inner = rawValue.slice(1, -1)
    let decoded = ''
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k]
      if (c !== '\\' || k + 1 >= inner.length) {
        decoded += c
        continue
      }
      const n = inner[k + 1]
      if (n === 'n') decoded += '\n'
      else if (n === 't') decoded += '\t'
      else if (n === 'r') decoded += '\r'
      else if (n === '"') decoded += '"'
      else if (n === '\\') decoded += '\\'
      else {
        decoded += c + n // 未知转义（如 \u、\x）保留原样
      }
      k++
    }
    return {
      key: match[1],
      value: decoded,
      quote: 'double',
    }
  }

  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'") || rawValue.length < 2) return null
    const innerValue = rawValue.slice(1, -1)
    if (innerValue.replace(/''/g, '').includes("'")) return null
    return {
      key: match[1],
      value: innerValue.replace(/''/g, "'"),
      quote: 'single',
    }
  }

  // 行内注释和映射样式值无法在轻量表单中无损往返，留在原始 YAML 中编辑。
  if (/(?:^|\s)#/.test(rawValue) || /:\s/.test(rawValue)) return null

  return { key: match[1], value: rawValue, quote: null }
}

/**
 * L18：重复键时 YAML 语义以最后一次出现为准，parseFrontmatterYaml 也是
 * 后写覆盖先写。编辑/删除必须作用于最后一行，否则面板显示的是最后一行、
 * 改的却是第一行，看起来"没生效"。
 */
const findLastPropertyIndex = (lines: string[], key: string): number => {
  let found = -1
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+)[ \t]*:/.exec(lines[i])
    if (match?.[1] === key) found = i
  }
  return found
}

/**
 * 解析 YAML frontmatter 文本为键值对记录。
 * 只返回可无损行级写回的顶层单行标量；数组、对象和多行值保留在原始 YAML 中。
 */
export function parseFrontmatterYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text || !text.trim()) return result

  const lines = text.split('\n')
  for (const line of lines) {
    const property = parseSafePropertyLine(line.replace(/\r$/, ''))
    if (!property) continue
    result[property.key] = property.value
  }

  return result
}

/** 返回所有可识别的顶层属性名，包括未在属性面板展示的复杂属性。 */
export function getFrontmatterPropertyKeys(text: string): string[] {
  const keys: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)[ \t]*:/.exec(line)
    if (match) keys.push(match[1])
  }
  return keys
}

/**
 * 将键值对格式化为 YAML frontmatter 文本行（不含 --- 围栏）。
 * 值含特殊字符时用双引号包裹。
 */
export function formatFrontmatterYaml(props: Record<string, string>): string {
  const entries = Object.entries(props)
  if (entries.length === 0) return ''

  return entries
    .map(([key, value]) => {
      const needsQuotes =
        value.length === 0 ||
        /[:\n#"']/.test(value) ||
        value.startsWith(' ') ||
        value.endsWith(' ') ||
        value.startsWith('- ') ||
        value.startsWith('[') ||
        value.startsWith('{')

      if (needsQuotes) {
        return `${key}: "${escapeDoubleQuoted(value)}"`
      }
      return `${key}: ${value}`
    })
    .join('\n')
}

function getLineBreak(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** 双引号转义（L10：换行/回车必须转义，否则值里的真实换行会把单行
 *  YAML 撑成多行，解析器按行拆分后属性丢失） */
const escapeDoubleQuoted = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')

function formatFrontmatterLine(
  key: string,
  value: string,
  preferredQuote: ScalarQuote = null,
): string {
  if (preferredQuote === 'single') {
    if (/[\r\n]/.test(value)) {
      // 单引号内无法表示换行，含换行的值改用双引号 + \n 转义
      return `${key}: "${escapeDoubleQuoted(value)}"`
    }
    return `${key}: '${value.replace(/'/g, "''")}'`
  }

  if (preferredQuote === 'double') {
    return `${key}: "${escapeDoubleQuoted(value)}"`
  }

  const needsQuotes =
    value.length === 0 ||
    /[:\n#"']/.test(value) ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value.startsWith('- ') ||
    value.startsWith('[') ||
    value.startsWith('{')

  if (needsQuotes) {
    return `${key}: "${escapeDoubleQuoted(value)}"`
  }
  return `${key}: ${value}`
}

/**
 * 从 Markdown 内容中提取 frontmatter 原始文本。
 * 返回 { text, start, end } 或 null。
 */
export function extractFrontmatterRaw(
  markdown: string,
): { text: string; start: number; end: number } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(markdown)
  if (!match) return null
  const trailerLength = match[2]?.length ?? 0
  return {
    text: match[1],
    start: 0,
    end: match.index + match[0].length - trailerLength,
  }
}

/**
 * L17：移除整个 frontmatter 后处理紧邻的分隔空行——
 * `---\n...\n---\n\nbody` 的 rest 是 `\n\nbody`，只去一个 \n 会残留 `\nbody`。
 * 最多去掉两个换行（frontmatter 与正文之间的一行空行），正文前不留空行；
 * 作者多留的空行保留一个。
 */
const stripFrontmatterGap = (rest: string): string => {
  let out = rest
  if (out.startsWith('\r\n')) out = out.slice(2)
  else if (out.startsWith('\n')) out = out.slice(1)
  if (out.startsWith('\r\n')) out = out.slice(2)
  else if (out.startsWith('\n')) out = out.slice(1)
  return out
}

/**
 * 替换 Markdown 中的 frontmatter 为新的 YAML 文本。
 */
export function replaceFrontmatter(
  markdown: string,
  newProps: Record<string, string>,
): string {
  const existing = extractFrontmatterRaw(markdown)
  const newYaml = formatFrontmatterYaml(newProps)

  if (newYaml) {
    const replacement = `---\n${newYaml}\n---`
    if (existing) {
      return replacement + markdown.slice(existing.end)
    }
    return replacement + '\n\n' + markdown
  }

  // 空属性：移除 frontmatter（连分隔空行一起，见 stripFrontmatterGap）
  if (existing) {
    return stripFrontmatterGap(markdown.slice(existing.end))
  }

  return markdown
}

/**
 * 更新 frontmatter 中的单个属性，尽量保留其余原始 YAML 行与注释。
 */
export function setFrontmatterProperty(
  markdown: string,
  key: string,
  value: string,
): string {
  if (!isValidFrontmatterPropertyKey(key)) return markdown

  const existing = extractFrontmatterRaw(markdown)
  const lineBreak = getLineBreak(markdown)

  if (!existing) {
    const nextLine = formatFrontmatterLine(key, value)
    return `---${lineBreak}${nextLine}${lineBreak}---${lineBreak}${lineBreak}${markdown}`
  }

  const lines = existing.text.split(/\r?\n/)
  let index = findLastPropertyIndex(lines, key)
  if (index >= 0) {
    let property = parseSafePropertyLine(lines[index])
    if (!property) {
      // L10：最后一行是不可行级回写的复杂值（tags: [a, b]、| 多行块、
      // https:// 等），面板改值此前静默失败、什么也不发生。向上找最近
      // 一个可解析的同键旧行覆盖；都没有则追加新行（last-wins，语义正确）
      let fallback = -1
      for (let j = index - 1; j >= 0; j--) {
        const m = /^([A-Za-z0-9_-]+)[ \t]*:/.exec(lines[j])
        if (m?.[1] !== key) continue
        const p = parseSafePropertyLine(lines[j])
        if (p) {
          fallback = j
          property = p
          break
        }
      }
      if (fallback < 0) {
        lines.push(formatFrontmatterLine(key, value))
        const replacement = `---${lineBreak}${lines.join(lineBreak)}${lineBreak}---`
        return replacement + markdown.slice(existing.end)
      }
      index = fallback
    }
    // 到达此处时 property 必非空：要么初值可解析，要么 fallback 循环
    // 已赋值（fallback < 0 分支提前 return 了）
    lines[index] = formatFrontmatterLine(key, value, property!.quote)
  } else {
    lines.push(formatFrontmatterLine(key, value))
  }
  const replacement = `---${lineBreak}${lines.join(lineBreak)}${lineBreak}---`
  return replacement + markdown.slice(existing.end)
}

/**
 * 删除 frontmatter 中的单个属性，尽量保留其余原始 YAML 行与注释。
 */
export function deleteFrontmatterProperty(markdown: string, key: string): string {
  if (!isValidFrontmatterPropertyKey(key)) return markdown

  const existing = extractFrontmatterRaw(markdown)
  if (!existing) return markdown

  const lineBreak = getLineBreak(markdown)
  const lines = existing.text.split(/\r?\n/)
  const index = findLastPropertyIndex(lines, key)
  if (index < 0) return markdown
  // L10：仅块标量（| 或 > 开头，多行值）不能只删键行——会留下孤立的
  // 缩进行、破坏 frontmatter 结构。其余单行值（数组/映射/URL/注释等）
  // 此前因 parseSafePropertyLine 返回 null 而拒删，属性无法从面板删除
  if (/^[A-Za-z0-9_-]+[ \t]*:[ \t]*[|>]/.test(lines[index])) return markdown

  lines.splice(index, 1)
  const hasYamlContent = lines.some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#')
  })
  if (!hasYamlContent) {
    // L17：连分隔空行一起去掉（见 stripFrontmatterGap）
    return stripFrontmatterGap(markdown.slice(existing.end))
  }

  const replacement = `---${lineBreak}${lines.join(lineBreak)}${lineBreak}---`
  return replacement + markdown.slice(existing.end)
}
