---
type: knowledge
tags:
  - markdown编辑器
  - electron
  - 安全
  - ipc
created: 2026-08-06
---
# Electron 安全架构

> 标签：#markdown编辑器 #electron #安全 #ipc
> 日期：2026-08-06

## 威胁模型

Markdown 文件、粘贴的 HTML、图片元数据、链接、Mermaid 内容和第三方主题都属于不可信输入。只要 renderer 中发生 XSS，如果它能直接调用 Node 或任意 IPC，就可能读取或修改本机文件。

因此安全目标不是“本地应用不用防攻击”，而是即使 renderer 被攻破，攻击者也只能使用最小白名单能力。

## BrowserWindow 基线

```ts
const window = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: preloadPath,
  },
});
```

禁止关闭 `webSecurity`，禁止启用 `enableRemoteModule`，禁止为解决开发问题给 renderer 开 Node 权限。

## 导航和新窗口

- 主窗口只加载打包资源或受控开发地址；
- 拦截 `will-navigate`，拒绝应用外导航；
- `setWindowOpenHandler` 默认 deny；
- `http/https` 外链校验协议后通过 `shell.openExternal`；
- 拒绝 `file:`, `javascript:`, `data:` 等非预期协议；
- 外链 API 不接受任意系统命令或未解析 URI。

## IPC 白名单

每个 IPC channel 对应一个业务动作，例如：

```text
document:open
document:save
document:save-as
document:watch
external:open-url
print:pdf
```

每个 handler 必须：

1. 校验发送者是受信窗口的主 frame，而不是仅比较某个 webContents 或接受子 frame；
2. 使用 schema 校验 payload；
3. 检查路径是否已授权；
4. 限制内容大小和调用频率；
5. 捕获异常并返回稳定错误；
6. 不返回栈、系统环境变量或敏感路径。

禁止 `execute`, `runCommand`, `readAnyFile` 之类通用能力。

## 路径授权

文件读取来源于用户在原生对话框中的选择，或已经保存的工作区授权。仅做字符串 `startsWith(root)` 不安全，必须规范化、解析真实路径，并考虑大小写、`..`、符号链接和 Windows junction。

Main 为每个受信窗口签发随机、不透明的 `fileId` 或 `workspaceId`，内部映射到规范化真实路径。保存已有文件时 renderer 提交 `fileId`，不能把显示路径当成授权；保存新文件时路径来自主进程原生 Save Dialog，renderer 只提交建议名称和正文。工作区内操作提交 `workspaceId + relativePath`，由 Main 解析和校验。

窗口关闭、授权撤销或主 frame 被替换时必须回收能力。能力不能跨窗口复用，不能持久化后直接信任，也不能由 renderer 猜测路径重新创建。

## HTML 与 Markdown

- HTML preview 使用成熟 sanitizer 和严格 allowlist；
- 禁止脚本、事件属性、危险 URL 和远程 iframe；
- React 中禁止直接使用未清洗的 `dangerouslySetInnerHTML`；
- Mermaid 使用安全配置，限制输入和渲染时间；
- 导出窗口使用独立、无 preload、无 Node 权限的隐藏窗口；
- 导出完成立刻销毁隐藏窗口。

## CSP

生产环境设置 Content Security Policy，默认目标：

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob: app-asset:;
connect-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'none';
```

本地图片通过下文受控协议加载，不把整个 `file:` 协议加入图片白名单。具体指令根据 KaTeX、代码高亮和开发服务器调整。开发环境的放宽不能进入生产包。

若当前 Milkdown、CodeMirror 或主题实现确实依赖内联样式，阶段性允许把生产 `style-src` 调整为 `'self' 'unsafe-inline'`，但必须满足：

- 只放宽样式，不放宽 `script-src`；
- 在 [[技术选型与决策]] ADR-008 记录具体依赖、验证证据和移除条件；
- 优先尝试抽取静态 CSS、带 nonce 的受控 `<style>` 或精确 hash；
- 每次相关依赖大版本升级和稳定版发布前复审；
- 通过打包产物测试确认实际 CSP 生效。

## 本地资源协议

不要把任意本地路径拼成 `file://` 后交给页面。注册类似 `app-asset:` 的受控自定义协议时，应在应用 ready 前声明为 standard/secure，并由协议 handler 根据窗口、文档或工作区能力把随机资源 ID 映射到本地图片。URL 不包含原始绝对路径；handler 校验请求来源、MIME、文件大小、真实路径和授权范围，并设置 `nosniff` 等响应头。

## 依赖和发布

- 提交 lockfile；
- 定期审查 Electron 安全更新；
- CI 执行依赖漏洞扫描，但人工判断可利用性；
- 不从 CDN 加载运行时代码；
- 安装包进行签名是正式发布前的要求；
- 自动更新元数据必须来自 HTTPS，更新包校验签名；
- source map 不包含密钥或私有路径。

## 第三方插件

MVP 禁止加载第三方插件。未来插件系统必须独立设计：

- manifest 声明权限；
- 默认无文件和网络权限；
- 版本兼容和撤销权限；
- Worker/iframe/独立进程隔离；
- 资源和执行时间限制；
- 崩溃隔离；
- 安装来源和完整性校验。

一个 TypeScript `Plugin` 接口不是安全沙箱。

## 安全检查清单

- [ ] `contextIsolation=true`
- [ ] `nodeIntegration=false`
- [ ] `sandbox=true`
- [ ] preload 不暴露 `ipcRenderer`
- [ ] 所有 IPC 输入有 runtime schema 校验
- [ ] IPC sender 限定为受信窗口主 frame
- [ ] 导航和新窗口默认拒绝
- [ ] 外链仅允许 `http/https`
- [ ] HTML 和 URL 完成清洗
- [ ] 文件路径基于授权并校验真实路径
- [ ] 文件和工作区操作使用 Main 签发的能力 ID
- [ ] 生产 CSP 生效
- [ ] `style-src 'unsafe-inline'` 若存在，已按 ADR-008 记录并复审
- [ ] 打包内容不包含开发密钥或测试文件

## 相关笔记
- [[总体架构]] - Electron 三进程边界
- [[模块与目录设计]] - preload 与 IPC 的代码位置
- [[文件与数据安全]] - 文件授权和路径安全
- [[测试与质量策略]] - 安全配置和恶意 fixture 测试
- [[技术参考资料]] - Electron 官方安全文档
- [[技术选型与决策]] - CSP 内联样式临时例外的 ADR 与复审条件
