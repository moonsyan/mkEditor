import { describe, expect, it } from 'vitest'
import { resolveWikiTarget, collectMdFiles, findFileByName } from './wiki-resolver'
import type { FolderTreeNode } from '../../../preload/api'

/** 构造测试用文件树 */
function makeTree(files: string[]): FolderTreeNode[] {
  // 简化版：扁平文件列表转树
  const byDir = new Map<string, FolderTreeNode[]>()
  for (const f of files) {
    const normalized = f.replace(/\\/g, '/')
    const parts = normalized.split('/')
    const fileName = parts.pop()!
    const dir = parts.join('/')

    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir)!.push({
      name: fileName,
      path: f,
      // .md 文件没有 children，非 .md 文件也没有 children（我们这个简化版本）
    })
  }
  // 构建目录树
  function build(dir: string): FolderTreeNode[] {
    const result: FolderTreeNode[] = []
    // 子目录
    const subdirs = new Set<string>()
    byDir.forEach((_, d) => {
      if (d.startsWith(dir + '/') || (dir === '' && d.includes('/'))) {
        const topDir = dir ? d.slice(dir.length + 1).split('/')[0] : d.split('/')[0]
        if (!d.includes('/', dir ? dir.length + 1 : 0)) {
          subdirs.add(dir ? `${dir}/${topDir}` : topDir)
        }
      }
    })
    Array.from(subdirs).forEach((sd) => {
      const name = sd.split('/').pop()!
      result.push({
        name,
        path: sd,
        children: build(sd),
      })
    })
    // 当前目录的文件
    if (byDir.has(dir)) {
      for (const f of byDir.get(dir)!) {
        result.push(f)
      }
    }
    return result
  }
  return build('')
}

describe('collectMdFiles', () => {
  it('收集工作区树中所有 .md 文件路径', () => {
    const tree: FolderTreeNode[] = [
      { name: 'a.md', path: '/ws/a.md' },
      {
        name: 'sub',
        path: '/ws/sub',
        children: [
          { name: 'b.md', path: '/ws/sub/b.md' },
          { name: 'c.md', path: '/ws/sub/c.md' },
        ],
      },
    ]
    const files = collectMdFiles(tree)
    expect(files).toContain('/ws/a.md')
    expect(files).toContain('/ws/sub/b.md')
    expect(files).toContain('/ws/sub/c.md')
  })
})

describe('findFileByName', () => {
  it('按文件名查找（大小写不敏感）', () => {
    const tree: FolderTreeNode[] = [
      { name: 'Readme.md', path: '/ws/Readme.md' },
    ]
    expect(findFileByName(tree, 'readme')).toBe('/ws/Readme.md')
    expect(findFileByName(tree, 'Readme.md')).toBe('/ws/Readme.md')
    expect(findFileByName(tree, 'unknown')).toBe(null)
  })
})

describe('resolveWikiTarget', () => {
  const tree: FolderTreeNode[] = [
    { name: 'index.md', path: 'D:/notes/index.md' },
    { name: 'todo.md', path: 'D:/notes/todo.md' },
    {
      name: 'sub',
      path: 'D:/notes/sub',
      children: [
        { name: 'note.md', path: 'D:/notes/sub/note.md' },
        {
          name: 'deep',
          path: 'D:/notes/sub/deep',
          children: [{ name: 'ideas.md', path: 'D:/notes/sub/deep/ideas.md' }],
        },
      ],
    },
    {
      name: 'projects',
      path: 'D:/notes/projects',
      children: [
        { name: 'readme.md', path: 'D:/notes/projects/readme.md' },
      ],
    },
  ]

  const workspacePath = 'D:/notes'

  it('精确匹配当前目录下的文件名', () => {
    const result = resolveWikiTarget('todo', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/todo.md')
  })

  it('带扩展名的精确匹配', () => {
    const result = resolveWikiTarget('todo.md', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/todo.md')
  })

  it('从子目录引用父目录文件', () => {
    const result = resolveWikiTarget('index', workspacePath, 'D:/notes/sub/note.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/index.md')
  })

  it('以 / 开头的绝对路径引用', () => {
    const result = resolveWikiTarget('/sub/deep/ideas', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/sub/deep/ideas.md')
  })

  it('引用兄弟目录文件（含子路径）', () => {
    const result = resolveWikiTarget('deep/ideas', workspacePath, 'D:/notes/sub/note.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/sub/deep/ideas.md')
  })

  it('不存在的 target 返回未解析', () => {
    const result = resolveWikiTarget('nonexistent', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(false)
  })

  it('L19:子目录路径大小写不敏感匹配（Windows 路径大小写不敏感）', () => {
    // 目录段 Sub 大小写不符，文件名也不一致——精确匹配与文件名兜底都失效
    const result = resolveWikiTarget('Sub/NOTE', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(true)
    expect(result.path).toBe('D:/notes/sub/note.md')

    // 根目录直接引用 + 文件名大小写不符
    const result2 = resolveWikiTarget('TODO.md', workspacePath, 'D:/notes/index.md', tree)
    expect(result2.resolved).toBe(true)
    expect(result2.path).toBe('D:/notes/todo.md')
  })

  it('空 target 返回未解析', () => {
    const result = resolveWikiTarget('', workspacePath, 'D:/notes/index.md', tree)
    expect(result.resolved).toBe(false)
  })
})
