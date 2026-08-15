import { describe, expect, it } from 'vitest'
import { filterWikiSuggestions } from './WikiAutocomplete'

const file = (name: string, path?: string) => ({ name, path: path ?? `/${name}` })
const dir = (name: string, children: Array<{ name: string; path: string; children?: unknown[] }>) => ({
  name,
  path: `/${name}`,
  children,
})

describe('Wiki 链接自动补全候选筛选', () => {
  it('多分支树不超过 maxResults（每层 return 只短路当前递归，需逐层传播）', () => {
    // 10 个文件夹 × 各 5 个匹配文件：若短路不传播会收集 10×5=50 条
    const tree = Array.from({ length: 10 }, (_, i) =>
      dir(
        `folder-${i}`,
        Array.from({ length: 5 }, (_, j) => file(`api-notes-${i}-${j}.md`, `/folder-${i}/api-notes-${i}-${j}.md`)),
      ),
    )
    const results = filterWikiSuggestions(tree, 'api', 20)
    expect(results).toHaveLength(20)
    // 且按深度优先顺序取前 20 条（folder-0 全 5 条 + folder-1 全 5 条 + folder-2 全 5 条 + folder-3 前 5 条）
    expect(results[0].path).toBe('/folder-0/api-notes-0-0.md')
    expect(results[19].path).toBe('/folder-3/api-notes-3-4.md')
  })

  it('空目录（children: []）不作为文件名候选', () => {
    const tree = [dir('docs', []), file('readme.md')]
    const results = filterWikiSuggestions(tree, 'docs')
    expect(results).toEqual([])
  })

  it('扁平列表（无 children 字段）与目录树混用均正常匹配', () => {
    const tree = [file('a.md'), dir('sub', [file('b.md', '/sub/b.md')])]
    expect(filterWikiSuggestions(tree, '')).toEqual([])
    expect(filterWikiSuggestions(tree, 'b')).toEqual([{ name: 'b', path: '/sub/b.md' }])
  })

  it('文件名匹配时去掉 .md 后缀且大小写不敏感', () => {
    const tree = [file('API-Notes.MD')]
    expect(filterWikiSuggestions(tree, 'api')).toEqual([{ name: 'API-Notes', path: '/API-Notes.MD' }])
  })
})
