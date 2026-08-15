#!/usr/bin/env node
/**
 * 把本机构建产物同步到 gitee Release（国内下载镜像）。
 *
 * 用法（Node 18+）：
 *   GITEE_TOKEN=<私人令牌> node scripts/sync-gitee.js [--tag=v0.3.0]
 *
 * 默认读取 package.json 的 version（release/<version>/ 目录需存在，
 * 先运行 npm run build:win）。上传的附件：
 *   - MarkdownSoft-Setup-<version>.exe（+ .blockmap 差异包）
 *   - latest.yml（electron-updater 更新清单）
 *
 * 令牌：gitee.com → 设置 → 私人令牌，勾选 projects 权限。
 * 之后用户在 gitee Release 页面即可看到安装包与更新清单；
 * 客户端自动更新主源仍是 GitHub（app-update.yml），gitee 供手动下载
 * 或后续切换为主源（改 package.json publish.url 为 gitee 直链）。
 */
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const GITEE_REPO = 'MingProject/mk-editormkEditor'
const API = 'https://gitee.com/api/v5'

const args = process.argv.slice(2)
const tagArg = (args.find((a) => a.startsWith('--tag=')) ?? '').slice(6)
const token = process.env.GITEE_TOKEN

if (!token) {
  console.error('缺少 GITEE_TOKEN 环境变量（gitee 设置 → 私人令牌，勾选 projects 权限）')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const version = tagArg || pkg.version
const tag = version.startsWith('v') ? version : `v${version}`

// 收集产物：安装包 + latest.yml + 差异包
const dir = join(__dirname, '..', 'release', version)
const exe = join(dir, `MarkdownSoft-Setup-${version}.exe`)
const files = []
if (existsSync(exe)) {
  files.push(exe)
  if (existsSync(`${exe}.blockmap`)) files.push(`${exe}.blockmap`)
}
const latestYml = join(dir, 'latest.yml')
if (existsSync(latestYml)) files.push(latestYml)
if (files.length === 0) {
  console.error(`release/${version} 目录没有可上传的产物，请先运行 npm run build:win`)
  process.exit(1)
}

async function api(path, options) {
  const res = await fetch(`${API}${path}`, options)
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new Error(`gitee API ${res.status} ${res.statusText}: ${JSON.stringify(data)}`)
  }
  return data
}

async function findOrCreateRelease() {
  // 先查同 tag 是否已有 release（重复上传会 409，复用即可）
  try {
    const existing = await api(
      `/repos/${GITEE_REPO}/releases/tags/${encodeURIComponent(tag)}?access_token=${token}`,
    )
    return existing.id
  } catch (err) {
    if (!String(err.message).includes('404')) throw err
  }
  const created = await api(`/repos/${GITEE_REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      tag_name: tag,
      name: `MarkdownSoft ${tag}`,
      body: '由 scripts/sync-gitee.js 同步自 GitHub Release，供国内用户下载。',
      target_commitish: 'master',
    }),
  })
  return created.id
}

async function uploadFile(releaseId, filePath) {
  const name = filePath.split(/[\\/]/).pop()
  const blob = new Blob([readFileSync(filePath)])
  const form = new FormData()
  form.append('file', blob, name)
  const res = await fetch(
    `${API}/repos/${GITEE_REPO}/releases/${releaseId}/attach_files?access_token=${token}`,
    {
      method: 'POST',
      body: form,
      // 安装包约 130MB，上传可能耗时数分钟；10 分钟超时后失败重跑即可
      signal: AbortSignal.timeout(10 * 60 * 1000),
    },
  )
  const text = await res.text()
  if (!res.ok) {
    // 附件同名已存在时 gitee 会报错，提示跳过即可（内容一致无需重传）
    throw new Error(`上传 ${name} 失败 ${res.status}: ${text.slice(0, 200)}`)
  }
  console.log(`✓ 已上传 ${name}`)
}

async function main() {
  console.log(`同步 release/${version} → gitee ${GITEE_REPO} (${tag})`)
  const releaseId = await findOrCreateRelease()
  for (const file of files) {
    try {
      await uploadFile(releaseId, file)
    } catch (err) {
      if (String(err.message).includes('已存在') || String(err.message).includes('exists')) {
        console.warn(`! 跳过已存在的附件：${file.split(/[\\/]/).pop()}`)
        continue
      }
      console.error(String(err.message))
      process.exitCode = 1
    }
  }
  console.log(
    `完成：https://gitee.com/${GITEE_REPO}/releases/tag/${tag}`,
  )
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
