import { useEffect, useRef, useState } from 'react'
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
  ready: boolean,
) {
  const [writingStats, setWritingStats] = useState<WritingStats>(() => ({
    date: todayStr(),
    words: 0,
    minutes: 0,
    history: [],
  }))

  /** 每个文件上次的字数（切换文件不计入增减） */
  const lastWordCountRef = useRef<Record<string, number>>({})
  /** 最近激活的文件（切换文件不算打字/编辑时间） */
  const lastActiveFileRef = useRef('')
  /** 最近一次编辑时间（用于写作时长累计） */
  const lastEditTimeRef = useRef(0)
  /** 最近撤销的幅度栈（栈顶为最近一次；E1：撤销→重做配对，避免重复计数） */
  const undoStackRef = useRef<number[]>([])

  // 字数净增追踪：同一文件字数增加才计入今日字数。
  // 打开/切换文档、搜索替换等字数变化并非真实打字，不能计入编辑时间；
  // 撤销（delta<0）后重做使字数回到撤销前，是恢复不是打字，不重复计数
  useEffect(() => {
    const prev = lastWordCountRef.current[activeFileId]
    lastWordCountRef.current[activeFileId] = wordCount
    if (prev === undefined) return // 首次打开该文件，不计
    const switched = lastActiveFileRef.current !== activeFileId
    lastActiveFileRef.current = activeFileId
    if (switched) {
      // 切换文档不算打字：不刷新编辑时间，撤销栈按文件隔离
      undoStackRef.current = []
      return
    }
    const delta = wordCount - prev
    if (delta !== 0) {
      // E2：删除/重写也是编辑活动——此前只刷正增量，纯删除的长时间
      // 编辑会卡住"最近编辑"计时，写作时长不再累计
      lastEditTimeRef.current = Date.now()
    }
    if (delta > 0) {
      const stack = undoStackRef.current
      if (stack.length > 0 && stack[0] === delta) {
        // 字数恰好回到最近一次撤销前的水平：撤销后的重做，不重复计数
        stack.shift()
      } else {
        setWritingStats((s) => {
          const rolled = rollStatsDate(s)
          return { ...rolled, words: rolled.words + delta }
        })
      }
    } else if (delta < 0) {
      // 记录撤销幅度供重做配对；只保留最近 8 次
      undoStackRef.current.unshift(-delta)
      if (undoStackRef.current.length > 8) undoStackRef.current.pop()
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
  usePersistedSetting('writingStats', writingStats, ready, 10_000)

  return { writingStats, setWritingStats }
}
