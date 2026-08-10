import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/* ==================== 表格列宽可视化拖拽 ====================
 * 鼠标靠近表格列边缘时显示拖拽手柄，按住左右拖动调整该列宽度。
 * 列宽仅保存在表格 DOM（data-colwidths），不写入 Markdown 文本
 * （GFM 无列宽语法，与 Typora 的纯视图级调整行为一致）。
 * ProseMirror 重建单元格后，下次交互会依据 data-colwidths 自愈恢复。 */

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

    /** 应用列宽：写首行单元格 + 表格总宽 + data-colwidths 存档 */
    const applyWidths = (table: HTMLTableElement, widths: number[]) => {
      const row = table.rows[0]
      if (!row) return
      const n = Math.min(row.cells.length, widths.length)
      let total = 0
      for (let i = 0; i < n; i++) {
        ;(row.cells[i] as HTMLElement).style.width = `${widths[i]}px`
        total += widths[i]
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
      // 列数变化（增删列）时存档失效，直接丢弃
      if (widths.length !== row.cells.length) {
        table.removeAttribute('data-colwidths')
        table.style.width = ''
        return
      }
      let total = 0
      for (let i = 0; i < widths.length; i++) {
        ;(row.cells[i] as HTMLElement).style.width = `${widths[i]}px`
        total += widths[i]
      }
      table.style.width = `${total}px`
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

    return {
      destroy() {
        if (raf) cancelAnimationFrame(raf)
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
