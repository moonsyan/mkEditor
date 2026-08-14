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
    // L9：围栏行可带 0-3 空格缩进（CommonMark）且可嵌在块引用内
    //（> ```），此前只认纯 ``` 开头——引用块里的代码围栏开闭都漏掉，
    // 其内部 `> # 伪标题` 被当成引用标题进入大纲
    if (/^(?:\s{0,3})(?:>\s*)*(?:```+|~~~+)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // L9：标题前最多允许 3 个空格缩进——4 空格缩进的代码块里的
    // `    # 伪标题` 是缩进代码不是标题（CommonMark 同样限制 3 空格）
    const match = line.match(/^\s{0,3}(?:>\s*)*(#{1,4})\s+(.+)$/)
    if (match) headings.push({ level: match[1].length, text: match[2] })
  }
  return buildOutlineTree(headings)
}
