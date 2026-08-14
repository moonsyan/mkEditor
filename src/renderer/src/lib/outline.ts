export interface OutlineNode {
  idx: number
  level: number
  text: string
  children: OutlineNode[]
}

const buildOutlineTree = (headings: { level: number; text: string }[]): OutlineNode[] => {
  const root: OutlineNode[] = []
  const stack: OutlineNode[] = []
  headings.forEach((heading, idx) => {
    const node: OutlineNode = {
      idx,
      level: heading.level,
      text: heading.text,
      children: [],
    }
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else root.push(node)
    stack.push(node)
  })
  return root
}

/** 提取正文与引用块中的 h1-h4，忽略代码围栏内的伪标题与 YAML frontmatter。 */
export const parseOutline = (content: string): OutlineNode[] => {
  const headings: { level: number; text: string }[] = []
  let inFence = false
  let inFrontmatter = false
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 文档首行 `---` 开启 YAML frontmatter：其中 "title: xxx" 等键值会被
    // 下面的标题正则误判为 H2，先把整块跳过去
    if (i === 0 && /^---\s*$/.test(line)) {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (/^---\s*$/.test(line)) inFrontmatter = false
      continue
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = line.match(/^\s*(?:>\s*)*(#{1,4})\s+(.+)$/)
    if (match) headings.push({ level: match[1].length, text: match[2] })
  }
  return buildOutlineTree(headings)
}
