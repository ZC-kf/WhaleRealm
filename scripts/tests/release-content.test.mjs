import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanReleaseEntries } from '../lib/release-content.mjs'

function asar(files) {
  const root = { files: {} }; const payload = []; let offset = 0
  for (const [name, value] of Object.entries(files)) {
    const parts = name.split('/'); let dir = root
    for (const part of parts.slice(0, -1)) dir = (dir.files[part] ??= { files: {} })
    const packed = typeof value === 'string' || Buffer.isBuffer(value)
    const data = Buffer.from(packed ? value : '')
    dir.files[parts.at(-1)] = packed ? { offset: String(offset), size: data.length } : value
    payload.push(data); offset += data.length
  }
  const json = Buffer.from(JSON.stringify(root)); const size = 8 + Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(8 + size)
  header.writeUInt32LE(4, 0); header.writeUInt32LE(size, 4)
  header.writeUInt32LE(size - 4, 8); header.writeUInt32LE(json.length, 12); json.copy(header, 16)
  return Buffer.concat([header, ...payload])
}
const clean = { 'dist/index.html': 'ok', 'dist-electron/main.js': 'ok', 'dist-electron/preload.mjs': 'ok', 'docs/guide.md': 'ok', 'licenses/GPL-3.0.txt': 'ok', 'licenses/THIRD_PARTY_NOTICES.md': 'ok' }
function scan(files, extra = []) {
  return scanReleaseEntries([
    { name: 'resources/app.asar', read: () => asar(files) },
    { name: 'LICENSE.electron.txt', read: () => Buffer.from('ok') },
    { name: 'LICENSES.chromium.html', read: () => Buffer.from('ok') }, ...extra,
  ])
}
test('valid packed files satisfy exact required paths', () => assert.deepEqual(scan(clean), []))
test('API key in packed JavaScript fails', () => assert.match(scan({ ...clean, 'dist/secret.js': 'sk-abcdefghijklmnopqrstuv' }).join('\n'), /API Key/))
test('nested user data paths fail', () => assert.match(scan({ ...clean, 'nested/instances/user.txt': 'private' }).join('\n'), /禁止条目/))
test('body marker strings cannot impersonate required files', () => assert.match(scan({ 'fake.txt': JSON.stringify(clean) }).join('\n'), /dist-electron\/main.js/))
test('unpacked mapping is scanned and missing mappings fail', () => {
  const files = { ...clean, 'dist/secret.js': { size: 23, unpacked: true } }
  assert.match(scan(files).join('\n'), /unpacked/)
  assert.match(scan(files, [{ name: 'resources/app.asar.unpacked/dist/secret.js', read: () => Buffer.from('sk-abcdefghijklmnopqrst') }]).join('\n'), /API Key/)
})
test('unsafe names, out-of-bounds offsets and links fail closed', () => {
  for (const [name, value] of [['../escape.js', 'x'], ['dist/x.js', { offset: '9999999', size: 10 }], ['dist/link.js', { link: '../../outside' }]]) {
    assert.ok(scan({ ...clean, [name]: value }).length > 0)
  }
})
test('truncated ASAR fails closed', () => assert.match(scanReleaseEntries([{ name: 'resources/app.asar', read: () => Buffer.alloc(3) }]).join('\n'), /ASAR/))
test('nested ASAR secrets are inspected recursively', () => {
  const nested = asar({ 'secret.js': 'sk-abcdefghijklmnopqrstuv' })
  assert.match(scan({ ...clean, 'assets/nested.asar': nested }).join('\n'), /API Key/)
})
test('oversized entries fail instead of silently skipping scans', () => {
  const failures = scanReleaseEntries([{ name: 'big.js', size: 257 * 1024 * 1024, read: () => { throw new Error('must not read') } }])
  assert.match(failures.join('\n'), /条目过大，扫描未完成/)
})
test('duplicate and traversal unpacked members fail closed', () => {
  for (const name of ['resources/../escape.js', 'resources/app.asar']) assert.ok(scan(clean, [{ name, read: () => Buffer.from('ok') }]).length)
})
