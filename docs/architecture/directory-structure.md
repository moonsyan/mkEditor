# 目录结构

> 2026-08-11：会话与草稿 Hook 位于 `src/renderer/src/hooks/`；编辑器图片与搜索模块位于 `src/renderer/src/components/Editor/`，并与 `plugins/` 中的 ProseMirror 插件分层。
>
> `hooks/` 新增 `useDocumentSessionPersistence.ts`、`useDraftPersistence.ts`、`useEditorViewState.ts`；`Editor/` 新增 `useImageInsertion.ts`、`searchController.ts` 与 `EditorOverlays.tsx`。

> 更新基线：2026-08-11。以下是当前实际目录，不包含历史目标架构中的 `features/`、`core/`、`ports/` 或 Zustand slice。

```text
src/
  main/
    index.ts                  应用生命周期、协议与外链策略
    ipc/handlers.ts           文件、工作区、导出、设置与图床 IPC
    settings/settings-store.ts 设置持久化
    window/window-manager.ts  窗口创建、崩溃自愈与关闭确认
  preload/
    index.ts                  contextBridge 桥接
    api.d.ts                  DesktopAPI 类型声明
  renderer/
    main.tsx                  React 入口
    App.tsx                   应用编排和会话状态
    src/
      components/             编辑器、侧栏、菜单、对话框等 UI
      hooks/                  可复用 React 状态逻辑
      lib/                    草稿、标签状态、键盘、图片路径、PDF、统计等纯工具及其单元测试
      data/                   演示文件与默认快捷键
      styles/                 全局、主题与组件 CSS
  shared/ipc/channels.ts      跨进程 IPC 常量
docs/                         项目说明，按 product / architecture / development 分组并由 _index.md 进入
develop/                      开发者学习资料
resources/                    图标等发布资源
```

## 命名和放置规则

- React 组件目录使用 PascalCase，入口为 `index.tsx`；其专属样式放在 `styles/components/`。
- 编辑器扩展放在 `components/Editor/plugins/`，并由 `Editor/index.tsx` 集中注册。
- 可复用 React 生命周期逻辑放 `hooks/`；不依赖 React 的转换与数据逻辑放 `lib/`。
- `lib/` 中的 `*.test.ts` 使用 Vitest 运行；标签打开、编辑、切换、关闭与恢复原文，以及大纲解析的长文档路径必须优先在此覆盖。
- 新 IPC 通道先写入 `shared/ipc/channels.ts`，再同步实现 main handler、preload API 和 `api.d.ts`。
- `out/`、`release/`、`node_modules/` 是生成目录，不提交也不作为源码修改位置。
