import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/ipc/channels'

/**
 * 暴露给渲染进程的安全 API
 * 渲染进程通过 window.desktopAPI 访问
 */
const desktopAPI = {
  /** 运行平台（darwin / win32 / linux），渲染进程用于适配窗口控件 */
  platform: process.platform,

  window: {
    /** 同步标题栏覆盖层颜色（Windows 下跟随主题） */
    setTitlebarColor: (color: string, symbolColor?: string) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_SET_TITLEBAR, { color, symbolColor }),
    /** 开关拼写检查（会话级） */
    setSpellcheck: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_SET_SPELLCHECK, enabled),
    /** 新建窗口（fresh 模式，不恢复会话） */
    newWindow: () => ipcRenderer.invoke(CHANNELS.WINDOW_NEW),
    /** 同步未保存状态到主进程（关闭时弹原生确认框用） */
    setUnsaved: (unsaved: boolean) => ipcRenderer.send(CHANNELS.WINDOW_SET_UNSAVED, unsaved),
  },

  document: {
    /** 打开文件对话框，选择并读取 Markdown 文件 */
    open: () => ipcRenderer.invoke(CHANNELS.FILE_OPEN),

    /** 打开文件夹（返回 Markdown 目录树）；传 path 时跳过对话框（会话恢复用） */
    openFolder: (path?: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_OPEN_FOLDER, path ? { path } : undefined),

    /** 按路径直接读取文件（会话恢复用，不弹对话框） */
    read: (path: string) => ipcRenderer.invoke(CHANNELS.FILE_READ, path),

    /** 保存到指定路径（expectedMtime 用于外部冲突检测） */
    save: (path: string, content: string, expectedMtime?: number) =>
      ipcRenderer.invoke(CHANNELS.FILE_SAVE, { path, content, expectedMtime }),

    /** 另存为，弹出保存对话框（可选自定义文件过滤器，用于导出 HTML 等） */
    saveAs: (
      content: string,
      options?: {
        filters?: { name: string; extensions: string[] }[]
        defaultPath?: string
      },
    ) => ipcRenderer.invoke(CHANNELS.FILE_SAVE_AS, { content, ...options }),

    /** 保存剪贴板/拖入的图片，返回磁盘路径 */
    saveImage: (
      dataUrl: string,
      hints?: { docPath?: string; workspacePath?: string },
    ) => ipcRenderer.invoke(CHANNELS.FILE_SAVE_IMAGE, { dataUrl, ...hints }),

    /** 导出 PDF（主进程隐藏窗口渲染后打印） */
    exportPdf: (html: string, defaultName: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_EXPORT_PDF, { html, defaultName }),
  },

  workspace: {
    /** 在目录下新建 Markdown 文件 */
    createFile: (dir: string, name: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_CREATE, { dir, name }),

    /** 重命名文件 */
    renameFile: (path: string, newName: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_RENAME, { path, newName }),

    /** 删除文件（移入回收站） */
    deleteFile: (path: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_DELETE, path),

    /** 列出目录下的图片文件（图片管理面板） */
    listImages: (dirs: string[]) =>
      ipcRenderer.invoke(CHANNELS.FILE_LIST_IMAGES, dirs),

    /** 删除图片（移入回收站） */
    deleteImage: (path: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_DELETE_IMAGE, path),
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke(CHANNELS.SETTINGS_GET, key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, { key, value }),
  },
}

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI)

/** 类型导出，供渲染进程使用 */
export type DesktopAPI = typeof desktopAPI
