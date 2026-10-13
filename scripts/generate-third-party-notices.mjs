/*
 * 鲸域 · WhaleRealm
 * Copyright (C) 2026 凛枫
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 附加署名要求：任何分发本程序或其衍生作品的行为，必须在显著位置
 * 保留上述版权声明及作者署名。
 */

/**
 * 生成第三方组件声明（THIRD_PARTY_NOTICES.md）与许可文本索引
 * （hub/licenses/npm/<pkg>@<version>/LICENSE），并校验两者与 lock 及
 * 实际安装的一致性。
 *
 * 事实来源（不凭记忆填许可文本）：
 *   - hub/package-lock.json —— 分发版本清单（本仓包管理器实际是 pnpm，
 *     lock 是声明性的；生成器以 node_modules 实际版本为准做一致性断言）；
 *   - hub/node_modules/<pkg>/LICENSE —— 逐包真实许可全文，复制进索引；
 *   - hub/release/win-unpacked/ —— Electron 分发体的 LICENSE.electron.txt
 *     与 LICENSES.chromium.html；
 *   - hub/package.json build.files —— electron-builder 实际打包范围。
 *
 * 用法：
 *   node scripts/generate-third-party-notices.mjs            # 生成
 *   node scripts/generate-third-party-notices.mjs --check     # 校验（不一致 exit 1）
 *
 * license IPC 兼容：hub/licenses/THIRD_PARTY_NOTICES.md 的固定路径不变
 * （electron/licenses.ts 读 <licensesRoot>/THIRD_PARTY_NOTICES.md）。
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HUB = path.join(REPO_ROOT, 'hub')
const LOCK_PATH = path.join(HUB, 'package-lock.json')
const PACKAGE_JSON_PATH = path.join(HUB, 'package.json')
const LICENSES_DIR = path.join(HUB, 'licenses')
const NOTICES_PATH = path.join(LICENSES_DIR, 'THIRD_PARTY_NOTICES.md')
const NPM_TEXT_DIR = path.join(LICENSES_DIR, 'npm')
const ELECTRON_DIST_DIR = path.join(HUB, 'release', 'win-unpacked')

/** electron-builder files 配置里会进 app 的生产 npm 包（bundle 内依赖不算独立分发单元，但各自 LICENSE 仍随包分发）。 */
const PACKAGED_NPM_COMPONENTS = [
  'react',
  'react-dom',
  'scheduler',
  'lucide-react',
  'yaml',
]

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const GPL_NOTICE = `# 第三方组件声明（THIRD PARTY NOTICES）

鲸域 · WhaleRealm 使用以下第三方开源组件。各组件版权归其原作者所有，按各自许可证分发。

本清单由 \`scripts/generate-third-party-notices.mjs\` 从 \`hub/package-lock.json\`、
\`hub/node_modules/\` 实际安装与 Electron 发行体自动生成；请勿手改，
改动依赖后重新生成（校验：\`node scripts/generate-third-party-notices.mjs --check\`）。

本项目自身按 GNU GPL-3.0-or-later 分发，全文见 \`licenses/GPL-3.0.txt\`。

## 随软件分发的组件

| 组件 | 版本 | 许可证 | 全文 |
|---|---|---|---|
`

function row(component, version, license, textPath) {
  return `| ${component} | ${version} | ${license} | \`${textPath}\` |`
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function fileStats(file) {
  const bytes = await readFile(file)
  return { size: bytes.length, sha256: sha256(bytes) }
}

/** 定位包的实际安装目录：先试直连 node_modules，再按 pnpm 布局扫 .pnpm/<name>@<version>。 */
async function resolveInstalledPackage(name, expectedVersion = null) {
  const direct = path.join(HUB, 'node_modules', name)
  try {
    const meta = await readJson(path.join(direct, 'package.json'))
    if (expectedVersion === null || meta.version === expectedVersion) {
      return { dir: direct, meta }
    }
  } catch { /* 直连不存在或版本不匹配，转 pnpm 树 */ }
  const pnpmRoot = path.join(HUB, 'node_modules', '.pnpm')
  let entries = []
  try {
    entries = await readdir(pnpmRoot)
  } catch {
    return null
  }
  const wanted = entries
    .filter(entry => entry.startsWith(`${name.replace('/', '+')}@`))
    .filter(entry => expectedVersion === null || entry.startsWith(`${name.replace('/', '+')}@${expectedVersion}_`) || entry === `${name.replace('/', '+')}@${expectedVersion}`)
    .sort()
  for (const entry of wanted) {
    const dir = path.join(pnpmRoot, entry, 'node_modules', name)
    try {
      const meta = await readJson(path.join(dir, 'package.json'))
      if (expectedVersion === null || meta.version === expectedVersion) return { dir, meta }
    } catch { /* 尝试下一个候选 */ }
  }
  return null
}

async function locateLicenseFile(packageDir) {
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'NOTICE']) {
    try {
      const file = path.join(packageDir, candidate)
      const info = await stat(file)
      if (info.isFile()) return file
    } catch { /* 尝试下一个候选名 */ }
  }
  return null
}

/**
 * 汇集全部事实。任何一项缺失直接抛错（fail-closed）：声明文件宁可生成失败，
 * 也不能带着"凭记忆补的"许可文本发布。
 */
async function collectFacts() {
  const lock = await readJson(LOCK_PATH)
  const pkg = await readJson(PACKAGE_JSON_PATH)
  if (lock.name !== pkg.name || lock.version !== pkg.version) {
    throw new Error(`package-lock 根 (${lock.name}@${lock.version}) 与 package.json (${pkg.name}@${pkg.version}) 不一致`)
  }

  const components = []
  for (const name of PACKAGED_NPM_COMPONENTS) {
    const lockEntry = lock.packages[`node_modules/${name}`]
    if (!lockEntry) throw new Error(`生产组件 ${name} 不在 package-lock 里`)
    const installed = await resolveInstalledPackage(name, lockEntry.version)
    if (!installed) throw new Error(`生产组件 ${name}@${lockEntry.version} 未实际安装（node_modules 直连与 .pnpm 树均未命中）`)
    if (lockEntry.version !== installed.meta.version) {
      throw new Error(`组件 ${name} 的 lock 版本 (${lockEntry.version}) 与实际安装 (${installed.meta.version}) 不一致`)
    }
    const licenseFile = await locateLicenseFile(installed.dir)
    if (!licenseFile) throw new Error(`组件 ${name}@${installed.meta.version} 的安装目录里没有许可文本`)
    const licenseText = await readFile(licenseFile, 'utf8')
    components.push({
      name,
      version: installed.meta.version,
      license: Array.isArray(installed.meta.license) ? installed.meta.license.join(' OR ') : installed.meta.license,
      source: `https://registry.npmjs.org/${name}/-/${name}-${installed.meta.version}.tgz`,
      integrity: lockEntry.integrity ?? null,
      licenseFile,
      licenseText,
    })
  }

  // lucide 的完整 LICENSE 含 Feather 派生图标的 MIT 归属——只标 ISC 会漏掉这段，
  // 生成器据实检测并显式注明。
  const lucide = components.find(component => component.name === 'lucide-react')
  if (lucide && /feather/i.test(lucide.licenseText)) {
    lucide.attribution = '完整 LICENSE 同时包含 Feather 派生图标的 MIT 归属（Cole Bemis 等），随全文一并列出，不得仅按 ISC 摘要。'
  }

  const electronLicense = path.join(ELECTRON_DIST_DIR, 'LICENSE.electron.txt')
  const chromiumNotices = path.join(ELECTRON_DIST_DIR, 'LICENSES.chromium.html')
  let electronDist = null
  try {
    electronDist = {
      electronVersion: (await readJson(path.join(HUB, 'node_modules', 'electron', 'package.json'))).version,
      electronLicense,
      electronLicenseStats: await fileStats(electronLicense),
      chromiumNotices,
      chromiumStats: await fileStats(chromiumNotices),
    }
  } catch (error) {
    throw new Error(`Electron 分发体许可文件缺失（release/win-unpacked）：${error.message}`)
  }

  const gplPath = path.join(LICENSES_DIR, 'GPL-3.0.txt')
  const gplStats = await fileStats(gplPath).catch(() => {
    throw new Error('licenses/GPL-3.0.txt 缺失：项目自身许可证必须存在')
  })

  return { lock, pkg, components, electronDist, gpl: { path: gplPath, stats: gplStats } }
}

/** 生成 THIRD_PARTY_NOTICES.md 正文。 */
function renderNotices(facts) {
  const lines = [GPL_NOTICE.trimEnd()]
  for (const component of facts.components) {
    const textPath = `licenses/npm/${component.name}@${component.version}/LICENSE`
    lines.push(row(component.name, component.version, component.license, textPath))
  }
  lines.push('')
  lines.push(`| Electron | ${facts.electronDist.electronVersion} | MIT | \`release/win-unpacked/LICENSE.electron.txt\`（随发行体分发） |`)
  lines.push(`| Chromium（随 Electron 分发） | — | 见汇总 | \`release/win-unpacked/LICENSES.chromium.html\`（20MB 全量第三方许可汇总，随发行体分发） |`)
  lines.push('')
  lines.push('### 许可证全文索引')
  lines.push('')
  lines.push('各 npm 组件的许可全文已复制到 `licenses/npm/<组件>@<版本>/LICENSE`，随软件一起分发：')
  lines.push('')
  for (const component of facts.components) {
    lines.push(`- \`${component.name}@${component.version}\` — ${component.license}${component.attribution ? `。${component.attribution}` : ''}`)
  }
  lines.push('')
  lines.push('### 说明')
  lines.push('')
  lines.push('- Electron 虽列于 devDependencies，但其二进制随软件分发，故按分发组件对待，不因 dev 标志豁免。')
  lines.push('- 社区桌面运行体（community-desktop）随本安装包分发，位于 `resources/runtimes/community-desktop-0.21.0-win-x64.zip`；其完整第三方声明随运行体自身携带（压缩包内 `source-notices/`），来源与哈希记录见 `manifests/source-provenance.json`。')
  lines.push('- 官方桌面版与 Web 运行体（Node.js 发行版、@deepseek-ai/dsh 等）仍为新建实例时按需下载，不随本软件分发；其许可与来源记录见 `manifests/source-provenance.json` 与各运行体自带的声明文件。')
  lines.push('- 构建/开发依赖不进分发包，其许可清单由 `hub/package-lock.json` 记录，不在此重复列举。')
  lines.push('')
  return lines.join('\n')
}

/** 生成 JSON 形式的索引（供 --check 精确对账）。 */
function renderIndex(facts) {
  const index = {
    schemaVersion: 1,
    generatedFrom: {
      lock: 'hub/package-lock.json',
      installedTree: 'hub/node_modules',
      electronDist: 'hub/release/win-unpacked',
    },
    project: {
      name: facts.pkg.name,
      version: facts.pkg.version,
      license: 'GPL-3.0-or-later',
      licenseFile: 'licenses/GPL-3.0.txt',
      licenseSha256: facts.gpl.stats.sha256,
    },
    packagedNpm: facts.components.map(component => ({
      name: component.name,
      version: component.version,
      license: component.license,
      featherAttribution: component.attribution ?? null,
      source: component.source,
      integrity: component.integrity,
      textFile: `licenses/npm/${component.name}@${component.version}/LICENSE`,
      sha256: sha256(Buffer.from(component.licenseText, 'utf8')),
    })),
    electronDist: {
      version: facts.electronDist.electronVersion,
      licenseFile: 'release/win-unpacked/LICENSE.electron.txt',
      licenseSha256: facts.electronDist.electronLicenseStats.sha256,
      chromiumNoticesFile: 'release/win-unpacked/LICENSES.chromium.html',
      chromiumSha256: facts.electronDist.chromiumStats.sha256,
    },
  }
  return index
}

async function writeGenerated(facts) {
  await mkdir(NPM_TEXT_DIR, { recursive: true })
  for (const component of facts.components) {
    const target = path.join(NPM_TEXT_DIR, `${component.name}@${component.version}`)
    await mkdir(target, { recursive: true })
    await cp(component.licenseFile, path.join(target, 'LICENSE'), { force: true })
  }
  await writeFile(NOTICES_PATH, renderNotices(facts), 'utf8')
  const index = renderIndex(facts)
  await writeFile(path.join(LICENSES_DIR, 'third-party-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return index
}

/** --check：重算事实并与磁盘上的生成物逐字节对账。 */
async function checkGenerated() {
  const facts = await collectFacts()
  const expectedNotices = renderNotices(facts)
  const expectedIndex = `${JSON.stringify(renderIndex(facts), null, 2)}\n`
  const actualNotices = await readFile(NOTICES_PATH, 'utf8').catch(() => null)
  const actualIndex = await readFile(path.join(LICENSES_DIR, 'third-party-index.json'), 'utf8').catch(() => null)
  const failures = []
  if (actualNotices !== expectedNotices) failures.push('THIRD_PARTY_NOTICES.md 与 lock/实际安装不一致（或不存在）')
  if (actualIndex !== expectedIndex) failures.push('licenses/third-party-index.json 不一致（或不存在）')
  for (const component of facts.components) {
    const textPath = path.join(NPM_TEXT_DIR, `${component.name}@${component.version}`, 'LICENSE')
    const actual = await readFile(textPath, 'utf8').catch(() => null)
    if (actual !== component.licenseText) failures.push(`${component.name}@${component.version} 的许可全文与实际安装不一致（或未复制）`)
  }
  if (failures.length > 0) {
    console.error(`--check 失败（${failures.length} 项）：`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('--check 通过：声明文件、许可文本索引与 package-lock / 实际安装完全一致。')
}

async function main() {
  if (process.argv.includes('--check')) {
    await checkGenerated()
    return
  }
  const facts = await collectFacts()
  const index = await writeGenerated(facts)
  console.log(`已生成 ${path.relative(REPO_ROOT, NOTICES_PATH)}`)
  console.log(`已生成 ${path.relative(REPO_ROOT, path.join(LICENSES_DIR, 'third-party-index.json'))}`)
  for (const component of index.packagedNpm) {
    console.log(`  复制 ${component.name}@${component.version} 许可全文 -> ${component.textFile}`)
  }
  console.log(`Electron ${index.electronDist.version} 分发许可已引用（LICENSE.electron.txt + LICENSES.chromium.html）。`)
}

main().catch(error => {
  console.error(`生成失败：${error.message}`)
  process.exit(1)
})

