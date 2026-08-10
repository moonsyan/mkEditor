/**
 * PDF 目录页：给正文标题打锚点 id，并在开头生成可跳转的目录块。
 * 标题少于 2 个时不生成。
 */
export function injectToc(body: string): string {
  try {
    const docEl = new DOMParser().parseFromString(
      `<div id="__mdroot">${body}</div>`,
      'text/html',
    )
    const root = docEl.getElementById('__mdroot')
    if (!root) return body
    const heads = Array.from(root.querySelectorAll('h1, h2, h3'))
    if (heads.length < 2) return body
    const items = heads
      .map((h, i) => {
        const id = `mdsoft-toc-${i}`
        h.id = id
        const lv = Number(h.tagName.slice(1))
        const text = (h.textContent ?? '').replace(/</g, '&lt;')
        return `<li class="toc-l${lv}"><a href="#${id}">${text}</a></li>`
      })
      .join('')
    return (
      `<div class="doc-toc"><div class="doc-toc-title">目录</div><ol class="doc-toc-list">${items}</ol></div>` +
      root.innerHTML
    )
  } catch {
    return body
  }
}
