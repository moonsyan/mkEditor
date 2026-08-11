/** 渲染进程中 window.desktopAPI 的类型声明 */
export interface DesktopAPI {
  /** 运行平台：darwin / win32 / linux */
  platform: string
  window: {
    setTitlebarColor(color: string, symbolColor?: string): Promise<{ ok: boolean }>
    setSpellcheck(enabled: boolean, language?: string): Promise<{ ok: boolean }>
    newWindow(): Promise<{ ok: boolean }>
    newWindowWithFile(path: string): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
    setUnsaved(unsaved: boolean): void
  }
  document: {
    open(): Promise<FileResult>
    openFolder(path?: string): Promise<FolderResult>
    read(path: string): Promise<FileResult>
    stat(path: string): Promise<{ ok: boolean; data?: { modifiedTime: number }; error?: { code: string; message?: string } }>
    save(path: string, content: string, expectedMtime?: number, encoding?: string): Promise<SaveResult>
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
    exportPdf(
      html: string,
      defaultName: string,
      options?: {
        pageSize?: 'A4' | 'Letter' | 'A5' | 'Legal'
        margins?: 'narrow' | 'standard' | 'wide'
        headerFooter?: boolean
      },
    ): Promise<{ ok: boolean; data?: { path: string }; error?: { code: string; message?: string } }>
    exportPandoc(markdown: string, defaultTitle: string): Promise<{ ok: boolean; data?: { path: string }; error?: { code: string; message?: string } }>
    pickCss(): Promise<{ ok: boolean; data?: { name: string; content: string }; error?: { code: string; message?: string } }>
    uploadImage(dataUrl: string): Promise<{ ok: boolean; data?: { url: string }; error?: { code: string; message?: string } }>
  }
  workspace: {
    createFile(dir: string, name: string): Promise<{ ok: boolean; data?: { path: string; name: string }; error?: { code: string; message?: string } }>
    renameFile(path: string, newName: string): Promise<{ ok: boolean; data?: { path: string; name: string; modifiedTime: number }; error?: { code: string; message?: string } }>
    moveFile(path: string, targetDir: string): Promise<{ ok: boolean; data?: { path: string; name: string; modifiedTime: number }; error?: { code: string; message?: string } }>
    deleteFile(path: string): Promise<{ ok: boolean; data?: { name: string }; error?: { code: string; message?: string } }>
    listImages(dirs: string[]): Promise<{ ok: boolean; data?: { images: { path: string; name: string; size: number }[] }; error?: { code: string; message?: string } }>
    deleteImage(path: string): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
    search(
      dir: string,
      query: string,
      caseSensitive?: boolean,
      regex?: boolean,
    ): Promise<{
      ok: boolean
      data?: {
        matches: { path: string; line: number; preview: string }[]
        truncated: boolean
      }
      error?: { code: string; message?: string }
    }>
  }
  settings: {
    get(key: string): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message?: string } }>
    set(key: string, value: unknown): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
    upsertDraft(id: string, content: string): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
    deleteDraft(id: string): Promise<{ ok: boolean; error?: { code: string; message?: string } }>
  }
}

/** 文件打开结果（encoding 为自动探测的源编码，保存时统一写回 UTF-8） */
export interface FileResult {
  ok: boolean
  data?: {
    path: string
    name: string
    content: string
    modifiedTime: number
    encoding?: string
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
  data?: { path: string; name: string; modifiedTime?: number }
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
