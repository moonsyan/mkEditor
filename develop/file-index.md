# 项目文件索引

> 更新基线：2026-08-11。当前文件清单以 `src/` 实际目录为准；`StartScreen/`、`ExportPdfDialog/` 与 `WorkspaceSearchDialog/` 已是现有组件。

> 按功能分类，方便快速定位代码。

---

## 一、核心逻辑文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/renderer/App.tsx` | 全部业务逻辑中枢（文件管理、状态、快捷键、导出） | ~1900 |
| `src/main/ipc/handlers.ts` | 所有 IPC 处理器（文件读写、窗口管理、设置） | ~520 |
| `src/main/settings/settings-store.ts` | 设置持久化（JSON 读写、并发控制、防御性设计） | ~140 |
| `src/main/window/window-manager.ts` | 窗口创建与管理（fresh 模式、关闭保护） | ~115 |
| `src/main/index.ts` | 应用入口（协议注册、单实例锁、自动更新） | ~102 |
| `src/preload/index.ts` | 安全桥接（暴露 desktopAPI） | ~103 |

---

## 二、UI 组件文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/components/Editor/index.tsx` | Milkdown 编辑器封装（搜索、图片、懒加载） |
| `src/renderer/src/components/Sidebar/index.tsx` | 侧栏（文件树 + 大纲 Tab） |
| `src/renderer/src/components/SearchBar/index.tsx` | 查找替换栏 |
| `src/renderer/src/components/StatusBar/index.tsx` | 底部状态栏（字数、行数、修改时间） |
| `src/renderer/src/components/MenuBar/index.tsx` | 自定义菜单栏 |
| `src/renderer/src/components/SettingsDialog/index.tsx` | 设置弹窗（主题、字号、快捷键） |
| `src/renderer/src/components/HelpDialog/index.tsx` | 帮助弹窗（快捷键一览、语法参考） |
| `src/renderer/src/components/ImagesDialog/index.tsx` | 图片管理弹窗 |
| `src/renderer/src/components/ThemeSwitcher/index.tsx` | 主题切换按钮 |

---

## 三、样式文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/styles/variables.css` | CSS 变量定义（所有主题的基础） |
| `src/renderer/src/styles/themes/default.css` | 暖白主题 |
| `src/renderer/src/styles/themes/dark.css` | 墨夜主题 |
| `src/renderer/src/styles/themes/ocean.css` | 海雾主题 |
| `src/renderer/src/styles/themes/rose.css` | 玫砂主题 |
| `src/renderer/src/styles/components/sidebar.css` | 侧栏样式 |
| `src/renderer/src/styles/components/searchbar.css` | 搜索栏样式 |
| `src/renderer/src/styles/components/statusbar.css` | 状态栏样式 |
| `src/renderer/src/styles/components/editor.css` | 编辑器样式 |
| `src/renderer/src/styles/components/settings.css` | 设置弹窗样式 |
| `src/renderer/src/styles/components/helpdialog.css` | 帮助弹窗样式 |
| `src/renderer/src/styles/components/menubar.css` | 菜单栏样式 |
| `src/renderer/src/styles/components/imagesdialog.css` | 图片管理弹窗样式 |
| `src/renderer/src/styles/global.css` | 全局样式（重置、布局） |
| `src/renderer/src/styles/typography.css` | 字体设置 |

---

## 四、数据与配置

| 文件 | 职责 |
|------|------|
| `src/renderer/src/data/shortcuts.ts` | 快捷键定义与合并逻辑 |
| `src/renderer/src/data/demo-files.ts` | 演示文件内容（首次启动用） |
| `src/shared/ipc/channels.ts` | IPC 通道名称常量（主进程和渲染进程共享） |
| `src/preload/api.d.ts` | DesktopAPI 类型声明 |
| `electron.vite.config.ts` | 构建配置（Vite + electron-vite） |
| `tsconfig.json` | TypeScript 配置（项目引用模式） |
| `tsconfig.node.json` | 主进程/Preload TypeScript 配置 |
| `tsconfig.web.json` | 渲染进程 TypeScript 配置 |
| `package.json` | 依赖声明、构建脚本、打包配置 |

---

## 五、按功能模块快速查找

### 文件管理
- 打开/保存：`App.tsx` `handleOpen`、`handleSave`、`handleSaveAs`
- 新建/重命名/删除：`App.tsx` `handleNew`、`handleRenameFile`、`handleDeleteFile`
- 移动文件：`App.tsx` `handleMoveFile`
- IPC 处理器：`handlers.ts` `FILE_OPEN`、`FILE_SAVE`、`FILE_CREATE`、`FILE_RENAME`、`FILE_MOVE`、`FILE_DELETE`

### 主题与外观
- 主题切换：`App.tsx` `theme` state + `useEffect`
- 主题 CSS：`src/renderer/src/styles/themes/*.css`
- 窗口标题栏颜色：`App.tsx` `TITLEBAR_COLORS` + `WINDOW_SET_TITLEBAR`

### 编辑器行为
- 打字机模式：`App.tsx` `centerCaret` + `typewriter` state
- 分栏预览：`App.tsx` `previewMode` + `previewHtml` state
- 专注模式：`App.tsx` `focusMode` state
- 缩放：`App.tsx` `zoom` state + `Ctrl+滚轮` 监听

### 搜索替换
- 搜索栏 UI：`SearchBar/index.tsx`
- 搜索逻辑：`Editor/index.tsx` `startSearch`、`searchNext`、`replaceCurrent`
- 搜索持久化：`App.tsx` `searchPref` state + `searchState` settings

### 快捷键
- 默认绑定：`data/shortcuts.ts` `DEFAULT_SHORTCUTS`
- 快捷键处理：`App.tsx` `handleAction` + `keydown` 监听
- 自定义逻辑：`SettingsDialog/index.tsx` 快捷键编辑 UI

### 会话与草稿
- 会话恢复：`App.tsx` 启动时的 `useEffect`
- 草稿恢复：`App.tsx` `loadDrafts`、`saveDrafts`
- 最近文件：`App.tsx` `recentFiles` state
- 自动保存：`App.tsx` 30 秒定时器

### 导出
- HTML 导出：`App.tsx` `handleExportHtml`、`buildDocHtml`、`inlineImagesInHtml`
- PDF 导出：`App.tsx` `handleExportPdf` → `handlers.ts` `FILE_EXPORT_PDF`
- Markdown 导出：`App.tsx` `handleExportMarkdown`

### 写作统计
- 统计逻辑：`App.tsx` `writingStats` state + `rollStatsDate`
- 统计 UI：`HelpDialog/index.tsx`（stats 视图）

---

## 六、已知问题位置索引

| 问题 ID | 状态 | 相关文件 |
|--------|------|---------|
| B4 拼写检查仅英文 | 未修复 | `window-manager.ts`（设置语言）、需引入 cspell |
| U4 搜索状态持久化 | ✅ 已修复 | `App.tsx` `searchPref` |
| B1 Mermaid 懒加载时序 | ✅ 已修复 | `Editor/index.tsx` `ensureRichContent` |
| B2 分栏预览延迟 | ✅ 已修复 | `App.tsx` `requestAnimationFrame` |
| B3 搜索不区分代码块 | ✅ 已修复 | `Editor/index.tsx` `collectHits` |
| B5 mtime 容差 | ✅ 已修复 | `handlers.ts` +3s 容差 |
| B6 草稿恢复基线 | ✅ 已修复 | `App.tsx` `stat` 校验 |
| B7 多窗口会话覆盖 | ✅ 已修复 | `settings-store.ts` 串行队列 |
| U1 打字机模式精度 | ✅ 已修复 | `App.tsx` `centerCaret` |
| U2 代码块悬浮定位 | ✅ 已修复 | `Editor/index.tsx` |
| U3 状态栏时间格式 | ✅ 已修复 | `StatusBar/index.tsx` |
| U5 文件树拖拽 | ✅ 已修复 | `App.tsx` `handleMoveFile` |
| U6 新建文件未聚焦 | ✅ 已修复 | `App.tsx` `focusEditorSoon` |
| U7 右键新窗口 | ✅ 已修复 | `App.tsx` `handleOpenInNewWindow` |
| U8 空白区点击行为 | ✅ 已修复 | `App.tsx` `blankClickToEnd` |
