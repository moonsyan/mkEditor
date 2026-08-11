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

/**
 * 从 Markdown 内容中提取 frontmatter 原始文本。
 * 返回 { text, start, end } 或 null。
 */
export function extractFrontmatterRaw(
  markdown: string,
): { text: string; start: number; end: number } | null {
  if (!markdown.startsWith('---')) return null
  const endIdx = markdown.indexOf('\n---', 3)
  if (endIdx < 0) return null
  return {
    text: markdown.slice(4, endIdx),
    start: 0,
    end: endIdx + 4,
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
    return rest.startsWith('\n') ? rest.slice(1) : rest
  }

  return markdown
}
