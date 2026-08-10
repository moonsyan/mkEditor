import { SPELL_LANG_OPTIONS } from './constants'

interface EditorPanelProps {
  autosave: boolean
  onAutosaveChange: (value: boolean) => void
  typewriter: boolean
  onTypewriterChange: (value: boolean) => void
  spellcheck: boolean
  onSpellcheckChange: (value: boolean) => void
  spellcheckLang: string
  onSpellcheckLangChange: (value: string) => void
  multiWindow: boolean
  onMultiWindowChange: (value: boolean) => void
  blankClickToEnd: boolean
  onBlankClickToEndChange: (value: boolean) => void
  codeLineNumbers: boolean
  onCodeLineNumbersChange: (value: boolean) => void
  imageHost: { provider: 'local' | 'smms'; token: string }
  onImageHostChange: (value: { provider: 'local' | 'smms'; token: string }) => void
}

/** 编辑器面板：编辑行为开关 + 图床配置 */
export function EditorPanel({
  autosave,
  onAutosaveChange,
  typewriter,
  onTypewriterChange,
  spellcheck,
  onSpellcheckChange,
  spellcheckLang,
  onSpellcheckLangChange,
  multiWindow,
  onMultiWindowChange,
  blankClickToEnd,
  onBlankClickToEndChange,
  codeLineNumbers,
  onCodeLineNumbersChange,
  imageHost,
  onImageHostChange,
}: EditorPanelProps): JSX.Element {
  return (
    <>
      <div className="settings-section-title">编辑</div>
      <div className="settings-row settings-row-toggle" onClick={() => onAutosaveChange(!autosave)}>
        <span className="settings-label">
          自动保存
          <span className="settings-hint">磁盘文件每 30 秒自动写回</span>
        </span>
        <div className={`switch ${autosave ? 'on' : ''}`} />
      </div>
      <div className="settings-row settings-row-toggle" onClick={() => onTypewriterChange(!typewriter)}>
        <span className="settings-label">
          打字机模式
          <span className="settings-hint">光标所在行始终保持屏幕居中</span>
        </span>
        <div className={`switch ${typewriter ? 'on' : ''}`} />
      </div>
      <div className="settings-row settings-row-toggle" onClick={() => onSpellcheckChange(!spellcheck)}>
        <span className="settings-label">
          拼写检查（多语言词典）
          <span className="settings-hint">仅检查正文，代码块与行内代码自动排除；中文不在词典范围</span>
        </span>
        <div className={`switch ${spellcheck ? 'on' : ''}`} />
      </div>
      {spellcheck && (
        <div className="settings-row">
          <span className="settings-label">拼写检查语言</span>
          <select
            className="settings-text-input"
            value={spellcheckLang}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSpellcheckLangChange(e.target.value)}
          >
            {SPELL_LANG_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="settings-row settings-row-toggle" onClick={() => onMultiWindowChange(!multiWindow)}>
        <span className="settings-label">
          多窗口模式
          <span className="settings-hint">允许同时打开多个窗口（重启后生效）</span>
        </span>
        <div className={`switch ${multiWindow ? 'on' : ''}`} />
      </div>
      <div className="settings-row settings-row-toggle" onClick={() => onBlankClickToEndChange(!blankClickToEnd)}>
        <span className="settings-label">
          点击空白区跳到文末
          <span className="settings-hint">点击正文下方空白区域时光标定位到文档末尾（Typora 同款行为）</span>
        </span>
        <div className={`switch ${blankClickToEnd ? 'on' : ''}`} />
      </div>
      <div className="settings-row settings-row-toggle" onClick={() => onCodeLineNumbersChange(!codeLineNumbers)}>
        <span className="settings-label">
          代码块行号
          <span className="settings-hint">在代码块左侧显示行号（导出 HTML/PDF 时一并包含）</span>
        </span>
        <div className={`switch ${codeLineNumbers ? 'on' : ''}`} />
      </div>

      <div className="settings-section-title">图床（粘贴/拖入图片）</div>
      <div className="settings-row">
        <span className="settings-label">图片存储位置</span>
        <div className="seg">
          <div
            className={`seg-item ${imageHost.provider === 'local' ? 'on' : ''}`}
            onClick={() => onImageHostChange({ ...imageHost, provider: 'local' })}
          >
            本地附件
          </div>
          <div
            className={`seg-item ${imageHost.provider === 'smms' ? 'on' : ''}`}
            onClick={() => onImageHostChange({ ...imageHost, provider: 'smms' })}
          >
            SM.MS 图床
          </div>
        </div>
      </div>
      {imageHost.provider === 'smms' && (
        <div className="settings-row">
          <span className="settings-label">
            SM.MS Token
            <span className="settings-hint">在 sm.ms 账号设置中获取；未填写时自动降级为本地附件</span>
          </span>
          <input
            className="settings-text-input"
            type="password"
            placeholder="粘贴 Token"
            value={imageHost.token}
            spellCheck={false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onImageHostChange({ ...imageHost, token: e.target.value })}
          />
        </div>
      )}
    </>
  )
}
