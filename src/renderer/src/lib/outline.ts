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
  // 上一行是否为正文段落（setext 下划线必须紧跟段落才有意义）
  let prevWasParagraph = false
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 文档首行 `---` 开启 YAML frontmatter：其中 "title: xxx" 等键值会被
    // 下面的标题正则误判为 H2，先把整块跳过去
    if (i === 0 && /^---\s*$/.test(line)) {
      inFrontmatter = true
      prevWasParagraph = false
      continue
    }
    if (inFrontmatter) {
      if (/^---\s*$/.test(line)) {
        inFrontmatter = false
        prevWasParagraph = false
      }
      continue
    }
    // L9：围栏行可带 0-3 空格缩进（CommonMark）且可嵌在块引用内
    //（> ```），此前只认纯 ``` 开头——引用块里的代码围栏开闭都漏掉，
    // 其内部 `> # 伪标题` 被当成引用标题进入大纲。
    // 围栏开关行本身不是段落：toggle 后必须清掉段落状态，否则围栏关闭
    // 行后的 `===` 会误用围栏前的段落状态被当成 setext 下划线
    if (/^(?:[ ]{0,3})(?:>\s*)*(?:```+|~~~+)/.test(line)) {
      inFence = !inFence
      prevWasParagraph = false
      continue
    }
    if (inFence) continue
    // setext 下划线：`=` 恒为 setext h1；`-` 需 1-2 个且上一行是段落才成立
    //（3+ 的 `---` 是主题分隔线，优先级高于 setext——`前文\n---` 不是 h2）。
    // Milkdown 渲染层把 setext 生成真实 h1/h2 DOM，parseOutline 不识别时
    // outline 索引与 DOM 标题索引错位，点击大纲会滚动/高亮到错误的标题
    const setextMatch = line.match(/^[ ]{0,3}(?:>\s*)*(=+|-{1,2})\s*$/)
    if (prevWasParagraph && setextMatch) {
      const isH1 = setextMatch[1].includes('=')
      // 缩进/引用前缀剥掉后取上一行正文作为标题文本
      const text = lines[i - 1].replace(/^[ ]{0,3}(?:>\s*)*/, '').trim()
      headings.push({ level: isH1 ? 1 : 2, text })
      prevWasParagraph = false
      continue
    }
    // L9：标题前最多允许 3 个空格缩进——4 空格缩进的代码块里的
    // `    # 伪标题` 是缩进代码不是标题；只用空格计数，tab 在 CommonMark
    // 中等于 4 空格（缩进代码块），`\t# x` 不是标题（原实现 `\s{0,3}`
    // 会匹配 tab 造成误判进大纲）
    const match = line.match(/^[ ]{0,3}(?:>\s*)*(#{1,4})\s+(.+)$/)
    if (match) {
      headings.push({ level: match[1].length, text: match[2] })
      prevWasParagraph = false
      continue
    }
    // 行尾更新段落状态：围栏/frontmatter/空行/标题行/分隔线/列表项不算段落
    prevWasParagraph =
      line.trim() !== '' &&
      !/^[ ]{0,3}(?:>\s*)*(#{1,4})\s+/.test(line) &&
      !/^[ ]{0,3}(?:>\s*)*(=+|-+)\s*$/.test(line) &&
      !/^[ ]{0,3}(?:>\s*)*[-*+]\s+/.test(line)
  }
  return buildOutlineTree(headings)
}
