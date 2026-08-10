import { BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * 创建窗口
 * @param fresh 新窗口模式：URL 带 #fresh，渲染端跳过会话恢复/写入，
 *              避免多窗口间会话互相覆盖
 * @param openFile 可选：新窗口启动后直接打开的磁盘文件路径（#fresh?file=...）
 */
export function createWindow(fresh = false, openFile?: string): BrowserWindow {
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

  // 白屏自愈：渲染进程崩溃或加载失败时自动重载，避免窗口挂死；
  // 连续自愈设上限，防止持续性失败（如文件损坏）演变为重载风暴
  let autoReloads = 0
  const MAX_AUTO_RELOADS = 3
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (
      (details.reason === 'crashed' || details.reason === 'killed') &&
      autoReloads < MAX_AUTO_RELOADS
    ) {
      autoReloads++
      mainWindow.webContents.reload()
    }
  })
  mainWindow.webContents.on('did-fail-load', () => {
    if (autoReloads < MAX_AUTO_RELOADS) {
      autoReloads++
      mainWindow.webContents.reload()
    }
  })
  // 加载成功后重置计数，允许新一轮故障再次自愈
  mainWindow.webContents.on('did-finish-load', () => {
    autoReloads = 0
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
      // 保存全部后关闭（destroy 绕过 beforeunload）；saveAll 返回保存失败的文件名清单。
      // 失败文件（外部冲突等）的未保存内容已由渲染端写入草稿兜底，
      // 此时再次确认告知用户；选"取消"则保留窗口手动处理
      wc.executeJavaScript(
        'window.__markdownsoft_saveAll ? window.__markdownsoft_saveAll() : Promise.resolve([])',
      )
        .then((failed: unknown) => {
          if (Array.isArray(failed) && failed.length > 0) {
            const names = failed.filter((n): n is string => typeof n === 'string')
            if (names.length > 0) {
              const proceed = dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                buttons: ['仍然关闭', '取消'],
                defaultId: 0,
                cancelId: 1,
                message: `${names.length} 个文件未能保存`,
                detail:
                  `「${names.join('」「')}」已被外部修改，未覆盖保存。\n` +
                  '未保存的内容已保留，下次启动打开时会自动恢复为未保存状态。\n\n仍然要关闭吗？',
              })
              if (proceed === 1) return // 取消：保持窗口打开
            }
          }
          mainWindow.destroy()
        })
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

  // fresh 窗口的 hash：可携带待打开文件路径（渲染端启动后自动打开）
  const freshHash = fresh
    ? `fresh${openFile ? `?file=${encodeURIComponent(openFile)}` : ''}`
    : undefined

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (freshHash ? `#${freshHash}` : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: freshHash,
    })
  }

  return mainWindow
}
