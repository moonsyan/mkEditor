import { app, shell, BrowserWindow, Menu, ipcMain, protocol } from 'electron'
import { join } from 'path'
import { readFileSync, statSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { createWindow } from './window/window-manager'
import { registerIpcHandlers } from './ipc/handlers'
import { fetchAllowedImage } from './image-protocol'

// 本地图片协议：mdimg:///<绝对路径> → 渲染进程可直接展示本地图片
// （必须在 app ready 之前注册特权）
// Y-M1：页面 CSP 为 default-src 'self'，mdimg 为自定义 scheme 与文档不同源，
// 无 bypassCSP 时 <img src="mdimg:///..."> 被 CSP 直接拒绝（真实 Electron
// 对照实验验证：不加时 naturalWidth=0，加后正常加载）。信任边界仍由
// fetchAllowedImage 的根目录 + realpath 双重校验把关，放行 CSP 不会放开读取
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mdimg',
    privileges: {
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
])

// 单实例锁：多窗口模式（上次会话开启过）下跳过，允许多开；
// 需在 app ready 前同步读取设置
let multiWindowMode = false
try {
  // 启动前不设体积守卫会让损坏的超大 settings.json 同步 parse 卡死/OOM 启动
  // （settings-store 才有 40MB 损坏判定与自愈备份，但它不在本路径上）。
  // 超限文件跳过多窗口判定，交给 store 的异步自愈流程处理
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  const settingsStat = statSync(settingsFile)
  if (settingsStat.size <= 40 * 1024 * 1024) {
    const raw = readFileSync(settingsFile, 'utf-8')
    multiWindowMode = (JSON.parse(raw) as { multiWindow?: boolean }).multiWindow === true
  }
} catch {
  multiWindowMode = false
}
if (!multiWindowMode) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    // 再次启动时聚焦已有窗口
    app.on('second-instance', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
  }
}

function initApp(): void {
  // 安全设置
  electronApp.setAppUserModelId('com.markdownsoft.v3')

  // 移除原生菜单：避免系统默认快捷键与编辑器冲突，快捷键全部由渲染进程接管
  Menu.setApplicationMenu(null)

  // 优化默认行为
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 处理 mdimg 协议：仅允许已打开文档或工作区范围内的图片资源。
  protocol.handle('mdimg', (request) => fetchAllowedImage(request.url))

  // 注册 IPC 处理器
  registerIpcHandlers()

  // 创建主窗口
  createWindow()

  // 自动更新：仅生产环境检查；未配置更新服务器时静默忽略
  if (!is.dev) {
    autoUpdater.autoDownload = true
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      /* 更新检查失败（未发布 latest.yml / 无网络等）不影响使用 */
    })
  }

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.whenReady().then(initApp).catch((err) => {
  console.error('App initialization failed:', err)
  app.exit(1)
})

// 退出保护：未保存内容的确认由每个窗口的渲染层 beforeunload 拦截（见 App.tsx）；
// 此处无需重复处理。

// 安全: 禁止导航到外部；新开窗口请求转交系统浏览器（仅限安全协议，
// 避免恶意文档中的 javascript:/file:/自定义协议链接被拉起）
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
      void shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // M15：will-navigate 在 web-contents-created 一次性注册，不再依赖
  // did-finish-load 延迟注册（重载/崩溃自愈会累计重复监听，点一个外链开 N 个标签）。
  // 程序化导航（loadFile/loadURL/reload）不触发 will-navigate，初始加载不受影响。
  // 普通链接没有 target 时会在当前窗口内导航；统一交给系统浏览器，
  // 避免应用壳被陌生页面替换（仅限安全协议，恶意文档中的 javascript:/file:/自定义协议不会放行）。
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
      void shell.openExternal(url).catch(() => {})
    }
  })
})
