# 维护指南

> 2026-08-12：修改会话、草稿、图片导入或搜索功能后，除 `npm run test` 与 `npm run build` 外，应手动验证“输入后切换标签、关闭再恢复、粘贴多张图片、查找替换及 Esc 关闭搜索”。

> 文档切换与撤销维护：程序性全文替换必须使用 `replaceAll(markdown, true)` 重建编辑器状态；自动节点转换必须设置 `addToHistory=false`；Milkdown 防抖回调写入会话前必须与当前编辑器 Markdown 校验一致。

> 文件打开竞态维护：连续选择工作区文件时只允许最后一次选择意图激活编辑器；同一路径合并在途读取，完成后复查标签是否已打开。

> Frontmatter 属性维护：增删改必须走 `replaceEditorContent(..., 'update')`，按行保留复杂 YAML、注释和 LF/CRLF；不得将无法完整解析的 YAML 全量格式化覆盖。

> 代码块样式维护：无语言标识、带语言标识和开启行号三种状态的内边距与行高必须同步调整，避免行号与正文错位。

> 异步面板维护：搜索和图片列表的失败分支必须清理旧结果、加载态及截断提示，避免请求异常后显示过期信息。

> 编辑器焦点维护：关闭查找或模态面板、打开或切换文档后应延迟恢复编辑器焦点；恢复前必须确认用户未转入其他输入控件，避免抢占焦点。

> 全局快捷键维护：组合输入期间直接跳过；在普通输入框、下拉框和非编辑器 `contentEditable` 区域仅阻止浏览器默认行为，不执行应用编辑命令。
> 标签页交互维护：使用 roving tabindex，Tab 键只进入当前活动标签；方向键、Home、End 在标签之间导航，关闭按钮必须保留键盘可达性与可读标签。
> 文档标题维护：有磁盘路径的文档在顶栏改名必须复用工作区重命名流程，成功后才更新显示名；失败、重名或非法名称时应恢复原名称，不能留下界面与磁盘不一致的状态。
> 顶栏标题编辑：Enter 提交并失焦，Escape 放弃本次修改；组合输入期间不得拦截 Enter，以免中断中文输入法候选词确认。
> 所有表单型键盘交互（搜索、重命名、代码语言、快捷键录制及弹窗 Escape）均须先跳过组合输入事件，不能只在编辑器主区处理输入法保护。
> Ctrl/Cmd 加滚轮仅能在编辑内容区域调整编辑缩放，菜单栏、侧栏和各类对话框不得意外改变文稿显示比例。
> 文件树单击与双击会连续触发打开操作；异步读取必须按路径合并在途请求，并在读取完成后再次检查已打开标签，不能因慢磁盘生成重复标签。
> 常用弹窗的关闭控件与设置导航必须使用可聚焦的原生按钮，并提供可见焦点；所有可关闭弹窗均应支持 Escape，且关闭后恢复编辑器焦点。
> 富内容维护：KaTeX 必须在编辑器创建前注册，不能在 `EditorStatus.Created` 后调用 `use()`；Mermaid 保持为 `mermaid` 代码块的节点视图，渲染器按需加载、采用 `securityLevel: 'strict'`，语法错误应就地显示且不得阻塞保存或导出。
> 导出与设置中的分段选项、布尔开关和确认操作必须是原生按钮，使用 `aria-pressed` 反映当前状态；不能仅依赖点击 `div` 完成关键配置。

> 大文档输入维护：预览、大纲和状态栏统计都必须使用延后更新；内容同步应跳过重复 Markdown，图片路径回写在不含 `mdimg://` 时直接返回原字符串。
> Mermaid 输入维护：源码必须保持为 Milkdown 原生 `mermaid` 代码块，图表预览通过独立装饰组件呈现；不能用节点视图接管源码输入，否则节点装饰可能干扰光标。默认只显示图表，点击“编辑源码”后只显示源码，点击“查看图表”或把光标移出当前 Mermaid 代码块后恢复图表。源码模式中的“查看图表”应覆盖在源码块右上角，不能形成第二个空白 Mermaid 容器。源码文字变更只能映射并复用既有预览装饰，只有代码块增删或语言切换才可重建装饰；预览在停止输入后更新。修改逻辑后手动覆盖正常图表、中文节点、错误语法、源码编辑、切换标签和 HTML/PDF 导出。
> Mermaid 导出维护：导出克隆 DOM 时，凡 mermaid 块非源码编辑态一律删除源码 pre 的旧判定会导致渲染失败（语法错误）或 4 秒等待超时未完成时源码丢失——块内无渲染 SVG 时必须以源码文本导出，内容不丢。
> 章节折叠维护：折叠仅用 `display:none` 隐藏，`sectionFold` 的 `handleKeyDown` 三层守卫（Ctrl+A 先展开全部再全选、隐藏区内按键 clamp 回标题末尾、方向键跨界跳转）是防盲打与防全选误删的边界，不得移除；setNodeMarkup 且目标是 heading 时必须跳过快速路径重建装饰，否则折叠范围与标题级别不一致。
> 代码块行号维护：`mapCodeBlockLines` 映射后必须校验 `nodeAt` 是 `code_block`，节点类型不符即剔除走重建，否则删除代码块起点时会残留幽灵块。
> 保存冲突维护：保存报 CONFLICT 时先重读磁盘消解自冲突（磁盘内容与本次写入一致则静默视为保存成功并回填 mtime），确为外部修改才弹确认/跳过提示；不得对自冲突直接弹外部修改确认。
> 移动文件维护：改写 `activeFileIdRef` 之前必须先取编辑器实时内容（`liveContentOf` 快路径依赖 ref 匹配），否则兜底读到空串会把空内容写回磁盘覆盖原文。
> 预览标签维护：丢弃预览标签前必须比对编辑器实时内容与已落账内容，防抖窗口内有输入时先落账并固定为普通标签，不能直接丢弃。
> 图片插入维护：粘贴/拖入图片保存失败必须按错误码提示（`TOO_LARGE` 超限、其他失败提示权限或磁盘空间），不能静默返回。
> 图片信任维护：分散文件（拖入/会话恢复打开）由 `FILE_READ` 授予 `trustFileForSave`，`FILE_SAVE_IMAGE` 必须与 `FILE_SAVE` 一致采用 `ensureTrusted || isFileTrustedForSave` 双重判定。
> 多窗口信任维护：trusted-roots 写盘前必须合并磁盘既有快照（workspaces / files / imageDirs 取并集）再截断上限，多个独立主进程整体覆写会互相丢信任。
> 信任持久化上限维护：workspaces 上限 8、files 上限 256、imageDirs 上限 64（与运行时 imageReadDirs 上限一致），超出淘汰最早登记的；新增持久化清单时必须同步设上限。
> 图片白名单维护：`FILE_OPEN`/`FILE_READ` 授予目录信任（信任根/文件级白名单）时必须同步 `allowImageDirectory` 登记图片读取白名单（只读，不授予写/删/搜权限），保证目录信任根被容量淘汰后已打开文档的图片仍可显示。
> mdimg 协议维护：`registerSchemesAsPrivileged` 的 `bypassCSP: true` 不得移除——页面 CSP 为 `default-src 'self'`，无放行时 `<img src="mdimg:///...">` 不显示；信任边界仍由 `fetchAllowedImage` 的根目录 + realpath 双重校验把关，放行 CSP 不放开读取。
> 导出内联维护：HTML/PDF 导出的图片内联必须走主进程只读 IPC（`document.readImageInline` → `file:read-image-inline`），渲染层 `fetch(mdimg://)` 被 Blink 拒绝必然 TypeError；单图 64MB 上限，超限保留原路径。
> 跨进程保存锁维护：`performFileSave` 写盘前必须先获取跨进程锁（`acquireCrossProcessSaveLock`，独占创建 `<path>.mkedit-save-lock`）；锁 mtime 超 10 秒且持有者进程不存活（崩溃残留）才可删锁抢锁，总等待超 30 秒返回 `SAVE_LOCKED`（手动保存 toast 提示稍后重试，自动保存静默下轮重试）。新增保存路径必须覆盖此锁，不能只依赖进程内 `saveLocks`。
> 编码写回维护：读取探测出的 `encoding`（含 `UTF-8-BOM`）必须在保存时原样写回——带 BOM 的 UTF-8 不得剥 BOM 按 UTF-8 存（BOM 被静默丢弃）；无 BOM UTF-16 探测的两路检测（零字节占比 + GBK 解码含 NUL 兜底）不可只保留其一，否则纯中文 UTF-16 会落入 GBK 并把原文件不可逆改写。
> PDF 导出维护：临时 HTML 写入必须在保护内并返回 `IO_ERROR` 结构化错误，不得让写入异常直接抛出 IPC。
> 设置存储维护：updater 返回 `undefined`（如删除 key）时序列化值为 `undefined`，必须显式抛 `INVALID_VALUE`，避免 `Buffer.byteLength` 抛 TypeError。
> 程序性更新维护：全文替换恢复光标必须经事务 `tr.mapping` 映射旧坐标，frontmatter 等开头内容长度变化时直接用旧坐标会整体漂移；解析失败必须走与成功一致的收尾并提示”内容无法解析，已保留原文档”。

> 工作区搜索缓存同时受条目数和 32MB 总大小约束；修改缓存策略时必须维护两项上限，不能只限制文件数量。
> 工作区正则搜索必须在 Worker 中执行，并对每个文件设置 500ms 超时；不得在 Electron 主进程直接运行不受控的用户正则表达式。

> 更新基线：2026-08-15。项目使用 npm，不使用 pnpm。

## 常用命令

```bash
npm ci
npm run dev
npm run typecheck
npm run test
npm run build
npm run preview
npm run build:win
```

PowerShell 环境若因执行策略拒绝 `npm.ps1`，使用 `npm.cmd run build` 等同命令即可。

## 发布新版本（含自动更新）

客户端升级依赖 GitHub Release 上的 `latest.yml` + 安装包（`electron-updater` 启动时自动检查、下载、覆盖安装，AppData 数据保留）。流程：

1. **升级版本号**：`package.json` 的 `version` 改为新版本（如 `0.2.1` → `0.3.0`），提交并推送。
2. **打 tag**：`git tag v0.3.0 && git push origin master --tags && git push github master:main --tags`——`v*` tag 推送触发 Actions 构建三平台，并自动创建 **GitHub Release 草稿**（`electron-builder --publish always`，`publish` 配置为 github provider + `draft: true`），上传安装包 + `latest.yml` + `blockmap`。
3. **人工发布**：GitHub Release 页面审核草稿（含版本说明）后点击发布——发布前客户端检查不到该版本。
4. **（可选）同步 gitee 国内镜像**：本地先 `npm run build:win` 产出 `release/<version>/` 产物，然后：
   ```bash
   GITEE_TOKEN=<私人令牌> node scripts/sync-gitee.js
   ```
   脚本把安装包、blockmap、latest.yml 上传到 gitee 同名 Release；gitee 令牌在 gitee 设置 → 私人令牌中创建（勾选 projects 权限）。重复执行会跳过已存在的附件。

更新源变更：客户端更新地址来自打包时注入的 `app-update.yml`（由 `publish` 配置生成）。若日后切 gitee 为主源（国内下载更快），把 `package.json` 的 `publish` 改为 `{"provider": "generic", "url": "https://gitee.com/MingProject/mk-editormkEditor/releases/download/<tag目录>"}` 后重新打包；gitee 直链行为需实测一次。

## 常见修改入口

| 需求 | 位置 |
| --- | --- |
| 文件读写、工作区、导出 | `src/main/ipc/handlers.ts` |
| 窗口与关闭确认 | `src/main/window/window-manager.ts` |
| 设置持久化 | `src/main/settings/settings-store.ts` |
| 桥接 API 与类型 | `src/preload/index.ts`、`src/preload/api.d.ts` |
| 顶层状态、快捷键和菜单动作 | `src/renderer/App.tsx` |
| 编辑器能力 | `src/renderer/src/components/Editor/` |
| 主题与外观 | `src/renderer/src/styles/` |

## 修改前后检查

1. 新增 IPC 时同步 `CHANNELS`、handler、preload 与类型声明。
2. 文件保存必须保持 mtime 冲突检测和编码错误处理；保存报 CONFLICT 时先重读磁盘消解自冲突，确为外部修改才提示。跨进程保存锁与编码原样写回（BOM / UTF-16 / GBK）属于数据安全边界，不得移除。
3. 图片导入单张上限为 20MB；工作区搜索关键词上限为 256 个字符。
4. 主题修改至少检查 default、dark、ocean、rose 四套主题。
5. 修改标签、保存状态或快捷键时，先运行 `npm run typecheck` 和 `npm run test`；再运行 `npm run build`。
6. 修改交互、文件或编辑器功能时，运行 `npm run dev` 完成冒烟验证；覆盖打开、编辑、切换、关闭、恢复原文和中文输入法候选词操作。
7. 修改编辑器切换或历史逻辑时，依次打开多个文件，固定预览文件并编辑，连续按 `Ctrl+Z`；最多回到当前文件打开状态，不能清空或混入其他文件内容。
8. 修改 Wiki、frontmatter、文件树或专注模式时，手工验证 Wiki 保存往返、复杂 YAML 保留、LF/CRLF、首次工作区默认折叠、折叠状态恢复以及专注模式 Escape 退出。
9. 修改保存、折叠、导出或图片逻辑时，手工验证：内容未变的重复保存不误报外部修改；折叠标题上 Ctrl+A 先展开再全选、方向键不进入隐藏区；mermaid 错误语法导出仍含源码文本；图片保存失败（超限/权限）有明确提示；分散文件（未加入工作区）中粘贴图片可正常保存。

## 不应直接修改的内容

- 不要在渲染进程直接使用 Node.js 文件系统 API。
- 不要删除 `preload/` 或暴露通用 IPC 调用。
- 不要编辑 `out/`、`release/`、`node_modules/`。
- 不要将图床 token、用户路径、草稿或设置文件提交到仓库。
