// SPDX-License-Identifier: GPL-3.0-or-later
// Read archive members in memory; never follow archive paths on the host filesystem.
const LIMIT = 256 * 1024 * 1024
const forbiddenPaths = /(^|\/)(instances|hub-data|\.dsh[^/]*|\.git|release|tests|scripts)(\/|$)|(^|\/)(hub-root\.txt|settings\.json)$|(^|\/)node_modules\/\.pnpm\//i
const forbiddenStrings = ['d:\\dsh-hub-hidm', 'd:/dsh-hub-hidm', '/d/dsh-hub-hidm', 'c:\\users\\lenovo', 'dsh-hub-hidm']
const textExtensions = /\.(js|mjs|cjs|json|html?|txt|md|css|ya?ml|map|ts)$/i
const safePath = name => name.length > 0 && !/[\\:\x00-\x1f]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..')

export function scanReleaseEntries(entries) {
  const failures = []; const fail = message => failures.push(message)
  const members = new Map()
  for (const entry of entries) {
    const name = entry.name.replace(/\/$/, '')
    if (!safePath(name)) { fail(`不安全的归档路径：${entry.name}`); continue }
    const key = name.toLowerCase()
    if (members.has(key)) fail(`重复归档路径：${entry.name}`)
    members.set(key, entry)
  }
  const scan = (name, data) => {
    if (forbiddenPaths.test(name)) fail(`含禁止条目：${name}`)
    const lower = (name + '\n' + data.toString('latin1')).toLowerCase()
    for (const value of forbiddenStrings) if (lower.includes(value)) fail(`条目 ${name} 含开发机路径字样：${value}`)
    if (textExtensions.test(name) && /sk-[A-Za-z0-9]{20,}/.test(data.toString('utf8'))) fail(`条目 ${name} 含疑似 API Key（sk-…）`)
  }
  const read = entry => {
    if (entry.size > LIMIT) throw new Error(`条目过大，扫描未完成：${entry.name}`)
    const bytes = entry.read()
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT || (entry.size !== undefined && entry.size !== bytes.length)) throw new Error(`条目大小异常：${entry.name}`)
    return bytes
  }
  const parseAsar = (name, bytes, depth = 0) => {
    if (depth > 8) throw new Error('ASAR 嵌套过深，扫描未完成')
    if (bytes.length < 16 || bytes.readUInt32LE(0) !== 4) throw new Error('ASAR 头损坏')
    const headerSize = bytes.readUInt32LE(4); const jsonSize = bytes.readUInt32LE(12)
    if (headerSize < 8 || headerSize % 4 || headerSize > bytes.length - 8 || bytes.readUInt32LE(8) !== headerSize - 4 || jsonSize > headerSize - 8) throw new Error('ASAR 索引越界')
    const root = JSON.parse(bytes.toString('utf8', 16, 16 + jsonSize)); const paths = new Set(); const seen = new Set()
    const walk = (directory, prefix = '', inheritedUnpacked = false, level = 0) => {
      if (level > 128 || !directory || typeof directory !== 'object' || !directory.files || typeof directory.files !== 'object' || Array.isArray(directory.files)) throw new Error('ASAR 目录结构异常')
      for (const [leaf, node] of Object.entries(directory.files)) {
        const relative = prefix + leaf
        if (!safePath(leaf) || leaf.includes('/') || !node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`ASAR 不安全路径或节点：${relative}`)
        if (seen.has(relative.toLowerCase())) throw new Error(`ASAR 重复路径：${relative}`)
        seen.add(relative.toLowerCase())
        const unpacked = inheritedUnpacked || node.unpacked === true
        if ('link' in node) throw new Error(`ASAR 链接不支持，扫描未完成：${relative}`)
        if ('files' in node) {
          scan(relative, Buffer.alloc(0)); walk(node, relative + '/', unpacked, level + 1); continue
        }
        if (!Number.isSafeInteger(node.size) || node.size < 0 || node.size > LIMIT) throw new Error(`ASAR 文件大小异常：${relative}`)
        let data
        if (unpacked) {
          const entry = members.get(`${name}.unpacked/${relative}`.toLowerCase())
          if (!entry || entry.name.endsWith('/')) throw new Error(`ASAR unpacked 文件缺失：${relative}`)
          data = read(entry)
          if (data.length !== node.size) throw new Error(`ASAR unpacked 文件大小不符：${relative}`)
        } else {
          if (typeof node.offset !== 'string' || !/^\d+$/.test(node.offset)) throw new Error(`ASAR offset 异常：${relative}`)
          const offset = Number(node.offset); const start = 8 + headerSize + offset
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(start) || start > bytes.length || node.size > bytes.length - start) throw new Error(`ASAR 文件越界：${relative}`)
          data = bytes.subarray(start, start + node.size)
        }
        paths.add(relative.toLowerCase()); scan(relative, data)
        if (/\.asar$/i.test(relative)) parseAsar(`${name}/${relative}`, data, depth + 1)
      }
    }
    walk(root)
    return paths
  }
  for (const required of ['resources/app.asar', 'license.electron.txt', 'licenses.chromium.html']) {
    const entry = members.get(required)
    if (!entry || entry.name.endsWith('/')) fail(`缺少必备文件：${required}`)
  }
  for (const entry of members.values()) {
    try {
      if (entry.name.endsWith('/')) { scan(entry.name, Buffer.alloc(0)); continue }
      const data = read(entry); scan(entry.name, data)
      if (/\.asar$/i.test(entry.name)) {
        const paths = parseAsar(entry.name, data)
        if (entry.name.toLowerCase() === 'resources/app.asar') {
          for (const required of ['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.mjs', 'licenses/gpl-3.0.txt', 'licenses/third_party_notices.md']) if (!paths.has(required)) fail(`app.asar 缺少必备文件：${required}`)
          if (![...paths].some(name => name.startsWith('docs/'))) fail('app.asar 缺少 docs/ 文件')
        }
      }
    } catch (error) { fail(`${entry.name} 扫描未完成：${error.message}`) }
  }
  return failures
}
