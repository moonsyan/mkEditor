import { TextSelection } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'

type GetPos = () => number | undefined

const MERMAID_RENDER_DELAY = 180
const MERMAID_RENDER_TIMEOUT = 4000
let diagramSequence = 0
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
const activeViews = new Set<MermaidCodeBlockView>()
const renderListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null

const observeThemeChanges = () => {
  if (themeObserver || typeof MutationObserver === 'undefined') return
  themeObserver = new MutationObserver(() => {
    activeViews.forEach((view) => view.rerender())
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

export const isMermaidLanguage = (language: unknown): boolean =>
  typeof language === 'string' && language.trim().toLowerCase() === 'mermaid'

export const shouldRenderMermaidUpdate = (editingSource: boolean): boolean => !editingSource

const getMermaid = () => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => mermaid)
  }
  return mermaidPromise
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message.split('\n')[0]
  return '请检查 Mermaid 语法'
}

class MermaidCodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private readonly isMermaid: boolean
  private readonly view: EditorView
  private readonly getPos: GetPos
  private readonly preview: HTMLElement | null
  private readonly status: HTMLElement | null
  private readonly toggle: HTMLButtonElement | null
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  private renderPromise: Promise<void> | null = null
  private renderVersion = 0
  private lastSource = ''
  private editing = false

  constructor(node: ProseNode, view: EditorView, getPos: GetPos) {
    this.isMermaid = isMermaidLanguage(node.attrs.language)
    this.view = view
    this.getPos = getPos

    if (!this.isMermaid) {
      const pre = document.createElement('pre')
      const language = node.attrs.language as string
      if (language) pre.dataset.language = language
      const code = document.createElement('code')
      pre.append(code)
      this.dom = pre
      this.contentDOM = code
      this.preview = null
      this.status = null
      this.toggle = null
      return
    }

    const container = document.createElement('section')
    container.className = 'mermaid-block'
    container.dataset.language = 'mermaid'

    const toolbar = document.createElement('div')
    toolbar.className = 'mermaid-toolbar'
    toolbar.contentEditable = 'false'
    const label = document.createElement('span')
    label.className = 'mermaid-label'
    label.textContent = 'Mermaid'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'mermaid-source-toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = '编辑源码'
    toolbar.append(label, toggle)

    const preview = document.createElement('div')
    preview.className = 'mermaid-preview'
    preview.setAttribute('aria-live', 'polite')
    const status = document.createElement('div')
    status.className = 'mermaid-status'
    status.textContent = '正在加载图表…'
    preview.append(status)

    const source = document.createElement('pre')
    source.className = 'mermaid-source'
    source.spellcheck = false
    const code = document.createElement('code')
    source.append(code)
    container.append(toolbar, preview, source)

    this.dom = container
    this.contentDOM = code
    this.preview = preview
    this.status = status
    this.toggle = toggle
    this.toggle.addEventListener('click', this.handleToggleSource)
    activeViews.add(this)
    observeThemeChanges()
    this.scheduleRender(node.textContent, true)
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'code_block') return false
    if (this.isMermaid !== isMermaidLanguage(node.attrs.language)) return false
    if (!this.isMermaid) {
      const language = node.attrs.language as string
      if (language) this.dom.dataset.language = language
      else delete this.dom.dataset.language
      return true
    }
    if (!shouldRenderMermaidUpdate(this.editing)) {
      this.captureSource(node.textContent)
      return true
    }
    this.scheduleRender(node.textContent)
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Element && Boolean(event.target.closest('.mermaid-toolbar'))
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (!this.isMermaid || mutation.type === 'selection') return false
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
    return Boolean(target?.closest('.mermaid-preview, .mermaid-toolbar'))
  }

  destroy(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    if (this.toggle) this.toggle.removeEventListener('click', this.handleToggleSource)
    activeViews.delete(this)
    if (activeViews.size === 0 && themeObserver) {
      themeObserver.disconnect()
      themeObserver = null
    }
  }

  ensureRendered = (): Promise<void> => {
    if (!this.isMermaid) return Promise.resolve()
    if (this.editing) {
      this.render(this.lastSource)
      return this.renderPromise ?? Promise.resolve()
    }
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = undefined
      this.render(this.lastSource)
    }
    return this.renderPromise ?? Promise.resolve()
  }

  rerender = () => {
    if (!this.isMermaid || this.editing) return
    this.scheduleRender(this.lastSource, true)
  }

  private handleToggleSource = () => {
    if (!this.isMermaid || !this.toggle) return
    this.editing = !this.editing
    this.dom.classList.toggle('is-editing', this.editing)
    this.toggle.setAttribute('aria-expanded', String(this.editing))
    this.toggle.textContent = this.editing ? '收起源码' : '编辑源码'
    if (!this.editing) {
      this.scheduleRender(this.lastSource, true)
      return
    }
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = undefined
    }
    // 使正在进行的旧渲染失效，避免打开源码后回写过时 SVG。
    this.renderVersion += 1
    requestAnimationFrame(() => {
      const pos = this.getPos()
      if (typeof pos !== 'number') return
      this.view.dispatch(
        this.view.state.tr
          .setSelection(TextSelection.create(this.view.state.doc, pos + 1))
          .scrollIntoView(),
      )
      this.view.focus()
    })
  }

  private scheduleRender(source: string, immediate = false) {
    this.captureSource(source)
    if (this.renderTimer) clearTimeout(this.renderTimer)
    if (immediate) {
      this.render(source)
      return
    }
    this.status?.replaceChildren(document.createTextNode('正在更新图表…'))
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.render(source)
    }, MERMAID_RENDER_DELAY)
  }

  private captureSource(source: string) {
    this.lastSource = source
    this.renderVersion += 1
  }

  private render(source: string) {
    const preview = this.preview
    const status = this.status
    if (!preview || !status) return
    const version = this.renderVersion
    if (!source.trim()) {
      preview.replaceChildren(status)
      status.textContent = '输入 Mermaid 图表源码'
      this.renderPromise = Promise.resolve()
      return
    }
    preview.replaceChildren(status)
    status.classList.remove('is-error')
    status.textContent = '正在渲染图表…'
    this.renderPromise = getMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        })
        const id = `markdownsoft-mermaid-${diagramSequence++}`
        const { svg, bindFunctions } = await mermaid.render(id, source)
        if (version !== this.renderVersion || preview !== this.preview) return
        // Mermaid 在 strict 模式下生成 SVG，避免把未经处理的 Markdown 直接写入 DOM。
        preview.innerHTML = svg
        bindFunctions?.(preview)
      })
      .catch((error: unknown) => {
        if (version !== this.renderVersion || preview !== this.preview) return
        preview.replaceChildren(status)
        status.textContent = `图表语法错误：${getErrorMessage(error)}`
        status.classList.add('is-error')
      })
      .finally(() => {
        if (version !== this.renderVersion || status !== this.status) return
        renderListeners.forEach((listener) => listener())
      })
  }
}

export const mermaidCodeBlockView = (
  node: ProseNode,
  view: EditorView,
  getPos: GetPos,
): NodeView => new MermaidCodeBlockView(node, view, getPos)

export const ensureMermaidRendered = async (): Promise<void> => {
  const renders = Array.from(activeViews, (view) => view.ensureRendered())
  if (renders.length === 0) return
  await Promise.race([
    Promise.all(renders).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, MERMAID_RENDER_TIMEOUT)),
  ])
}

export const subscribeMermaidRender = (listener: () => void): (() => void) => {
  renderListeners.add(listener)
  return () => renderListeners.delete(listener)
}
