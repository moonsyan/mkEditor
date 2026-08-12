import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
/* ProseMirror 基础样式（选区 / GapCursor / 表格） */
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'
/* KaTeX 公式排版样式 */
import 'katex/dist/katex.min.css'
import './src/styles/global.css'
import './src/styles/variables.css'
import './src/styles/typography.css'
import './src/styles/themes/default.css'
import './src/styles/themes/dark.css'
import './src/styles/themes/ocean.css'
import './src/styles/themes/rose.css'
import './src/styles/components/sidebar.css'
import './src/styles/components/editor.css'
import './src/styles/components/menubar.css'
import './src/styles/components/statusbar.css'
import './src/styles/components/searchbar.css'
import './src/styles/components/settings.css'
import './src/styles/components/helpdialog.css'
import './src/styles/components/imagesdialog.css'
import './src/styles/components/tabbar.css'

// 平台标识：顶栏按平台避让系统窗口按钮区域
document.documentElement.setAttribute(
  'data-platform',
  window.desktopAPI?.platform ?? 'browser',
)

// 全局关闭拼写检查（兜底：即使浏览器级检查器开启也不出红色波浪线）
document.documentElement.setAttribute('spellcheck', 'false')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
