/**
 * 编辑器内容回调可能经过防抖，回调携带的内容必须仍属于当前编辑器状态。
 * currentMarkdown 为 null 表示编辑器尚未就绪，此时不能用该检查阻断回调。
 */
export const isCurrentEditorChange = (
  reportedMarkdown: string,
  currentMarkdown: string | null,
): boolean => currentMarkdown === null || reportedMarkdown === currentMarkdown
