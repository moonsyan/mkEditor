import { useCallback, useState } from 'react'
import type { RecentFile } from '../components/MenuBar'
import { usePersistedSetting } from './usePersistedSetting'

/**
 * 最近打开的磁盘文件列表：置顶 + 去重 + 上限 10，并持久化。
 * 历史数据加载仍由 App 的设置加载流程完成，通过返回的 setRecentFiles 灌入。
 */
export function useRecentFiles(ready: boolean) {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])

  /** 记录最近打开的磁盘文件（置顶 + 去重 + 上限 10） */
  const recordRecent = useCallback((path: string, name: string) => {
    setRecentFiles((prev) => {
      const rest = prev.filter((r) => r.path !== path)
      return [{ path, name }, ...rest].slice(0, 10)
    })
  }, [])

  // 最近文件持久化（防抖 2 秒；设置加载完成前不写，避免空列表覆盖）
  usePersistedSetting('recentFiles', recentFiles, ready, 2_000)

  return { recentFiles, setRecentFiles, recordRecent }
}
