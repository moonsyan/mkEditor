# MarkdownSoft

一款本地优先的桌面 Markdown 编辑器，基于 Electron 43、React 18 与 Milkdown（ProseMirror）构建。

支持多文件工作区、Wiki 链接、YAML 属性面板、主题切换、实时预览、代码块行号、拼写检查、拖拽导入文件、写作统计，以及 HTML / PDF / Word / EPUB 等格式导出。

完整的产品、架构与维护文档请从 [docs 文档索引](./docs/_index.md) 进入。

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 📂 多文件 & 工作区 | 打开文件夹作为工作区，侧栏展示文件树；支持新建、重命名、删除、拖拽移动 |
| 🔗 Wiki 链接 | 支持 `[[目标]]`、路径与别名，工作区内点击跳转并提供文件自动补全 |
| 🏷️ YAML 属性 | Frontmatter 简单键值可在属性面板增删改，复杂 YAML 与注释保持原文 |
| ✍️ 富文本编辑器 | 基于 Milkdown / ProseMirror，支持 GFM、表格、任务列表、引用、代码块 |
| 🎨 主题系统 | 内置 default / dark / ocean / rose 四套主题，支持导入自定义 CSS |
| 📐 分栏预览 | 可切换实时分栏预览模式，编辑区与预览区比例同步滚动 |
| 🔍 查找替换 | 支持普通文本、正则、大小写敏感、全词匹配；搜索状态跨会话持久化 |
| 📝 打字机模式 | 光标所在行始终保持在可视区中央，减少视觉干扰 |
| 🧘 专注模式 | 隐藏顶部栏与侧栏，仅保留编辑区 |
| 📷 图片管理 | 本地图床 + SM.MS 图床；支持拖入图片自动上传；图片管理对话框 |
| 📊 写作统计 | 实时字数 / 行数 / 阅读时长统计；每日写作时长历史记录（保留 30 天） |
| 🖨️ 导出 | 导出为 HTML / PDF（可含目录页）/ Markdown / Word / EPUB / LaTeX / 纯文本（需 pandoc） |
| 🔤 自定义快捷键 | 所有快捷键可在设置中自定义，支持多键组合 |
| ⚡ 自动保存 | 每 30 秒自动写盘；崩溃退出后恢复未保存草稿 |
| 🔤 代码块行号 | 可在设置中开启 |
| 🔤 拼写检查 | 支持多语言（en-US 等），可在设置中切换 |
| 📄 多窗口 | 可开启多窗口模式，各窗口独立编辑不同文件 |
| 📂 全文搜索 | 工作区模式下的全局文件内容搜索 |
| 🖱️ 拖拽导入 | 将 .md 文件拖入窗口即可直接打开 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | [Electron](https://www.electronjs.org/) 43 |
| 构建工具 | [electron-vite](https://electron-vite.github.io/) + [Vite](https://vitejs.dev/) |
| UI 框架 | [React](https://react.dev/) 18 |
| 编辑器内核 | [Milkdown](https://milkdown.dev/) 7（基于 ProseMirror） |
| 状态管理 | React useState / useRef（轻量方案，避免外部状态库开销） |
| 图表/公式 | [Mermaid](https://mermaid.js.org/) + [KaTeX](https://katex.org/) |
| 打包发布 | [electron-builder](https://www.electron.build/) + [electron-updater](https://www.npmjs.com/package/electron-updater) |

---

## 目录结构

```
markdown-soft-v3/
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.ts           # 入口：单实例锁、协议注册、窗口创建
│   │   ├── ipc/               # IPC 处理器（文件读写、设置存取）
│   │   ├── settings/          # 设置持久化存储
│   │   └── window/            # 窗口生命周期管理
│   ├── preload/               # 桥接层：contextBridge 暴露窄接口 DesktopAPI
│   ├── renderer/              # Electron 渲染进程（React 应用）
│   │   ├── main.tsx           # React 入口
│   │   ├── App.tsx            # 顶层应用组件（状态管理、文件操作、快捷键分发）
│   │   └── src/
│   │       ├── components/    # UI 组件
│   │       │   ├── Editor/            # Milkdown 编辑器封装
│   │       │   ├── Sidebar/           # 侧栏（文件树、大纲、工作区）
│   │       │   ├── MenuBar/           # 顶部菜单栏
│   │       │   ├── StatusBar/         # 底部状态栏
│   │       │   ├── SearchBar/         # 查找替换栏
│   │       │   ├── ThemeSwitcher/     # 主题切换按钮
│   │       │   ├── SettingsDialog/    # 设置弹窗
│   │       │   ├── HelpDialog/        # 帮助弹窗（快捷键、语法、关于）
│   │       │   ├── ImagesDialog/      # 图片管理弹窗
│   │       │   ├── ExportPdfDialog/   # PDF 导出选项弹窗
│   │       │   └── WorkspaceSearchDialog/  # 工作区全文搜索弹窗
│   │       ├── data/           # 静态数据（演示文件、快捷键定义）
│   │       └── styles/         # 样式（主题变量、组件样式）
│   └── shared/
│       └── ipc/               # IPC 通道名称常量（主进程 & 渲染进程共享）
├── docs/                      # 项目文档
│   ├── _index.md              # 文档总入口
│   ├── product/               # 产品边界、功能规格、对比
│   ├── architecture/          # 架构、目录与技术选型
│   └── development/           # 组件、主题、快捷键与维护
├── resources/                 # 应用资源（图标等）
├── electron.vite.config.ts    # Electron-Vite 构建配置
├── tsconfig.json
└── package.json
```

---

## 安全架构

```
Renderer（React）
    ↕ IPC（窄接口）
Preload（contextBridge 桥接）
    ↕ IPC
Main（Node.js，拥有 fs/path 权限）
```

- **渲染进程不能直接访问 Node.js API**（`fs`、`path` 等），所有文件操作必须通过 IPC 由主进程执行
- **Preload 脚本**通过 `contextBridge` 暴露类型安全的 `DesktopAPI` 接口，不暴露通用 IPC 或 Node.js 权限
- **自定义 `mdimg://` 协议**：编辑器中引用本地图时使用 `mdimg://` 协议，由主进程安全地将其转换为 `file://` 读取，确保文档可移植
- **窗口导航保护**：窗口内不加载外部页面，HTTP(S) 与 `mailto:` 外链交由系统浏览器打开

---

## 快速开始

### 前置要求

- Node.js 18+
- npm 9+

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

启动后 Electron 窗口将打开，支持热更新。

### 构建

```bash
npm run typecheck
npm run test
npm run build
```

### 预览构建产物

```bash
npm run preview
```

### 打包发行版

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

打包产物输出至 `release/${version}/` 目录。

---

## 快捷键

部分常用快捷键（可在设置中自定义）：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文档 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开文件夹（工作区） |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+F` | 打开查找 |
| `Ctrl+H` | 打开查找替换 |
| `Ctrl+J` | 切换侧栏 |
| `F11` | 专注模式 |
| `Escape` | 专注模式下退出（查找栏或弹窗打开时由对应控件处理） |
| `Ctrl+=` / `Ctrl+滚轮` | 放大编辑区 |
| `Ctrl+-` | 缩小编辑区 |

完整快捷键列表请参阅应用内「帮助 → 快捷键」。

---

## 导出功能

| 格式 | 说明 |
|------|------|
| HTML | 自包含，图片内联为 base64，可直接在浏览器打开 |
| PDF | 支持页面大小、页边距、页眉页脚、目录页等选项 |
| Markdown | 另存为新的 .md 文件 |
| Word / EPUB / LaTeX / 纯文本 | 需要系统已安装 [pandoc](https://pandoc.org/) |

---

## 配置与持久化

所有设置与用户状态均持久化至本地用户数据目录（`%APPDATA%` / `~/Library/Application Support/`），重启后自动恢复：

- 主题 / 字体大小 / 内容宽度 / 行高 / 字体类型
- 自动保存 / 拼写检查 / 多窗口模式
- 最近打开文件记录（最近 10 条）
- 自定义快捷键
- 写作统计（今日字数、时长及 30 天历史）
- 搜索状态（查询词、选项、替换文本）
- 文件树展开/折叠状态与侧栏活动页
- 自定义主题 CSS
- 图床配置（SM.MS token）
- 会话状态（上次打开的文件、工作区、激活文档）
- 草稿（崩溃/退出后恢复未保存内容）

---

## 开发说明

### IPC 通道

所有 IPC 通道名称定义在 `src/shared/ipc/channels.ts`，主进程和渲染进程共享同一份常量，避免字符串拼写错误。

### 编辑器状态管理

- 编辑器内容通过 Milkdown（ProseMirror）管理，React 通过 `handleEditorChange` 回调同步到 `contents` 状态
- 脏标记（`savedMap`）在内容变化时自动更新，用于判断是否需要保存

---

## 许可证

本项目仅供学习参考。
