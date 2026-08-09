---
type: knowledge
tags:
  - markdown编辑器
  - markdown
  - commonmark
  - 兼容性
created: 2026-08-06
---
# Markdown 兼容策略

> 标签：#markdown编辑器 #markdown #commonmark #兼容性
> 日期：2026-08-06

## 核心结论

“支持 Markdown”必须被定义成可测试的 profile。第一版采用 CommonMark 基础语法，加少量 GFM 扩展；保证内容与语义，允许受控格式规范化，不承诺对任意私有语法逐字符无损。

## 兼容 Profile

### Profile Core

- ATX 标题 `#`；
- 段落和软换行；
- 粗体、斜体；
- 行内代码和 fenced code block；
- 有序、无序列表和嵌套列表；
- 引用；
- 行内链接、引用链接；
- 图片；
- 分隔线；
- 硬换行；
- 转义字符。

### Profile GFM Basic

- 阶段 2 加入；
- 删除线；
- task list；
- autolink；
- 表格属于 L2，后置到阶段 3。

### Extension

Frontmatter、脚注、数学、Mermaid 和 Callout 必须分别完成功能设计和兼容性验收。只有它们改变持久化契约、总体技术路线或安全边界时才新建 ADR。不能把所有 remark 插件装上就认为产品完成支持。

## 权威转换链路

```text
Markdown string
    |
Milkdown parser
    |-- 内部 remark/mdast（仅临时转换对象）
    |
ProseMirror Document（实时模式权威）
    |
Milkdown serializer
    |
Markdown string
```

应用层通过统一 `MarkdownCodec`/editor adapter 调用 Milkdown 的 parse/serialize，不直接串联 unified pipeline，也不自行维护 remark 与 ProseMirror 的映射。remark AST 不保存在全局状态，不与 ProseMirror Document 并行更新。只有开发 Milkdown 插件或排查转换缺陷时，才在 editor 模块内部接触 remark/mdast。

## 规范化规则

第一版允许：

- 强调统一为 `**bold**` 和 `*italic*`；
- fenced code block 统一使用三个反引号，必要时增加 fence 长度；
- 有序列表重新编号或统一使用 `1.`，策略必须固定；
- 行尾空格、空行数量按 serializer 规则整理；
- EOL 和 BOM 由文件层恢复，不由 Markdown serializer 决定。

第一版不允许：

- 删除可见文本；
- 改变标题层级、列表嵌套或链接目标；
- 丢失 code fence language；
- 把代码中的 Markdown 当成语法处理；
- 静默删除不支持的块。

## 不支持语法处理

“unknown block 原样保留”只有在 parser 能识别边界时才成立。任意行内私有语法、HTML 注释或混合嵌套无法靠一个 UnknownNode 自动解决。

第一版采取：

1. 打开前扫描已知高风险语法；
2. 检测到不支持语法时显示兼容模式提示；
3. 阶段 1 用户可选择只读预览、安全源码兜底或继续并接受规范化；阶段 3 可使用完整源码模式；
4. 未经确认，不在实时模式自动保存这类文件；
5. 保存前保留原文件恢复副本。

## Raw HTML

MVP 默认不在实时编辑器执行 Raw HTML：

- 简单 HTML 可以作为不可执行文本或受控节点保留；
- `<script>`、事件属性、远程 iframe 不执行；
- HTML 预览必须 sanitize；
- 导出时是否保留 Raw HTML 是显式选项；
- 无法安全往返的 HTML 文件在阶段 1 默认进入安全源码兜底，阶段 3 可进入完整源码模式。

## Frontmatter

阶段 3 支持 YAML Frontmatter 时应：

- 只把文件开头合法 `---` 块识别为 Frontmatter；
- 原始字符串作为数据保存，表单只是投影；
- 表单修改时使用 YAML parser，不做字符串拼接；
- 保留 key 顺序和注释是独立能力，不能默认承诺；
- YAML 解析失败时显示源码，不覆盖内容。

## Roundtrip 验收层次

### Level 1 内容守恒

所有可见文本、代码、URL、图片路径和元数据值都存在。

### Level 2 语义等价

两次 parse 后得到等价的规范化 AST 或 ProseMirror Document：

```text
normalize(parse(input)) == normalize(parse(serialize(parse(input))))
```

这是第一版自动化门禁。

上述 `parse`/`serialize` 均指项目 `MarkdownCodec` 暴露的 Milkdown 适配能力，不表示应用层另建 remark pipeline。

### Level 3 字符稳定

规范化一次后再次往返不再变化：

```text
format(format(input)) == format(input)
```

也叫幂等性，第一版必须满足。

### Level 4 逐字符无损

输入和输出完全相同。除未编辑的特殊 raw block 外，第一版不承诺。

## Fixture 设计

```text
tests/fixtures/markdown/
├── commonmark/
├── gfm/
├── mixed/
├── unicode/
├── whitespace/
├── unsupported/
└── regression/
```

每个 fixture 包含：

- 输入 Markdown；
- 期望规范化 Markdown；
- 期望文档 JSON 或关键断言；
- 兼容级别；
- 若是回归用例，关联 issue ID。

必须覆盖中文、emoji、组合字符、Windows CRLF、无末尾换行、BOM、超长行、嵌套列表、fence 内反引号、括号 URL 和相对图片路径。

## 扩展加入流程

每种新语法必须同时交付：

1. Profile 文档和语法示例；
2. parser 与 serializer；
3. schema/node/mark；
4. 输入、粘贴、删除和撤销行为；
5. fixture 和 E2E；
6. 导出行为；
7. 不支持场景及降级方式。

## 相关笔记
- [[产品范围与原则]] - 兼容级别由产品范围决定
- [[编辑器内核设计]] - 文档模型和转换链路
- [[文件与数据安全]] - EOL、BOM 和恢复副本属于文件层
- [[测试与质量策略]] - 兼容测试和属性测试
- [[技术参考资料]] - CommonMark、GFM 和 unified 官方资料
- [[测试用例模板]] - 用标准格式固化兼容性回归
- [[技术选型与决策]] - Markdown 工具链的选择依据
- [[项目蓝图]] - 兼容策略服务于整体项目目标
