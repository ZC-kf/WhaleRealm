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

import { createElement, type ReactNode } from 'react'

/**
 * 内置文档用的轻量 Markdown 渲染：标题、段落、加粗/斜体、行内代码、代码块、
 * 无序/有序列表、表格、引用、分割线、链接。全部输出 React 元素，不经过
 * dangerouslySetInnerHTML，天然免疫 HTML 注入。
 */

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

export function renderInline(text: string, base: number, onOpenLink?: (url: string) => void): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0
  let match: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**') && token.length > 4) {
      nodes.push(createElement('strong', { key: `s-${base}-${index++}` }, token.slice(2, -2)))
    } else if (token.startsWith('*') && token.length > 2) {
      nodes.push(createElement('em', { key: `e-${base}-${index++}` }, token.slice(1, -1)))
    } else if (token.startsWith('`')) {
      nodes.push(createElement('code', { key: `c-${base}-${index++}` }, token.slice(1, -1)))
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) {
        nodes.push(createElement('a', {
          key: `l-${base}-${index++}`,
          href: link[2],
          onClick: (event: { preventDefault(): void }) => { event.preventDefault(); onOpenLink?.(link[2]) },
        }, link[1]))
      } else {
        nodes.push(token)
      }
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
}

const isTableSeparator = (line: string) => line.includes('-') && /^[\s|:-]+$/.test(line)

export function renderMarkdown(source: string, onOpenLink?: (url: string) => void): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  const inline = (text: string) => renderInline(text, key++, onOpenLink)

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    if (line.startsWith('```')) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i += 1 }
      i += 1
      blocks.push(createElement('pre', { key: `pre-${key++}` }, createElement('code', null, buf.join('\n'))))
      continue
    }
    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(createElement(`h${level}`, { key: `h-${key++}` }, ...inline(heading[2])))
      i += 1
      continue
    }
    // 分割线
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { blocks.push(createElement('hr', { key: `hr-${key++}` })); i += 1; continue }
    // 引用
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      blocks.push(createElement('blockquote', { key: `bq-${key++}` },
        ...buf.map((item, j) => createElement('p', { key: j }, ...inline(item)))))
      continue
    }
    // 表格（当前行含 |，下一行是分隔行）
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = parseTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseTableRow(lines[i])); i += 1 }
      blocks.push(createElement('table', { key: `t-${key++}` },
        createElement('thead', null,
          createElement('tr', null, header.map((cell, j) => createElement('th', { key: j }, ...inline(cell.trim()))))),
        createElement('tbody', null,
          rows.map((row, r) => createElement('tr', { key: r },
            row.map((cell, j) => createElement('td', { key: j }, ...inline(cell.trim()))))))))
      continue
    }
    // 列表
    const listMatch = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!m) break
        items.push(m[2])
        i += 1
      }
      const children = items.map((item, j) => createElement('li', { key: j }, ...inline(item)))
      blocks.push(createElement(ordered ? 'ol' : 'ul', { key: `li-${key++}` }, ...children))
      continue
    }
    // 空行
    if (!line.trim()) { i += 1; continue }
    // 段落：合并连续的非特殊行
    const buf: string[] = [line]
    i += 1
    while (i < lines.length) {
      const next = lines[i]
      if (!next.trim()) break
      if (/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s|\s*[-*_]{3,}\s*$)/.test(next)) break
      if (next.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break
      buf.push(next)
      i += 1
    }
    blocks.push(createElement('p', { key: `p-${key++}` }, ...inline(buf.join(' '))))
  }
  return blocks
}
