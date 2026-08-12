/** 渲染进程全局类型补充 */

/** Vite ?inline 导入：CSS 以字符串形式内联（导出 HTML 时嵌入 KaTeX 样式用） */
declare module '*.css?inline' {
  const css: string
  export default css
}

interface Window {
  /**
   * Chromium 内置的页面查找 API（Electron 可用）
   * @param search 关键字
   * @param caseSensitive 是否区分大小写
   * @param backwards 是否反向查找
   * @param wrapAround 是否循环查找
   */
  find(
    search: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
  ): boolean
}
