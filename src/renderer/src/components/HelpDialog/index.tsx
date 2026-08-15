import { useEffect } from 'react'
import type { ShortcutMap } from '../../data/shortcuts'
import { isImeComposing } from '../../lib/keyboard'

export type HelpView = 'shortcuts' | 'syntax' | 'about' | 'stats' | null

/** 写作统计数据（App 维护并持久化） */
export interface WritingStats {
  /** 当前统计日期 YYYY-MM-DD */
  date: string
  /** 今日净增字数 */
  words: number
  /** 今日写作分钟数 */
  minutes: number
  /** 历史 30 天 */
  history: { date: string; words: number; minutes: number }[]
}

interface HelpDialogProps {
  view: HelpView
  onClose: () => void
  /** 写作统计（view='stats' 时使用） */
  stats?: WritingStats
  /** 当前快捷键配置（动态显示可自定义项） */
  shortcuts?: ShortcutMap
}

/** 快捷键分组数据 */
/** 快捷键分组数据：[默认组合键, 标签, 可自定义动作 id?] */
const SHORTCUT_GROUPS: { title: string; items: [string, string, string?][] }[] = [
  {
    title: '文件',
    items: [
      ['Ctrl+N', '新建文档', 'new'],
      ['Ctrl+O', '打开文件', 'open'],
      ['Ctrl+Shift+O', '打开文件夹', 'openFolder'],
      ['Ctrl+S', '保存', 'save'],
      ['Ctrl+Shift+S', '另存为', 'saveAs'],
      ['Ctrl+W', '关闭标签页', 'closeTab'],
      ['右键标签页', '关闭其他 / 关闭全部'],
    ],
  },
  {
    title: '编辑',
    items: [
      ['Ctrl+Z / Ctrl+Shift+Z', '撤销 / 重做'],
      ['Ctrl+B', '粗体'],
      ['Ctrl+I', '斜体'],
      ['Ctrl+Shift+X', '删除线', 'strike'],
      ['Ctrl+F', '查找', 'find'],
      ['Ctrl+H', '查找替换', 'replace'],
    ],
  },
  {
    title: '段落',
    items: [
      ['Ctrl+1 / 2 / 3', '标题 1 / 2 / 3'],
      ['Ctrl+0', '恢复为正文', 'text'],
      ['Ctrl+= / Ctrl+-', '放大 / 缩小编辑区'],
    ],
  },
  {
    title: '视图',
    items: [
      ['Ctrl+J', '切换侧栏', 'toggleSidebar'],
      ['F11', '专注模式', 'focusMode'],
      ['Esc', '退出专注模式'],
      ['Ctrl+Shift+L', '大纲面板', 'outline'],
      ['Ctrl+滚轮', '缩放编辑区'],
    ],
  },
  {
    title: '快捷输入',
    items: [
      ['# + 空格', '一级标题'],
      ['- + 空格', '无序列表'],
      ['- [ ] + 空格', '任务列表'],
      ['> + 空格', '引用'],
      ['```语言 + 空格', '带语言的代码块'],
      ['$公式$ / $$', '行内 / 块级数学公式'],
      ['[^标签]', '脚注'],
    ],
  },
]

/** 语法参考数据 */
const SYNTAX_GROUPS: { title: string; items: { name: string; code: string }[] }[] = [
  {
    title: '标题与文本',
    items: [
      { name: '一~四级标题', code: '# 标题  /  ## 标题  /  ### 标题' },
      { name: '粗体 / 斜体', code: '**粗体**  /  *斜体*' },
      { name: '删除线', code: '~~删除线~~' },
      { name: '行内代码', code: '`代码`' },
    ],
  },
  {
    title: '列表与引用',
    items: [
      { name: '无序列表', code: '- 列表项' },
      { name: '有序列表', code: '1. 列表项' },
      { name: '任务列表', code: '- [ ] 待办  /  - [x] 完成' },
      { name: '引用', code: '> 引用内容' },
    ],
  },
  {
    title: '块级元素',
    items: [
      { name: '代码块', code: '```python（回车后输入代码）' },
      { name: '表格', code: '| 列1 | 列2 |（换行 | --- | --- |）' },
      { name: '分割线', code: '---' },
      { name: '链接 / 图片', code: '[文字](链接)  /  ![说明](图片)' },
    ],
  },
  {
    title: '扩展语法',
    items: [
      { name: '行内公式', code: '$E = mc^2$' },
      { name: '块级公式', code: '$$（回车后输入 LaTeX）' },
      { name: '流程图', code: '```mermaid（回车后输入图表代码）' },
      { name: '脚注', code: '引用[^1]，行首 [^1]: 内容' },
    ],
  },
]

const TITLES: Record<Exclude<HelpView, null>, string> = {
  shortcuts: '快捷键一览',
  syntax: 'Markdown 语法',
  about: '关于 MarkdownSoft',
  stats: '写作统计',
}

/** 近 7 天数据（含今日，缺失日补 0） */
function buildLast7Days(stats: WritingStats): { date: string; words: number; minutes: number }[] {
  const map = new Map<string, { words: number; minutes: number }>()
  for (const h of stats.history) map.set(h.date, { words: h.words, minutes: h.minutes })
  map.set(stats.date, { words: stats.words, minutes: stats.minutes })
  const result: { date: string; words: number; minutes: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    const v = map.get(key) ?? { words: 0, minutes: 0 }
    result.push({ date: key, ...v })
  }
  return result
}

/** 日历热力图：按周分列（周一→周日），含历史数据上限内的天数 */
function buildCalendar(stats: WritingStats, weeks = 5): { date: string; words: number }[][] {
  const map = new Map<string, number>()
  for (const h of stats.history) map.set(h.date, h.words)
  map.set(stats.date, stats.words)
  const today = new Date()
  // 起点回退到周一，保证列与真实周对齐
  const dayIdx = (today.getDay() + 6) % 7 // 周一=0
  const totalDays = weeks * 7 + dayIdx
  const cells: { date: string; words: number }[] = []
  for (let i = totalDays; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    cells.push({ date: key, words: map.get(key) ?? 0 })
  }
  const cols: { date: string; words: number }[][] = []
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))
  return cols
}

/** 字数→热力等级（0-4） */
function levelOf(words: number): number {
  if (words <= 0) return 0
  if (words < 300) return 1
  if (words < 1000) return 2
  if (words < 2500) return 3
  return 4
}

/**
 * 帮助弹窗：快捷键一览 / Markdown 语法 / 关于
 */
export function HelpDialog({ view, onClose, stats, shortcuts }: HelpDialogProps): JSX.Element | null {
  // Esc 关闭
  useEffect(() => {
    if (!view) return
    const handler = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, onClose])

  if (!view) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">{TITLES[view]}</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭" title="关闭">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="help-body">
          {view === 'shortcuts' && (
            <div className="help-cols">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="help-group">
                  <div className="help-group-title">{group.title}</div>
                  {group.items.map(([key, desc, action]) => {
                    // 可自定义项：优先显示当前配置（含已清除→“未设置”）
                    const shown =
                      action && shortcuts
                        ? shortcuts[action] || '未设置'
                        : key
                    return (
                      <div key={desc} className="help-row">
                        <kbd className="help-kbd">{shown}</kbd>
                        <span className="help-desc">{desc}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {view === 'syntax' && (
            <div className="help-cols">
              {SYNTAX_GROUPS.map((group) => (
                <div key={group.title} className="help-group">
                  <div className="help-group-title">{group.title}</div>
                  {group.items.map((item) => (
                    <div key={item.name} className="help-row help-row-syntax">
                      <span className="help-desc">{item.name}</span>
                      <code className="help-code">{item.code}</code>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {view === 'about' && (
            <div className="about-box">
              <img className="about-icon" src="/icon.png" alt="" />
              <div className="about-name">MarkdownSoft</div>
              <div className="about-version">版本 0.0.1</div>
              <p className="about-desc">
                一款柔和简洁的 Markdown 桌面编辑器，
                <br />
                对标 Typora 的所见即所得体验。
              </p>
              <div className="about-stack">
                <span>Electron</span>
                <span>React</span>
                <span>TypeScript</span>
                <span>Milkdown</span>
                <span>KaTeX</span>
                <span>Mermaid</span>
              </div>
            </div>
          )}

          {view === 'stats' && stats && (
            <div className="stats-box">
              <div className="stats-today">
                <div className="stats-card">
                  <div className="stats-num">{stats.words}</div>
                  <div className="stats-cap">今日字数（净增）</div>
                </div>
                <div className="stats-card">
                  <div className="stats-num">{stats.minutes}</div>
                  <div className="stats-cap">今日写作（分钟）</div>
                </div>
              </div>
              <div className="stats-chart-title">近 7 天字数趋势</div>
              <div className="stats-chart">
                {buildLast7Days(stats).map((d) => {
                  const max = Math.max(1, ...buildLast7Days(stats).map((x) => x.words))
                  return (
                    <div className="stats-bar-wrap" key={d.date}>
                      <div
                        className="stats-bar"
                        style={{ height: `${Math.max(d.words > 0 ? 6 : 2, (d.words / max) * 100)}%` }}
                        title={`${d.date}：${d.words} 字 / ${d.minutes} 分钟`}
                      />
                      <span className="stats-bar-label">{d.date.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="stats-chart-title">写作日历（近 5 周）</div>
              <div className="cal-wrap">
                <div className="cal-grid">
                  {buildCalendar(stats).map((col, ci) => (
                    <div className="cal-col" key={ci}>
                      {col.map((c) => (
                        <div
                          key={c.date}
                          className={`cal-cell cal-l${levelOf(c.words)}`}
                          title={`${c.date}：${c.words} 字`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="cal-legend">
                  <span className="cal-legend-text">少</span>
                  {[0, 1, 2, 3, 4].map((l) => (
                    <span key={l} className={`cal-cell cal-l${l}`} />
                  ))}
                  <span className="cal-legend-text">多</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
