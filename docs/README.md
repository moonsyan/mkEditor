# MarkdownSoft 文档索引

> 更新基线：2026-08-11。本文档以仓库已落地的代码为准；计划性内容会明确标注，不再与当前实现混写。

MarkdownSoft 是一个本地优先的桌面 Markdown 编辑器。应用使用 Electron 43、React 18、TypeScript 严格模式和 Milkdown 7 构建，支持 Windows、macOS 与 Linux。

## 项目文档

- [项目概述](./project-overview.md)：目标、边界和已实现能力。
- [架构说明](./architecture.md)：主进程、预加载层、渲染进程与安全边界。
- [目录结构](./directory-structure.md)：当前代码目录及职责。
- [技术选型](./tech-stack.md)：运行时、依赖、构建和测试现状。
- [功能规格](./feature-spec.md)：关键用户流程、限制和验收要点。
- [组件指南](./component-guide.md)：React 组件、编辑器、hook 与工具模块。
- [主题定制](./theme-guide.md)：CSS 变量和主题扩展规则。
- [快捷键参考](./keyboard-shortcuts.md)：默认快捷键与使用限制。
- [维护指南](./maintenance-guide.md)：常见维护任务与构建方式。
- [Typora 对比](./typora-comparison.md)：产品差异参考，不作为功能承诺。

开发规范见仓库根目录的 [项目开发规范](../项目开发规范.md)，开发者学习资料见 [develop/](../develop/README.md)。
