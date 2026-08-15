# 组件指南

> 2026-08-15 更新：`App.tsx` 的视图偏好、会话写入与草稿防抖已分别交给 Hook；`Editor/index.tsx` 只保留 Milkdown 生命周期、DOM 事件委托和命令编排。编辑器扩展与数据安全约束见 [编辑器扩展指南](./editor-extensions.md)，已修复问题见 [排障与缺陷记录](./troubleshooting.md)。

## 本轮拆分

- `hooks/useEditorViewState.ts`：编辑器外观、视图和设置弹窗状态。
- `hooks/useDocumentSessionPersistence.ts`：仅持久化真实文件标签、激活文档和工作区；新窗口不会覆盖主窗口会话。
- `hooks/useDraftPersistence.ts`：草稿延迟写入，并在标签切换时补写最后一次输入。
- `components/Editor/useImageInsertion.ts`：图片大小校验、图床降级、本地写入与串行插入队列。
- `components/Editor/searchController.ts`：搜索高亮、跳转、替换当前项、全部替换和清理。
- `components/Editor/EditorOverlays.tsx`：代码块和表格悬浮工具，以及全屏代码预览的视图层。

代码块采用紧凑排版：正文行高为 `1.55`，无语言标识时不预留标题区；启用语言标识或行号后，标题区、行号和代码正文使用同一垂直基线。

> 更新基线：2026-08-15。顶层编排以 `src/renderer/App.tsx` 为准；当前实现未使用 Zustand。

> `App.tsx` 仍包含文档工作流与应用壳装配。继续重构时应先抽取工作区文件操作和动作分发 Hook，不应为了缩短文件而拆散保存、草稿、mtime 冲突与预览标签的同一业务链路。

## 组件架构

所有 UI 组件位于 `src/renderer/src/components/` 下，按功能拆分为独立目录。每个组件目录包含：

- `index.tsx` — 组件主文件
- 样式统一放在 `src/renderer/src/styles/components/` 下

```
components/
├── Sidebar/        侧栏（文件树 + 大纲）
├── Editor/         Milkdown 编辑器（含命令式接口 + plugins/ 子插件）
│   └── plugins/    编辑器插件（frontmatter / wikiLink / footnote / sectionFold 等）
├── TabBar/         多标签页栏（拖拽排序）
├── MenuBar/        菜单栏（数据驱动）
├── StatusBar/      状态栏
├── ThemeSwitcher/  主题切换器
├── SearchBar/      查找替换栏
├── SettingsDialog/ 设置弹窗（Typora 式分类导航，拆分为 AppearancePanel / EditorPanel / ShortcutsPanel）
├── HelpDialog/     帮助弹窗（快捷键/语法/关于）
├── ImagesDialog/   图片管理面板
├── ExportPdfDialog/ PDF 导出选项对话框
├── WorkspaceSearchDialog/  工作区搜索对话框
└── StartScreen/    关闭全部标签页后的起始界面

src/renderer/src/hooks/
├── usePersistedSetting.ts  通用设置持久化 hook
├── useRecentFiles.ts       最近文件管理 hook
└── useWritingStats.ts      写作统计 hook

src/renderer/src/lib/
├── drafts.ts              草稿读写（崩溃恢复）
├── editor-sync.ts         编辑器防抖回调归属校验
├── frontmatter-parser.ts  YAML 属性提取与最小写回
├── image-path.ts          图片路径处理（mdimg:// 协议）
├── pdf.ts                 PDF 导出（主进程调用）
├── stats.ts               写作统计数据模型与日期工具
└── wiki-resolver.ts       工作区 Wiki 链接目标解析

src/renderer/src/data/
└── demo-files.ts   演示文件树数据源（正式版换成 Main 进程读目录）
```

> 顶部栏（窗口圆点 + 菜单 + 标题 + 操作按钮）直接在 `App.tsx` 中组装，无独立 TitleBar 组件。标签栏位于右侧编辑器区域顶部，不占用侧栏上方空间。侧栏单击文件时以斜体预览标签打开，下一次单击会替换未修改的预览标签；双击或首次修改后固定标签。关闭最后一个标签页会显示 `StartScreen`，不会强制创建空白文档。

---

## 组件说明

### Sidebar — 侧栏

**路径**：`components/Sidebar/index.tsx`

**职责**：
- 显示文件树（文件夹 + 文件列表，支持折叠）
- 显示文档大纲（从 Markdown 标题提取；输入期间延后计算，避免长文档阻塞编辑）
- 两个 tab 切换；点击文件切换文档，点击大纲定位标题

大纲解析位于 `lib/outline.ts`，侧栏仅负责延后调度和渲染。

**Props**：
```typescript
interface SidebarProps {
  tree: DemoFolder[]              // 文件树结构（来自 data/demo-files.ts）
  openFiles: OpenFile[]           // 当前打开的所有文件
  activeFileId: string            // 当前激活文件 ID
  content: string                 // 当前文档 Markdown（生成大纲）
  onSelectDemoFile: (id: string, pinned: boolean) => void
  onSelectWorkspaceFile: (path: string, pinned: boolean) => void
  onOutlineClick: (index: number) => void // 点击大纲回调（标题序号）
  focusOutlineTick?: number       // 递增时自动切到大纲 tab
}
```

---

### Editor — 编辑器（Milkdown）

**路径**：`components/Editor/index.tsx`
**插件目录**：`components/Editor/plugins/`（`frontmatter` / `wikiLink` / `footnote` / `sectionFold` / `tableColResize` / `bracketMatch` / `codeLineNumbers` / `customCodeFence` / `mermaidCodeBlock` / `searchHighlight` / `blockContext` / `nodeAttrs`）

**职责**：
- 封装 Milkdown（commonmark + gfm + history + listener 插件）
- 通过插件系统支持：Frontmatter 元数据与属性面板、Wiki 链接、脚注、KaTeX 数学公式、Mermaid 图表、章节折叠、表格列宽拖拽、括号匹配高亮、代码块行号、自定义代码围栏、搜索高亮、块上下文标记
- 提供所见即所得编辑，内容变化通过回调上抛 Markdown
- 通过 ref 暴露命令式接口，供 App 分发菜单操作
- 输入法合成期间不拦截方向键，避免干扰中文候选词选择

**Props**：
```typescript
interface EditorProps {
  initialContent: string                    // 初始内容（仅首次挂载）
  onChange: (markdown: string) => void      // 内容变化回调
}
```

**命令式接口（ref）**：
```typescript
interface EditorHandle {
  replaceContent(md: string): void    // 整体替换（切换文件）
  getMarkdown(): string | null        // 当前编辑器状态序列化结果
  insertMd(md: string): void          // 光标处插入片段
  runCommand(key: CmdKey<T>, payload?: T): boolean  // 执行命令（粗体/标题/表格…）
  getHtml(): string                   // 导出 HTML 用
  focus(): void
}
```

**设计要点**：
- `useEditor` 只在挂载时执行一次，`onChange` 通过 ref 透传，避免重建编辑器丢光标
- KaTeX 在实例创建前注册；Mermaid 使用 `mermaidCodeBlock` 节点视图保持标准代码围栏，可按需加载 SVG 渲染器、切换源码，并在导出前等待渲染结束（最多 4 秒）；渲染失败或超时未完成时块内无 SVG，导出以源码文本兜底，内容不丢
- 切换文档复用同一编辑器实例，但调用 `replaceAll(markdown, true)` 重建 `EditorState`，清空跨文档撤销历史；切换后重新转换 Wiki 文本并清空章节折叠状态
- 程序性更新（属性面板等）走单条全文替换事务并保留撤销历史，选区经事务 `tr.mapping` 精确恢复，frontmatter 长度变化不再漂移；内容解析失败时提示"内容无法解析，已保留原文档"，浮层一并清理
- 章节折叠仅以 `display:none` 隐藏，`sectionFold` 的 `handleKeyDown` 提供三层选区守卫（Ctrl+A 先展开全部再全选、隐藏区内按键 clamp 回标题末尾、方向键跨界跳转）；标题级别变更（setNodeMarkup）时跳过快速路径立即重建折叠装饰
- 调用 action 前检查 `EditorStatus.Created`，防止初始化未完成时抛异常
- 编辑器插件统一放在 `plugins/` 子目录，每个插件是一个独立的 `.ts` 文件

---

### MenuBar — 菜单栏

**路径**：`components/MenuBar/index.tsx`

**职责**：
- 渲染菜单项（文件/编辑/段落/视图/帮助）
- 管理下拉菜单的展开/收起
- 分发菜单操作到对应 handler

**Props**：
```typescript
interface MenuBarProps {
  onAction: (action: string) => void  // 菜单操作回调
}
```

**子组件**：无（菜单定义集中在 `MENU_DEFS` 常量，新增菜单项只需加一行）

**实现要点**：下拉菜单使用 `position: fixed` 动态定位，避免被工作区 `overflow: hidden` 裁剪

---

### StatusBar — 状态栏

**路径**：`components/StatusBar/index.tsx`

**职责**：
- 显示保存状态
- 显示字数、行数、阅读时间
- 显示文件编码和格式

**Props**：
```typescript
interface StatusBarProps {
  saved: boolean
  wordCount: number
  lineCount: number
  readTime: number
}
```

> 状态栏显示检测到的文件编码与 Markdown 格式；GBK 文件可按原编码保存，遇到无法表示的字符时会提示转为 UTF-8。带 BOM 的 UTF-8 显示为 `UTF-8 (BOM)` 并原样写回 BOM；无 BOM 的 UTF-16 按零字节占比自动探测并按原编码保存；UTF-32 明确拒绝打开。

---

### ThemeSwitcher — 主题切换器

**路径**：`components/ThemeSwitcher/index.tsx`

**职责**：
- 显示主题选择下拉面板
- 切换 `data-theme` 属性
- 记住用户选择的主题

**Props**：
```typescript
interface ThemeSwitcherProps {
  currentTheme: string
  onThemeChange: (theme: string) => void
}
```

---

### SearchBar — 查找替换栏

**路径**：`components/SearchBar/index.tsx`

**职责**：
- 文档内查找（ProseMirror 装饰高亮引擎，支持正则模式）
- 匹配计数显示（x / y），当前匹配深色高亮
- 逐个替换与全部替换（从后往前批量 insertText，位置不回漂）
- Enter 下一个 / Shift+Enter 上一个 / Esc 关闭

**Props**：
```typescript
interface SearchBarProps {
  withReplace: boolean
  onClose: () => void
  count: number            // 匹配总数
  current: number          // 当前匹配索引
  onQueryChange: (query: string, useRegex: boolean) => void
  onNext: (backwards: boolean) => void
  onReplace: (replacement: string) => void
  onReplaceAll: (replacement: string) => void
}
```

> 搜索状态与高亮插件位于 `Editor/plugins/searchHighlight.ts`，命令控制器位于 `Editor/searchController.ts`；`EditorHandle` 转发 startSearch / searchNext / replaceCurrent / replaceAllMatches / endSearch，SearchBar 只负责 UI。

---

**新增设置项的做法**：
1. SettingsDialog 对应分类页加一行 UI + Props
2. App 加 state，在启动加载 effect 中读取、变化 effect 中写回（settings IPC）
3. 需要样式联动的写到 html 根元素 data 属性 + CSS（参考 data-fontsize）
4. 如需 CSS 变量联动，在 App.tsx 对应 useEffect 中写 document.documentElement.style.setProperty

---

### SettingsDialog — 设置弹窗（Typora 式）

**路径**：`components/SettingsDialog/index.tsx`
**子组件**：`AppearancePanel.tsx` / `EditorPanel.tsx` / `ShortcutsPanel.tsx` / `constants.ts`
**Hook**：`useShortcutRecorder.ts`

**职责**：
- 左侧分类导航（外观 / 编辑器 / 快捷键）+ 右侧配置面板
- 外观面板：主题卡片、字号分段选择、缩放控制、自定义 CSS 导入
- 编辑器面板：自动保存、打字机模式、拼写检查（含语言选择）、多窗口模式、空白区点击聚焦、代码块行号、图床配置
- 快捷键面板：23 项全局快捷键可录入新组合键（需含 Ctrl 或功能键）、冲突检测、清除停用、一键恢复默认
- 全部受控组件，状态与持久化由 App 负责；Esc/点背景关闭

### TabBar — 多标签页栏

**路径**：`components/TabBar/index.tsx`

**职责**：
- 展示所有已打开文档的标签，点击切换、× 按钮关闭
- 支持拖拽排序（重排 openFiles 顺序）
- 侧栏单击以预览标签打开，双击或首次编辑后固定；仅未保存文档显示 dirty 指示点
- 样式文件：`styles/components/tabbar.css`

**Props**：
```typescript
interface TabBarProps {
  openFiles: OpenFile[]
  activeFileId: string
  savedMap: Record<string, boolean>
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onReorder: (from: number, to: number) => void
}
```

### HelpDialog — 帮助弹窗

**路径**：`components/HelpDialog/index.tsx`

**职责**：三个视图合一，由 `view` prop 切换：
- `shortcuts` — 快捷键分组列表
- `syntax` — Markdown 语法参考（含扩展语法）
- `about` — 关于页（图标、版本、技术栈）

```typescript
type HelpView = 'shortcuts' | 'syntax' | 'about' | null
interface HelpDialogProps {
  view: HelpView
  onClose: () => void
}
```

---

## 组件设计原则

### 1. 单一职责

每个组件只做一件事。侧栏只管导航，编辑器只管写作，状态栏只管展示统计。

### 2. Props 驱动

组件不自己获取数据，所有数据通过 Props 传入。这样组件容易测试、容易复用。

### 3. 样式集中管理

组件样式统一放在 `src/renderer/src/styles/components/` 下，按组件名分文件（如 `menubar.css`）。主题相关的颜色、间距使用 CSS 变量。

### 4. 事件上抛

组件不直接修改全局状态。用户操作通过回调函数传递给父组件处理。

```
用户点击 → 组件触发回调 → 父组件更新状态 → Props 变化 → 组件重新渲染
```

---

## 新增组件的步骤

1. 在 `components/` 下创建新目录
2. 创建 `index.tsx` 定义组件
3. 如需专属样式，在 `styles/components/` 下新建 css 并在 `main.tsx` 中导入
4. 在 `App.tsx` 中引入并使用
5. 更新本文档的组件说明

---

## Hook 说明

### usePersistedSetting

**路径**：`hooks/usePersistedSetting.ts`

通用设置持久化 hook，在设置加载完成后将值写回磁盘。支持防抖写入（拖拽、输入等高频变化场景）。

```typescript
usePersistedSetting<T>(key: string, value: T, readyRef: Ref<boolean>, debounceMs?: number): void
```

### useDocumentSessionPersistence

**路径**：`hooks/useDocumentSessionPersistence.ts`

写入当前真实文件标签、激活文档和工作区。写入前去重并限制为 200 项，`#fresh` 新窗口不会改写主窗口会话。

### useDraftPersistence

**路径**：`hooks/useDraftPersistence.ts`

当前文档内容在 1 秒后写入草稿；若用户在防抖期间切换标签，会立即补写旧标签最后一次输入。它同时提供关闭窗口前的强制草稿写入，保存、重命名、删除或确认关闭后由调用方清理对应草稿。

### useRecentFiles

**路径**：`hooks/useRecentFiles.ts`

管理最近打开的磁盘文件列表（置顶 + 去重 + 上限 10），防抖 2 秒持久化。

```typescript
const { recentFiles, setRecentFiles, recordRecent } = useRecentFiles(readyRef)
```

### useWritingStats

**路径**：`hooks/useWritingStats.ts`

写作统计 hook：追踪字数净增（同文件字数增加才计入）+ 写作时长（每 60 秒检查最近 90 秒内是否有编辑），持久化防抖 10 秒。

```typescript
const { writingStats, setWritingStats } = useWritingStats(wordCount, activeFileId, readyRef)
```

---

## 模块说明：lib/

`src/renderer/src/lib/` 存放与编辑器核心逻辑相关的工具模块：

- **`drafts.ts`**：草稿读写（崩溃/退出后恢复未保存内容）
- **`editor-sync.ts`**：校验 Milkdown 防抖回调仍属于当前编辑器状态
- **`frontmatter-parser.ts`**：提取简单 YAML 属性并按行更新，保留复杂结构与换行
- **`image-path.ts`**：图片路径处理，支持 `mdimg://` 本地协议
- **`pdf.ts`**：PDF 导出逻辑（调用主进程 printToPDF）
- **`stats.ts`**：写作统计的数据模型与日期工具（`todayStr`、`rollStatsDate`）
- **`wiki-resolver.ts`**：在当前工作区内解析 Wiki 链接目标

---

## 数据源：demo-files.ts

`src/renderer/src/data/demo-files.ts` 提供演示文件树，正式版替换为 Main 进程读取的真实目录：

```typescript
export interface DemoFile { id: string; name: string; content: string }
export interface DemoFolder { label: string; fileIds: string[] }
export const DEMO_FILES: Record<string, DemoFile>  // 全部文件内容
export const DEMO_TREE: DemoFolder[]               // 树结构
export const DEFAULT_FILE_ID: string               // 启动时打开的文件
```

**换成真实目录的做法**：在 Main 进程新增 IPC（读取目录树），渲染进程用同样结构的数据替换 `DEMO_TREE`/`DEMO_FILES`，Sidebar 无需修改。
