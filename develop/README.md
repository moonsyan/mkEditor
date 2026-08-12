# MarkdownSoft 开发者文档

> 更新基线：2026-08-11。本文档面向学习与维护；项目实际边界以根目录 [项目开发规范](../项目开发规范.md) 和 [docs/架构说明](../docs/architecture.md) 为准。

> 为 Java 开发者准备。读完本文档，你能理解整个项目，修复 Bug，增加新功能。

---

## 目录结构

```
develop/
├── README.md              ← 你正在看的文件（总览 + 导航）
├── architecture.md        ← 架构详解：分层、数据流、IPC 机制
├── tech-stack.md          ← 技术栈详解：每项技术的 Java 类比
├── development-guide.md   ← 开发实战：修 Bug / 加功能的完整流程
├── react-primer.md        ← React 快速入门（概念 + 代码示例）
├── electron-primer.md     ← Electron 快速入门（主进程/渲染进程/安全模型）
├── milkdown-editor.md     ← 编辑器扩展指南：懒加载、命令、搜索
├── file-index.md          ← 文件索引：按功能分类，快速定位代码
└── learning-path.md       ← 学习路径 + 项目后续发展建议
```

**建议阅读顺序**：`README.md` → `architecture.md` → `file-index.md` → 按需读其他文档。

---

## 一、这个项目是什么

**MarkdownSoft** 是一款桌面级 Markdown 编辑器，对标 Typora。

技术栈：

| 技术 | 用途 | Java 类比 |
|------|------|-----------|
| **Electron** | 把 Web 页面打包成独立桌面应用 | JRE + Swing（把网页打包成 EXE） |
| **React + TypeScript** | UI 框架 + 类型系统 | Spring + 注解（声明式 UI） |
| **Milkdown** | 所见即所得 Markdown 编辑器内核 | Lucene（专业领域内核，插件丰富） |

**一句话理解**：主进程像 Java 的 `main` 方法（有系统权限），渲染进程像 GUI 线程（渲染 UI），两者通过 IPC 通信（类似 RPC）。

---

## 二、快速启动

```bash
# 进入项目目录
cd D:\project\markdown\mk-editormkEditor

# 安装依赖（首次运行需要）
npm install

# 开发模式运行（热重载，改代码立刻生效，按 F5 刷新）
npm run dev

# 构建生产包（Windows，输出到 release/）
npm run build:win
```

开发模式下修改 `src/renderer` 下的文件，浏览器自动刷新，**不需要重启**。

---

## 三、核心架构

### 三层结构

```
┌─────────────────────────────────────────────────────┐
│ 第 3 层：渲染进程（Renderer）                         │
│   React UI + CSS 主题 + Milkdown 编辑器              │
│   运行在浏览器沙箱中，不能直接访问文件系统             │
└────────────────────────┬────────────────────────────┘
                         │ IPC（安全桥接）
┌────────────────────────┴────────────────────────────┐
│ 第 2 层：Preload 桥接                                │
│   把主进程能力封装成 window.desktopAPI               │
│   只暴露白名单方法，不暴露 Node.js 原始 API           │
└────────────────────────┬────────────────────────────┘
                         │ IPC（channel 路由）
┌────────────────────────┴────────────────────────────┐
│ 第 1 层：主进程（Main）                               │
│   Node.js 环境，有完整系统权限                       │
│   文件读写 / 窗口管理 / 原生对话框 / 自动更新         │
└─────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── main/              ← 主进程（Node.js）
│   ├── index.ts       ← 入口：注册协议、单实例锁、创建窗口
│   ├── ipc/
│   │   └── handlers.ts ← ★ 所有 IPC 处理器（核心业务逻辑）
│   ├── settings/
│   │   └── settings-store.ts ← JSON 配置读写（含并发控制）
│   └── window/
│       └── window-manager.ts ← 窗口创建与管理
├── preload/           ← 安全桥接层
│   ├── index.ts       ← 封装 desktopAPI
│   └── api.d.ts       ← 类型声明（渲染进程用）
├── shared/
│   └── ipc/
│       └── channels.ts ← IPC 通道名称常量
└── renderer/          ← 渲染进程（浏览器环境）
    ├── index.html
    └── src/
        ├── main.tsx           ← React 入口
        ├── App.tsx            ← ★ 核心（全部业务逻辑，1900 行）
        ├── components/        ← UI 组件
        └── styles/            ← CSS 主题（4 套）
```

**关键文件**：`App.tsx`（业务中枢）和 `handlers.ts`（IPC 中枢）。

### 数据流示例：打开文件

```
用户点击"打开"
  → App.tsx handleOpen()
  → window.desktopAPI.document.open()
  → preload → ipcRenderer.invoke('file:open')
  → handlers.ts → fs.readFile()
  → 返回 { ok: true, data: { path, name, content } }
  → App.tsx 更新 openFiles state
  → React 自动重绘
```

---

## 四、开发前必知的概念

### 4.1 React 状态（state）
类似 Java 实例字段，但变化时 React **自动重绘**：

```tsx
const [theme, setTheme] = useState('default')
setTheme('dark')  // 自动触发 UI 刷新
```

### 4.2 useEffect（副作用）
类似 `@PostConstruct`，依赖变化时执行：

```tsx
useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme)
}, [theme])  // theme 变化时执行
```

### 4.3 TypeScript 类型
类似 Java 接口，编译时检查：

```typescript
interface FileResult {
  ok: boolean
  data?: { path: string; name: string }
  error?: { code: string }
}
```

### 4.4 异步编程
类似 Java 的 `CompletableFuture`：

```typescript
const result = await window.desktopAPI.document.open()
if (!result.ok) { console.error(result.error) }
```

---

## 五、开发工作流

### 修 Bug
1. 查看 `../功能文档与对比分析.md` 中的已知 Bug 列表
2. 在 `file-index.md` 中定位相关文件
3. 修改代码，`npm run dev` 实时验证
4. 修复后更新 Bug 状态

### 加新功能（标准流程）
```
1. 新增 IPC 通道  → src/shared/ipc/channels.ts
2. 添加主进程处理器 → src/main/ipc/handlers.ts
3. 更新类型声明  → src/preload/api.d.ts
4. 暴露 API    → src/preload/index.ts
5. 在 App.tsx 调用 → src/renderer/App.tsx
```

详见 `development-guide.md`。

---

## 六、常见问题定位表

| 要改什么 | 文件位置 |
|---------|---------|
| 主题颜色 | `src/renderer/src/styles/themes/*.css` |
| 菜单栏文字/动作 | `src/renderer/src/components/MenuBar/index.tsx` |
| 快捷键绑定 | `src/renderer/src/data/shortcuts.ts` |
| 侧栏样式 | `src/renderer/src/styles/components/sidebar.css` |
| 状态栏内容 | `src/renderer/src/components/StatusBar/index.tsx` |
| 设置弹窗 | `src/renderer/src/components/SettingsDialog/index.tsx` |
| 搜索替换 | `src/renderer/src/components/SearchBar/index.tsx` |
| 编辑器行为 | `src/renderer/src/components/Editor/index.tsx` |
| 新增 IPC 操作 | 按"加新功能"流程 |

---

## 七、调试技巧

**打开开发者工具**：开发模式下按 `Ctrl + Shift + I`

**查看日志**：
- 主进程日志 → 终端（`npm run dev` 的输出）
- 渲染进程日志 → DevTools 的 Console 标签

**调试 IPC**：在 `handlers.ts` 处理器开头加：
```typescript
console.log('[IPC]', channel, args)
```

---

## 八、学习路径

```
第 1 天：跑起来（npm run dev），读本文档 + architecture.md
第 2-3 天：读 react-primer.md + electron-primer.md
第 4-5 天：读 tech-stack.md + milkdown-editor.md
第 1 周+：读 file-index.md，找一个已知 Bug 动手修复
```

详见 `learning-path.md`。

---

## 九、相关文档

| 文档 | 适合谁 | 内容 |
|------|--------|------|
| [architecture.md](./architecture.md) | 所有人 | 完整架构解析，数据流，IPC 机制 |
| [tech-stack.md](./tech-stack.md) | 想深入了解技术栈 | 每项技术的 Java 类比 + 速查表 |
| [development-guide.md](./development-guide.md) | 动手修 Bug / 加功能 | 完整开发流程 + 代码示例 |
| [react-primer.md](./react-primer.md) | 不熟悉 React | React 概念 + 项目中的实际用法 |
| [electron-primer.md](./electron-primer.md) | 不熟悉 Electron | 主进程/渲染进程/安全模型 |
| [milkdown-editor.md](./milkdown-editor.md) | 改编辑器行为 | 懒加载、命令、搜索实现 |
| [file-index.md](./file-index.md) | 快速定位代码 | 按功能分类的所有文件索引 |
| [learning-path.md](./learning-path.md) | 规划学习节奏 | 学习路线 + 项目后续发展方向 |
