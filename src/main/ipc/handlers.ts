import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron'
import { readFile, writeFile, stat, readdir, mkdir, rename } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, dirname, basename } from 'path'
import { CHANNELS } from '../../shared/ipc/channels'
import { getSetting, setSetting } from '../settings/settings-store'
import { createWindow } from '../window/window-manager'

/** 目录树节点（只含 .md 文件与含 .md 的文件夹） */
interface FolderTreeNode {
  name: string
  path: string
  children?: FolderTreeNode[]
}

const MAX_TREE_DEPTH = 5

/** 递归扫描目录，只保留 Markdown 文件与含 Markdown 的文件夹 */
async function walkMarkdownTree(dir: string, depth: number): Promise<FolderTreeNode[]> {
  if (depth > MAX_TREE_DEPTH) return []
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'zh-CN')
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .sort(byName)
  const files = entries
    .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
    .sort(byName)

  const nodes: FolderTreeNode[] = []
  for (const d of dirs) {
    const children = await walkMarkdownTree(join(dir, d.name), depth + 1)
    // 空文件夹（无 Markdown 内容）不展示
    if (children.length > 0) {
      nodes.push({ name: d.name, path: join(dir, d.name), children })
    }
  }
  for (const f of files) {
    nodes.push({ name: f.name, path: join(dir, f.name) })
  }
  return nodes
}

export function registerIpcHandlers(): void {
  // 打开文件
  ipcMain.handle(CHANNELS.FILE_OPEN, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELLED' } }
    }

    const filePath = result.filePaths[0]
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileStat = await stat(filePath)
      return {
        ok: true,
        data: {
          path: filePath,
          name: filePath.split(/[/\\]/).pop() || 'untitled.md',
          content,
          modifiedTime: fileStat.mtimeMs,
        },
      }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 打开文件夹（会话恢复时可直接传 path 跳过对话框）
  ipcMain.handle(
    CHANNELS.FILE_OPEN_FOLDER,
    async (event, args?: { path?: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      let folderPath = args?.path
      if (!folderPath) {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, error: { code: 'CANCELLED' } }
        }
        folderPath = result.filePaths[0]
      }

      try {
        const children = await walkMarkdownTree(folderPath, 0)
        return {
          ok: true,
          data: {
            path: folderPath,
            name: folderPath.split(/[/\\]/).pop() || 'workspace',
            tree: children,
          },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 按路径读取文件（会话恢复用，不弹对话框）
  ipcMain.handle(CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileStat = await stat(filePath)
      return {
        ok: true,
        data: {
          path: filePath,
          name: filePath.split(/[/\\]/).pop() || 'untitled.md',
          content,
          modifiedTime: fileStat.mtimeMs,
        },
      }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 保存文件（带外部冲突检测：磁盘 mtime 比预期新则拒绝，避免静默覆盖）
  ipcMain.handle(
    CHANNELS.FILE_SAVE,
    async (
      _event,
      args: { path: string; content: string; expectedMtime?: number },
    ) => {
      try {
        const pre = await stat(args.path).catch(() => null)
        if (!pre) {
          return { ok: false, error: { code: 'NOT_FOUND' } }
        }
        // 容差 1 秒，避开文件系统时间精度差异
        if (
          typeof args.expectedMtime === 'number' &&
          pre.mtimeMs > args.expectedMtime + 1000
        ) {
          return {
            ok: false,
            error: { code: 'CONFLICT', message: '文件已被外部修改' },
          }
        }
        await writeFile(args.path, args.content, 'utf-8')
        const fileStat = await stat(args.path)
        return { ok: true, data: { modifiedTime: fileStat.mtimeMs } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 另存为（支持自定义过滤器，用于导出 HTML 等）
  ipcMain.handle(
    CHANNELS.FILE_SAVE_AS,
    async (
      event,
      args: {
        content: string
        filters?: { name: string; extensions: string[] }[]
        defaultPath?: string
      },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      const result = await dialog.showSaveDialog(window, {
        filters: args.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: args.defaultPath ?? 'untitled.md',
      })

      if (result.canceled || !result.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      try {
        await writeFile(result.filePath, args.content, 'utf-8')
        return {
          ok: true,
          data: {
            path: result.filePath,
            name: result.filePath.split(/[/\\]/).pop() || 'untitled.md',
          },
        }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 保存剪贴板/拖入的图片，返回磁盘路径
  ipcMain.handle(
    CHANNELS.FILE_SAVE_IMAGE,
    async (
      _event,
      args: { dataUrl: string; docPath?: string; workspacePath?: string },
    ) => {
      try {
        const match = args.dataUrl.match(
          /^data:(image\/(png|jpe?g|gif|webp|bmp));base64,(.+)$/i,
        )
        if (!match) {
          return { ok: false, error: { code: 'UNSUPPORTED' } }
        }
        const ext = match[2].toLowerCase().replace('jpeg', 'jpg')
        const buffer = Buffer.from(match[3], 'base64')

        // 存储位置：文档旁 attachments/ → 工作区 attachments/ → 用户数据目录
        let dir: string
        if (args.docPath) {
          dir = join(dirname(args.docPath), 'attachments')
        } else if (args.workspacePath) {
          dir = join(args.workspacePath, 'attachments')
        } else {
          dir = join(app.getPath('userData'), 'images')
        }
        await mkdir(dir, { recursive: true })
        const name = `image-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`
        const filePath = join(dir, name)
        await writeFile(filePath, buffer)
        return { ok: true, data: { path: filePath, name } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 同步标题栏覆盖层颜色（Windows 无边框窗口，跟随主题）
  ipcMain.handle(
    CHANNELS.WINDOW_SET_TITLEBAR,
    (event, args: { color: string; symbolColor?: string }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { ok: false }
      if (process.platform === 'win32') {
        try {
          window.setTitleBarOverlay({
            color: args.color,
            symbolColor: args.symbolColor ?? '#5C5850',
            height: 42,
          })
        } catch {
          /* 部分平台不支持 titleBarOverlay，忽略 */
        }
      }
      return { ok: true }
    },
  )

  // 开关拼写检查（会话级；代码块/行内代码由渲染端标记 spellcheck=false 排除）
  ipcMain.handle(CHANNELS.WINDOW_SET_SPELLCHECK, (event, enabled: boolean) => {
    try {
      event.sender.session.setSpellCheckerEnabled(Boolean(enabled))
      if (enabled) event.sender.session.setSpellCheckerLanguages(['en-US'])
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // 新建窗口（fresh 模式：不恢复/不写入会话，避免多窗口互相覆盖）
  ipcMain.handle(CHANNELS.WINDOW_NEW, () => {
    try {
      createWindow(true)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // 渲染端同步未保存状态到主进程（关闭时弹原生确认框用，避免静默阻止关闭）
  ipcMain.on(CHANNELS.WINDOW_SET_UNSAVED, (event, unsaved: boolean) => {
    ;(event.sender as unknown as { __unsaved?: boolean }).__unsaved = !!unsaved
  })

  // 导出 PDF：隐藏窗口渲染 HTML 后 printToPDF
  ipcMain.handle(
    CHANNELS.FILE_EXPORT_PDF,
    async (event, args: { html: string; defaultName: string }) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { ok: false, error: { code: 'WINDOW_NOT_FOUND' } }

      const save = await dialog.showSaveDialog(parent, {
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        defaultPath: args.defaultName,
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, error: { code: 'CANCELLED' } }
      }

      // 隐藏窗口加载文档 HTML，等待渲染完成后打印
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })
      try {
        await printWin.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(args.html)}`,
        )
        // 等图片/字体等资源就绪
        await printWin.webContents.executeJavaScript(
          `new Promise(r => {
            const imgs = Array.from(document.images)
            if (imgs.length === 0) return r(true)
            Promise.all(imgs.map(i => i.complete ? 1 : new Promise(res => {
              i.onload = i.onerror = res
            }))).then(() => r(true))
          })`,
        )
        const pdf = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 },
        })
        await writeFile(save.filePath, pdf)
        return { ok: true, data: { path: save.filePath } }
      } catch (err) {
        return { ok: false, error: { code: 'PDF_ERROR', message: String(err) } }
      } finally {
        printWin.close()
      }
    },
  )

  /* ==================== 工作区文件操作 ==================== */

  /** 文件名安全校验：禁止路径分隔符与非法字符 */
  const safeName = (name: string): string | null => {
    const trimmed = name.trim()
    if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) return null
    return trimmed
  }

  // 新建文件
  ipcMain.handle(
    CHANNELS.FILE_CREATE,
    async (_event, args: { dir: string; name: string }) => {
      const base = safeName(args.name)
      if (!base) return { ok: false, error: { code: 'INVALID_NAME' } }
      // 重名时自动编号：新文档.md → 新文档 2.md → 新文档 3.md ...
      const extMatch = base.match(/\.(md|markdown)$/i)
      const ext = extMatch ? extMatch[0] : '.md'
      const stem = extMatch ? base.slice(0, -ext.length) : base
      let name = base
      let target = join(args.dir, name)
      let n = 2
      while (n <= 1000) {
        try {
          await stat(target)
          name = `${stem} ${n}${ext}`
          target = join(args.dir, name)
          n++
        } catch {
          break // 不存在，可用
        }
      }
      try {
        const title = name.replace(/\.(md|markdown)$/i, '')
        await writeFile(target, `# ${title}\n\n`, 'utf-8')
        return { ok: true, data: { path: target, name } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 重命名
  ipcMain.handle(
    CHANNELS.FILE_RENAME,
    async (_event, args: { path: string; newName: string }) => {
      const name = safeName(args.newName)
      if (!name) return { ok: false, error: { code: 'INVALID_NAME' } }
      const target = join(dirname(args.path), name)
      if (target !== args.path) {
        try {
          await stat(target)
          return { ok: false, error: { code: 'EXISTS' } }
        } catch {
          /* 目标不存在，可以重命名 */
        }
      }
      try {
        await rename(args.path, target)
        // 返回重命名后的 mtime，供渲染端更新冲突检测基线，避免误报"外部修改"
        const modifiedTime = (await stat(target).catch(() => null))?.mtimeMs ?? 0
        return { ok: true, data: { path: target, name, modifiedTime } }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )

  // 删除（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE, async (_event, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return { ok: true, data: { name: basename(filePath) } }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 列出指定目录下的图片文件（图片管理面板）
  ipcMain.handle(CHANNELS.FILE_LIST_IMAGES, async (_event, dirs: string[]) => {
    const images: { path: string; name: string; size: number }[] = []
    for (const dir of dirs) {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (!e.isFile()) continue
          if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(e.name)) continue
          const p = join(dir, e.name)
          const st = await stat(p).catch(() => null)
          images.push({ path: p, name: e.name, size: st?.size ?? 0 })
        }
      } catch {
        /* 目录不存在则跳过 */
      }
    }
    return { ok: true, data: { images } }
  })

  // 删除图片（移入回收站）
  ipcMain.handle(CHANNELS.FILE_DELETE_IMAGE, async (_event, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 读取设置
  ipcMain.handle(CHANNELS.SETTINGS_GET, async (_event, key: string) => {
    try {
      return { ok: true, data: await getSetting(key) }
    } catch (err) {
      return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
    }
  })

  // 写入设置
  ipcMain.handle(
    CHANNELS.SETTINGS_SET,
    async (_event, args: { key: string; value: unknown }) => {
      try {
        await setSetting(args.key, args.value)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: { code: 'IO_ERROR', message: String(err) } }
      }
    },
  )
}
