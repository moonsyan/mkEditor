# 技术选型

## 选型原则

1. 优先降低编辑器数据安全风险
2. 其次降低开发者的学习成本
3. 最后考虑安装包大小和理论性能

## 技术栈总览

| 能力 | 选择 | 理由 |
|------|------|------|
| 运行环境 | Electron | 生态成熟，文件对话框/菜单/打印方案完善 |
| 构建工具 | electron-vite | 自动分离 main/preload/renderer 构建 |
| 前端框架 | React 18 | 只负责应用壳和声明式 UI |
| 编程语言 | TypeScript (strict) | IPC DTO、领域错误必须有明确类型 |
| 编辑器 | Milkdown 7（@milkdown/kit + @milkdown/react，ProseMirror 之上） | Markdown 优先，所见即所得，parse/serialize 内置 |
| 状态管理 | React Hooks + useRef（App.tsx 统一管理） | 文档数量少，局部状态更简单；无需外部状态库 |
| 样式方案 | CSS Variables + 模块化 | 主题切换简单，无需 CSS-in-JS |
| 测试 | Vitest + Playwright | 关键编辑行为用真实浏览器验证 |
| 代码规范 | ESLint + Prettier | 自动化，不争论风格 |

## 关键决策

### 为什么选 Electron

- ProseMirror、Milkdown、CodeMirror 等生态直接运行
- 文件对话框、菜单、打印 PDF、剪贴板和自动更新方案成熟
- TypeScript 覆盖 UI 到 preload 的主要边界
- 代价是安装包和内存较大，第一版可接受

### 为什么选 Milkdown

- 已把 Markdown 处理、ProseMirror 和插件机制组合起来
- 减少基础 schema、parser、serializer 的搭建工作
- 应用层只通过 adapter 接口调用 parse/serialize 能力

**当前使用的 Milkdown 模块**（均来自 `@milkdown/kit`，版本 7.22）：

| 模块 | 导入路径 | 用途 |
|------|---------|------|
| core | `@milkdown/kit/core` | 编辑器实例、rootCtx、defaultValueCtx |
| commonmark 预设 | `@milkdown/kit/preset/commonmark` | 标准语法 + 标题/列表/引用等命令 |
| gfm 预设 | `@milkdown/kit/preset/gfm` | 表格 / 任务列表 / 删除线 |
| history 插件 | `@milkdown/kit/plugin/history` | 撤销重做 |
| listener 插件 | `@milkdown/kit/plugin/listener` | 内容变更监听（markdownUpdated） |
| utils | `@milkdown/kit/utils` | replaceAll / insert / getHTML / callCommand 宏 |
| react | `@milkdown/react` | MilkdownProvider / useEditor / Milkdown 组件 |

**辅助插件与库**：

| 库 | 用途 |
|------|------|
| `@milkdown/plugin-prism` | 代码块语法高亮 |
| `@milkdown/plugin-math` | 数学公式（KaTeX，动态加载） |
| `@milkdown/plugin-diagram` | Mermaid 图表（动态加载） |
| `katex` | LaTeX 渲染引擎 |
| `mermaid` | 图表渲染引擎 |
| `micromark-extension-footnote` | 脚注语法解析 |
| `mdast-util-footnote` | 脚注 AST 转换 |

### 为什么用 CSS Variables 做主题

- 新增主题只需添加一组 CSS 变量，零 JS 逻辑
- 不需要 CSS-in-JS 库，降低依赖复杂度
- 运行时切换主题只需修改 `data-theme` 属性
- 对非前端开发者友好，修改颜色值即可

## 不选择的方案

| 方案 | 不选原因 |
|------|---------|
| JavaFX | 缺少 Web 编辑器生态，需嵌入 WebView |
| Monaco | 更适合代码编辑器，Markdown 场景过重 |
| Slate / Quill | Markdown 往返转换不是核心优势 |
| Tauri (第一版) | 迁移成本高，生态不如 Electron 成熟 |
| CSS-in-JS | 增加复杂度，对主题系统无必要 |
