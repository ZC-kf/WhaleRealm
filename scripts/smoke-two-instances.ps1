# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][string]$First = 'stable',
  [Parameter(Mandatory = $false)][string]$Second = 'beta',
  [Parameter(Mandatory = $false)][string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [Parameter(Mandatory = $false)][string]$Evidence = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$HubRoot = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($Evidence)) { $Evidence = Join-Path $HubRoot 'manifests\two-instance-smoke.json' }

$registryPath = Join-Path $HubRoot 'hub-data\instances.json'
if (-not (Test-Path -LiteralPath $registryPath)) { throw "runner not built: instance registry is absent" }
$records = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json)
$selected = @($records | Where-Object { $_.id -eq $First -or $_.id -eq $Second })
if ($selected.Count -ne 2) { throw "runner not built: both instances must be registered before smoke" }
foreach ($record in $selected) {
  $runner = if ($record.runtimeRoot) { Join-Path $record.runtimeRoot 'DeepSeek Harness.exe' } else { '' }
  if ([string]::IsNullOrWhiteSpace($runner) -or -not (Test-Path -LiteralPath $runner)) { throw "runner not built for instance $($record.id)" }
}
throw 'smoke launch requires the Hub IPC host; no process was spawned by this preflight script'
