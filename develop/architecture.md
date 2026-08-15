# 架构详解

> 更新基线：2026-08-11。当前壳层状态由 React `useState`/`useRef` 管理，未使用 Zustand；IPC 通道以 `src/shared/ipc/channels.ts` 为唯一来源。

## 一、整体分层架构

本项目采用 **Electron 多进程架构**，共 3 层：

```
┌─────────────────────────────────────────────────────┐
│ 第 3 层：渲染进程 (Renderer)                          │
│   React UI  +  CSS 主题系统  +  Milkdown 编辑器       │
│   运行在 Chromium 沙箱中，无法直接访问文件系统          │
└────────────────────────┬────────────────────────────┘
                         │ IPC (安全桥接)
┌────────────────────────┴────────────────────────────┐
│ 第 2 层：Preload 桥接 (preload)                      │
│   contextBridge：把主进程能力封装成 window.desktopAPI │
│   只暴露白名单中的方法，不暴露 Node.js 原始 API        │
└────────────────────────┬────────────────────────────┘
                         │ IPC (channel 路由)
┌────────────────────────┴────────────────────────────┐
│ 第 1 层：主进程 (Main)                               │
│   Node.js 环境，拥有完整系统权限                       │
│   - 文件读写 (fs/promises)                           │
│   - 窗口管理 (BrowserWindow)                         │
│   - 原生对话框 (dialog)                              │
│   - 自定义协议 (mdimg://)                            │
│   - 自动更新 (electron-updater)                      │
└─────────────────────────────────────────────────────┘
```

---

## 二、数据流方向

### 2.1 文件打开流程（典型数据流）

```
用户点击"打开"
    │
    ▼
App.tsx handleOpen()
    │ 调用 desktopAPI.document.open()
    ▼
preload/index.ts → ipcRenderer.invoke('file:open')
    │ IPC 消息
    ▼
main/ipc/handlers.ts → FILE_OPEN 处理器
    │ fs.readFile(filePath, 'utf-8')
    ▼
返回 { ok: true, data: { path, name, content, modifiedTime } }
    │
    ▼
App.tsx → 更新 openFiles state
    │
    ▼
Editor 组件接收新内容 → Milkdown 渲染
```

### 2.2 状态同步流程

```
用户修改设置
    │
    ▼
App.tsx 更新 React state
    │
    ▼
useEffect 检测到 state 变化
    │ 调用 window.desktopAPI.settings.set(key, value)
    ▼
preload → ipcRenderer.invoke('settings:set', { key, value })
    │
    ▼
main/settings/settings-store.ts
    │ 写入串行队列（防并发）→ JSON.stringify → writeFile → rename
    ▼
持久化到 %APPDATA%/MarkdownSoft/settings.json
```

---

## 三、IPC 通信机制

### 3.1 通道定义

所有 IPC 通道名称集中在一个文件中，保证主进程和渲染进程使用相同字符串：

```typescript
// src/shared/ipc/channels.ts
export const CHANNELS = {
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  SETTINGS_GET: 'settings:get',
  // ...
} as const
```

### 3.2 三种 IPC 通信模式

| 模式 | 方向 | 方法 | 用途 |
|------|------|------|------|
| `invoke` | 双向（请求→响应） | `ipcRenderer.invoke(channel, args)` | 文件读写、设置操作 |
| `send` | 单向（渲染→主） | `ipcRenderer.send(channel, args)` | 状态同步（无返回值） |
| `on` | 单向（主→渲染） | `ipcMain.on(channel, handler)` | 事件通知（本项目未用） |

### 3.3 安全设计

**Preload 层**是安全边界：
- 渲染进程**不能**直接 `require('fs')` 或访问 `ipcMain`
- 只能调用 `window.desktopAPI` 上预定义的方法
- 类型声明在 `api.d.ts` 中，TypeScript 编译时检查

---

## 四、主进程架构

### 4.1 入口 `src/main/index.ts`

启动流程：
1. 注册 `mdimg://` 自定义协议（让编辑器能加载本地图片；`registerSchemesAsPrivileged` 含 `bypassCSP: true`——页面 CSP 为 `default-src 'self'`，自定义 scheme 需放行 CSP 才能显示图片；读取仍经 `fetchAllowedImage` 的根目录 + realpath 双重信任校验）
2. 读取设置，决定是否允许多窗口
3. 设置单实例锁（防止重复启动，多窗口模式下跳过）
4. 创建第一个窗口
5. 检查自动更新

### 4.2 IPC 处理器 `src/main/ipc/handlers.ts`

所有业务逻辑都在这里。每个 `ipcMain.handle()` 就是一个 RPC 方法：

```typescript
ipcMain.handle(CHANNELS.FILE_SAVE, async (_event, args) => {
  // 1. 冲突检测（mtime）
  // 2. 写文件
  // 3. 返回结果
})
```

### 4.3 设置存储 `src/main/settings/settings-store.ts`

- 存储在 `{用户数据目录}/settings.json`
- **写入串行队列**：多窗口同时写时防并发损坏
- **防御性设计**：
  - 文件超 8MB → 备份后清空
  - 单值超 4MB → 拒绝写入
  - session/drafts 有上限（200/50 条）

### 4.4 窗口管理 `src/main/window/window-manager.ts`

- `fresh` 模式：新窗口不恢复会话，避免多窗口互相覆盖
- 白屏自愈：渲染进程崩溃自动 reload
- 关闭保护：有未保存内容时弹原生对话框

---

## 五、渲染进程架构

### 5.1 入口 `src/renderer/src/main.tsx`

```typescript
// React 入口，挂载 <App /> 到 #root
```

### 5.2 核心组件 `App.tsx`

**这是整个项目最重要的文件**（1888 行）。所有业务逻辑都在这里：
- 文件管理（打开/保存/新建/删除/重命名/移动）
- 会话恢复与草稿恢复
- 写作统计
- 搜索替换逻辑
- 快捷键分发
- 导出功能

### 5.3 组件树

```
App
├── MenuBar              ← 自定义菜单栏
├── Sidebar              ← 左侧栏（文件树 + 大纲）
│   ├── 文件树 Tab
│   └── 大纲 Tab
├── SearchBar            ← 查找替换栏（悬浮在编辑器上方）
├── Editor               ← Milkdown 编辑器（核心）
├── StatusBar            ← 底部状态栏
├── SettingsDialog       ← 设置弹窗
├── HelpDialog           ← 帮助弹窗
└── ImagesDialog         ← 图片管理弹窗
```

---

## 六、编辑器架构（Milkdown）

### 6.1 为什么选 Milkdown

- 基于 **ProseMirror**（业界最强富文本编辑器内核）
- **所见即所得**：输入 Markdown 语法即时渲染
- **插件系统**：数学公式、流程图、代码高亮都可按需加载
- **React 绑定**：`@milkdown/react` 提供 React 组件封装

### 6.2 编辑器生命周期

```
创建 Milkdown 实例
    │
    ├─ 初始化：加载 commonmark preset（基础语法）
    ├─ 初始化：加载 gfm preset（表格、任务列表、代码块）
    ├─ 初始化：加载 history plugin（撤销/重做）
    └─ 初始化：加载 prism plugin（代码高亮）
    │
    ├─ 懒加载（首次检测到内容）：
    │   ├─ plugin-math → KaTeX（数学公式）
    │   └─ plugin-diagram → Mermaid（流程图）
    │
    └─ 对外暴露 EditorHandle：
        ├─ replaceContent(md)      → 替换内容
        ├─ runCommand(key, ...args) → 执行命令
        ├─ startSearch(...)         → 启动搜索
        ├─ getPreviewHtml()         → 获取预览 HTML
        └─ ensureRichContent()      → 等待懒加载插件就绪
```

### 6.3 图片路径转换

编辑器需要 `mdimg://` 协议才能加载本地图片，但 `.md` 文件使用相对路径（为了可移植）：

```
存储时：![图](./images/pic.png)          ← 普通 Markdown 路径
渲染时：![图](mdimg:///C:/docs/images/pic.png)  ← 编辑器能加载
导出时：经主进程只读 IPC（`file:read-image-inline`）内联为 base64（渲染层 fetch 自定义 scheme 被 Blink 拒绝，必须走主进程校验读取），生成自包含 HTML
```

转换函数：
- `toEditorImages()` — 渲染前，相对路径 → `mdimg://` 绝对路径
- `toStoredImages()` — 保存前，`mdimg://` 路径 → 相对路径

---

## 七、主题系统

### 7.1 CSS 变量驱动

所有主题通过 CSS 变量实现，切换主题 = 切换 `data-theme` 属性：

```css
/* src/renderer/src/styles/variables.css */
:root {
  --bg-primary: #F7F5F2;
  --text-primary: #1d1b18;
  --accent: #7c6f5b;
  /* ... */
}

[data-theme="dark"] {
  --bg-primary: #171614;
  --text-primary: #e8e6e3;
  /* ... */
}
```

### 7.2 四套主题

| 主题 ID | 名称 | 背景色 |
|---------|------|--------|
| `default` | 暖白 | `#F7F5F2` |
| `dark` | 墨夜 | `#171614` |
| `ocean` | 海雾 | `#EFF4F9` |
| `rose` | 玫砂 | `#FBF5F3` |

---

## 八、关键设计决策

| 决策 | 原因 |
|------|------|
| 自定义菜单栏，不用原生菜单 | 避免系统快捷键与编辑器冲突 |
| 单实例锁（多窗口模式除外） | 防止多个窗口会话互相覆盖 |
| 写入串行队列 | 多窗口并发写 settings.json 会损坏文件 |
| Markdown 内容存 `contents` Map（id → content） | 支持多标签页同时编辑 |
| 草稿持久化 | 崩溃后恢复未保存内容 |
| 懒加载插件 | 避免 Mermaid/KaTeX 体积占用启动内存 |
| `mdimg://` 协议 | 让 Chromium 能加载本地图片（不暴露真实路径） |
| fresh 窗口模式 | 右键"新窗口打开"时不恢复会话 |
