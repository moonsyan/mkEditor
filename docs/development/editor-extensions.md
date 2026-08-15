# 编辑器扩展指南

> 更新基线：2026-08-15。本文记录 Wiki 链接、YAML frontmatter 属性面板、章节折叠以及文档切换时的编辑器状态约束。

## 编辑器实例与文档切换

应用在多个标签之间复用同一个 Milkdown 编辑器实例，文件内容和选区由 ProseMirror 管理，`App.tsx` 只保存每个文件的会话快照。切换文件必须通过 `EditorHandle.replaceContent()`，不得在页面层直接修改 ProseMirror 状态。

`replaceContent()` 使用 `replaceAll(markdown, true)`。第二个参数 `true` 会重新创建 `EditorState`，清空上一个文件的撤销和重做历史，同时保留编辑器实例。连续撤销因此最多回到当前文件本次打开时的内容，不能进入空文档或其他文件。

切换完成后还要重新执行 Wiki 文本转换，并重置章节折叠状态。新增程序性全文替换时，应复用 `App.tsx` 的 `replaceEditorContent()`，保证编辑器内容、`contents`、保存基线和脏状态使用同一更新路径。

程序性更新（`updateContentPreservingHistory`，属性面板等使用）与切换不同：它是一条全文替换事务，保留撤销历史（Ctrl+Z 可回退本次修改），并通过事务 `tr.mapping` 精确恢复旧选区坐标——frontmatter 等开头内容长度变化时正文坐标整体偏移，直接用旧坐标会漂移到错误行；滚动位置在渲染后手动恢复。全文替换前 `parserCtx` 同步解析 markdown，畸形输入抛错时必须走与成功一致的收尾（清代码/表格/全屏/补全浮层）并提示"内容无法解析，已保留原文档"，不能让异常从调用链逃逸。

## 章节折叠

标题左侧 ▾ 折叠/展开章节，折叠状态跨切换文件不泄漏（切换时重置）。折叠仅用 `display:none` 隐藏，ProseMirror 不知道折叠区不可见，因此 `sectionFold` 插件在 `handleKeyDown` 中提供三层选区守卫，改动折叠逻辑时必须保留：

- Ctrl/Cmd+A 先展开全部折叠再全选，全选语义完整，隐藏内容可一并操作；
- 选区已在隐藏区内时任何按键 clamp 回所属标题文本末尾，防止盲打；
- ↓/→（含 PageDown）从折叠标题移动时跳到隐藏区后的可见位置，↑/←（含 PageUp）从隐藏区末尾向回移动时 clamp 回标题文本末尾。

折叠范围 `[nodeEnd, end)` 依赖标题级别。setNodeMarkup（如 `#` 降级为 `##`）事务无 slice，快速路径会复用旧装饰；检测到 setNodeMarkup 且目标是 heading 时必须跳过快速路径、按新 doc 重建装饰，否则隐藏范围与真实折叠范围不一致。

## Wiki 链接

### 支持语法

- `[[目标]]`
- `[[路径/目标|别名]]`

输入闭合的 `]]` 时，输入规则会创建 `wiki_link` 节点。加载已有 Markdown 或切换文件后，`convertWikiTextInDoc()` 会把普通文本中的 Wiki 语法转换为节点；代码块和 frontmatter 内的相同文本保持原样。

### 解析和序列化

Wiki 节点保存时借助 Markdown AST 的 `html` 节点原样输出 `[[...]]`。不能改为普通文本节点，因为序列化器会转义方括号；也不能输出未注册的自定义 AST 节点，否则保存时会出现未知节点错误。

自动文本转换不是用户编辑，事务必须设置：

```typescript
tr.setMeta('addToHistory', false)
```

否则自动转换会进入撤销栈，连续撤销时会先拆除 Wiki 节点，污染用户真正的编辑历史。

### 跳转和补全

点击 Wiki 链接后，`wiki-resolver.ts` 在当前工作区中解析目标，兼容扩展名、省略扩展名、相对路径、工作区根路径和大小写不敏感的文件名匹配。自动补全候选来自当前工作区的 Markdown 文件树。

Wiki 跳转只解析现有工作区文件。目标不存在时给出提示，不自动创建文件；未打开工作区时不跨任意磁盘路径查找。

## YAML Frontmatter 属性

`frontmatter-parser.ts` 负责提取和修改文档开头由 `---` 包围的 YAML。属性面板只将零缩进、可安全往返的顶层单行标量显示为可编辑字段。Obsidian 常用的 `tags`、`aliases`、`cssclasses` 数组，以及对象、多行值、锚点、显式类型和带行内注释的属性不做结构化展开。

属性修改采用最小行级写回：更新或删除一个简单属性时，保留其他 YAML 行、注释、复杂结构以及原文的 LF/CRLF 换行。已有单双引号标量继续沿用原引号类型，防止字符串被改写成布尔值、数字或日期。复杂属性不能通过新增表单被同名覆盖；删除最后一个简单属性且只剩空行或注释时，移除整个 frontmatter 围栏。

属性面板的新增、修改和删除统一调用 `replaceEditorContent(..., 'update')`，由同一入口同步 React 会话快照和 Milkdown 内容。该路径经事务 mapping 恢复光标，frontmatter 长度变化不会导致正文光标漂移；解析失败时提示并保留原文档。不得只调用编辑器的 `replaceContent()`，否则界面状态可能在下一次异步回调前短暂分叉。

属性面板的展开状态只控制表格内容，标题栏必须始终保留，确保收起后仍能再次展开。新增属性名只允许字母、数字、下划线和连字符；需要编辑复杂 YAML 时直接在正文 frontmatter 节点中完成。

## 侧栏浏览与键盘交互

文件树与大纲正文统一使用 14px 基准字号，标题层级通过字重和颜色表达，不能通过缩小低级标题牺牲可读性。文件树节点支持 Enter 和空格执行与单击相同的打开或折叠操作；大纲项支持 Enter 跳转，并使用左右方向键展开或折叠子标题。文件、大纲标签必须保持原生按钮语义和可见焦点样式。

## 内容回调归属

Milkdown 的 `markdownUpdated` 回调带有约 200ms 防抖。切换文件后，旧文件的延迟回调仍可能到达，因此 `handleEditorChange()` 会通过 `EditorHandle.getMarkdown()` 获取当前编辑器序列化结果，并使用 `isCurrentEditorChange()` 比较：

- 回调 Markdown 与当前编辑器一致：接受并同步到当前文件。
- 两者不一致：视为旧文件延迟回调，直接丢弃。
- 编辑器尚未就绪：不以该检查阻断初始化回调。

这项校验是跨文件内容安全边界，修改监听器、防抖时间或文件切换流程时不得绕过。

## 异步文件打开

工作区文件读取是异步操作。连续点击多个文件时，磁盘读取完成顺序可能与点击顺序不同。`latestWorkspaceSelectionRef` 记录最后一次选择意图，较早请求完成后必须再次比对，只有最后选择的文件可以激活编辑器。

同一路径的在途读取通过 `openingWorkspaceFilesRef` 合并。读取完成后还要再次检查标签是否已由其他入口打开，避免单击和双击连续触发时生成重复标签。

## 回归测试

相关自动化测试：

- `src/renderer/src/lib/wiki-resolver.test.ts`
- `src/renderer/src/lib/frontmatter-parser.test.ts`
- `src/renderer/src/lib/editor-sync.test.ts`
- `src/renderer/src/lib/document-tabs.test.ts`

编辑器交互仍需手工覆盖：快速连续打开多个文件、固定预览标签后编辑、跨文件切换、连续撤销和重做、Wiki 输入与保存往返、LF/CRLF frontmatter 属性编辑；另需覆盖：保存 CONFLICT 自冲突静默成功与真外部修改确认、折叠标题上 Ctrl+A 先展开再全选、方向键不进入折叠隐藏区、mermaid 错误语法导出仍含源码文本、分散文件（未加入工作区）中粘贴图片。
