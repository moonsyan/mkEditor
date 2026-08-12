# moonsyan.github.io 官网 v1 设计

日期:2026-08-13
状态:已批准(2026-08-13 头脑风暴确认)

## 背景与目标

为桌面 Markdown 编辑器 **MarkdownSoft**(仓库 moonsyan/mkEditor,已发布 v0.1.0)建一个 GitHub Pages 官网,展示产品并提供下载入口。网站结构保持简单,便于用户以后自行扩展。

## 需求决定(头脑风暴结论)

| 决定点 | 结论 |
|--------|------|
| 网站位置 | 独立公开仓库 `moonsyan.github.io`(用户站点,域名 `https://moonsyan.github.io/`) |
| 范围 | 单页落地页(v1);后续可加页面 |
| 技术 | Vue 3 + Vite + TypeScript,轻量自研,不引入 vue-router / vue-i18n |
| 语言 | 中英双语,切换按钮,localStorage 记忆,默认中文 |
| 视觉 | 柔和、简洁、优雅;官网自带 4 套主题切换(light / dark / rose / ocean),调色板挪用应用内置主题,品牌统一 |
| 产品展示 | 截图占位组件(CSS 绘制编辑器窗口骨架);真实截图后续放入 `public/screenshots/` 替换 |
| 下载入口 | 静态链接指向 `https://github.com/moonsyan/mkEditor/releases/latest` |

## 架构与目录结构

```
moonsyan.github.io/
├── index.html
├── package.json / vite.config.ts / tsconfig.json
├── .github/workflows/deploy.yml        # 构建 + 部署 Pages
├── public/screenshots/                 # 真实截图位(现在为空)
└── src/
    ├── main.ts                         # createApp + 挂载
    ├── App.vue                         # 根组件:持有 locale + theme 状态,页面骨架
    ├── composables/
    │   ├── useI18n.ts                  # 语言状态 + t(key) 查找 + localStorage
    │   └── useTheme.ts                 # 主题状态 + <html data-theme> + localStorage
    ├── locales/
    │   ├── zh.ts                       # 中文文案字典(全部文案集中于此)
    │   └── en.ts                       # 英文文案字典(键与 zh 一致)
    ├── themes/
    │   ├── light.css                   # 4 套主题,只含 CSS 变量(无选择器逻辑)
    │   ├── dark.css
    │   ├── rose.css
    │   └── ocean.css
    ├── components/
    │   ├── HeroSection.vue             # 产品名、标语、下载按钮、截图占位
    │   ├── FeatureGrid.vue             # 6-9 个核心功能卡片(内容取自 mkEditor README)
    │   ├── DownloadSection.vue         # 三平台说明 + 跳转 Releases
    │   └── SiteFooter.vue              # 版权、GitHub 仓库链接
    └── styles/global.css               # 排版、布局、引用主题变量
```

## 数据流

- `App.vue` 持有两个响应式状态:`locale`(zh/en)、`theme`(light/dark/rose/ocean)
- **语言**:`t('hero.title')` 从 `locales/{locale}.ts` 取文案;切换时同步 `<html lang>` 属性;localStorage 记忆,首次访问默认中文
- **主题**:往 `<html>` 挂 `data-theme` 属性;主题 css 通过 `[data-theme="dark"]` 等覆盖 CSS 变量;首次访问默认跟随系统 `prefers-color-scheme`;localStorage 记忆
- **零网络请求**:无后端、无 API。下载按钮为静态链接

## 组件职责

- **HeroSection**:产品名 + 标语 + 下载按钮 + 截图占位组件
- **FeatureGrid**:从 README 挑选核心亮点(富文本编辑、多文件工作区、Wiki 链接、主题系统、分栏预览、导出 PDF/Word/EPUB 等),图标 + 标题 + 一句话
- **DownloadSection**:Windows / macOS / Linux 三平台说明,按钮跳转 Releases 页
- **SiteFooter**:版权、GitHub 链接
- 右上角固定两个小控件:语言切换(中/EN)、主题切换(四个色点)

## 错误处理

- 静态站无请求失败路径;唯一兜底:localStorage 读取 try/catch,解析失败回默认值
- 截图缺失时占位组件自然呈现,不存在图片 404 裂图问题

## 测试

- vitest 单元测试:`useI18n`(切换、持久化、未知 key 回退到键名)、`useTheme`(切换、持久化、非法值回退)
- 部署后人工访问验证:URL 生效、双语切换、四主题切换、下载链接可达

## 部署

- `deploy.yml`:checkout → setup-node(20)→ `npm ci` → `npm run build` → `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`
- workflow 权限:`contents: read`、`pages: write`、`id-token: write`
- 一次性人工步骤:
  1. GitHub 网页新建公开空仓库 `moonsyan.github.io`(用户名必须精确匹配)
  2. 仓库 Settings → Pages → Source 选择 **"GitHub Actions"**
- 该新仓库正常跟踪 package-lock.json,CI 用 `npm ci`(与 mkEditor 仓库的约定不同,无历史包袱)

## 边界(刻意不做)

- 不引入 vue-router、vue-i18n(单页够用,加页面时再升级)
- 不做动态版本号/自动拉取最新 release(静态链接 `/releases/latest` 已满足)
- 不做复杂 SEO(仅基础 meta 描述)
- 不做博客、文档站(以后需要时另行设计)

## 实施前提

- [ ] 用户新建公开仓库 `moonsyan.github.io`
- [ ] 用户设置 Pages Source = GitHub Actions
