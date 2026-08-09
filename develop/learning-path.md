# 学习路径与后续发展建议

> 给你一条清晰的学习路线，以及项目后续可以做什么。

---

## 一、推荐学习顺序

### 第 1 步：先跑起来（1 小时）
```bash
cd D:\project\markdown\mk-editormkEditor
npm install
npm run dev
```
看看应用长什么样，自己用一下，了解核心功能。

### 第 2 步：读懂架构（2 小时）
1. 读 `develop/README.md` — 全局概览
2. 读 `develop/architecture.md` — 理解数据流
3. 读 `develop/file-index.md` — 知道代码在哪

### 第 3 步：补前端基础（1-2 周）
1. 读 `develop/react-primer.md` — React 概念（一天能看懂核心）
2. 读 `develop/electron-primer.md` — Electron 概念（一天）
3. 读 `develop/tech-stack.md` — 技术栈速查
4. 读 `develop/milkdown-editor.md` — 编辑器原理

### 第 4 步：动手实践（持续）
1. 找一个已知 Bug（如 U3 已修复，参考它的修复方式）
2. 尝试加一个小功能（如加一个快捷键）
3. 逐步深入

---

## 二、作为 Java 开发者的优势与差距

### 你的优势
- **异步编程**：Java 有 `CompletableFuture`，TS 有 `async/await`，思路一样
- **类型系统**：TypeScript 比 Java 弱，但概念相似（interface、泛型）
- **OOP 思维**：React 组件就是 Java 类，Props 就是构造参数
- **架构理解**：主进程/渲染进程 ≈ 服务端/客户端，概念相通

### 你需要补齐的
- **React 编程范式**：从"命令式"到"声明式"的思维转换
- **事件驱动**：浏览器/JS 全是回调，不是调用栈
- **CSS 布局**：Flexbox/Grid 是必须掌握的
- **npm 生态**：包管理、版本兼容、依赖树

---

## 三、项目后续发展方向

### 短期（1-2 个月）
1. **完善已知功能**
   - B4 拼写检查多语言（引入 cspell）
   - 导出 PDF 增加页眉页脚选项
   - 搜索增加"全字匹配"选项

2. **体验优化**
   - 代码块增加行号显示（开关）
   - 图片拖拽上传直接显示（当前已支持，但体验可优化）
   - 搜索栏增加"替换全部"按钮

### 中期（3-6 个月）
1. **导出增强**
   - 接入 pandoc，支持导出 Word/LaTeX/纯文本
   - PDF 增加目录页、页眉页脚、纸张尺寸选择

2. **图片管理**
   - 接入图床（SM.MS、阿里云 OSS），粘贴直接上传
   - 图片压缩（导出时自动压缩大图）

3. **写作辅助**
   - 写作统计可视化（柱状图/折线图）
   - 写作目标设定与提醒

### 长期（6 个月+）
1. **云端同步**
   - 接入 Git 仓库同步
   - 或接入第三方云存储

2. **插件系统**
   - 支持用户自定义插件
   - 内置插件市场

3. **协作编辑**
   - CRDT 冲突解决
   - 实时协作（WebSocket）

---

## 四、技术债务与改进建议

### 4.1 代码结构
- `App.tsx` 1900 行，建议按功能拆分为多个 Hook（如 `useFileManagement`、`useSession`）
- 部分逻辑在组件内，可提取为自定义 Hook

### 4.2 测试
- 项目目前没有自动化测试
- 建议优先为 IPC 处理器写测试（纯函数，好测）
- 再用 Jest + Testing Library 测 React 组件

### 4.3 类型安全
- 部分 `unknown` 类型可进一步收窄
- 建议引入 Zod 做运行时类型校验

### 4.4 性能
- 文件树递归扫描可加缓存（路径不变时不重复扫描）
- 草稿持久化可改用 IndexedDB（避免 JSON 文件过大）

---

## 五、常见问题速查

| 问题 | 答案 |
|------|------|
| 怎么改主题颜色？ | 编辑 `src/renderer/src/styles/themes/xxx.css` |
| 怎么加新快捷键？ | 编辑 `src/renderer/src/data/shortcuts.ts` |
| 怎么加新菜单项？ | 编辑 `src/renderer/src/components/MenuBar/index.tsx` |
| 怎么加新设置项？ | 在 `settings-store.ts` 加读取逻辑，在 `SettingsDialog` 加 UI |
| 怎么调试 IPC？ | 在 `handlers.ts` 加 `console.log`，看终端输出 |
| 怎么打开 DevTools？ | 开发模式按 `Ctrl+Shift+I` |
| 怎么构建安装包？ | `npm run build:win`，产物在 `release/` |

---

## 六、推荐资源

### React
- [React 官方文档](https://react.dev)（中文版）
- [React 入门实战教程](https://reacttraining.com)（英文）

### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- 项目本身就是最好的学习材料（代码注释很详细）

### Electron
- [Electron 官方文档](https://www.electronjs.org/docs)
- 本项目架构已符合 Electron 最佳实践

### Milkdown
- [Milkdown 文档](https://milkdown.dev)
- [ProseMirror 指南](https://prosemirror.net/guide)（深入理解编辑器）

---

## 七、总结

这个项目整体架构清晰，代码质量不错（防御性设计、注释详细、已知问题记录完整）。

**作为 Java 开发者，你已经具备了核心能力**（异步、类型系统、架构思维），只需要补齐前端范式（React 声明式、CSS 布局）就能上手维护。

**建议**：先跑起来，读 `README.md`，然后从修复一个小 Bug 开始，边做边学。
