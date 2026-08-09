interface StatusBarProps {
  saved: boolean
  wordCount: number
  lineCount: number
  readTime: number
  /** 光标行（1 起） */
  cursorLine?: number
  /** 光标列（1 起） */
  cursorCol?: number
  /** 光标上方最近的标题 */
  currentHeading?: string
  /** 文档最后修改时间戳（毫秒） */
  modifiedTime?: number
  /** 选中字数（>0 时显示） */
  selectedChars?: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function StatusBar({
  saved,
  wordCount,
  lineCount,
  readTime,
  cursorLine,
  cursorCol,
  currentHeading,
  modifiedTime,
  selectedChars,
}: StatusBarProps): JSX.Element {
  return (
    <div className="statusbar">
      <div className="st-item">
        <span className={`st-dot ${saved ? '' : 'unsaved'}`} />
        {saved ? '已保存' : '未保存'}
      </div>
      {currentHeading ? (
        <div className="st-item st-heading" title={currentHeading}>
          {currentHeading}
        </div>
      ) : null}
      <div className="st-spacer" />
      {typeof modifiedTime === 'number' && modifiedTime > 0 && (
        <div className="st-item">修改于 {formatTime(modifiedTime)}</div>
      )}
      {typeof cursorLine === 'number' && typeof cursorCol === 'number' && (
        <div className="st-item">
          行 {cursorLine}, 列 {cursorCol}
        </div>
      )}
      {typeof selectedChars === 'number' && selectedChars > 0 && (
        <div className="st-item st-selected">已选中 {selectedChars} 字</div>
      )}
      <div className="st-item">{wordCount} 字</div>
      <div className="st-item">{lineCount} 行</div>
      <div className="st-item">约 {readTime} 分钟</div>
      <div className="st-item">UTF-8</div>
      <div className="st-item">Markdown</div>
    </div>
  )
}
