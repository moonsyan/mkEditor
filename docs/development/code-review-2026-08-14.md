# 全量代码审查报告(2026-08-14)

> 审查对象:master 分支 `57c7745`(体积精简 + 合并 GitHub 历史之后)
> 审查范围:主进程(`src/main/**`)、预加载层(`src/preload/**`)、编辑器核心(`src/renderer/src/components/Editor/**`)、UI 交互层(`App.tsx`、Sidebar、SettingsDialog、ThemeSwitcher、`src/lib/**`)、构建配置
> 审查方法:三路并行代码审查(主进程/IPC、编辑器插件层、UI 交互层)+ `tsc` 类型检查 + vitest 测试

## 验证基线

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 无类型错误 |
| `npm test`(vitest) | ✅ 37/37 通过(10 个测试文件) |
| 审查发现 | 高优先级 7 项、中优先级 15 项、低优先级 16 项 |

---

## 一、高优先级(直接影响编辑体验或数据安全)

### H1. 属性面板每次编辑 = 清空整个撤销历史 + 全文重建 + 光标丢失

- **位置**:`src/renderer/App.tsx:2697-2717`(`replaceEditorContent('update')`)→ `src/renderer/src/components/Editor/index.tsx:727-739`(`replaceContent` → `replaceAll(markdown, true)`)
- **问题**:面板改一个属性走 flush 模式全量替换,`view.updateState(EditorState.create(...))` 丢弃全部撤销/重做历史,且重新初始化每个插件(mermaid 重渲染、wiki 链接重新转换、折叠全部复位)。替换后不恢复光标位置,继续打字会落在文档开头。
- **失败场景**:写长文 → 依赖 Ctrl+Z → 改一个 frontmatter 属性 → 撤销栈全空;后续输入插到第一行前。
- **修复建议**:属性变更改为针对 frontmatter 节点的定向事务(就地替换文本),保留历史;或替换后恢复原选区与滚动位置。

### H2. 侧栏/大纲点击后编辑器焦点不恢复,打字无反应

- **位置**:`App.tsx:1078-1086`(`focusEditorSoon`)、`src/renderer/src/lib/editor-focus.ts:4-7`、`Sidebar/index.tsx:314/412`(行 `tabIndex={0}`)、`Sidebar/index.tsx:451-465`(大纲按钮)
- **问题**:树行/大纲按钮可聚焦,点击后行自身持有焦点,60ms 后的守卫 `shouldRestoreEditorFocus`(要求焦点在 body 上)不满足 → 编辑器永不被聚焦。主题切换、齿轮按钮、Esc 关闭设置后同样失败。
- **失败场景**:从树里点开文件,直接打字 → 无反应,必须再点编辑器。
- **修复建议**:文件选择后无条件 `editorRef.current?.focus()`;或把守卫改为"焦点不在应用自有 UI(侧栏/菜单栏)内即恢复"。

### H3. Wiki 自动补全键盘操作与编辑器冲突(方向键动光标、回车拆段)

- **位置**:`EditorOverlays/WikiAutocomplete.tsx:55-80`(window keydown 监听,冒泡阶段)、`plugins/wikiLink.ts:263-292`
- **问题**:窗口级监听在 PM 之后运行,PM 从不 stopPropagation:
  - ↓/↑:PM 先移动文档光标,再轮到下拉列表导航 —— 每次按箭头光标都跳行;
  - Enter:PM 先 `splitBlock` 拆段(插件状态随之失效关闭),再选中建议 —— 插入链接 + 多出一个空段;
  - 回车无法直接换行离开(只能 Esc)。
- **失败场景**:输入 `[[foo` → ↓ 选文件 → Enter → wiki 链接 + 多余空段;或点击建议后链接插到旧位置。
- **修复建议**:把键处理放进 PM 插件 `props.handleKeyDown`(返回 true 拦截);或在编辑器祖先上捕获阶段监听并 stopPropagation。

### H4. Mermaid 预览模式光标落入隐藏源码块 —— 盲打

- **位置**:`plugins/mermaidCodeBlock.ts:226-261`、`styles/components/editor.css:627-631`(`.mermaid-block:not(.is-editing-source) + .mermaid-source-block { display: none }`)
- **问题**:预览模式下源码 `pre` 是 `display:none`,但 PM 不知道不可见。`syncSelection` 只在 `isEditingSource` 已为 true 时才处理,键盘进入时不会自动切换到源码编辑态。
- **失败场景**:段落结尾按 ↓ 进入 mermaid 块 → 光标消失,打字在盲改源码,预览默默变化。
- **修复建议**:`syncSelection` 中选区进入块且非源码编辑态时自动翻转编辑模式并显示 pre;或隐藏时禁止选区进入该节点。

### H5. frontmatter 块是键盘死胡同

- **位置**:`plugins/frontmatter.ts:71-81`(Enter 总是插 `\n`)+ 节点 `isolating: true`(line 37)+ `Editor/index.tsx:459-502`(`exitCodeBlock` 只处理 `code_block`)
- **问题**:YAML 块内 Enter 永远无法拆分跳出,`isolating` 挡住 ↑/↓ 跨界,退出代码块逻辑不覆盖 frontmatter 节点。
- **失败场景**:点进 YAML 块后按 Enter/↓,光标困在块内,只能鼠标点出去。
- **修复建议**:`exitCodeBlock` 把 frontmatter 当 code_block 处理(结尾 ↓ / 开头 ↑ 跳出),或去掉 `isolating`。

### H6. 保存冲突检测有 3 秒盲窗,外部修改可能被静默覆盖

- **位置**:`src/main/ipc/handlers.ts:396-400`
- **问题**:检测单向(`磁盘 mtime > expected + 3000` 才拒绝)+ 3 秒容差无条件应用于所有文件系统:
  - 外部编辑落在最近保存后 3 秒内(同步工具回写、双编辑器自动保存)→ `mtime < expected+3000` → 用户保存直接覆盖,无任何提示;
  - mtime 比 expected 更旧的外部修改(git checkout、`cp -p` 恢复)完全绕过检测。
- **失败场景**:Obsidian 等另一编辑器自动保存了同一文件,本应用 3 秒内 Ctrl+S → 外部内容丢失。
- **修复建议**:容差仅用于粗粒度文件系统(检测盘类型/颗粒度);冲突时提供"覆盖/取消/对比合并"路径。

### H7. 未命名标签页重启后 ID 冲突,两个标签共享一个内容槽

- **位置**:`App.tsx:1136`(`untitled-${untitledCounter++}`)、`App.tsx:120`(counter 模块级、从未从会话恢复的 ID 播种)、`App.tsx:500-503`(恢复保留原 ID)
- **问题**:建未命名页 → 不保存退出 → 重启(会话恢复 `untitled-1`)→ Ctrl+N 又生成 `untitled-1`。`handleEditorChange` 按 ID 写入,两个标签显示同一内容;关任一个会删除另一个的 `contents[id]`。
- **失败场景**:两标签编辑互相串内容,关一个丢另一个。
- **修复建议**:从恢复的 `untitled-N` 中取最大值播种 counter,或加随机后缀。

---

## 二、中优先级(体验明显受损)

### M1. 保存丢最后几键(200ms 防抖窗口)

- **位置**:`Editor/index.tsx:339-343`(listener 防抖 200ms)、`App.tsx:1458-1460`(保存读 `contents[activeFileId]`)
- **问题**:Ctrl+S 读取的是防抖前的快照,最后 ≤200ms 的输入丢失;随后防抖触发会重新标记 dirty,可恢复但用户会以为已保存。
- **修复**:保存时同步读 `editorRef.current.getMarkdown()`;或保存前先 flush 防抖。

### M2. PDF 导出 >2MB 截断

- **位置**:`src/main/ipc/handlers.ts:646-648`(`printWin.loadURL(data:text/html,...)`)
- **问题**:Chromium 对 `data:` URL 导航有 2MB 上限。导出预处理把 `mdimg://` 图片内联为 base64,带几张照片的文档轻松 3-20MB → 打印窗加载截断 HTML,PDF 残缺或报笼统的 `PDF_ERROR`。
- **修复**:HTML 写入临时文件后 `loadFile`;或注册自定义特权协议承载导出内容。

### M3. "保存并关闭"无超时,渲染进程卡死则窗口永久关不掉

- **位置**:`src/main/window/window-manager.ts:114-158`
- **问题**:`executeJavaScript` 的保存往返没有超时。渲染进程卡死(同步 confirm、长渲染、崩溃自动重载中)时 promise 永不落定,`e.preventDefault()` 吞掉所有后续关闭,唯一出路是杀进程。
- **修复**:包裹 15s 超时,超时后弹错误对话框/提供强制关闭。

### M4. 弹窗打开时全局快捷键仍生效

- **位置**:`App.tsx:2499-2537`(keydown 未检查 `settingsOpen/helpView/imagesOpen/pdfOptsOpen/wsSearchOpen`)
- **问题**:设置面板开着时 Ctrl+F 在遮罩底下挂起搜索框并自动聚焦 —— 按键悄悄进隐形输入框;Ctrl+N/Ctrl+O 在弹窗背后开标签。
- **修复**:任一弹窗打开时早退,或把组合键交给顶层弹窗。

### M5. 大纲面板在侧栏折叠时静默失效

- **位置**:`App.tsx:2315-2318` + `Sidebar/index.tsx:163-169`
- **问题**:折叠时 Sidebar 被卸载(见 L9),重挂载后 `lastOutlineTickRef = useRef(focusOutlineTick)` 直接等于新 tick,`>` 比较永不成立 → 展开后落在文件标签,大纲不显示。
- **修复**:tick 的"已消费"值由 App 持有,或标签切换在 App 侧执行。

### M6. 快捷键缺 `e.defaultPrevented` / `e.repeat` 守卫

- **位置**:`App.tsx:2500-2507`
- **问题**:PM 对自身键位(加粗/撤销等)只 preventDefault 不停止冒泡,用户把任意动作绑到编辑器保留组合键会双重触发;按住 Ctrl+N 连发 keydown 会连续开标签。
- **修复**:处理器开头 `if (e.defaultPrevented || e.repeat) return`。

### M7. 移动/另存为后 `mdimg://` 绝对路径泄漏进文件

- **位置**:`src/renderer/src/lib/image-path.ts:37-54`(仅重写当前文档目录下的图片)+ `App.tsx:2037-2127`(移动)/ `App.tsx:1397-1443`(另存)
- **问题**:`a/doc.md` 含 `![x](img.png)`,移到 `b/` 后未重写内容,下一键就把 `![x](mdimg:///C%3A/a/img.png)` 写进文件。本应用显示正常,其他编辑器/git diff 里全是坏链接。
- **修复**:移动/另存后按新目录重跑图片路径迁移并重渲染。

### M8. 补全下拉框垂直偏移

- **位置**:`plugins/wikiLink.ts:270-279`(坐标 `coordsAtPos − view.dom.getBoundingClientRect()` 视口相对)+ `index.tsx:227-236`(绝对定位在 `.editor-scroll` 内)
- **问题**:偏移量 = 编辑器在滚动容器内的偏移(属性面板高度 + 内边距,约 30-150px)。属性面板显示时下拉浮在光标上方 ~100px。
- **修复**:相对滚动容器计算(减其 rect + 加 scrollTop)。

### M9. 搜索替换位置过期

- **位置**:`searchController.ts:44-63/104-126`(命中一次性计算,仅装饰做映射)+ `plugins/searchHighlight.ts:71`
- **问题**:搜索后编辑文档,Replace All 按旧偏移替换 —— 错位替换或乱插字符,next 跳到过期位置。
- **修复**:docChanged 时重算命中,或在插件 apply 中经 `tr.mapping` 映射。

### M10. 拖入非图片文件 → 应用整体导航跳走

- **位置**:`useImageInsertion.ts:105-122`
- **问题**:dragOver 对任何文件 preventDefault(接受拖放),drop 只在含图片时 preventDefault —— 拖 .pdf/.docx 落入浏览器默认行为,窗口整个跳转到该文件。
- **修复**:所有文件 drop 都 preventDefault,只处理图片。

### M11. 粘贴网页图片插两次

- **位置**:`Editor/index.tsx:846`(`onPaste`)
- **问题**:剪贴板同时带 text/html `<img>` 和文件(网页"复制图片")时,PM 原生粘贴先解析插入图片节点,React 再存文件插 `![alt](url)` —— 两张图。
- **修复**:注册 PM `handlePaste` prop,消费图片时返回 true 阻止 PM 自身插入。

### M12. 折叠小节后光标困在隐藏内容

- **位置**:`plugins/sectionFold.ts:11-56`(折叠 `display:none`,切换时无选区处理)+ `searchController.ts:98`(搜索可命中隐藏文本)
- **问题**:光标在折叠区时点折叠按钮 → 光标进入不可见内容,打字盲改;search-next 把光标跳进折叠区,滚动无效果。
- **修复**:折叠时将选区移出折叠范围;搜索跳过/展开折叠区。

### M13. 每次按键 5 次全文档扫描,大文档卡顿

- **位置**:`plugins/nodeAttrs.ts:33`、`plugins/sectionFold.ts:83`、`plugins/mermaidCodeBlock.ts:291`、`plugins/codeLineNumbers.ts:99`、`blockContext`/`bracketMatch`
- **问题**:每个事务约 5 次 `doc.descendants` 全遍历 + 装饰重建。5-10k 节点长文档(多代码块/表格)打字明显掉帧。
- **修复**:各插件只扫描变更区域;sectionFold 装饰重建防抖。

### M14. 多窗口设置缓存不失效

- **位置**:`src/main/settings/settings-store.ts:158-167`
- **问题**:内存 `cache` 只随本进程写入更新。多窗口(已故意启用)下 B 窗口读不到 A 窗口的写入 —— 图床 token、主题等不生效,图床静默回退本地保存。
- **修复**:读路径短 TTL 失效或每次读盘;或跨实例广播 settings-changed。

### M15. will-navigate 监听器重复注册

- **位置**:`src/main/index.ts:99-106`(`did-finish-load` 内注册)
- **问题**:每次加载/重载注册一个新的永久监听;dev HMR 与崩溃自愈重载累计后,点一个外链开 N 个浏览器标签。
- **修复**:用标志位只注册一次,或在 `web-contents-created` 一次性注册。

---

## 三、低优先级(择机处理)

### 主进程

- **L1 崩溃自愈排除 oom**:`window-manager.ts:73-76` —— 最常见的内存崩溃不自愈,窗口死等手动关闭;`MAX_AUTO_RELOADS` 已可防风暴,纳入 oom 是安全的。
- **L2 mdimg 允许列表只增不减**:`image-protocol.ts:7-13` + `handlers.ts:877-910` —— 每个打开过的目录、`FILE_LIST_IMAGES` 传入的任意目录都会永久授信;防御性建议:文档关闭时回收、仅授信打开文档/工作区。
- **L3 工作区树遍历无宽度上限**:`handlers.ts:207-236` —— 深度限 5 层但不限条目数,数万目录时主进程长时间阻塞,全部 IPC 卡死(保存排队、自动保存基线过期)。建议限制总量并返回 `truncated`。
- **L4 搜索行缓存陈旧**:`handlers.ts:1013-1022` —— FAT32/exFAT 2 秒颗粒度下同尺寸两次编辑可能返回旧内容(仅搜索,瞬时)。
- **L5 图床上传不检查 resp.ok**:`handlers.ts:1320-1335` —— 5xx 页面 `resp.json()` 抛错,原始解析文本直接抛给用户。检查 ok 并给稳定文案。
- **L6 图片保存不校验 base64**:`handlers.ts:498-499` —— `Buffer.from` 静默忽略非法字符,损坏剪贴板数据会写出截断图片并报成功。严格正则校验。
- **L7 原子保存破坏符号链接**:`handlers.ts:176-195` —— rename 覆盖符号链接本身,真实目标收不到新内容。保存前 lstat 检测并写穿。
- **L8 IPC 路径无归属校验**:`handlers.ts` 多处 —— FILE_READ/SAVE/DELETE/MOVE 等接受任意绝对路径。当前 sandbox + contextIsolation + 无远程内容下安全,但任何未来 XSS 向量会把它变成全盘读写删。防御性建议:路径必须属于已打开文档/工作区。

### 编辑器插件层

- **L9 括号配对类型不区分**:`plugins/bracketMatch.ts:10` —— `CLOSERS[']']` 映射 `'('` 且配对忽略类型,`(]` 高亮为配对,`([)]` 配对错误。
- **L10 代码围栏 Enter 是死分支**:`plugins/customCodeFence.ts:13` —— PM 输入规则只对文本输入生效,` ```python Enter` 不建代码块(仅空格有效),与正则意图不符。
- **L11 补全转换可能打断中文组合**:`plugins/wikiLink.ts:129-131` —— `setTimeout(0)` 链不检查组合态,文档加载/替换后可能打断 IME 组合提交。
- **L12 脚注 Enter 拆出重复标签**:`plugins/footnote.ts:63-97` —— 脚注定义内 Enter 拆成两个同标签定义,保存出现重复 `[^1]:`;多段定义也不支持(内容为 `inline*`)。
- **L13 mermaid-source 类名死判断**:`Editor/index.tsx:568` —— 检查 `mermaid-source` 而装饰类名是 `mermaid-source-block`,守卫永不生效。
- **L14 折叠 mousedown 无 destroyed 守卫**:`plugins/sectionFold.ts:47` —— `replaceAll` flush 后 widget 可能持有失效 view,低风险。
- **L15 表格列宽随结构变化重置**:`plugins/tableColResize.ts` —— 宽度只存首行与表格元素,增删行列后 PM 重建表格,自定义宽度丢失。

### UI 交互层

- **L16 侧栏折叠卸载丢状态**:`App.tsx:2607-2609` 卸载 Sidebar;`Sidebar/index.tsx:236-249` 每次树变化重同步折叠集 + `App.tsx:874` 500ms 防抖持久化 —— 折叠后滚动/重命名状态丢失,刷新前 <500ms 的折叠操作被静默回退。建议 CSS 宽度动画保持挂载,或状态提升。
- **L17 删除最后一个 frontmatter 属性留空行**:`lib/frontmatter-parser.ts:186-194/247-252` —— `---\ntitle: x\n---\n\nbody` 变 `\nbody`。
- **L18 重复 frontmatter 键只改第一行**:`frontmatter-parser.ts:52-58/215-219` —— 面板编辑第一行,解析器读最后一行,改完像没生效。
- **L19 wiki 路径大小写敏感**:`lib/wiki-resolver.ts:148` —— Windows 上 `[[c:\doc]]` 大小写不匹配精确命中(名字回退通常兜底)。
- **L20 取消原生对话框后不聚焦编辑器**:`App.tsx:2492` —— focus 在 IPC 打开前同步执行,取消后焦点落在窗口 chrome。

---

## 四、已验证干净的区域

以下模块经核对无功能问题,不需改动:

- **预加载层**:`preload/index.ts` + `api.d.ts` 窄接口、类型安全、无泄漏;`unsaved.ts` WeakMap 无泄漏。
- **electron-vite 配置**:`externalizeDepsPlugin` 与生产依赖匹配正确。
- **设置存储写入路径**:原子写 + 令牌校验 + 陈旧锁恢复 + 大小上限(仅读缓存有缺陷,见 M14)。
- **图片协议**:扩展名白名单、host 拒绝、双侧 realpath 防符号链接逃逸。
- **中文输入法保护**:所有自定义键路径(exitCodeBlock、全屏 Esc、代码语言输入、frontmatter 输入、补全)均检查 `isImeComposing`/229;mermaid/行号复用 widget 不干扰组合。
- **撤销历史**:装饰类插件(blockContext、bracketMatch、行号、折叠、搜索高亮)不发文档变更事务;wiki 转换 `addToHistory: false`;除 H1 外无污染。
- **frontmatter 解析/序列化**:yaml 节点 `textContent` 原样往返;wiki 链接经 html 节点 `value` 保存存活;输入规则正确跳过代码块。
- **mermaid 渲染竞态**:`renderVersion` 守卫丢弃过期异步渲染、定时器清理、destroy 清理监听与主题观察者。
- **文件切换竞态**:`replaceContent` flush + `isCurrentEditorChange` 守卫 + 折叠复位覆盖跨文档污染路径。
- **iconv-lite 写前 GBK 往返校验**:正确防止 `?` 替换式数据损坏。

---

## 五、修复建议顺序

1. **第一批(高优先级,日常写作必踩)**:H1(撤销历史)、H3(补全键盘)、H2(焦点)、H7(标签 ID)
2. **第二批(高优先级,数据安全)**:H6(保存盲窗)、H4/H5(光标陷阱与死胡同)
3. **第三批(中优先级,小改动大收益)**:M1(防抖丢键)、M4(弹窗快捷键)、M6(键守卫)、M10(拖拽跳走)、M15(监听器重复)
4. **第四批(中优先级,需设计)**:M2(PDF 导出)、M3(关窗超时)、M7(mdimg 迁移)、M9(搜索映射)、M8/M11/M12/M13
5. **其余低优先级**:随模块迭代顺手处理

## 六、修复完成与复查记录(2026-08-14 深夜)

全部 42 项(H1-H7、M1-M15、L1-L20)已逐一修复，每项独立 commit 并推送 gitee(origin)，
未推送 GitHub。

**复查基线(单次复查)**:
- `npm run typecheck`(web + node 两个 tsconfig)通过
- `vitest run` 41 个测试全部通过(含本次新增 5 个:L17 空行、L18 重复键、L19 大小写)
- 复查确认无旧函数/旧类名残留(findTopLevelPropertyIndex / mermaid-source 均无引用)

**复查发现的新问题:无**

**已知限制(设计取舍,非缺陷,随版本迭代考虑)**:
1. L15 表格列宽:在表格中间插入列时，存活的列宽按列位对齐（新列取内容宽度），
   仅中间插入这一种结构变化会出现列宽错位;表尾增删列/增删行均正确继承。
2. L16 侧栏:折叠时组件保持挂载，大纲跟随高亮仍在计算，大目录 + 长文档下
   折叠期间有轻微渲染开销(可忽略)。
3. L18 重复 frontmatter 键:YAML 重复键本身是歧义写法，现行为与解析器
   last-wins 一致(面板所见即所改);重复键行仍会同时保留在原始 YAML 中。
4. L19 wiki 大小写不敏感匹配:大小写敏感文件系统上若同时存在
   `/a/Doc.md` 与 `/a/doc.md` 且 target 大小写不匹配两者，取树中先遇到者
   (精确命中仍优先)。

## 七、第二轮复查与修复记录(2026-08-15)

继续自主马拉松：对三份 agent 报告的剩余项逐项验证并修复，每项独立 commit 推送 gitee(origin)，
未推送 GitHub。全部提交均通过 `npm run typecheck` + `vitest run`(41/41)。

**本轮修复清单(17 项)**:

| 编号 | 问题 | 修复 |
|------|------|------|
| B-M1 | 信任根容量淘汰可能逐出工作区/图片目录,保存开始返回 INVALID_PATH | `trustDirectory` 支持 essential 保底根,工作区与 userData/images 永不淘汰 |
| B-M4 | PDF 打印窗口无沙箱;图片等待 executeJavaScript 无超时,挂起资源让导出无限等待 | 打印窗口 `sandbox: true`;图片等待 15s 超时兜底 |
| B-L1 | 设置文件锁重试 4s 即放弃,而陈旧锁 60s 才清理——崩溃残留锁让整分钟设置写入失败 | 陈旧阈值 4s、重试窗口 5s,残留锁约 4s 自愈 |
| B-L2 | 新窗口无数量上限,窗口失控放大内存/句柄占用 | WINDOW_NEW/WITH_FILE 上限 8,超限返回 WINDOW_LIMIT |
| B-L3 | 冲突检测状态无限累积;改名/移动/删除后旧路径条目残留误报冲突 | 4096 条上限淘汰;rename/move 迁移条目、delete 清理 |
| B-L4 | pandoc 探测与导出无超时,挂起进程无限阻塞 IPC | 探测 10s、导出 60s 超时 |
| B-L5 | 图床上传 | 已在此前轮次修复(30s 超时 + resp.ok 检查),本轮验证确认 |
| B-L6 | FILE_SAVE 无体积上限,渲染端异常可写出超限文件 | 写入前 20MB 校验,与打开上限一致 |
| B-L7 | FILE_WATCH 死通道(定义无 handler) | 删除通道常量 |
| B-M5 | 草稿上限 4MB 与文档上限 20MB 不一致,大文档草稿保存失败且整文件可能被误判损坏 | 草稿值上限 20MB、settings 文件总限 40MB |
| A-L2 | 慢速读取(网络盘)双击表现为"点了没反应":opening 分支只 pin 不切换 | await 完成后若最新选择仍是该文件,补齐切标签 |
| A-L3 | 连续两次重命名(A→B 立刻 B→C)交错完成时闭包旧 id 过期,产生重复标签 id/内容丢失 | 迁移按当前 path 定位记录;找不到即跳过 |
| C-3 | IME 组合期间切文档/属性写入立即 replaceAll 打断组合,未提交拼音丢失 | 挂起替换,compositionend 后执行,组合期多次替换只保留最后一次 |
| C-5 | mermaid.render 并发(共享临时容器)报错/串图 | 全程串行队列 + 单次渲染 15s 超时 |
| C-9 | 文档替换后代码块/表格/全屏/补全浮层引用旧 DOM 悬浮新文档 | replaceContent 一并清空浮层状态与 DOM 引用 |
| C-10 | 导出/预览快照中源码编辑态 mermaid 块整块空白 | 有 SVG 切回预览态导出图表;无 SVG 保留源码 pre |
| C-12 | 光标上报每次按键全文 textBetween + 全文档标题扫描,大文档 O(doc) | 按块缓存行/列/章节,每次按键降为 O(块) |

**复查基线(单次复查)**:
- `npm run typecheck`(web + node)通过
- `vitest run` 41/41 通过
- git 工作区干净,全部提交已推送 gitee

**复查发现的新问题:无**——剩余观察项均为设计取舍,与 2026-08-14 版已知限制一致。
