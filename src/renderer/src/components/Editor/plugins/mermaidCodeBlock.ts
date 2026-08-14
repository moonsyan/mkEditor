import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { analyzeDecorationChange } from './decoOptimize'

const MERMAID_RENDER_DELAY = 420
const MERMAID_RENDER_TIMEOUT = 4000
let diagramSequence = 0
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
const activePreviews = new Set<MermaidPreview>()
const renderListeners = new Set<() => void>()
let themeObserver: MutationObserver | null = null

type MermaidBlock = {
  pos: number
  language: string
}

type MermaidPreviewState = {
  decorations: DecorationSet
  blocks: MermaidBlock[]
}

export const isMermaidLanguage = (language: unknown): boolean =>
  typeof language === 'string' && language.trim().toLowerCase() === 'mermaid'

export const isSelectionInsideMermaidBlock = (
  from: number,
  to: number,
  blockPos: number,
  blockSize: number,
): boolean => from >= blockPos + 1 && to <= blockPos + blockSize - 1

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

const observeThemeChanges = () => {
  if (themeObserver || typeof MutationObserver === 'undefined') return
  themeObserver = new MutationObserver(() => {
    activePreviews.forEach((preview) => preview.renderNow())
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

class MermaidPreview {
  readonly dom: HTMLElement

  private readonly preview: HTMLElement
  private readonly status: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly getPos: () => number | undefined
  private readonly view: EditorView
  private source = ''
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  private renderPromise: Promise<void> | null = null
  private renderVersion = 0
  private isEditingSource = false

  constructor(view: EditorView, getPos: () => number | undefined, source: string) {
    this.view = view
    this.getPos = getPos
    this.source = source

    const container = document.createElement('section')
    container.className = 'mermaid-block'
    container.contentEditable = 'false'
    const toolbar = document.createElement('div')
    toolbar.className = 'mermaid-toolbar'
    const label = document.createElement('span')
    label.className = 'mermaid-label'
    label.textContent = 'Mermaid'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mermaid-source-toggle'
    button.textContent = '编辑源码'
    button.setAttribute('aria-label', '编辑 Mermaid 源码')
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', this.handleToggleSource)
    toolbar.append(label, button)

    const preview = document.createElement('div')
    preview.className = 'mermaid-preview'
    preview.setAttribute('aria-live', 'polite')
    const status = document.createElement('div')
    status.className = 'mermaid-status'
    status.textContent = '正在加载图表…'
    preview.append(status)
    container.append(toolbar, preview)

    this.dom = container
    this.preview = preview
    this.status = status
    this.button = button
    activePreviews.add(this)
    observeThemeChanges()
    this.renderNow()
  }

  updateSource(source: string) {
    if (source === this.source) return
    this.source = source
    this.renderVersion += 1
    if (this.renderTimer) clearTimeout(this.renderTimer)
    // 编辑源码时维持既有 SVG，停止输入后再更新，避免干扰光标与视觉闪烁。
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.renderNow()
    }, MERMAID_RENDER_DELAY)
  }

  renderNow = (): Promise<void> => {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = undefined
    }
    this.renderVersion += 1
    const version = this.renderVersion
    const source = this.source
    if (!source.trim()) {
      this.preview.replaceChildren(this.status)
      this.status.textContent = '输入 Mermaid 图表源码'
      this.renderPromise = Promise.resolve()
      return this.renderPromise
    }
    this.preview.replaceChildren(this.status)
    this.status.classList.remove('is-error')
    this.status.textContent = '正在渲染图表…'
    this.renderPromise = getMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        })
        const id = `markdownsoft-mermaid-${diagramSequence++}`
        const { svg, bindFunctions } = await mermaid.render(id, source)
        if (version !== this.renderVersion) return
        // Mermaid 在 strict 模式下生成 SVG，避免把未经处理的 Markdown 直接写入 DOM。
        this.preview.innerHTML = svg
        bindFunctions?.(this.preview)
      })
      .catch((error: unknown) => {
        if (version !== this.renderVersion) return
        this.preview.replaceChildren(this.status)
        this.status.textContent = `图表语法错误：${getErrorMessage(error)}`
        this.status.classList.add('is-error')
      })
      .finally(() => {
        if (version !== this.renderVersion) return
        renderListeners.forEach((listener) => listener())
      })
    return this.renderPromise
  }

  destroy = () => {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.button.removeEventListener('click', this.handleToggleSource)
    activePreviews.delete(this)
    if (activePreviews.size === 0 && themeObserver) {
      themeObserver.disconnect()
      themeObserver = null
    }
  }

  getSourcePosition = (): number | undefined => this.getPos()

  syncSelection = () => {
    const codePos = this.getPos()
    if (typeof codePos !== 'number') return
    const codeNode = this.view.state.doc.nodeAt(codePos)
    const { from, to } = this.view.state.selection
    const isInsideCodeBlock =
      codeNode &&
      codeNode.type.name === 'code_block' &&
      isSelectionInsideMermaidBlock(from, to, codePos, codeNode.nodeSize)
    if (this.isEditingSource) {
      // 源码编辑态：选区移出代码块后切回预览
      if (isInsideCodeBlock) return
      this.showPreview()
      return
    }
    // 预览态：键盘/搜索把光标带入隐藏的源码块时自动切换源码编辑，
    // 否则光标在 display:none 的 pre 里消失，用户会盲改源码（H4）
    if (isInsideCodeBlock) this.setSourceEditing(true)
  }

  private handleToggleSource = () => {
    if (this.isEditingSource) {
      this.showPreview()
      this.button.focus()
      return
    }
    const codePos = this.getPos()
    if (typeof codePos !== 'number') return
    const codeNode = this.view.state.doc.nodeAt(codePos)
    if (!codeNode || codeNode.type.name !== 'code_block') return
    this.setSourceEditing(true)
    this.view.dispatch(
      this.view.state.tr
        .setSelection(TextSelection.create(this.view.state.doc, codePos + 1))
        .scrollIntoView(),
    )
    this.view.focus()
  }

  private showPreview() {
    this.setSourceEditing(false)
    this.renderNow()
  }

  private setSourceEditing(editing: boolean) {
    this.isEditingSource = editing
    this.dom.classList.toggle('is-editing-source', editing)
    this.button.textContent = editing ? '查看图表' : '编辑源码'
    this.button.setAttribute('aria-pressed', String(editing))
    this.button.setAttribute('aria-label', editing ? '查看 Mermaid 图表' : '编辑 Mermaid 源码')
  }
}

const getMermaidBlocks = (doc: ProseNode): MermaidBlock[] => {
  const blocks: MermaidBlock[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block' || !isMermaidLanguage(node.attrs.language)) return
    blocks.push({ pos, language: node.attrs.language.trim().toLowerCase() })
    return false
  })
  return blocks
}

const buildMermaidDecorations = (doc: ProseNode, blocks = getMermaidBlocks(doc)): DecorationSet => {
  const decorations: Decoration[] = []
  blocks.forEach(({ pos }) => {
    const node = doc.nodeAt(pos)
    if (!node) return
    const key = `mermaid-preview-${pos}`
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mermaid-source-block' }))
    decorations.push(
      Decoration.widget(
        pos,
        (view, getPos) => new MermaidPreview(view, getPos, node.textContent).dom,
        {
          key,
          side: -1,
          ignoreSelection: true,
          stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('.mermaid-block')),
          destroy: (dom) => {
            const preview = Array.from(activePreviews).find((item) => item.dom === dom)
            preview?.destroy()
          },
        },
      ),
    )
  })
  return DecorationSet.create(doc, decorations)
}

const mapBlocks = (blocks: MermaidBlock[], tr: Transaction): MermaidBlock[] =>
  blocks.flatMap((block) => {
    const mapped = tr.mapping.mapResult(block.pos, -1)
    if (mapped.deleted) return []
    return [{ ...block, pos: mapped.pos }]
  })

const haveSameBlocks = (left: MermaidBlock[], right: MermaidBlock[]): boolean =>
  left.length === right.length &&
  left.every((block, index) => block.pos === right[index].pos && block.language === right[index].language)

export const mermaidPreviewKey = new PluginKey('mermaid-preview')

export const mermaidPreviewPlugin = new Plugin({
  key: mermaidPreviewKey,
  state: {
    init: (_config, state): MermaidPreviewState => {
      const blocks = getMermaidBlocks(state.doc)
      return { decorations: buildMermaidDecorations(state.doc, blocks), blocks }
    },
    apply: (tr, previous, _oldState, state) => {
      const previousState = previous as MermaidPreviewState
      if (!tr.docChanged) {
        return {
          decorations: previousState.decorations.map(tr.mapping, tr.doc),
          blocks: mapBlocks(previousState.blocks, tr),
        }
      }
      // M13：段落内打字不触碰代码块，直接映射复用，避免每次按键全文档扫描
      const info = analyzeDecorationChange(tr)
      if (info.blockAt !== 'code_block' && !info.sliceBlocks.has('code_block')) {
        return {
          decorations: previousState.decorations.map(tr.mapping, tr.doc),
          blocks: mapBlocks(previousState.blocks, tr),
        }
      }
      const blocks = getMermaidBlocks(state.doc)
      const mappedBlocks = mapBlocks(previousState.blocks, tr)
      if (haveSameBlocks(mappedBlocks, blocks)) {
        // Mermaid 源码输入不会改变代码块的结构，必须复用预览 DOM，避免光标被重建打断。
        return { decorations: previousState.decorations.map(tr.mapping, tr.doc), blocks }
      }
      return { decorations: buildMermaidDecorations(state.doc, blocks), blocks }
    },
  },
  props: {
    decorations: (state) =>
      (mermaidPreviewKey.getState(state) as MermaidPreviewState | undefined)?.decorations,
  },
  view: () => ({
    update: (view, previousState) => {
      activePreviews.forEach((preview) => preview.syncSelection())
      if (previousState.doc.eq(view.state.doc)) return
      activePreviews.forEach((preview) => {
        const pos = preview.getSourcePosition()
        if (typeof pos !== 'number') return
        const node = view.state.doc.nodeAt(pos)
        if (!node || !isMermaidLanguage(node.attrs.language)) return
        preview.updateSource(node.textContent)
      })
    },
    destroy: () => {
      activePreviews.forEach((preview) => preview.destroy())
    },
  }),
})

export const ensureMermaidRendered = async (): Promise<void> => {
  const renders = Array.from(activePreviews, (preview) => preview.renderNow())
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
