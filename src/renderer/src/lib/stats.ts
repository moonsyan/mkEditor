import type { WritingStats } from '../components/HelpDialog'

/** 今天日期 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** 跨天滚动：旧日期数据归档到 history（保留 30 天） */
export function rollStatsDate(stats: WritingStats): WritingStats {
  const today = todayStr()
  if (stats.date === today) return stats
  const history = [
    ...stats.history.filter((h) => h.date !== today),
    { date: stats.date, words: stats.words, minutes: stats.minutes },
  ].slice(-30)
  return { date: today, words: 0, minutes: 0, history }
}

export const EMPTY_STATS: WritingStats = { date: '', words: 0, minutes: 0, history: [] }
