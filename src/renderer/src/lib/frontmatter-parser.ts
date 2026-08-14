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
    if (!rawValue.endsWith('"') || rawValue.length < 2 || rawValue.includes('\\')) return null
    if (rawValue.slice(1, -1).includes('"')) return null
    return {
      key: match[1],
      value: rawValue.slice(1, -1),
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

const findTopLevelPropertyIndex = (lines: string[], key: string): number => {
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+)[ \t]*:/.exec(lines[i])
    if (match?.[1] === key) return i
  }
  return -1
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
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        return `${key}: "${escaped}"`
      }
      return `${key}: ${value}`
    })
    .join('\n')
}

function getLineBreak(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function formatFrontmatterLine(
  key: string,
  value: string,
  preferredQuote: ScalarQuote = null,
): string {
  if (preferredQuote === 'single') {
    return `${key}: '${value.replace(/'/g, "''")}'`
  }

  if (preferredQuote === 'double') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `${key}: "${escaped}"`
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
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `${key}: "${escaped}"`
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
  const index = findTopLevelPropertyIndex(lines, key)
  if (index >= 0) {
    const property = parseSafePropertyLine(lines[index])
    if (!property) return markdown
    lines[index] = formatFrontmatterLine(key, value, property.quote)
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
  const index = findTopLevelPropertyIndex(lines, key)
  if (index < 0) return markdown
  if (!parseSafePropertyLine(lines[index])) return markdown

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
