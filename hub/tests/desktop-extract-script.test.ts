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

import { describe, expect, it } from 'vitest'
import { extractScript } from '../electron/adapters/desktop'

/*
 * Regression guard for the 100%-Desktop-deploy-failure escape bug.
 *
 * `extractScript` is a TypeScript *template literal* that embeds a PowerShell
 * script. Backslash escapes inside a template literal are interpreted by TS
 * BEFORE the text is written to the .ps1 file, so the authored source and the
 * evaluated (on-disk) bytes differ:
 *
 *   - TS source `\.`  → invalid escape → evaluates to bare `.`
 *   - TS source `\\.` → evaluates to a literal `\.`
 *   - TS source `\x00` → VALID hex escape → evaluates to a real NUL byte
 *   - TS source `\\x00` → evaluates to the literal text `\x00`
 *
 * The original `(?:\\.|$)`/`\x00` combination therefore shipped a .NET regex
 * `(?:.|$)` — where `.` is a wildcard — which matched ANY filename starting
 * with con/prn/aux/nul/com1-9/lpt1-9, wrongly rejecting legitimate members such
 * as constants.js / configuration.js / connection.js ("Unsafe ZIP path").
 *
 * These tests pin the *evaluated* script text so the same trap cannot return.
 */

describe('extractScript escaping', () => {
  it('keeps a literal `\\.` in the reserved-device-name alternation', () => {
    // Matched against the evaluated script, i.e. exactly what gets written to disk.
    const found = /-match '([^']*)'\) \{throw 'Unsafe ZIP path'\}/.exec(extractScript)
    expect(found, 'reserved-name -match pattern must be present').not.toBeNull()
    const pattern = found![1]
    // `(?:\\.|$)` in this TS source is the two-char `\.` — a literal dot in .NET.
    expect(pattern).toContain('(?:\\.|$)')
    // The buggy form (bare wildcard `.`) must never come back.
    expect(pattern).not.toContain('(?:.|$)')
  })

  it('keeps `\\x00-\\x1f` as literal text, not raw control characters', () => {
    const found = /-match '([^']*)'\) \{throw 'Unsafe ZIP path'\}/.exec(extractScript)
    const pattern = found![1]
    // `'\\x00-\\x1f'` here is the 10-char text `\x00-\x1f` (.NET parses the range).
    expect(pattern).toContain('\\x00-\\x1f')
    // And the raw control characters must be absent from the evaluated pattern.
    for (const ch of pattern) {
      const code = ch.codePointAt(0)!
      expect(code >= 0x20 || code === 0x0a || code === 0x0d || code === 0x09).toBe(true)
    }
  })

  it('evaluates the whole script with no stray control characters', () => {
    for (const ch of extractScript) {
      const code = ch.codePointAt(0)!
      expect(code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d, `unexpected control char U+${code.toString(16)}`).toBe(true)
    }
  })

  it('keeps the backslash-in-entry-name guard intact', () => {
    // Evaluated text must be PowerShell single-quoted `'\'` (a literal backslash).
    expect(extractScript).toContain("$name.Contains('\\')")
  })
})

describe('extractScript reserved-name regex behaves correctly', () => {
  // Compile the *evaluated* pattern. JS and .NET agree on `\.`, `\x00` and `$`
  // semantics for this pattern; the `i` flag mirrors PowerShell `-match` being
  // case-insensitive (as does safePath's own `/i` on line 20).
  const pattern = /-match '([^']*)'\) \{throw 'Unsafe ZIP path'\}/.exec(extractScript)![1]
  const regex = new RegExp(pattern, 'i')

  it('rejects genuine Windows reserved device names', () => {
    for (const name of ['con', 'CON', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9', 'nul.txt', 'con.json']) {
      expect(regex.test(name), `${name} must be rejected`).toBe(true)
    }
  })

  it('accepts legitimate members that previously triggered the bug', () => {
    for (const name of ['constants.js', 'configuration.js', 'connection.js', 'console.md', 'content', 'controller.js', 'nullish.js', 'auxiliary.txt', 'lptheory']) {
      expect(regex.test(name), `${name} must be accepted`).toBe(false)
    }
  })

  it('accepts ordinary packaging members', () => {
    for (const name of ['resources', 'locales', 'app.asar', 'index.html', 'main.js', 'preload.mjs', 'package.json', 'node_modules', 'dsh']) {
      expect(regex.test(name), `${name} must be accepted`).toBe(false)
    }
  })

  it('still rejects control characters and trailing dot/space', () => {
    expect(regex.test('a\u0000b')).toBe(true)
    expect(regex.test('a\u001fb')).toBe(true)
    expect(regex.test('name.')).toBe(true)
    expect(regex.test('name ')).toBe(true)
    expect(regex.test('na<me')).toBe(true)
  })
})
