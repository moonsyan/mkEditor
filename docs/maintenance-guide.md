# 维护指南

> 面向不熟悉 React 和 TypeScript 的维护者。

## 你需要知道的基础概念

### 项目是什么

这是一个 **Electron 桌面应用**，本质是一个打包成桌面程序的网页。你看到的界面和网页一样，用 HTML + CSS + JavaScript 构建。

### 三个关键区域

```
┌──────────────────────────────────────────────┐
│  Main Process（后台）                         │
│  负责：文件读写、窗口管理、系统菜单            │
│  语言：TypeScript (Node.js)                  │
├──────────────────────────────────────────────┤
│  Preload（桥梁）                              │
│  负责：安全地连接 Main 和 Renderer            │
│  语言：TypeScript                            │
├──────────────────────────────────────────────┤
│  Renderer（界面）                             │
│  负责：你看到的一切 UI                        │
│  语言：TypeScript + React + CSS              │
└──────────────────────────────────────────────┘
```

### 文件类型速查

| 后缀 | 是什么 | 你需要关心吗 |
|------|--------|-------------|
| `.css` | 样式文件，控制外观 | 改颜色/间距看这里 |
| `.html` | 页面结构 | 一般不需要改 |
| `.tsx` | React 组件（UI） | 改界面逻辑看这里 |
| `.ts` | TypeScript 代码 | 改业务逻辑看这里 |
| `.json` | 配置文件 | 改依赖/脚本看这里 |

---

## 常见维护任务

### 修改颜色 / 主题

**这是最简单的修改，只需要懂 CSS。**

1. 打开 `src/renderer/src/styles/themes/` 目录
2. 选择要修改的主题文件（如 `default.css`）
3. 修改颜色值

```css
/* 例：把背景色改得更白一点 */
--bg-app: #FFFFFF;  /* 原来是 #F7F5F2 */
```

4. 保存，重启 `pnpm dev` 查看效果

详细指南见 [主题定制](./theme-guide.md)。

### 修改界面文字

界面文字分散在各组件中：

| 要改什么 | 去哪里找 |
|---------|---------|
| 菜单栏文字 | `components/MenuBar/index.tsx` |
| 状态栏文字 | `components/StatusBar/index.tsx` |
| 侧栏标签 | `components/Sidebar/index.tsx` |
| 默认文档内容 | `components/Editor/index.tsx` |

搜索中文关键字即可定位。

### 添加新的菜单项

1. 打开 `components/MenuBar/index.tsx`
2. 找到对应的菜单分组（文件/编辑/段落/视图/帮助）
3. 在 `dropdownItems` 数组中添加新项：

```tsx
{
  label: '新功能',
  shortcut: 'Ctrl+Shift+N',
  action: 'newFeature'
}
```

4. 在 `App.tsx` 的 `handleAction` 函数中添加对应的处理逻辑

### 添加新的快捷键

1. 打开 `App.tsx`
2. 找到 `useEffect` 中的 `keydown` 事件监听
3. 添加新的条件分支：

```tsx
if (e.ctrlKey && e.key === 'n') {
  e.preventDefault()
  handleAction('newFeature')
}
```

### 修改侧栏宽度

打开 `src/renderer/src/styles/global.css`（或对应的 CSS 变量文件），修改：

```css
--sidebar-w: 260px;  /* 改为你想要的宽度 */
```

---

## 开发命令

```bash
# 安装依赖（首次或依赖变更后）
pnpm install

# 启动开发模式（修改代码自动刷新）
pnpm dev

# 构建生产版本
pnpm build

# 运行测试
pnpm test
```

---

## 项目结构速查

```
src/
├── main/          后台逻辑（文件读写、窗口管理、IPC 注册）
├── preload/       安全桥梁（一般不需要改）
├── renderer/      界面（最常修改的部分）
│   └── src/
│       ├── components/   UI 组件（改界面看这里）
│       │   ├── MenuBar/       菜单栏
│       │   ├── Sidebar/       文件树 + 文档大纲
│       │   ├── Editor/        Milkdown 编辑器（含搜索/图片/代码块操作层）
│       │   ├── StatusBar/     状态栏（字数/行/列/保存状态）
│       │   ├── ThemeSwitcher/ 主题切换按钮
│       │   ├── SearchBar/     查找替换栏
│       │   ├── SettingsDialog/ 设置弹窗
│       │   ├── HelpDialog/    帮助弹窗（快捷键/语法/统计/关于）
│       │   └── ImagesDialog/  图片管理面板
│       ├── data/        演示文件树数据源
│       └── styles/      样式（改外观看这里）
│           ├── global.css        全局样式、Reset
│           ├── variables.css     CSS 变量（主题 token）
│           ├── typography.css    排版样式
│           ├── themes/           主题定义（default/dark/ocean/rose）
│           └── components/       组件级样式
└── shared/        共享类型（IPC 通道常量，一般不需要改）
```

---

## 注意事项

### 不要做的事

1. **不要在 Renderer 中直接使用 `require('fs')`** — Electron 安全模型禁止这样做，文件操作必须通过 IPC
2. **不要删除 `preload/` 目录** — 它是安全桥梁，删除后应用无法正常工作
3. **不要修改 `tsconfig.json` 除非你理解它** — 错误的配置会导致编译失败

### 安全修改范围

以下文件可以安全修改，不会影响系统稳定性：

- `src/renderer/src/styles/` 下的所有 CSS 文件
- `src/renderer/src/components/` 下的组件文字和布局
- `src/renderer/App.tsx` 下的菜单动作分发逻辑（handleAction switch 语句）
- `docs/` 下的所有文档

### 需要谨慎的修改

- `src/main/` 下的文件 — 涉及文件读写安全
- `src/preload/` 下的文件 — 涉及安全边界
- `src/renderer/App.tsx` — 涉及文档状态机、会话/草稿持久化
- `package.json` 中的依赖版本

---

## 调试技巧

1. **打开开发者工具**：在开发模式下按 `Ctrl+Shift+I`
2. **查看 Console 日志**：`console.log()` 会输出到开发者工具
3. **检查元素**：右键点击界面元素 → 检查，可以看到对应的 CSS
4. **实时预览**：`pnpm dev` 模式下，修改代码后界面自动刷新

---

## 相关文档

- [组件指南](./component-guide.md) — 每个组件的职责和使用方式
- [主题定制](./theme-guide.md) — 如何新增和修改主题
- [目录结构](./directory-structure.md) — 完整的目录说明
- [架构说明](./architecture.md) — 系统架构详解
