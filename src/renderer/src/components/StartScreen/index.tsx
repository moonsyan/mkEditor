interface StartScreenProps {
  /** 新建空白文档 */
  onNew: () => void
  /** 打开单个文件对话框 */
  onOpen: () => void
  /** 打开文件夹（工作区） */
  onOpenFolder: () => void
}

/**
 * 「开始」界面：当用户关闭全部标签页时显示，替代原先"自动新建空白文档"的行为。
 * 左侧文件夹树始终保留，用户可从中点击样例文件，或用此处按钮创建/打开文档。
 */
export function StartScreen({ onNew, onOpen, onOpenFolder }: StartScreenProps): JSX.Element {
  return (
    <div className="start-screen">
      <div className="start-inner">
        <img className="start-logo" src="/icon.png" alt="" />
        <h1 className="start-title">MarkdownSoft</h1>
        <p className="start-sub">一个安静的 Markdown 写作空间</p>
        <div className="start-actions">
          <button className="start-btn primary" onClick={onNew}>
            <svg viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建文档
          </button>
          <button className="start-btn" onClick={onOpen}>
            <svg viewBox="0 0 24 24">
              <path d="M3 7a2 2 0 0 1 2-2h4.2a1 1 0 0 1 .8.4L11.6 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            打开文件
          </button>
          <button className="start-btn" onClick={onOpenFolder}>
            <svg viewBox="0 0 24 24">
              <path d="M3 7a2 2 0 0 1 2-2h4.2a1 1 0 0 1 .8.4L11.6 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7L9 5.6A2 2 0 0 0 7.6 5H5" />
            </svg>
            打开文件夹
          </button>
        </div>
        <p className="start-hint">或点击左侧文件夹中的样例文件开始编辑</p>
      </div>
    </div>
  )
}
