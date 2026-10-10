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
import { spawnOwnedProcess, bounded, ProcessCleanupError, type OwnedProcessOptions } from './process-supervisor'
/** Finite commands share the exact runtime ownership and exit-confirmation path. */
export async function runOwnedCommand(executable:string,args:string[],timeoutMs:number,options:OwnedProcessOptions={}):Promise<void>{
 const handle=await spawnOwnedProcess(executable,args,options)
 try{const exit=await bounded(handle.exited,timeoutMs,'Command');options.signal?.throwIfAborted();if(exit.code!==0)throw new Error(`Command exited ${exit.code}: ${executable}`)}
 catch(error){try{await handle.stop()}catch(stopError){throw new ProcessCleanupError(`Command failed: ${String(error)}; cleanup failed: ${String(stopError)}`)}throw error}
}
