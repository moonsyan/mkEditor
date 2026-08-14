import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/* ==================== 表格列宽可视化拖拽 ====================
 * 鼠标靠近表格列边缘时显示拖拽手柄，按住左右拖动调整该列宽度。
 * 列宽仅保存在表格 DOM（data-colwidths），不写入 Markdown 文本
 * （GFM 无列宽语法，与 Typora 的纯视图级调整行为一致）。
 * ProseMirror 重建单元格后，下次交互会依据 data-colwidths 自愈恢复。
 * L15：增删行列后 PM 重建单元格，新行/新列不再继承列宽——
 * 宽度写所有行 + 列数变化时以实测值重归档 + 结构变化自愈恢复。 */

/** 边缘命中容差（px） */
const EDGE_TOLERANCE = 5
/** 列最小宽度（px） */
const MIN_COL_WIDTH = 36

export const tableColResizePlugin = new Plugin({
  key: new PluginKey('table-col-resize'),
  view: (editorView: EditorView) => {
    const handle = document.createElement('div')
    handle.className = 'col-resize-handle'
    handle.style.display = 'none'

    interface DragInfo {
      table: HTMLTableElement
      colIndex: number
      startX: number
      widths: number[]
    }
    let drag: DragInfo | null = null
    let hover: { table: HTMLTableElement; colIndex: number } | null = null
    let raf = 0
    let lastMove: MouseEvent | null = null
    /** L15：表格结构变化（增删行列）后 PM 重建单元格，观察新增 tr/td 立即自愈列宽 */
    let structureObserver: MutationObserver | null = null

    const scrollEl = (): HTMLElement | null =>
      editorView.dom.closest('.editor-scroll') as HTMLElement | null
    const milkdownRoot = (): HTMLElement | null =>
      editorView.dom.closest('.milkdown') as HTMLElement | null

    const mount = () => {
      const el = scrollEl()
      if (el && handle.parentElement !== el) el.appendChild(handle)
    }

    /** 首行各单元格的当前宽度 */
    const currentWidths = (table: HTMLTableElement): number[] => {
      const row = table.rows[0]
      if (!row) return []
      const out: number[] = []
      for (let i = 0; i < row.cells.length; i++) {
        out.push(row.cells[i].getBoundingClientRect().width)
      }
      return out
    }

    /** 应用列宽：写所有行单元格 + 表格总宽 + data-colwidths 存档 */
    const applyWidths = (table: HTMLTableElement, widths: number[]) => {
      const rows = table.rows
      if (!rows.length) return
      const n = Math.min(rows[0].cells.length, widths.length)
      let total = 0
      for (let i = 0; i < n; i++) total += widths[i]
      // L15：只写首行会导致增删行后新行单元格没有宽度样式，列宽按内容撑开，
      // 视觉上"自定义宽度丢失"。所有行统一写，增行后新行也能继承列宽。
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < n; i++) {
          ;(rows[r].cells[i] as HTMLElement).style.width = `${widths[i]}px`
        }
      }
      table.style.width = `${total}px`
      table.setAttribute(
        'data-colwidths',
        widths.map((w) => Math.round(w)).join(','),
      )
    }

    /** 恢复已保存的列宽（单元格被 ProseMirror 重建后自愈） */
    const restoreWidths = (table: HTMLTableElement) => {
      const saved = table.getAttribute('data-colwidths')
      if (!saved) return
      const row = table.rows[0]
      if (!row) return
      const widths = saved
        .split(',')
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
      // L15：列数变化（增删列）时旧存档与当前列错位，不能直接丢弃——
      // 以首行实测宽度重新归档（存活的列仍保留原宽度，新增列取内容宽度），
      // 避免一次增列就把全部自定义宽度清空。列数一致时走存档恢复。
      if (widths.length !== row.cells.length) {
        applyWidths(table, currentWidths(table))
        return
      }
      applyWidths(table, widths)
    }

    const hideHandle = () => {
      handle.style.display = 'none'
      hover = null
      milkdownRoot()?.classList.remove('resize-cursor')
    }

    /** 在滚动容器内定位手柄到指定列右边缘 */
    const positionHandle = (table: HTMLTableElement, colIndex: number) => {
      const el = scrollEl()
      if (!el) return
      mount()
      restoreWidths(table)
      const row = table.rows[0]
      const cell = row?.cells[colIndex] as HTMLElement | undefined
      if (!cell) {
        hideHandle()
        return
      }
      const cellRect = cell.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      handle.style.display = 'block'
      handle.style.left = `${cellRect.right - elRect.left + el.scrollLeft - 2}px`
      handle.style.top = `${tableRect.top - elRect.top + el.scrollTop}px`
      handle.style.height = `${tableRect.height}px`
      hover = { table, colIndex }
      milkdownRoot()?.classList.add('resize-cursor')
    }

    /** 找鼠标命中的列边缘（首行单元格右边缘 ± 容差） */
    const hitEdge = (table: HTMLTableElement, clientX: number): number => {
      const row = table.rows[0]
      if (!row) return -1
      for (let i = 0; i < row.cells.length; i++) {
        const rect = row.cells[i].getBoundingClientRect()
        if (Math.abs(clientX - rect.right) <= EDGE_TOLERANCE) return i
      }
      return -1
    }

    /* ---------- 事件处理 ---------- */

    const onMouseMove = (e: MouseEvent) => {
      if (drag) return
      lastMove = e
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const ev = lastMove
        lastMove = null
        if (!ev) return
        const target = ev.target as HTMLElement | null
        const table = target?.closest?.('table') as HTMLTableElement | null
        if (!table || !editorView.dom.contains(table)) {
          hideHandle()
          return
        }
        const colIndex = hitEdge(table, ev.clientX)
        if (colIndex < 0) {
          hideHandle()
          return
        }
        positionHandle(table, colIndex)
      })
    }

    const onMouseLeave = () => {
      if (!drag) hideHandle()
    }

    const onDragMove = (e: MouseEvent) => {
      if (!drag) return
      e.preventDefault()
      const { table, colIndex, startX, widths } = drag
      const next = widths.slice()
      next[colIndex] = Math.max(MIN_COL_WIDTH, widths[colIndex] + (e.clientX - startX))
      applyWidths(table, next)
      positionHandle(table, colIndex)
    }

    const onDragEnd = () => {
      drag = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onDragMove)
      document.removeEventListener('mouseup', onDragEnd)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (!hover || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      drag = {
        table: hover.table,
        colIndex: hover.colIndex,
        startX: e.clientX,
        widths: currentWidths(hover.table),
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onDragMove)
      document.addEventListener('mouseup', onDragEnd)
    }

    editorView.dom.addEventListener('mousemove', onMouseMove)
    editorView.dom.addEventListener('mousedown', onMouseDown)
    editorView.dom.addEventListener('mouseleave', onMouseLeave)

    /** L15：新增行/列立即恢复已保存列宽，而不是等下次悬停才自愈 */
    const selfHealWidths = (mutations: MutationRecord[]) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue
        const added = mutation.addedNodes
        for (let i = 0; i < added.length; i++) {
          const node = added[i]
          if (!(node instanceof HTMLElement)) continue
          // 只处理表格结构变化（新增 tr/td/th）；普通文本节点直接跳过
          const cells = node.querySelectorAll('tr, td, th')
          if (!cells.length) continue
          const first = cells[0]
          const tr = first.tagName === 'TR' ? first : first.closest('tr')
          const table = tr?.closest?.('table') as HTMLTableElement | null
          if (!table || !editorView.dom.contains(table)) continue
          if (!table.hasAttribute('data-colwidths')) continue
          // 恢复会写 style（attribute 变更），不会再次触发 childList，无循环
          restoreWidths(table)
        }
      }
    }
    structureObserver = new MutationObserver(selfHealWidths)
    structureObserver.observe(editorView.dom, { childList: true, subtree: true })

    return {
      destroy() {
        if (raf) cancelAnimationFrame(raf)
        structureObserver?.disconnect()
        structureObserver = null
        editorView.dom.removeEventListener('mousemove', onMouseMove)
        editorView.dom.removeEventListener('mousedown', onMouseDown)
        editorView.dom.removeEventListener('mouseleave', onMouseLeave)
        document.removeEventListener('mousemove', onDragMove)
        document.removeEventListener('mouseup', onDragEnd)
        handle.remove()
      },
    }
  },
})
