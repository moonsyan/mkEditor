import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { WritingStats } from '../components/HelpDialog'
import { todayStr, rollStatsDate } from '../lib/stats'
import { usePersistedSetting } from './usePersistedSetting'

/**
 * 写作统计：今日字数净增、写作时长累计与持久化。
 * wordCount/activeFileId 由外部传入（字数统计依赖当前文档内容）。
 * 历史数据加载仍由 App 的设置加载流程完成，通过返回的 setWritingStats 灌入。
 */
export function useWritingStats(
  wordCount: number,
  activeFileId: string,
  readyRef: MutableRefObject<boolean>,
) {
  const [writingStats, setWritingStats] = useState<WritingStats>(() => ({
    date: todayStr(),
    words: 0,
    minutes: 0,
    history: [],
  }))

  /** 每个文件上次的字数（切换文件不计入增减） */
  const lastWordCountRef = useRef<Record<string, number>>({})
  /** 最近一次编辑时间（用于写作时长累计） */
  const lastEditTimeRef = useRef(0)

  // 字数净增追踪：同一文件字数增加才计入今日字数
  useEffect(() => {
    const prev = lastWordCountRef.current[activeFileId]
    lastWordCountRef.current[activeFileId] = wordCount
    if (prev === undefined) return // 首次打开该文件，不计
    lastEditTimeRef.current = Date.now()
    const delta = wordCount - prev
    if (delta > 0) {
      setWritingStats((s) => {
        const rolled = rollStatsDate(s)
        return { ...rolled, words: rolled.words + delta }
      })
    }
  }, [wordCount, activeFileId])

  // 写作时长：每 60 秒检查一次，最近 90 秒内有编辑则 +1 分钟
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      if (Date.now() - lastEditTimeRef.current < 90_000) {
        setWritingStats((s) => {
          const rolled = rollStatsDate(s)
          return { ...rolled, minutes: rolled.minutes + 1 }
        })
      }
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  // 统计持久化（防抖 10 秒；设置加载完成前不写，避免空值覆盖）
  usePersistedSetting('writingStats', writingStats, readyRef, 10_000)

  return { writingStats, setWritingStats }
}
