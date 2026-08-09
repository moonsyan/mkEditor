# MarkdownSoft v3

一款柔和简洁的 Markdown 桌面编辑器，对标 Typora 的所见即所得体验。**完全免费开源**。

## 特性

- **所见即所得** — 输入 Markdown 语法即刻渲染，无需分栏预览
- **柔和配色** — 4 套精心调配的主题（暖白 / 墨夜 / 海雾 / 玫砂）
- **简洁界面** — 所有功能收纳在菜单栏，界面只留下文字本身
- **文件管理** — 左侧栏文件树 + 文档大纲
- **桌面原生** — 基于 Electron，支持系统级文件操作

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建生产版本
npm run build
```

> 提示：Electron 二进制下载慢时，设置镜像后重装：
> `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install electron`

## 技术栈

| 能力 | 选择 |
|------|------|
| 运行环境 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | electron-vite + Vite 5 |
| 编辑器 | Milkdown 7（@milkdown/kit + @milkdown/react，ProseMirror 之上） |
| 主题 | CSS Variables，4 套内置主题 |

## 项目结构

```
markdownSoftV3/
├── docs/                    # 项目文档
├── src/
│   ├── main/                # Electron 主进程（窗口 + 文件 IPC）
│   ├── preload/             # 预加载脚本（desktopAPI 桥接）
│   ├── renderer/            # 渲染进程 (React UI)
│   │   ├── App.tsx          # 根组件（状态编排）
│   │   └── src/
│   │       ├── components/  # UI 组件（菜单/侧栏/编辑器/状态栏/主题）
│   │       ├── data/        # 演示文件树数据源
│   │       └── styles/      # 样式系统（全局/主题/组件）
│   └── shared/              # IPC 通道常量
├── package.json
└── electron.vite.config.ts
```

> 完整目标架构见 [目录结构](./directory-structure.md)。

## 文档索引

| 文档 | 说明 |
|------|------|
| [项目概述](./project-overview.md) | 项目目标、用户定位、产品原则 |
| [架构说明](./architecture.md) | 系统架构、进程模型、数据流 |
| [技术选型](./tech-stack.md) | 技术栈选择与决策依据 |
| [功能规格](./feature-spec.md) | 各阶段功能规格说明 |
| [目录结构](./directory-structure.md) | 完整目录结构与职责说明 |
| [组件指南](./component-guide.md) | 可复用组件说明与使用方式 |
| [主题定制](./theme-guide.md) | 如何新增和修改主题 |
| [维护指南](./maintenance-guide.md) | 面向非前端开发者的维护说明 |
| [快捷键](./keyboard-shortcuts.md) | 完整快捷键参考 |
| [Typora 对比](./typora-comparison.md) | MarkdownSoft vs Typora 功能差异分析 |

## 设计预览

直接在浏览器中打开 `design-preview-v3.html` 查看当前设计效果。
