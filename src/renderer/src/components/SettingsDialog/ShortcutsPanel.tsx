import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS } from '../../data/shortcuts'
import type { ShortcutMap } from '../../data/shortcuts'
import { useShortcutRecorder } from './useShortcutRecorder'

interface ShortcutsPanelProps {
  shortcuts: ShortcutMap
  onShortcutsChange: (map: ShortcutMap) => void
}

/** 快捷键面板：录入 / 清除 / 恢复默认 */
export function ShortcutsPanel({ shortcuts, onShortcutsChange }: ShortcutsPanelProps): JSX.Element {
  const { recordingId, scError, startRecording, resetRecording } = useShortcutRecorder(
    shortcuts,
    onShortcutsChange,
  )

  return (
    <>
      <div className="settings-section-title">全局快捷键</div>
      <div className="sc-tip">
        点击"修改"后按下新组合键（需含 Ctrl 或为功能键），Esc 取消；"清除"可停用该快捷键
      </div>
      {scError && <div className="sc-error">{scError}</div>}
      {SHORTCUT_ACTIONS.map((def) => (
        <div className="settings-row sc-row" key={def.id}>
          <span className="settings-label">{def.label}</span>
          <div className="sc-edit-group">
            <span className={`sc-combo ${recordingId === def.id ? 'recording' : ''}`}>
              {recordingId === def.id
                ? '按下组合键…'
                : shortcuts[def.id] || '未设置'}
            </span>
            <div className="sc-btn" onClick={() => startRecording(def.id)}>
              修改
            </div>
            {shortcuts[def.id] && recordingId !== def.id && (
              <div
                className="sc-btn"
                onClick={() => onShortcutsChange({ ...shortcuts, [def.id]: '' })}
              >
                清除
              </div>
            )}
          </div>
        </div>
      ))}
      <div
        className="sc-reset"
        onClick={() => {
          onShortcutsChange({ ...DEFAULT_SHORTCUTS })
          resetRecording()
        }}
      >
        恢复默认快捷键
      </div>
    </>
  )
}
