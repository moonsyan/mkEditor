import { useEffect } from 'react'
/**
 * 持久化单个设置项：仅在设置加载完成后（ready 为 true）写回，
 * 避免加载完成前用初始值覆盖已有配置。
 * debounceMs > 0 时防抖写入（拖拽、输入等高频变化场景）。
 */
export function usePersistedSetting<T>(
  key: string,
  value: T,
  ready: boolean,
  debounceMs = 0,
): void {
  useEffect(() => {
    // null 表示"无记录"（如折叠键从未持久化过），不写回，避免覆盖其他记录
    if (!ready || value == null) return
    if (debounceMs <= 0) {
      window.desktopAPI?.settings.set(key, value).catch(() => {})
      return
    }
    const timer = setTimeout(() => {
      window.desktopAPI?.settings.set(key, value).catch(() => {})
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [key, value, ready, debounceMs])
}
