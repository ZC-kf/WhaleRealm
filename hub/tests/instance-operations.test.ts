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

import { expect, it } from 'vitest'
import { createInstanceOperations } from '../electron/instance-operations'

it('queues operations for one instance while allowing an independent instance to finish', async () => {
  const operations = createInstanceOperations()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const order: string[] = []
  const a = operations.run('a', async () => { order.push('create'); await gate; order.push('created'); return 1 })
  const restore = operations.run('a', async () => { order.push('restore'); return 2 })
  const b = operations.run('b', async () => { order.push('other'); return 3 })
  expect(await b).toBe(3); expect(order).toEqual(['create', 'other'])
  release(); expect(await a).toBe(1); expect(await restore).toBe(2)
  expect(order).toEqual(['create', 'other', 'created', 'restore'])
})

it('continues the instance queue after rejected and synchronously throwing operations', async () => {
  const operations = createInstanceOperations()
  const failed = operations.run('a', async () => { throw new Error('first failure') })
  const thrown = operations.run('a', () => { throw new Error('sync failure') })
  const last = operations.run('a', async () => 7)
  await expect(failed).rejects.toThrow('first failure'); await expect(thrown).rejects.toThrow('sync failure')
  expect(await last).toBe(7)
})
