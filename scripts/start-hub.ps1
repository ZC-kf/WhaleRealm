# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param([string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$hubRoot = [IO.Path]::GetFullPath($HubRoot)
$exe = Join-Path $hubRoot 'hub\release\win-unpacked\WhaleRealm.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Hub is not packaged: $exe" }

# Hub 本身是 Electron 应用。若从 DSH 宿主环境启动，继承的 ELECTRON_RUN_AS_NODE=1 会让它
# 退化成纯 Node 并拒绝 Electron 参数，因此启动前必须清除（与 official-runner 的修复同理）。
$env:DSH_HUB_ROOT = $hubRoot
$env:DSH_HUB_MODE = 'desktop'
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -PassThru
Start-Sleep -Seconds 4
if ($process.HasExited) { throw "Hub exited immediately with code $($process.ExitCode)." }
Write-Output "HUB_PID=$($process.Id)"
Write-Output "HUB_EXE=$exe"
exit 0
