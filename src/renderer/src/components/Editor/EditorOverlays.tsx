export interface CodePanelState {
  pre: HTMLElement
  top: number
  left: number
  language: string
}

export interface TablePanelState {
  table: HTMLElement
  top: number
  left: number
}

export interface FullscreenCodeState {
  language: string
  text: string
}

type TableAction =
  | 'addRow'
  | 'addCol'
  | 'delRow'
  | 'delCol'
  | 'delTable'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'

interface EditorOverlaysProps {
  codePanel: CodePanelState | null
  tablePanel: TablePanelState | null
  fullscreenCode: FullscreenCodeState | null
  language: string
  copied: boolean
  onLanguageChange: (language: string) => void
  onApplyLanguage: (language: string) => void
  onCloseCodePanel: () => void
  onOpenFullscreen: () => void
  onCopyCode: () => void
  onTableAction: (action: TableAction) => void
  onCloseFullscreen: () => void
  onCopyFullscreen: () => void
}

export function EditorOverlays({
  codePanel,
  tablePanel,
  fullscreenCode,
  language,
  copied,
  onLanguageChange,
  onApplyLanguage,
  onCloseCodePanel,
  onOpenFullscreen,
  onCopyCode,
  onTableAction,
  onCloseFullscreen,
  onCopyFullscreen,
}: EditorOverlaysProps): JSX.Element {
  return (
    <>
      {codePanel && (
        <div
          className="code-panel"
          style={{ top: codePanel.top, left: codePanel.left }}
          onMouseOver={(event) => event.stopPropagation()}
          contentEditable={false}
        >
          <input
            className="code-lang-input"
            placeholder="语言"
            value={language}
            spellCheck={false}
            onChange={(event) => onLanguageChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onApplyLanguage(language)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onCloseCodePanel()
              }
            }}
            onBlur={() => {
              if (language !== codePanel.language) onApplyLanguage(language)
            }}
            title="输入语言后回车生效（如 python）"
          />
          <div className="code-copy" onClick={onOpenFullscreen} title="全屏预览代码">
            <svg viewBox="0 0 24 24">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </div>
          <div className={`code-copy ${copied ? 'copied' : ''}`} onClick={onCopyCode} title={copied ? '已复制' : '复制代码'}>
            {copied ? (
              <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </div>
        </div>
      )}

      {tablePanel && (
        <div
          className="table-panel"
          style={{ top: tablePanel.top, left: tablePanel.left }}
          onMouseOver={(event) => event.stopPropagation()}
          contentEditable={false}
        >
          <div className="table-act" onClick={() => onTableAction('addRow')} title="在光标所在行下方加行">+行</div>
          <div className="table-act" onClick={() => onTableAction('addCol')} title="在光标所在列右侧加列">+列</div>
          <div className="table-act" onClick={() => onTableAction('delRow')} title="删除光标所在行">−行</div>
          <div className="table-act" onClick={() => onTableAction('delCol')} title="删除光标所在列">−列</div>
          <div className="table-act danger" onClick={() => onTableAction('delTable')} title="删除整个表格">删表</div>
          <span className="table-act-sep" />
          <div className="table-act" onClick={() => onTableAction('alignLeft')} title="当前列左对齐">左</div>
          <div className="table-act" onClick={() => onTableAction('alignCenter')} title="当前列居中">中</div>
          <div className="table-act" onClick={() => onTableAction('alignRight')} title="当前列右对齐">右</div>
        </div>
      )}

      {fullscreenCode && (
        <div className="code-fullscreen-overlay" onClick={onCloseFullscreen}>
          <div className="code-fullscreen" onClick={(event) => event.stopPropagation()}>
            <div className="code-fullscreen-head">
              <span className="code-fullscreen-lang">{fullscreenCode.language || 'text'}</span>
              <div className="code-fullscreen-actions">
                <div className="sc-btn" onClick={onCopyFullscreen}>复制</div>
                <div className="sc-btn" onClick={onCloseFullscreen}>关闭（Esc）</div>
              </div>
            </div>
            <pre className="code-fullscreen-pre">
              <code>{fullscreenCode.text}</code>
            </pre>
          </div>
        </div>
      )}
    </>
  )
}
