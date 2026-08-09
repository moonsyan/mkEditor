# 架构说明

## 系统上下文

```
┌──────────────┐     文件读写     ┌──────────────────┐
│   用户磁盘    │ ◄──────────────► │  MarkdownSoft    │
│  (.md 文件)   │                 │  (Electron App)  │
└──────────────┘                 └──────────────────┘
```

MarkdownSoft 是一个单机桌面应用，不依赖网络服务。所有数据存储在用户本地磁盘。

## 进程模型

Electron 应用有三个进程上下文，各自职责和权限不同：

```
┌─────────────────────────────────────────────────┐
│  Main Process (Node.js)                          │
│  ┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ │
│  │  file/  │ │  ipc/   │ │window/ │ │ menu/  │ │
│  │文件读写  │ │IPC注册  │ │窗口管理│ │ 菜单   │ │
│  └─────────┘ └─────────┘ └────────┘ └────────┘ │
│                        │ IPC                      │
│  ┌──────────────────────────────────────────┐    │
│  │  Preload Script (桥接层)                  │    │
│  │  暴露窄接口 DesktopAPI                    │    │
│  └──────────────────────────────────────────┘    │
│                        │                          │
│  ┌──────────────────────────────────────────┐    │
│  │  Renderer Process (React UI)              │    │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────┐ │    │
│  │  │Sidebar  │ │ Editor  │ │ ThemeSwitch │ │    │
│  │  │侧栏组件  │ │编辑器   │ │ 主题切换    │ │    │
│  │  └─────────┘ └─────────┘ └────────────┘ │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Main Process

- 唯一可以读写用户文件的进程
- 管理窗口生命周期
- 注册 IPC 通道并校验请求
- 创建应用菜单

### Preload Script

- 在渲染进程加载前执行
- 通过 `contextBridge` 暴露类型安全的窄接口
- 不暴露通用 `invoke(channel)` 给渲染进程

### Renderer Process

- 运行 React UI
- 通过 Zustand 管理壳层状态
- 通过 ProseMirror/Milkdown 管理编辑器状态
- 不能直接访问 Node.js API

## 数据流

```
用户输入
  │
  ▼
Editor (ProseMirror) ─── 内容变化 ──► DocumentSession
                                          │
                                    标记 dirty
                                          │
                                    序列化 Markdown
                                          │
                                          ▼
                                     FilePort.save()
                                          │
                                    IPC → Main Process
                                          │
                                          ▼
                                      写入磁盘
```

## 状态管理分层

| 状态类型 | 存储位置 | 示例 |
|---------|---------|------|
| 编辑器状态 | ProseMirror EditorState | 文档内容、光标、选区 |
| 会话状态 | DocumentSession (Application 层) | dirty、saving、conflicted |
| UI 投影 | Zustand Store | 主题、侧栏开关、对话框 |
| 系统状态 | Main Process | 文件句柄、窗口位置 |

**关键规则**：Zustand 只能订阅会话快照并展示，不能拥有修改 dirty/saving 等状态的独立 action。

## 安全边界

- Renderer 不能直接使用 `fs`、`path` 等 Node.js 模块
- 文件操作必须通过 IPC 由 Main Process 执行
- Preload 只暴露业务级接口（open/save/saveAs），不接受任意路径
- 生产 CSP 不使用 `unsafe-inline`（临时例外需记录）
