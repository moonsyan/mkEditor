# 维护指南

> 2026-08-11：修改会话、草稿、图片导入或搜索功能后，除 `npm run test` 与 `npm run build` 外，应手动验证“输入后切换标签、关闭再恢复、粘贴多张图片、查找替换及 Esc 关闭搜索”。

> 代码块样式维护：无语言标识、带语言标识和开启行号三种状态的内边距与行高必须同步调整，避免行号与正文错位。

> 异步面板维护：搜索和图片列表的失败分支必须清理旧结果、加载态及截断提示，避免请求异常后显示过期信息。

> 编辑器焦点维护：关闭查找或模态面板、打开或切换文档后应延迟恢复编辑器焦点；恢复前必须确认用户未转入其他输入控件，避免抢占焦点。

> 全局快捷键维护：组合输入期间直接跳过；在普通输入框、下拉框和非编辑器 `contentEditable` 区域仅阻止浏览器默认行为，不执行应用编辑命令。
> 标签页交互维护：使用 roving tabindex，Tab 键只进入当前活动标签；方向键、Home、End 在标签之间导航，关闭按钮必须保留键盘可达性与可读标签。
> 文档标题维护：有磁盘路径的文档在顶栏改名必须复用工作区重命名流程，成功后才更新显示名；失败、重名或非法名称时应恢复原名称，不能留下界面与磁盘不一致的状态。
> 顶栏标题编辑：Enter 提交并失焦，Escape 放弃本次修改；组合输入期间不得拦截 Enter，以免中断中文输入法候选词确认。
> 所有表单型键盘交互（搜索、重命名、代码语言、快捷键录制及弹窗 Escape）均须先跳过组合输入事件，不能只在编辑器主区处理输入法保护。
> Ctrl/Cmd 加滚轮仅能在编辑内容区域调整编辑缩放，菜单栏、侧栏和各类对话框不得意外改变文稿显示比例。

> 大文档输入维护：预览、大纲和状态栏统计都必须使用延后更新；内容同步应跳过重复 Markdown，图片路径回写在不含 `mdimg://` 时直接返回原字符串。

> 工作区搜索缓存同时受条目数和 32MB 总大小约束；修改缓存策略时必须维护两项上限，不能只限制文件数量。
> 工作区正则搜索必须在 Worker 中执行，并对每个文件设置 500ms 超时；不得在 Electron 主进程直接运行不受控的用户正则表达式。

> 更新基线：2026-08-11。项目使用 npm，不使用 pnpm。

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
2. 文件保存必须保持 mtime 冲突检测和编码错误处理。
3. 图片导入单张上限为 20MB；工作区搜索关键词上限为 256 个字符。
4. 主题修改至少检查 default、dark、ocean、rose 四套主题。
5. 修改标签、保存状态或快捷键时，先运行 `npm run typecheck` 和 `npm run test`；再运行 `npm run build`。
6. 修改交互、文件或编辑器功能时，运行 `npm run dev` 完成冒烟验证；覆盖打开、编辑、切换、关闭、恢复原文和中文输入法候选词操作。

## 不应直接修改的内容

- 不要在渲染进程直接使用 Node.js 文件系统 API。
- 不要删除 `preload/` 或暴露通用 IPC 调用。
- 不要编辑 `out/`、`release/`、`node_modules/`。
- 不要将图床 token、用户路径、草稿或设置文件提交到仓库。
