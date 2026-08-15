# 架构说明

> 更新基线：2026-08-15。当前应用未使用 Zustand；会话状态由 `App.tsx`、React state 与 `useRef` 镜像管理。

## 进程边界

```text
Renderer (React + Milkdown)
  -> window.desktopAPI
Preload (contextBridge)
  -> IPC
Main (Electron/Node.js/文件系统/窗口)
```

- `src/main/`：应用生命周期、窗口、文件读写、工作区、导出、设置、图床请求和 IPC handler。只有此层可以使用 `fs`、`path`、`shell`、`child_process` 等系统能力。
- `src/preload/`：通过 `contextBridge` 暴露固定的 `window.desktopAPI`。接口类型定义在 `src/preload/api.d.ts`。
- `src/renderer/`：React 界面、Milkdown 编辑器、会话状态和交互逻辑。渲染层不得直接导入 Node.js 或 Electron 权限 API。
- `src/shared/ipc/channels.ts`：唯一的 IPC 通道常量来源。

## 核心数据流

1. 编辑器将 Markdown 变更回调给 `App.tsx`，更新 `contents` 与 `savedMap`。
2. 保存时渲染层携带已知 mtime 调用 `desktopAPI.document.save`。
3. 主进程检测外部修改、编码损失和 I/O 错误，再将结构化结果返回。
4. 成功保存后更新 mtime、已保存基线与草稿。保存报 CONFLICT 时渲染层先重读磁盘消解自冲突：磁盘内容与本次写入一致（上次保存后 mtime 未回填、内容未变又保存）则静默视为保存成功并回填 mtime；仅当磁盘内容确实不同才提示外部修改（自动保存跳过并提示，手动保存弹确认框）。外部修改的磁盘内容不会被静默覆盖。

## 安全与可靠性

- 窗口开启 `contextIsolation`，关闭 `nodeIntegration`。
- Preload 只暴露业务级 API，不暴露任意 `ipcRenderer` 或文件系统能力。
- 文件操作、图片、CSS、搜索和导出都在主进程实施格式或体积边界。
- 新窗口和普通链接不会在应用内加载外部页面；安全的 HTTP(S) 与 `mailto:` 链接由系统浏览器处理。
- 应用设置、会话和草稿保存在 Electron `userData` 目录，与用户 Markdown 正文分离。
- 会话信任清单（`userData/trusted-roots.json`）由主进程独占维护，渲染层没有 IPC 能写入；多窗口模式下存在多个独立主进程，写盘前会合并磁盘既有快照（workspaces / files / imageDirs 取并集）再截断上限（工作区 8 / 文件 256 / 图片目录 64，超出淘汰最早登记的），避免各进程整体覆写导致其他窗口的信任丢失、也防止清单无界增长。
- `mdimg://` 图片协议：`registerSchemesAsPrivileged` 为该 scheme 声明 `bypassCSP: true`——页面 CSP 为 `default-src 'self'`，自定义 scheme 与文档不同源，不放行则 `<img src="mdimg:///...">` 被 CSP 拒绝（真实实验验证）。信任边界不变：`fetchAllowedImage` 仍做完整信任根/图片白名单 + realpath 双重校验，放行 CSP 不放开读取。
- 导出内联图片走主进程只读 IPC（`file:read-image-inline` → `readImageAsDataUrl`）：渲染层对自定义 scheme 的 `fetch()` 被 Blink 拒绝（必然 TypeError），内联必须由主进程读为 base64 data URL；信任校验与 mdimg 协议共用 `resolveAllowedImagePath`，单图 64MB 上限防 OOM。
- 图片读取白名单独立于目录信任根：`FILE_OPEN` 在授予目录信任根之外另登记 `allowImageDirectory(dirname(filePath))`（只读，不授予写/删/搜权限），目录信任根被 64 上限淘汰后已打开文档的图片仍可显示。
- 跨进程保存锁：多窗口模式下各主进程的进程内 `saveLocks` 互相不可见，`performFileSave` 写盘前先独占创建 `<path>.mkedit-save-lock`（写入 pid + 时间戳）；锁 mtime 超过 10 秒且持有者进程不存活（崩溃残留）时删除抢锁，总等待超过 30 秒返回 `SAVE_LOCKED`（手动保存 toast 提示稍后重试，自动保存静默下轮重试）。锁覆盖 stat 校验 + 冲突检测 + 写盘全流程。
- 编码处理：读取时自动探测——BOM 优先（UTF-8 / UTF-16LE / UTF-16BE），带 BOM 的 UTF-8 记独立编码 `UTF-8-BOM`，保存时写回 BOM；无 BOM 的 UTF-16 按抽样前 8KB 零字节占比判定（一侧 ≥30% 且另一侧 ≤5%），纯中文 UTF-16（零字节占比低）由「GBK 解码结果含 NUL」兜底检测补上；UTF-32 明确拒绝打开；保存按原编码写回（GBK 先做往返校验，无法映射的字符拒绝写入）。

## 状态边界

- ProseMirror/Milkdown：编辑器文档、选区和命令执行。
- `App.tsx`：打开文件、活动标签、脏状态、mtime、顶层弹窗与工作区快照。
- 组件内部：输入框、展开状态等短生命周期 UI 状态。
- 主进程：设置缓存、窗口状态与对系统资源的访问。

文档切换复用 Milkdown 实例，但通过 `replaceAll(markdown, true)` 重建 `EditorState`，清空跨文档撤销历史。Milkdown 内容回调带有防抖，`App.tsx` 接收回调前必须用当前编辑器 Markdown 校验内容归属，防止旧文件快照写入新文件。

## 重构边界

- `Editor/index.tsx` 已将图片插入、搜索控制器和悬浮层拆出；后续只把独立的编辑器能力放入 `Editor/`，不在 `App.tsx` 直接操作 ProseMirror transaction。
- `App.tsx` 仍负责文档会话、文件工作流、顶层动作分发和应用壳装配，是当前唯一需要继续拆分的高复杂度模块。下一步应优先抽取 `useDocumentWorkspace`（打开、创建、重命名、移动和删除）与 `useAppActions`（菜单和快捷键分发）。
- 上述两个 Hook 都会触及保存、草稿、mtime 冲突和预览标签语义，必须先为对应工作流补齐回归用例后再迁移；本轮不为了压缩行数而改变既有状态所有权。
