# 开发实战手册

> 解决"怎么修 Bug"和"怎么加功能"的问题。

---

## 一、修复已知 Bug

### B4：拼写检查仅支持英文

**位置**：`src/renderer/src/components/SettingsDialog/index.tsx`

当前拼写检查调用的是 Electron 内置的 `setSpellCheckerEnabled`，只支持英文。
要支持中文需要引入第三方库（如 `cspell`），但项目没有接入，留待后续。

**现状**：
```typescript
// src/main/index.ts 或 window-manager.ts
event.sender.session.setSpellCheckerEnabled(Boolean(enabled))
event.sender.session.setSpellCheckerLanguages(['en-US'])  // 只设了英文
```

---

### U4：搜索状态持久化（已修复，但可参考）

**位置**：`src/renderer/App.tsx`

修复思路：用 `useEffect` + `settings.set('searchState', ...)` 防抖写入。
这个模式可以复用到其他需要持久化的 UI 状态。

---

## 二、添加新功能的标准流程

### 场景：新增一个"导出为 PDF 带目录"功能

#### 步骤 1：定义 IPC 通道

编辑 `src/shared/ipc/channels.ts`：
```typescript
export const CHANNELS = {
  // ... 现有通道
  FILE_EXPORT_PDF_TOC: 'file:export-pdf-toc',  // 新增
} as const
```

#### 步骤 2：实现主进程处理器

编辑 `src/main/ipc/handlers.ts`：
```typescript
ipcMain.handle(CHANNELS.FILE_EXPORT_PDF_TOC, async (event, args) => {
  // 实现逻辑
  const parent = BrowserWindow.fromWebContents(event.sender)
  // ...
  return { ok: true, data: { path } }
})
```

#### 步骤 3：更新类型声明

编辑 `src/preload/api.d.ts`：
```typescript
interface DesktopAPI {
  document: {
    // ... 现有方法
    exportPdfWithToc(html: string, defaultName: string): Promise<...>
  }
}
```

#### 步骤 4：在 preload 暴露

编辑 `src/preload/index.ts`：
```typescript
document: {
  // ...
  exportPdfWithToc: (html, name) =>
    ipcRenderer.invoke(CHANNELS.FILE_EXPORT_PDF_TOC, { html, defaultName: name }),
}
```

#### 步骤 5：在 App.tsx 调用

```typescript
const handleExportPdfWithToc = useCallback(async () => {
  if (!window.desktopAPI) return
  const html = buildDocHtml()
  const res = await window.desktopAPI.document.exportPdfWithToc(html, 'document.pdf')
  if (res.ok) setToast('PDF 导出成功')
}, [buildDocHtml])
```

#### 步骤 6：在菜单栏添加入口

编辑 `src/renderer/src/components/MenuBar/index.tsx`，在菜单配置中添加新项。

---

## 三、修改主题

### 新建主题

1. 在 `src/renderer/src/styles/themes/` 新建 `mytheme.css`
2. 复制 `default.css` 作为模板，修改颜色变量
3. 在 `App.tsx` 的 `THEMES` 数组中添加：
```typescript
{ id: 'mytheme', name: '我的主题', color: '#xxx', desc: '描述' }
```

### 修改现有主题

直接编辑对应 `.css` 文件，`npm run dev` 热重载即可看到效果。

---

## 四、修改快捷键

**位置**：`src/renderer/src/data/shortcuts.ts`

```typescript
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'new': 'Mod-n',
  'open': 'Mod-o',
  'save': 'Mod-s',
  'find': 'Mod-f',
  'replace': 'Mod-h',
  // ...
}
```

- `Mod` = Ctrl（Windows/Linux）或 Cmd（macOS）
- 修改后重启应用生效（快捷键会持久化到 settings）

---

## 五、添加新的弹窗组件

以新增"关于"弹窗为例：

### 1. 创建组件文件
```
src/renderer/src/components/AboutDialog/index.tsx
```

### 2. 编写组件（React 函数）
```typescript
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>关于 MarkdownSoft</h2>
        <p>版本：v0.0.2</p>
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  )
}
```

### 3. 添加样式
```
src/renderer/src/styles/components/aboutdialog.css
```

### 4. 在 App.tsx 中使用
```typescript
import { AboutDialog } from './src/components/AboutDialog'

// 在 state 中添加
const [aboutOpen, setAboutOpen] = useState(false)

// 在 JSX 中渲染
<AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
```

---

## 六、调试技巧

### 查看主进程日志
```bash
npm run dev
# 所有 console.log 在终端输出
```

### 查看渲染进程日志
1. `Ctrl + Shift + I` 打开 DevTools
2. Console 标签页

### 打断点调试
DevTools 的 Sources 标签页可以打断点，支持 F8 继续、F10 单步。

### 查看 IPC 调用
在 `handlers.ts` 的每个处理器开头加：
```typescript
console.log('[IPC]', channel, args)
```

---

## 七、常见问题排查

### 问题：修改代码后没有热更新
**解决**：确认 `npm run dev` 在运行，不要直接打开编译后的 `out/` 目录。

### 问题：IPC 调用返回 `{ ok: false, error: { code: 'WINDOW_NOT_FOUND' } }`
**原因**：主进程找不到当前窗口。通常是因为调用时机过早（窗口还未创建）。
**解决**：检查调用时窗口是否已 ready，或在 handler 中增加重试。

### 问题：样式修改不生效
**原因**：CSS 变量被主题覆盖，或组件使用了内联样式。
**解决**：检查 DevTools 的 Computed 面板，确认变量值。

### 问题：新建文件后编辑器没有聚焦
**原因**：内容替换需要一帧时间。
**解决**：用 `requestAnimationFrame + setTimeout` 延迟聚焦（见 `focusEditorSoon`）。

---

## 八、代码规范

### 命名约定
- 组件：PascalCase（`SearchBar`、`SettingsDialog`）
- 文件：index.tsx（每个组件一个目录）
- 状态：camelCase（`activeFileId`、`searchMode`）
- IPC 通道：kebab-case（`file:open`、`settings:get`）

### 错误处理
所有 IPC 调用必须处理 `ok: false` 的情况：
```typescript
const result = await window.desktopAPI.document.open()
if (!result.ok) {
  setToast(result.error?.message ?? '操作失败')
  return
}
```

### 性能注意事项
- 用 `useMemo` 缓存计算结果
- 用 `useCallback` 缓存函数引用
- 用 `useRef` 存不触发重绘的值
- 高频操作（拖拽、滚动）用 `requestAnimationFrame` 节流
