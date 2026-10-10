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


export interface InstanceOperations { run<T>(id: string, operation: () => Promise<T>): Promise<T> }

/** Queue whole instance operations; registry operations use a separate global queue.
 * Callers must not recursively acquire the same id from inside its operation.
 */
export function createInstanceOperations(): InstanceOperations {
  const tails = new Map<string, Promise<void>>()
  return {
    run<T>(id: string, operation: () => Promise<T>): Promise<T> {
      const result = (tails.get(id) ?? Promise.resolve()).then(operation)
      const tail = result.then(() => undefined, () => undefined)
      tails.set(id, tail)
      void tail.then(() => { if (tails.get(id) === tail) tails.delete(id) })
      return result
    },
  }
}

// Defaults share one queue when both handler sets receive the same registry.
const shared = new WeakMap<object, InstanceOperations>()
export function operationsForRegistry(registry: object): InstanceOperations {
  let operations = shared.get(registry)
  if (!operations) { operations = createInstanceOperations(); shared.set(registry, operations) }
  return operations
}
