# 维护指南

> 更新基线：2026-08-11。项目使用 npm，不使用 pnpm。

## 常用命令

```bash
npm ci
npm run dev
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
5. 修改标签、保存状态或快捷键时，先运行 `npm run test`；再运行 `npm run build`。
6. 修改交互、文件或编辑器功能时，运行 `npm run dev` 完成冒烟验证；覆盖打开、编辑、切换、关闭、恢复原文和中文输入法候选词操作。

## 不应直接修改的内容

- 不要在渲染进程直接使用 Node.js 文件系统 API。
- 不要删除 `preload/` 或暴露通用 IPC 调用。
- 不要编辑 `out/`、`release/`、`node_modules/`。
- 不要将图床 token、用户路径、草稿或设置文件提交到仓库。
