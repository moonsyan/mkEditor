# Electron 快速入门（Java 开发者视角）

> 理解主进程和渲染进程的关系，学会安全地读写文件。

---

## 一、为什么需要 Electron

Web 技术（HTML/CSS/JS）运行在浏览器沙箱中，**无法访问文件系统、无法创建原生窗口**。
Electron 给 Web 技术加上了系统级能力，让它能打包成桌面应用。

```
浏览器：只能跑网页，不能读文件
Electron：网页 + Node.js + 原生窗口 = 桌面应用
```

---

## 二、两个进程

| | 主进程 (Main) | 渲染进程 (Renderer) |
|--|--------------|---------------------|
| 环境 | Node.js | 浏览器沙箱 |
| 能力 | 读写文件、创建窗口、系统 API | 渲染 UI、处理用户交互 |
| 数量 | 一个应用只有一个 | 每个窗口一个 |
| Java 类比 | `main()` 方法所在的进程 | GUI 线程（Swing/AWT） |

### 关键规则
- **渲染进程不能直接操作文件系统**（安全沙箱）
- **主进程不能直接操作 DOM**（没有浏览器环境）
- 两者通过 **IPC** 通信

---

## 三、IPC 通信

### 请求-响应模式（最常用的）

```typescript
// 渲染进程发起请求
const result = await window.desktopAPI.document.open()

// 主进程处理请求
ipcMain.handle('file:open', async (event) => {
  const filePath = await dialog.showOpenDialog(...)
  const content = await readFile(filePath, 'utf-8')
  return { ok: true, data: { path: filePath, content } }
})
```

### 单向通知模式

```typescript
// 渲染进程发送通知（不需要响应）
window.desktopAPI.window.setUnsaved(true)

// 主进程接收
ipcMain.on('window:set-unsaved', (event, unsaved) => {
  event.sender.__unsaved = unsaved
})
```

---

## 四、安全模型（最重要）

### 4.1 默认安全配置

```typescript
// window-manager.ts
webPreferences: {
  nodeIntegration: false,   // 禁止渲染进程直接 require('fs')
  contextIsolation: true,   // 隔离 preload 和渲染进程
  preload: './preload/index.js'
}
```

### 4.2 Preload 层的作用

```
渲染进程  ──→  window.desktopAPI  ──→  preload  ──→  ipcRenderer  ──→  主进程
               (白名单 API)              (安全桥)      (IPC 调用)        (处理逻辑)
```

preload 只暴露**白名单方法**，不暴露 Node.js 原始 API：

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('desktopAPI', {
  document: {
    open: () => ipcRenderer.invoke('file:open'),  // 只暴露 open
    // 不暴露 require、process 等危险 API
  }
})
```

### 4.3 为什么这样设计

类比 Java 的 **白名单机制**：
- 渲染进程 ≈ 不可信的外部代码（用户可能粘贴恶意内容）
- preload  ≈ SecurityManager
- 主进程  ≈ 受信任的核心代码

---

## 五、常用 API

### 5.1 文件操作

```typescript
import { readFile, writeFile, stat } from 'fs/promises'

// 读文件
const content = await readFile('/path/to/file.md', 'utf-8')

// 写文件
await writeFile('/path/to/file.md', content, 'utf-8')

// 获取文件信息（mtime 用于冲突检测）
const stat = await stat('/path/to/file.md')
console.log(stat.mtimeMs)  // 修改时间（毫秒时间戳）
```

### 5.2 对话框

```typescript
import { dialog } from 'electron'

// 打开文件
const result = await dialog.showOpenDialog(window, {
  filters: [{ name: 'Markdown', extensions: ['md'] }],
  properties: ['openFile']
})
if (!result.canceled) {
  const filePath = result.filePaths[0]
}

// 保存文件
const result = await dialog.showSaveDialog(window, {
  defaultPath: 'untitled.md'
})
```

### 5.3 窗口管理

```typescript
import { BrowserWindow } from 'electron'

// 创建窗口
const win = new BrowserWindow({
  width: 1200,
  height: 800,
  titleBarStyle: 'hidden',  // 隐藏系统标题栏
  webPreferences: { ... }
})

// 加载内容
win.loadFile('index.html')  // 或 win.loadURL('http://...')

// 窗口事件
win.on('close', (e) => {
  // 可以阻止关闭
  if (hasUnsavedChanges) {
    e.preventDefault()
    dialog.showMessageBox(...)
  }
})
```

---

## 六、协议注册（mdimg://）

项目用自定义协议让编辑器加载本地图片：

```typescript
// main/index.ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'mdimg', privileges: { secure: true, stream: true } }
])

protocol.handle('mdimg', (request) => {
  const filePath = decodeURIComponent(new URL(request.url).pathname)
  return net.fetch(pathToFileURL(filePath).toString())
})
```

**为什么需要**：
- 直接 `file://` 路径会暴露用户文件系统结构
- `mdimg://` 隐藏真实路径，同时让 Chromium 能加载图片

---

## 七、单实例锁

防止重复启动（多窗口模式除外）：

```typescript
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()  // 已有实例在运行，退出当前进程
} else {
  app.on('second-instance', () => {
    // 有人想再次启动，聚焦已有窗口
    BrowserWindow.getAllWindows()[0]?.focus()
  })
}
```

---

## 八、自动更新

```typescript
import { autoUpdater } from 'electron-updater'

if (!is.dev) {
  autoUpdater.autoDownload = true
  autoUpdater.checkForUpdatesAndNotify()
}
```

发布时需要配置更新服务器（`package.json` 的 `build.publish`）。
