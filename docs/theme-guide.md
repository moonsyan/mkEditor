# 主题定制指南

> 更新基线：2026-08-11。主题文件位于 `src/renderer/src/styles/themes/`；当前内置 `default`、`dark`、`ocean`、`rose` 四套主题。

## 主题系统原理

MarkdownSoft 使用 **CSS 变量（Custom Properties）** 实现主题系统。所有颜色、间距、阴影等视觉属性都定义为 CSS 变量，切换主题只需改变一组变量的值。

**优势**：
- 新增主题不需要写 JavaScript
- 修改颜色只需改变一个色值
- 运行时切换零延迟
- 对非前端开发者友好

---

## 主题变量说明

每个主题定义以下变量组：

```css
/* ===== 背景色 ===== */
--bg-app:       #F7F5F2;    /* 应用整体背景 */
--bg-surface:   #FFFFFF;    /* 编辑区域背景 */
--bg-sidebar:   #F0EDEA;    /* 侧栏背景 */
--bg-hover:     rgba(0,0,0,.035);  /* 悬停高亮 */
--bg-active:    rgba(0,0,0,.06);   /* 激活高亮 */
--bg-menu:      #FFFFFF;    /* 菜单背景 */
--bg-code:      #F5F2EE;    /* 代码块背景 */
--bg-quote:     #FAF8F5;    /* 引用块背景 */

/* ===== 文字色 ===== */
--text-1:  #1D1B18;   /* 主文字（标题、正文） */
--text-2:  #5C5850;   /* 次要文字（菜单项、说明） */
--text-3:  #9C978E;   /* 辅助文字（状态栏、提示） */
--text-4:  #C8C3BA;   /* 最弱文字（分割线替代） */

/* ===== 强调色 ===== */
--accent:     #7C6F5B;   /* 链接、选中态、强调 */
--accent-h:   #635847;   /* 强调色悬停态 */
--accent-bg:  rgba(124,111,91,.08);  /* 强调色背景用途 */

/* ===== 边框与阴影 ===== */
--border:    rgba(0,0,0,.06);   /* 普通边框 */
--border-m:  rgba(0,0,0,.08);   /* 菜单边框 */
--shadow-m:  0 8px 32px ...;    /* 菜单阴影 */
--shadow-s:  0 1px 3px ...;     /* 小阴影 */

/* ===== 间距与圆角 ===== */
--radius:     6px;     /* 小圆角 */
--radius-md:  10px;    /* 中圆角 */
```

---

## 如何新增主题

### 步骤 1：创建主题 CSS 文件

在 `src/renderer/src/styles/themes/` 下创建新文件，例如 `forest.css`：

```css
[data-theme="forest"] {
  --bg-app:     #F0F4F0;
  --bg-surface: #FFFFFF;
  --bg-sidebar: #E8EDE8;
  --bg-hover:   rgba(0,80,0,.04);
  --bg-active:  rgba(0,80,0,.07);
  --bg-menu:    #FFFFFF;
  --bg-code:    #EDF3ED;
  --bg-quote:   #F5F9F5;

  --text-1:  #1A2E1A;
  --text-2:  #4A6A4A;
  --text-3:  #8AAA8A;
  --text-4:  #C0D4C0;

  --accent:    #3A7A3A;
  --accent-h:  #2A6A2A;
  --accent-bg: rgba(58,122,58,.07);

  --border:   rgba(0,80,0,.07);
  --border-m: rgba(0,80,0,.09);
  --shadow-m: 0 8px 32px rgba(0,80,0,.07);
  --shadow-s: 0 1px 3px rgba(0,80,0,.03);
}
```

### 步骤 2：在 HTML 中引入

在 `index.html` 的 `<head>` 中添加：

```html
<link rel="stylesheet" href="./src/styles/themes/forest.css">
```

### 步骤 3：注册到主题切换器

在 `ThemeSwitcher/index.tsx` 中添加选项：

```tsx
const themes = [
  { id: 'default', name: '暖白', color: '#F7F5F2' },
  { id: 'dark',    name: '墨夜', color: '#171614' },
  { id: 'ocean',   name: '海雾', color: '#EFF4F9' },
  { id: 'rose',    name: '玫砂', color: '#FBF5F3' },
  { id: 'forest',  name: '森林', color: '#F0F4F0' },  // 新增
]
```

完成！不需要修改任何业务逻辑代码。

---

## 配色建议

### 柔和感的关键

1. **避免纯白纯黑**：用 `#FAF8F5` 代替 `#FFFFFF`，用 `#1A1917` 代替 `#000000`
2. **降低对比度**：文字和背景的对比度保持在 7:1 ~ 12:1 之间
3. **使用暖灰**：灰色中混入微量暖色（黄/橙），比冷灰更舒适
4. **半透明叠加**：hover 效果使用 `rgba` 半透明色，自动适配深浅主题

### 暗色主题要点

- 背景不要用纯黑，用深灰（`#171614` ~ `#1C1B19`）
- 文字色用暖白（`#E6E2DC`），不要用纯白
- 阴影要加深 3-4 倍（暗色下阴影不明显）
- 边框用 `rgba(255,255,255,0.06)` 微透明

---

## 现有主题预览

| 主题 | 风格 | 适用场景 |
|------|------|---------|
| 暖白 (default) | 暖灰米色调 | 日间写作，通用 |
| 墨夜 (dark) | 深邃暗色 | 夜间使用，低光环境 |
| 海雾 (ocean) | 冷调蓝灰 | 喜欢冷色系的用户 |
| 玫砂 (rose) | 温暖粉棕 | 温馨感，个性化 |
