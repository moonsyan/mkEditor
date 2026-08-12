# 技术选型

> 更新基线：2026-08-11。

| 领域 | 当前选择 | 说明 |
| --- | --- | --- |
| 桌面运行时 | Electron 43 | 文件对话框、窗口、打印、回收站和自动更新能力。 |
| 构建 | electron-vite 2 + Vite 5 | 分别构建 main、preload 与 renderer。 |
| UI | React 18 | `App.tsx` 编排会话，局部状态使用 Hooks。 |
| 语言 | TypeScript 5，`strict` | IPC 与组件边界维持明确类型。 |
| 编辑器 | Milkdown 7 + ProseMirror | CommonMark、GFM、历史记录与命令式编辑接口。 |
| 富内容 | KaTeX、Mermaid、Prism | KaTeX 在初始化阶段注册；Mermaid 代码块按需加载 SVG 渲染器。 |
| 样式 | CSS Variables + 原生 CSS | 四套内置主题与导入自定义 CSS。 |
| 打包 | electron-builder 25 | Windows NSIS、macOS DMG、Linux AppImage。 |
| 依赖管理 | npm + package-lock.json | CI 使用 `npm ci` 和 Node.js 20。 |

## 现状说明

- 当前已配置 Vitest，覆盖标签状态、输入法与快捷键作用域、焦点恢复、图片路径、大纲和搜索高亮等基础逻辑。每次改动至少执行 `npm run typecheck`、`npm run test` 与 `npm run build`；交互修改还需要 `npm run dev` 冒烟验证。ESLint、Prettier 和 Playwright 尚未配置。
- `electron-updater` 已集成，但 `package.json` 中的更新 URL 仍是示例地址。未配置真实服务前，不能将自动更新视为可用功能。
- `pandoc` 导出 Word、EPUB、LaTeX 与纯文本依赖用户系统安装 pandoc；HTML 和 PDF 不依赖该工具。
