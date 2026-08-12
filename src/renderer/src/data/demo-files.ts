/**
 * 演示用文件树数据源
 * 正式版将由 Main 进程读取真实目录生成，结构保持一致。
 */

export interface DemoFile {
  /** 文件唯一 ID（正式版使用文件绝对路径） */
  id: string
  /** 显示名称 */
  name: string
  /** Markdown 正文 */
  content: string
}

export interface DemoFolder {
  /** 文件夹名称 */
  label: string
  /** 文件夹下的文件 ID 列表（顺序即显示顺序） */
  fileIds: string[]
}

export const DEMO_FILES: Record<string, DemoFile> = {
  welcome: {
    id: 'welcome',
    name: '欢迎使用.md',
    content: `# 欢迎使用 MarkdownSoft

一款对标 Typora 的**柔和简洁**的 Markdown 桌面编辑器。

## 设计理念

> 少即是多。最好的写作工具不会分散你的注意力——它让你专注于文字本身。

没有工具栏，没有分栏预览。你只需要安静地写字，Markdown 标记在落笔的瞬间自然呈现。

## 核心特性

### 所见即所得

输入 Markdown 语法即刻渲染，不需要切换模式，不需要侧边预览：

- 输入 \`# \` 立刻变成一级标题
- 输入 \`**文字**\` 立刻变成**粗体**
- 输入 \`- \` 立刻变成列表项

### 柔和配色

精心调配的多套主题色系，长时间书写也不会感到视觉疲劳：

- **暖白** — 经典暖色调
- **墨夜** — 深邃暗色
- **海雾** — 冷调蓝灰
- **玫砂** — 温暖粉棕

点击右上角的太阳图标即可切换。

### 功能隐藏

所有功能收纳在顶部菜单栏，界面只留下文字本身。

## 任务清单

- [x] 所见即所得编辑
- [x] 多主题适配
- [x] 文件树与大纲
- [ ] 插件系统
- [ ] 云端同步

## 表格

| 特性 | 状态 | 说明 |
| ---- | ---- | ---- |
| 所见即所得 | 已完成 | Typora 式编辑 |
| 多主题 | 已完成 | CSS 变量驱动 |
| 文件管理 | 已完成 | 打开 / 保存 / 另存为 |

## 扩展语法

### 数学公式（KaTeX）

行内公式：质能方程 $E = mc^2$，勾股定理 $a^2 + b^2 = c^2$。

块级公式用双美元符号包裹：

$$
\\int_0^\\infty e^{-x}\\,dx = 1
$$

### 流程图（Mermaid）

用 mermaid 代码块书写：

\`\`\`mermaid
graph TD
  A[书写 Markdown] --> B[即时渲染]
  B --> C{满意?}
  C -->|是| D[导出分享]
  C -->|否| A
\`\`\`

### 脚注

MarkdownSoft 支持脚注语法[^1]，适合学术写作。

[^1]: 行内输入 [^标签] 插入引用；行首输入 [^标签]: 内容 定义脚注。

### 代码块

输入 \`\`\`python 或 ~~~python 加空格即可创建带语言的代码块；
点击代码块可直接在块内修改语言、复制内容。

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")
\`\`\`

---

*开始书写你的想法。*
`,
  },
  quickstart: {
    id: 'quickstart',
    name: '快速开始.md',
    content: `# 快速开始

## 基本语法

### 标题

输入 \`#\` + 空格 创建一级标题，\`##\` 二级，以此类推。

### 强调

- \`**粗体**\` → **粗体**
- \`*斜体*\` → *斜体*
- \`~~删除线~~\` → ~~删除线~~
- \`\\\`行内代码\\\`\` → \`行内代码\`

### 列表

输入 \`-\` + 空格 创建无序列表，\`1.\` + 空格 创建有序列表。

1. 第一项
2. 第二项
3. 第三项

### 引用

> 按下 \`>\` + 空格 即可创建引用块。

## 快捷键

| 快捷键 | 功能 |
| ------ | ---- |
| Ctrl+B | 粗体 |
| Ctrl+I | 斜体 |
| Ctrl+S | 保存 |
| Ctrl+Z | 撤销 |
| Ctrl+J | 切换侧栏 |
`,
  },
  design: {
    id: 'design',
    name: '设计理念.md',
    content: `# 设计理念

## 安静的界面

> 界面应当像纸一样安静，让文字成为唯一的主角。

MarkdownSoft 遵循三条设计原则：

1. **柔和** — 低对比、暖色调，长时间书写不疲劳
2. **简洁** — 功能收纳进菜单，界面只保留文字
3. **专注** — 专注模式隐藏一切干扰元素

## 色彩系统

所有颜色通过 CSS 变量定义，新增主题只需要一组变量：

\`\`\`css
[data-theme="my-theme"] {
  --bg-app: #FAFAFA;
  --accent: #5B8DEF;
}
\`\`\`

## 排版细节

- 正文行高 1.85，最舒适的中文字距
- 内容区限宽 720px，避免过长的阅读行
- 标题层级间保持呼吸感的留白
`,
  },
  architecture: {
    id: 'architecture',
    name: '架构说明.md',
    content: `# 架构说明

## 三进程模型

| 进程 | 职责 | 技术 |
| ---- | ---- | ---- |
| Main | 窗口管理、文件读写 | Electron |
| Preload | 安全桥接 | contextBridge |
| Renderer | 界面与编辑 | React + Milkdown |

## 渲染进程分层

- **components** — 纯 UI 组件（MenuBar / Sidebar / Editor / StatusBar）
- **features** — 业务能力（文件管理、主题、导出）
- **core** — 核心域模型（文档、目录树）
- **ports** — 能力接口（EditorPort / FilePort / StoragePort）

## 编辑器内核

基于 [Milkdown](https://milkdown.dev)（ProseMirror 之上），实现 Typora 式所见即所得。

- \`commonmark\` 预设 — 标准语法
- \`gfm\` 预设 — 表格 / 任务列表 / 删除线
- \`history\` 插件 — 撤销重做
- \`listener\` 插件 — 内容变更监听
`,
  },
  api: {
    id: 'api',
    name: 'API 参考.md',
    content: `# API 参考

## DesktopAPI（window.desktopAPI）

Preload 暴露给渲染进程的安全接口。

### document

\`\`\`typescript
// 打开文件对话框并读取内容
document.open(): Promise<FileResult>

// 保存到指定路径
document.save(path: string, content: string): Promise<SaveResult>

// 另存为（可自定义过滤器导出 HTML）
document.saveAs(content: string, options?): Promise<SaveAsResult>
\`\`\`

### settings

\`\`\`typescript
settings.get(key: string): Promise<unknown>
settings.set(key: string, value: unknown): Promise<void>
\`\`\`

## IPC 结果约定

所有 IPC 返回统一结构：

\`\`\`typescript
{ ok: boolean; data?: T; error?: { code: string; message?: string } }
\`\`\`
`,
  },
  meeting: {
    id: 'meeting',
    name: '会议记录.md',
    content: `# 会议记录

## 2026-08-08 产品评审

### 结论

- [x] 确定 Typora 式所见即所得方向
- [x] 四套主题全部保留
- [ ] 下阶段：接入真实文件系统
- [ ] 下阶段：插件系统预研

### 待讨论

1. 是否支持 LaTeX 公式
2. 图片粘贴上传策略

> 下次会议时间：待定
`,
  },
  todo: {
    id: 'todo',
    name: '待办事项.md',
    content: `# 待办事项

## 本周

- [x] 完成所见即所得编辑器
- [x] 文件树与大纲联动
- [ ] 导出 PDF
- [ ] 拼写检查

## 后续

- [ ] 插件市场
- [ ] 多窗口支持
- [ ] 国际化
`,
  },
}

/** 文件树结构（顺序即显示顺序） */
export const DEMO_TREE: DemoFolder[] = [
  { label: '项目文档', fileIds: ['welcome', 'quickstart', 'design'] },
  { label: '技术文档', fileIds: ['architecture', 'api'] },
  { label: '笔记', fileIds: ['meeting', 'todo'] },
]

/** 默认打开的文件 */
export const DEFAULT_FILE_ID = 'welcome'
