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
    /** 开关拼写检查（会话级，可选语言） */
    setSpellcheck: (enabled: boolean, language?: string) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_SET_SPELLCHECK, { enabled, language }),
    /** 新建窗口（fresh 模式，不恢复会话） */
    newWindow: () => ipcRenderer.invoke(CHANNELS.WINDOW_NEW),
    /** 新建窗口并打开指定文件（fresh 模式） */
    newWindowWithFile: (path: string) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_NEW_WITH_FILE, path),
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

    /** 仅读取文件 mtime（草稿恢复前校验基线新鲜度用） */
    stat: (path: string) => ipcRenderer.invoke(CHANNELS.FILE_STAT, path),

    /** 保存到指定路径（expectedMtime 用于外部冲突检测；encoding 为 GBK 时写回原编码） */
    save: (path: string, content: string, expectedMtime?: number, encoding?: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_SAVE, { path, content, expectedMtime, encoding }),

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

    /** 导出 PDF（主进程隐藏窗口渲染后打印，支持纸张/页边距/页眉页脚选项） */
    exportPdf: (
      html: string,
      defaultName: string,
      options?: {
        pageSize?: 'A4' | 'Letter' | 'A5' | 'Legal'
        margins?: 'narrow' | 'standard' | 'wide'
        headerFooter?: boolean
      },
    ) => ipcRenderer.invoke(CHANNELS.FILE_EXPORT_PDF, { html, defaultName, options }),

    /** 通过 pandoc 导出 Word/LaTeX/纯文本/EPUB（未安装 pandoc 时返回 PANDOC_NOT_FOUND） */
    exportPandoc: (markdown: string, defaultTitle: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_EXPORT_PANDOC, { markdown, defaultTitle }),

    /** 选择本地 CSS 文件并读取内容（自定义主题导入） */
    pickCss: () => ipcRenderer.invoke(CHANNELS.FILE_PICK_CSS),

    /** 上传图片到已配置的图床（未配置返回 NOT_CONFIGURED） */
    uploadImage: (dataUrl: string) =>
      ipcRenderer.invoke(CHANNELS.IMAGE_UPLOAD, { dataUrl }),
  },

  workspace: {
    /** 在目录下新建 Markdown 文件 */
    createFile: (dir: string, name: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_CREATE, { dir, name }),

    /** 重命名文件 */
    renameFile: (path: string, newName: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_RENAME, { path, newName }),

    /** 移动文件/文件夹到目标目录（文件树拖拽用） */
    moveFile: (path: string, targetDir: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_MOVE, { path, targetDir }),

    /** 删除文件（移入回收站） */
    deleteFile: (path: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_DELETE, path),

    /** 列出目录下的图片文件（图片管理面板） */
    listImages: (dirs: string[]) =>
      ipcRenderer.invoke(CHANNELS.FILE_LIST_IMAGES, dirs),

    /** 删除图片（移入回收站） */
    deleteImage: (path: string) =>
      ipcRenderer.invoke(CHANNELS.FILE_DELETE_IMAGE, path),

    /** 工作区全文搜索（逐行子串/正则匹配，返回命中行与预览） */
    search: (
      dir: string,
      query: string,
      caseSensitive?: boolean,
      regex?: boolean,
    ) =>
      ipcRenderer.invoke(CHANNELS.FILE_SEARCH_WORKSPACE, {
        dir,
        query,
        caseSensitive,
        regex,
      }),
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
