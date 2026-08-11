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

/** 提取正文与引用块中的 h1-h4，忽略代码围栏内的伪标题。 */
export const parseOutline = (content: string): OutlineNode[] => {
  const headings: { level: number; text: string }[] = []
  let inFence = false
  for (const line of content.split('\n')) {
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
