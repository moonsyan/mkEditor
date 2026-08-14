import { schemaCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose } from '@milkdown/kit/utils'

/**
 * 自定义围栏输入规则 + 回车键（补充内置规则）：
 * 支持 ~~~ 围栏与大写语言名（如 ```Python），
 * 输入 ```python / ~~~python + 空格或回车即创建带语言的代码块。
 * L10：PM 输入规则只对文本输入生效，物理 Enter 由 keymap 抢先处理，
 * 原来的 `[\s\n]$` 里回车分支实际是死代码。
 */
/** 围栏输入规则：```python + 空格 创建带语言的代码块 */
export const customCodeFenceRule = $prose((ctx) => {
  const codeBlockType = ctx.get(schemaCtx).nodes.code_block
  return inputRules({
    rules: [
      new InputRule(
        /^(```|~~~)([A-Za-z0-9+#.-]*)[\s]$/,
        (state, match, start, end) => {
          if (!codeBlockType) return null
          const language = (match[2] ?? '').toLowerCase()
          const node = codeBlockType.create({ language })
          const tr = state.tr.replaceRangeWith(start, end, node)
          return tr
            .setSelection(TextSelection.create(tr.doc, start + 1))
            .scrollIntoView()
        },
      ),
    ],
  })
})

/**
 * 围栏回车键：光标处于完整围栏行末尾（```python 无尾随空格）时，
 * Enter 直接建代码块。L10：PM 输入规则只对文本输入生效，物理 Enter
 * 由 keymap 抢先处理，原输入规则里的 \n 分支实际是死代码。
 * 须注册在 commonmark 预设之前才能抢先其 Enter 绑定。
 */
export const customCodeFenceKeymap = $prose((ctx) => {
  const codeBlockType = ctx.get(schemaCtx).nodes.code_block
  return keymap({
    Enter: (state, dispatch) => {
      if (!state.selection.empty) return false
      const { $from } = state.selection
      if ($from.parent.type.name !== 'paragraph') return false
      const lineBefore = $from.parent.textContent.slice(0, $from.parentOffset)
      const m = /^(```|~~~)([A-Za-z0-9+#.-]*)\s*$/.exec(lineBefore)
      if (!m || !codeBlockType) return false
      const language = (m[2] ?? '').toLowerCase()
      const node = codeBlockType.create({ language })
      const start = $from.start()
      if (dispatch) {
        dispatch(
          state.tr
            .replaceWith(start, $from.pos, node)
            .setSelection(TextSelection.create(state.tr.doc, start + 1))
            .scrollIntoView(),
        )
      }
      return true
    },
  })
})
