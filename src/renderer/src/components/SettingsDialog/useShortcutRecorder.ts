import { useEffect, useState } from 'react'
import { SHORTCUT_ACTIONS, comboFromEvent } from '../../data/shortcuts'
import type { ShortcutMap } from '../../data/shortcuts'
import { isImeComposing } from '../../lib/keyboard'

/**
 * 快捷键录入：捕获下一个有效组合键（capture 阶段，避免触发其它快捷键逻辑）。
 * 组合键必须含 Ctrl/Cmd 或为功能键；与其它动作冲突时给出错误提示。
 */
export function useShortcutRecorder(
  shortcuts: ShortcutMap,
  onShortcutsChange: (map: ShortcutMap) => void,
) {
  /** 正在录入快捷键的动作 id */
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [scError, setScError] = useState('')

  useEffect(() => {
    if (!recordingId) return
    const h = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setRecordingId(null)
        setScError('')
        return
      }
      const combo = comboFromEvent(e)
      // 必须含 Ctrl（或功能键），避免占用单字符按键
      if (!combo || (!(e.ctrlKey || e.metaKey) && !/^F\d{1,2}$/.test(e.key))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const conflict = Object.entries(shortcuts).find(([a, c]) => a !== recordingId && c === combo)
      if (conflict) {
        const def = SHORTCUT_ACTIONS.find((d) => d.id === conflict[0])
        setScError(`该组合键已被“${def?.label ?? conflict[0]}”占用`)
        return
      }
      onShortcutsChange({ ...shortcuts, [recordingId]: combo })
      setScError('')
      setRecordingId(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [recordingId, shortcuts, onShortcutsChange])

  const startRecording = (id: string) => {
    setRecordingId(id)
    setScError('')
  }
  const resetRecording = () => {
    setRecordingId(null)
    setScError('')
  }

  return { recordingId, scError, startRecording, resetRecording }
}
