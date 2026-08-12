/* ==================== YAML Frontmatter 简单解析器 ==================== */

/**
 * 解析 YAML frontmatter 文本为键值对记录。
 * 支持：简单键值对（key: value）、引号包裹的值、单行数组 [a, b, c]
 * 嵌套对象/多行数组等复杂结构作为原始文本保留。
 */
export function parseFrontmatterYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text || !text.trim()) return result

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue

    // 不可能是键值对的情况：之后是另一个冒号之前没有非空格
    // 确保冒号后至少有一个空格（标准 YAML 要求）
    if (colonIdx + 1 >= trimmed.length) continue

    const key = trimmed.slice(0, colonIdx).trim()
    if (!key || key.includes(' ')) continue // 嵌套情况跳过

    let value = trimmed.slice(colonIdx + 1).trim()

    // 去除前后引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // 解析转义引号
    value = value.replace(/\\"/g, '"').replace(/\\'/g, "'")

    result[key] = value
  }

  return result
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

function formatFrontmatterLine(key: string, value: string): string {
  const needsQuotes =
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

function findFrontmatterKeyIndex(lines: string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    if (match[1] === key) return i
  }
  return -1
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

  // 空属性：移除 frontmatter
  if (existing) {
    const rest = markdown.slice(existing.end)
    if (rest.startsWith('\r\n')) return rest.slice(2)
    if (rest.startsWith('\n')) return rest.slice(1)
    return rest
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
  const existing = extractFrontmatterRaw(markdown)
  const lineBreak = getLineBreak(markdown)
  const nextLine = formatFrontmatterLine(key, value)

  if (!existing) {
    return `---${lineBreak}${nextLine}${lineBreak}---${lineBreak}${lineBreak}${markdown}`
  }

  const lines = existing.text.split(/\r?\n/)
  const index = findFrontmatterKeyIndex(lines, key)
  if (index >= 0) {
    lines[index] = nextLine
  } else {
    lines.push(nextLine)
  }
  const replacement = `---${lineBreak}${lines.join(lineBreak)}${lineBreak}---`
  return replacement + markdown.slice(existing.end)
}

/**
 * 删除 frontmatter 中的单个属性，尽量保留其余原始 YAML 行与注释。
 */
export function deleteFrontmatterProperty(markdown: string, key: string): string {
  const existing = extractFrontmatterRaw(markdown)
  if (!existing) return markdown

  const lineBreak = getLineBreak(markdown)
  const lines = existing.text.split(/\r?\n/)
  const index = findFrontmatterKeyIndex(lines, key)
  if (index < 0) return markdown

  lines.splice(index, 1)
  if (lines.length === 0) {
    const rest = markdown.slice(existing.end)
    if (rest.startsWith('\r\n')) return rest.slice(2)
    if (rest.startsWith('\n')) return rest.slice(1)
    return rest
  }

  const replacement = `---${lineBreak}${lines.join(lineBreak)}${lineBreak}---`
  return replacement + markdown.slice(existing.end)
}
