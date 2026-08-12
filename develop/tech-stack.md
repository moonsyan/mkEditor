# 技术栈详解

> 更新基线：2026-08-11。当前 Electron 版本为 43；构建与依赖管理使用 npm。测试、Lint、格式化工具仍是待补齐能力，并非仓库现有脚本。

> 面向 Java 开发者。每项技术用 Java 类比说明。

---

## 一、Node.js（运行时）

### Java 类比
> 相当于 **JRE（Java 运行时环境）**。它提供 JavaScript 运行环境和 npm 包管理。

### 核心概念

| 概念 | 说明 | Java 类比 |
|------|------|-----------|
| `npm` | 包管理器，类似 Maven/Gradle | Maven |
| `package.json` | 依赖声明 + 脚本配置 | `pom.xml` |
| `node_modules/` | 下载的依赖库 | `.m2/repository/` |
| `async/await` | 异步编程，不阻塞线程 | `CompletableFuture` |
| `fs/promises` | 文件系统 API（Promise 版） | `java.nio.file` |

### 常用命令

```bash
npm install        # 安装依赖（等价于 mvn install）
npm run dev        # 运行开发脚本（package.json 的 scripts 字段）
npm run build      # 构建生产版本
```

---

## 二、TypeScript（类型系统）

### Java 类比
> **TypeScript = Java**。静态类型检查，编译时报错而不是运行时才炸。

### 核心语法

```typescript
// 接口（等价于 Java interface）
interface FileResult {
  ok: boolean
  data?: { path: string; name: string }  // ? 表示可选
  error?: { code: string }
}

// 类型别名（等价于 Java 泛型类）
type DraftMap = Record<string, { content: string; savedAt: number }>

// 枚举（等价于 Java enum）
type FontSize = 'sm' | 'md' | 'lg'  // 字面量联合类型

// 函数类型（等价于 Java 函数式接口）
type Callback = (x: string) => void
```

### 关键区别

| TypeScript | Java |
|-----------|------|
| 类型在编译时检查，运行时消失 | 类型在运行时也保留 |
| `any` = 放弃类型检查（类似 `Object`） | `Object` 是类型 hierarchy 顶层 |
| `interface` 只描述结构，不生成代码 | `interface` 也是纯结构 |

---

## 三、Electron（桌面应用框架）

### Java 类比
> 把 Web 技术（HTML/CSS/JS）打包成桌面应用的框架。
> 类似 **JetBrains 用 Java 做桌面 IDE，Electron 用 Web 技术做桌面 IDE**。

### 核心概念

| 概念 | 说明 | Java 类比 |
|------|------|-----------|
| **主进程 (Main)** | Node.js 环境，创建窗口，有文件系统权限 | 类似 `main` 方法所在的进程 |
| **渲染进程 (Renderer)** | 浏览器沙箱，运行 React UI，无系统权限 | 类似 GUI 线程 |
| **BrowserWindow** | 一个桌面窗口 | `JFrame` |
| **ipcMain / ipcRenderer** | 进程间通信 | `RemoteMethod` / 消息队列 |
| **preload** | 安全桥接层 | 类似 `SecurityManager` 白名单 |

### 安全模型（重要）

Electron 默认关闭 Node.js 集成：
```typescript
// window-manager.ts
webPreferences: {
  nodeIntegration: false,   // 禁止渲染进程直接 require
  contextIsolation: true,   // 隔离 preload 和渲染进程
  preload: './preload/index.js'  // 只通过 preload 暴露能力
}
```

**这意味着**：渲染进程**不能**直接读文件，必须通过 `window.desktopAPI`（安全桥）。

---

## 四、React（UI 框架）

### Java 类比
> **React = Swing/JFrame 的现代化版本**。但它不是直接操作 DOM，而是描述"状态 → UI"的映射关系。

### 核心概念

| 概念 | 说明 | Java 类比 |
|------|------|-----------|
| **组件 (Component)** | 可复用的 UI 单元 | 自定义 `JPanel` / `JFrame` |
| **Props** | 父组件传给子组件的参数 | 构造方法参数 |
| **State** | 组件内部可变状态 | 实例字段 + `propertyChange` |
| **JSX** | HTML-like 语法写 JS | 类似注解 + 模板引擎 |
| **Hooks** | `useState`、`useEffect` 等 | 类似生命周期方法 |

### 关键概念详解

#### useState
```typescript
const [count, setCount] = useState(0)
// 等价于 Java：private int count = 0;
// 但 setCount() 会触发 UI 重绘
```

#### useEffect
```typescript
useEffect(() => {
  // 组件挂载时执行，依赖变化时重新执行
  console.log('theme changed to', theme)
}, [theme])  // 依赖数组
// 等价于 Java：@PostConstruct + PropertyChangeListener
```

#### useCallback
```typescript
const handleClick = useCallback(() => {
  doSomething(id)
}, [id])  // id 变化时才重建函数
// 等价于 Java：方法引用，避免每次渲染都重建 lambda
```

#### useRef
```typescript
const timerRef = useRef(0)
timerRef.current = Date.now()  // 改 ref 不触发重绘
// 等价于 Java：`volatile long timer = 0;`（不触发 UI 刷新）
```

---

## 五、Milkdown（编辑器内核）

### Java 类比
> 类似 **Apache Lucene**（专业领域内核）+ **Spring 插件系统**。
> 底层是 **ProseMirror**（JavaScript 生态最强的富文本编辑器内核，VS Code 也用类似的机制）。

### 核心概念

| 概念 | 说明 |
|------|------|
| **Schema** | 定义编辑器支持哪些节点类型（标题、段落、代码块...） |
| **Commands** | 编辑器操作（粗体、插入表格、转标题...） |
| **Plugins** | 扩展功能（搜索、脚注、数学公式...） |
| **ProseNode** | 文档的抽象语法树（AST），类似 Java 的 `AST` |

### 插件加载方式

```typescript
// 启动时静态加载（核心功能）
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'

// 懒加载（体积大，按需加载）
const mathPlugin = await import('@milkdown/plugin-math')
const diagramPlugin = await import('@milkdown/plugin-diagram')
```

### 编辑器命令系统

```typescript
// 执行命令（类似 Java 的 Command 模式）
editor.runCommand('strong')      // 加粗
editor.runCommand('heading', 2)  // 转 H2 标题
editor.runCommand('table', {row: 3, col: 3})  // 插入 3x3 表格
```

---

## 六、Vite + electron-vite（构建工具）

### Java 类比
> **Vite = Maven 的编译阶段**，但速度快 100 倍（用 ES Module 替代打包）。

### 关键配置

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]  // 主进程：不打包，直接用 node_modules
  },
  renderer: {
    plugins: [react()]  // 渲染进程：React 支持
  }
})
```

### 构建产物

```
out/
├── main/          ← 主进程（可直接 node 运行）
├── preload/       ← 桥接层
└── renderer/      ← 渲染进程（HTML + JS）
```

---

## 七、依赖库速查

| 包名 | 用途 | 版本 |
|------|------|------|
| `react` / `react-dom` | UI 框架 | ^18.3.1 |
| `@milkdown/kit` | 编辑器核心 | ^7.22.0 |
| `@milkdown/plugin-math` | 数学公式（KaTeX） | ^7.5.9 |
| `@milkdown/plugin-diagram` | 流程图（Mermaid） | ^7.7.0 |
| `@milkdown/plugin-prism` | 代码高亮 | ^7.22.0 |
| `katex` | 公式渲染引擎 | ^0.18.2 |
| `mermaid` | 流程图渲染引擎 | ^11.16.1 |
| `electron-updater` | 自动更新 | ^6.8.9 |
| `electron-builder` | 打包为 EXE/DMG/AppImage | ^25.1.8 |

---

## 八、CSS 主题系统

### 设计原理
使用 **CSS 自定义属性（CSS Variables）** + **data 属性选择器**实现主题切换：

```css
/* 基础变量 */
:root {
  --bg-primary: #F7F5F2;
  --text-primary: #1d1b18;
}

/* 主题覆盖 */
[data-theme="dark"] {
  --bg-primary: #171614;
  --text-primary: #e8e6e3;
}
```

切换主题时只需：
```typescript
document.documentElement.setAttribute('data-theme', 'dark')
```

### 4 套主题文件
- `default.css` — 暖白
- `dark.css` — 墨夜
- `ocean.css` — 海雾
- `rose.css` — 玫砂

---

## 九、构建产物说明

```bash
npm run build:win
```

产出：
```
release/0.0.1/
└── MarkdownSoft-Setup-0.0.1.exe   ← NSIS 安装包
```

安装包内含：
- `resources/app/out/` — 应用代码（主进程 + 渲染进程 + preload）
- `resources/app/node_modules/` — 依赖库
- 自动生成的卸载程序
