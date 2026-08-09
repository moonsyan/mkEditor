/** 渲染进程中 window.desktopAPI 的类型声明 */
export interface DesktopAPI {
  /** 运行平台：darwin / win32 / linux */
  platform: string
  window: {
    setTitlebarColor(color: string, symbolColor?: string): Promise<{ ok: boolean }>
    setSpellcheck(enabled: boolean): Promise<{ ok: boolean }>
    newWindow(): Promise<{ ok: boolean }>
    setUnsaved(unsaved: boolean): void
  }
  document: {
    open(): Promise<FileResult>
    openFolder(path?: string): Promise<FolderResult>
    read(path: string): Promise<FileResult>
    save(path: string, content: string, expectedMtime?: number): Promise<SaveResult>
    saveAs(
      content: string,
      options?: {
        filters?: { name: string; extensions: string[] }[]
        defaultPath?: string
      },
    ): Promise<SaveAsResult>
    saveImage(
      dataUrl: string,
      hints?: { docPath?: string; workspacePath?: string },
    ): Promise<ImageResult>
    exportPdf(html: string, defaultName: string): Promise<{ ok: boolean; data?: { path: string }; error?: { code: string; message?: string } }>
  }
  workspace: {
    createFile(dir: string, name: string): Promise<{ ok: boolean; data?: { path: string; name: string }; error?: { code: string; message?: string } }>
    renameFile(path: string, newName: string): Promise<{ ok: boolean; data?: { path: string; name: string; modifiedTime: number }; error?: { code: string; message?: string } }>
    deleteFile(path: string): Promise<{ ok: boolean; data?: { name: string }; error?: { code: string; message?: string } }>
    listImages(dirs: string[]): Promise<{ ok: boolean; data?: { images: { path: string; name: string; size: number }[] }; error?: { code: string; message?: string } }>
    deleteImage(path: string): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
  }
  settings: {
    get(key: string): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message?: string } }>
    set(key: string, value: unknown): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
  }
}

/** 文件打开结果 */
export interface FileResult {
  ok: boolean
  data?: {
    path: string
    name: string
    content: string
    modifiedTime: number
  }
  error?: { code: string; message?: string }
}

/** 目录树节点 */
export interface FolderTreeNode {
  name: string
  path: string
  /** 存在则为文件夹，否则为 .md 文件 */
  children?: FolderTreeNode[]
}

/** 打开文件夹结果 */
export interface FolderResult {
  ok: boolean
  data?: {
    path: string
    name: string
    tree: FolderTreeNode[]
  }
  error?: { code: string; message?: string }
}

/** 文件保存结果（error.code 为 CONFLICT 表示文件已被外部修改） */
export interface SaveResult {
  ok: boolean
  data?: { modifiedTime: number }
  error?: { code: string; message?: string }
}

/** 另存为结果 */
export interface SaveAsResult {
  ok: boolean
  data?: { path: string; name: string }
  error?: { code: string; message?: string }
}

/** 图片保存结果 */
export interface ImageResult {
  ok: boolean
  data?: { path: string; name: string }
  error?: { code: string; message?: string }
}

declare global {
  interface Window {
    desktopAPI: DesktopAPI
  }
}
