# 目录结构

> ⚠️ 下方目录树是**目标架构**（含尚未创建的模块，如 features/、core/、ports/）。
> 当前实际已落地的文件见文末《当前实际结构》。

## 完整目录树

```
markdownSoftV3/
│
├── docs/                          # 📖 项目文档（本目录）
│   ├── README.md                  #   项目入口，快速开始
│   ├── project-overview.md        #   项目目标、用户、原则
│   ├── architecture.md            #   系统架构、进程模型、数据流
│   ├── tech-stack.md              #   技术选型与决策依据
│   ├── feature-spec.md            #   各阶段功能规格
│   ├── directory-structure.md     #   本文件
│   ├── component-guide.md         #   可复用组件说明
│   ├── theme-guide.md             #   主题定制指南
│   ├── maintenance-guide.md       #   维护指南（面向非前端开发者）
│   └── keyboard-shortcuts.md      #   快捷键参考
│
├── src/                           # 💻 源代码
│   │
│   ├── main/                      # 🔧 Electron 主进程
│   │   ├── index.ts               #   入口：创建窗口、注册 IPC
│   │   ├── bootstrap/             #   应用初始化逻辑
│   │   │   └── app-init.ts        #   单实例锁、CSP、协议注册
│   │   ├── ipc/                   #   IPC 通道注册与校验
│   │   │   ├── channels.ts        #   通道名称常量
│   │   │   └── handlers.ts        #   请求处理器
│   │   ├── file/                  #   文件操作（唯一写磁盘的模块）
│   │   │   ├── file-service.ts    #   读取、原子写入、备份
│   │   │   ├── file-watcher.ts    #   文件变化监听
│   │   │   └── file-id.ts         #   fileId 签发与映射
│   │   ├── window/                #   窗口管理
│   │   │   └── window-manager.ts  #   创建/恢复/关闭窗口
│   │   └── menu/                  #   应用菜单
│   │       └── app-menu.ts        #   菜单定义与快捷键
│   │
│   ├── preload/                   # 🔌 预加载脚本（桥接层）
│   │   ├── index.ts               #   contextBridge 注册
│   │   └── api.ts                 #   DesktopAPI 类型定义
│   │
│   ├── renderer/                  # 🎨 渲染进程（React UI）
│   │   ├── index.html             #   HTML 入口
│   │   ├── main.tsx               #   React 入口
│   │   ├── App.tsx                #   根组件（布局编排）
│   │   │
│   │   ├── src/
│   │   │   ├── components/        # 🧩 可复用 UI 组件
│   │   │   │   ├── Sidebar/       #   侧栏（文件树 + 大纲）
│   │   │   │   │   ├── index.tsx  #     侧栏容器
│   │   │   │   │   ├── FileTree.tsx    # 文件树组件
│   │   │   │   │   ├── Outline.tsx     # 文档大纲组件
│   │   │   │   │   └── Sidebar.module.css
│   │   │   │   ├── Editor/        #   编辑器区域
│   │   │   │   │   ├── index.tsx  #     编辑器容器
│   │   │   │   │   └── Editor.module.css
│   │   │   │   ├── TitleBar/      #   标题栏
│   │   │   │   │   ├── index.tsx
│   │   │   │   │   └── TitleBar.module.css
│   │   │   │   ├── MenuBar/       #   菜单栏（文件/编辑/段落/视图）
│   │   │   │   │   ├── index.tsx
│   │   │   │   │   ├── MenuItem.tsx    # 单个菜单项
│   │   │   │   │   └── MenuBar.module.css
│   │   │   │   ├── StatusBar/     #   状态栏
│   │   │   │   │   ├── index.tsx
│   │   │   │   │   └── StatusBar.module.css
│   │   │   │   └── ThemeSwitcher/ #   主题切换器
│   │   │   │       ├── index.tsx
│   │   │   │       └── ThemeSwitcher.module.css
│   │   │   │
│   │   │   ├── features/          # 📦 业务功能模块
│   │   │   │   ├── document/      #   文档会话管理
│   │   │   │   │   ├── DocumentSession.ts  # 会话状态机
│   │   │   │   │   └── documentSlice.ts   # Zustand slice
│   │   │   │   ├── editor/        #   编辑器功能
│   │   │   │   │   ├── editorAdapter.ts   # Milkdown adapter
│   │   │   │   │   └── editorSlice.ts    # Zustand slice
│   │   │   │   └── settings/      #   设置管理
│   │   │   │       └── settingsSlice.ts
│   │   │   │
│   │   │   ├── core/              # 🔧 核心逻辑
│   │   │   │   ├── markdown/      #   Markdown 编解码
│   │   │   │   │   ├── codec.ts   #     编解码契约
│   │   │   │   │   └── profile.ts #     支持的语法 profile
│   │   │   │   └── errors/        #   错误类型定义
│   │   │   │       └── error-types.ts
│   │   │   │
│   │   │   ├── ports/             # 🔌 接口定义
│   │   │   │   ├── FilePort.ts    #   文件操作接口
│   │   │   │   └── EditorPort.ts  #   编辑器操作接口
│   │   │   │
│   │   │   └── styles/            # 🎨 样式系统
│   │   │       ├── global.css     #   全局样式、Reset
│   │   │       ├── variables.css  #   CSS 变量（主题 token）
│   │   │       ├── typography.css #   排版样式
│   │   │       ├── themes/        #   主题定义
│   │   │       │   ├── default.css    # 暖白主题
│   │   │       │   ├── dark.css       # 墨夜主题
│   │   │       │   ├── ocean.css      # 海雾主题
│   │   │       │   └── rose.css       # 玫砂主题
│   │   │       └── components/    #   组件级样式
│   │   │           ├── sidebar.css
│   │   │           ├── editor.css
│   │   │           ├── menubar.css
│   │   │           └── statusbar.css
│   │
│   └── shared/                    # 🔄 主进程/渲染进程共享代码
│       ├── ipc/                   #   IPC 通道常量
│       │   └── channels.ts
│       ├── dto/                   #   数据传输对象类型
│       │   ├── file.dto.ts
│       │   └── settings.dto.ts
│       └── result/                #   统一结果类型
│           └── result.ts
│
├── resources/                     # 📁 静态资源（图标等）
├── design-preview-v3.html         # 🎯 设计预览（浏览器直接打开）
├── package.json                   # 依赖与脚本
├── electron.vite.config.ts        # 构建配置
├── tsconfig.json                  # TypeScript 配置
├── tsconfig.node.json             #   主进程 TS 配置
└── tsconfig.web.json              #   渲染进程 TS 配置
```

## 分层规则

```
依赖方向（只能从上到下依赖）：

  components/  →  features/  →  core/  →  ports/
  (UI 组件)      (业务逻辑)    (核心)     (接口)
```

- `components/` 可以调用 `features/` 和 `core/`
- `features/` 可以调用 `core/` 和 `ports/`
- `core/` 可以调用 `ports/`
- `ports/` 不依赖任何其他模块

## 文件命名约定

| 类型 | 命名规则 | 示例 |
|------|---------|------|
| React 组件 | PascalCase | `FileTree.tsx` |
| 工具函数 | camelCase | `file-service.ts` |
| 组件样式 | 集中在 styles/components/ | `menubar.css` |
| 类型定义 | camelCase + `.ts` | `file.dto.ts` |
| 常量 | camelCase | `channels.ts` |
| 测试文件 | `*.test.ts` | `codec.test.ts` |

---

## 当前实际结构（与代码一致）

```
markdownSoftV3/
├── docs/                              # 项目文档（10 篇）
├── design-preview-v3.html             # 设计原型（浏览器直接打开）
├── src/
│   ├── main/
│   │   ├── index.ts                   # 主进程入口（已移除原生菜单）
│   │   ├── ipc/handlers.ts            # 文件打开/保存/另存为/设置 IPC
│   │   ├── settings/settings-store.ts # 设置持久化（JSON 存储）
│   │   └── window/window-manager.ts   # 窗口管理
│   ├── preload/
│   │   ├── index.ts                   # contextBridge 暴露 desktopAPI
│   │   └── api.d.ts                   # DesktopAPI 类型声明
│   ├── shared/ipc/channels.ts         # IPC 通道常量
│   └── renderer/
│       ├── index.html / main.tsx / App.tsx
│       └── src/
│           ├── components/
│           │   ├── MenuBar/index.tsx      # 菜单栏（fixed 定位下拉）
│           │   ├── Sidebar/index.tsx      # 文件树 + 大纲
│           │   ├── Editor/index.tsx       # Milkdown 编辑器（命令式接口）
│           │   ├── StatusBar/index.tsx    # 状态栏
│           │   ├── ThemeSwitcher/index.tsx
│           │   ├── SearchBar/index.tsx    # 查找替换栏
│           │   ├── SettingsDialog/index.tsx # 设置弹窗
│           │   ├── HelpDialog/index.tsx    # 帮助弹窗
│           │   └── ImagesDialog/index.tsx # 图片管理面板
│           ├── data/demo-files.ts         # 演示文件树数据源
│           └── styles/
│               ├── global.css / variables.css / typography.css
│               ├── themes/ (default/dark/ocean/rose).css
│               └── components/ (sidebar/editor/menubar/statusbar/searchbar/settings/helpdialog/imagesdialog).css
├── package.json
├── electron.vite.config.ts
└── tsconfig(.node/.web).json
```

**当前实际落地状态（2026-08-09）**：`main/`、`preload/`、`shared/ipc/` 核心架构已完整；`renderer/` 所有 UI 组件已全部落地（9 个组件）；样式系统完整（全局/主题/组件 CSS）；`main/settings/` 设置持久化已实现。规划中的 `main/bootstrap`、`main/file`、`main/menu`、`renderer/src/features`、`core`、`ports`、`shared/dto`、`shared/result` 尚未创建，当前阶段暂不需要，待架构重构时落地。

> 注意：原生菜单已移除（`Menu.setApplicationMenu(null)`），所有快捷键由渲染进程接管，避免系统默认行为与编辑器冲突。开发模式 DevTools 快捷键（Ctrl+Shift+I）由主进程 before-input-event 保留。
