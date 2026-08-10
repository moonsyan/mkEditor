import { schemaCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule } from '@milkdown/kit/utils'

/**
 * 自定义围栏输入规则（补充内置规则）：
 * 支持 ~~~ 围栏与大写语言名（如 ```Python），
 * 输入 ```python / ~~~python + 空格或回车即创建带语言的代码块。
 */
export const customCodeFenceRule = $inputRule((ctx) => {
  return new InputRule(
    /^(```|~~~)([A-Za-z0-9+#.-]*)[\s\n]$/,
    (state, match, start, end) => {
      const codeBlockType = ctx.get(schemaCtx).nodes.code_block
      if (!codeBlockType) return null
      const language = (match[2] ?? '').toLowerCase()
      const node = codeBlockType.create({ language })
      const tr = state.tr.replaceRangeWith(start, end, node)
      return tr
        .setSelection(TextSelection.create(tr.doc, start + 1))
        .scrollIntoView()
    },
  )
})
