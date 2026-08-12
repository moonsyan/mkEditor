# Milkdown 编辑器扩展指南

> 更新基线：2026-08-11。插件以 `src/renderer/src/components/Editor/index.tsx` 的实际注册和 `plugins/` 目录实现为准。

> 理解编辑器内核，学会添加新功能和修复编辑相关 Bug。

---

## 一、为什么选 Milkdown

Milkdown 是 ProseMirror 的 React 封装，提供：
- **所见即所得**：输入 Markdown 语法即时渲染
- **插件系统**：公式、图表、代码高亮按需加载
- **命令系统**：统一的操作接口（粗体、标题、表格...）
- **React 原生**：`@milkdown/react` 提供 `useEditor` Hook

---

## 二、编辑器初始化流程

```typescript
// Editor/index.tsx
const editor = useEditor((root) => {
  createEditor({
    root,
    // 1. 基础语法
    preset: commonmark().config(preset),
    // 2. GFM 扩展（表格、任务列表、代码块）
    plugin(gfm()),
    // 3. 历史记录（撤销/重做）
    plugin(history()),
    // 4. 监听器（用于获取光标位置、大纲等）
    plugin(listener(...)),
    // 5. 代码高亮
    plugin(prism()),
  })
})
```

---

## 三、懒加载插件

Math（KaTeX）和 Diagram（Mermaid）体积大，**不在启动时加载**：

```typescript
// 检测到内容包含公式/图表时才加载
async function ensureRichContent(editor: Milkdown) {
  const md = editor.getMarkdown()

  // 懒加载 KaTeX
  if (md.includes('$') && !katexLoaded) {
    const { block } = await import('@milkdown/plugin-math')
    editor.setConfig((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, md)
      ctx.update(schemaCtx, (schema) => block(schema))
    })
    katexLoaded = true
  }

  // 懒加载 Mermaid
  if (md.includes('```mermaid') && !diagramLoaded) {
    const { diagram } = await import('@milkdown/plugin-diagram')
    // ... 类似逻辑
  }
}
```

**导出前调用**：
```typescript
await editor.ensureRichContent()  // 等待插件就绪
const html = editor.getPreviewHtml()
```

---

## 四、编辑器命令系统

### 执行命令

```typescript
// EditorHandle 暴露的方法
editorRef.current.runCommand('strong')              // 加粗
editorRef.current.runCommand('heading', 2)          // 转 H2
editorRef.current.runCommand('table', { row: 3, col: 3 })  // 插入表格
editorRef.current.runCommand('undo')                // 撤销
editorRef.current.runCommand('redo')                // 重做
```

### 命令来源

```typescript
import {
  toggleStrongCommand,    // 粗体
  toggleEmphasisCommand,  // 斜体
  wrapInHeadingCommand,   // 标题
  insertTableCommand,     // 表格
  undoCommand, redoCommand,  // 撤销/重做
} from '@milkdown/kit/preset/...'
```

---

## 五、搜索高亮实现

搜索高亮用 **ProseMirror Decorations** 实现（不操作 DOM）：

```typescript
// Editor/index.tsx
const searchPlugin = new Plugin({
  key: searchKey,
  props: {
    decorations(state) {
      // 遍历文档，找到匹配位置
      const hits: SearchHit[] = []
      // ... 构建高亮范围
      return DecorationSet.create(state.doc, hits)
    }
  }
})
```

### 搜索状态管理

```typescript
// 模块级变量（单编辑器实例安全）
let searchHits: SearchHit[] = []
let searchCurrent = -1

function startSearch(query, regex, caseSensitive) {
  searchHits = buildHits(query, regex, caseSensitive)
  searchCurrent = 0
  editor.queueEditor((ctx) => {
    const view = ctx.get(editorViewCtx)
    const decorations = buildDecorations(searchHits)
    view.dispatch(view.state.tr.setDecoration(searchKey, decorations))
  })
}
```

---

## 六、获取编辑器内容

```typescript
// 获取 Markdown 源码
const md = editor.getMarkdown()

// 获取预览 HTML（用于导出）
const html = editor.getPreviewHtml()

// 替换内容
editor.replaceContent(newMd)

// 获取当前光标位置
const pos = editor.getCursorPosition()  // { line, col }
```

---

## 七、编辑器扩展点

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| 新增命令 | `Editor/index.tsx` | 通过 `callCommand` 注册 |
| 新增节点类型 | `Editor/index.tsx` | 修改 schema |
| 修改搜索逻辑 | `Editor/index.tsx` | 修改 `buildSearchRegex` |
| 修改懒加载逻辑 | `Editor/index.tsx` | 修改 `ensureRichContent` |

---

## 八、与 ProseMirror 的关系

```
Milkdown
  └── ProseMirror（底层内核）
        ├── schema：定义节点类型
        ├── state：文档状态（不可变）
        ├── view：DOM 渲染
        └── commands：操作命令
```

项目中的 ProseMirror 类型：
```typescript
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
```

---

## 九、常见问题

### Q: 为什么导出时 Mermaid 图表不显示？
A: 懒加载有时序问题。修复方式：导出前调用 `ensureRichContent()` 等待插件就绪。

### Q: 搜索为什么能跳过代码块？
A: `collectHits` 遍历时检查节点类型，跳过 `code_block`。

### Q: 如何添加新的 Markdown 语法支持？
A: 引入对应的 micromark 扩展（如 `micromark-extension-footnote`），并在 Milkdown preset 中注册。
