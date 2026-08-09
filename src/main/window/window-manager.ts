import { BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * 创建窗口
 * @param fresh 新窗口模式：URL 带 #fresh，渲染端跳过会话恢复/写入，
 *              避免多窗口间会话互相覆盖
 */
export function createWindow(fresh = false): BrowserWindow {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 480,
    show: false,
    title: 'MarkdownSoft',
    // 窗口/任务栏图标（与打包图标同源）
    icon: join(__dirname, '../../resources/icon.png'),
    // 去掉系统标题栏，与渲染进程的顶栏菜单栏合为一体：
    // - macOS：hiddenInset 保留红绿灯（交通灯）
    // - Windows：hidden + titleBarOverlay 由系统绘制最小化/最大化/关闭按钮
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: '#F0EDEA',
            symbolColor: '#5C5850',
            height: 42,
          },
        }),
    backgroundColor: '#F7F5F2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 拼写检查能力保留（由设置面板控制开关，默认关）；
      // webPreferences 开启底层能力，创建后默认关闭会话级拼写，避免中文/代码红波浪线
      spellcheck: true,
    },
  })

  // 默认关闭拼写检查（用户在设置中打开时才启用）
  mainWindow.webContents.session.setSpellCheckerEnabled(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 白屏自愈：渲染进程崩溃或加载失败时自动重载，避免窗口挂死
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'crashed' || details.reason === 'killed') {
      mainWindow.webContents.reload()
    }
  })
  mainWindow.webContents.on('did-fail-load', () => {
    mainWindow.webContents.reload()
  })

  // 关闭确认：有未保存内容时弹原生对话框（修复 beforeunload 静默阻止关闭的问题）
  // 未保存状态由渲染端通过 WINDOW_SET_UNSAVED 同步到 webContents.__unsaved
  mainWindow.on('close', (e) => {
    const wc = mainWindow.webContents
    const unsaved = (wc as unknown as { __unsaved?: boolean }).__unsaved === true
    if (!unsaved) return // 无未保存，直接放行
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['保存并关闭', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      message: '有未保存的更改',
      detail: '关闭前要保存这些更改吗？',
    })
    if (choice === 0) {
      // 保存全部后关闭（destroy 绕过 beforeunload）
      wc.executeJavaScript(
        'window.__markdownsoft_saveAll ? window.__markdownsoft_saveAll() : Promise.resolve()',
      )
        .then(() => mainWindow.destroy())
        .catch(() => mainWindow.destroy())
    } else if (choice === 1) {
      mainWindow.destroy()
    }
    // choice === 2：取消，保持窗口打开
  })

  // 开发模式：保留 Ctrl+Shift+I 打开 DevTools（原生菜单已移除）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (is.dev && input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (fresh ? '#fresh' : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: fresh ? 'fresh' : undefined,
    })
  }

  return mainWindow
}
