# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [int]$ProcessId,
  [int]$TimeoutSeconds = 45
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { [Console]::Error.WriteLine($Message); exit 1 }

$hubRootFull = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
$exe = Join-Path $hubRootFull 'hub\release\win-unpacked\WhaleRealm.exe'
if (-not (Test-Path -LiteralPath $exe)) { Fail "Hub is not packaged: $exe" }
$exeFull = [IO.Path]::GetFullPath($exe)

# The Electron main process spawns GPU/renderer/utility children that share the exact
# same executable path. Only the root process holds the single-instance lock and answers
# --shutdown, so discovery must select the root; otherwise this script waits on a child
# and reports a false stop failure.
$candidates = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try {
    $procPath = $_.Path
    (-not [string]::IsNullOrWhiteSpace($procPath) -and [IO.Path]::GetFullPath($procPath) -eq $exeFull)
  } catch { $false }
})
$candidateIds = @($candidates | ForEach-Object { $_.Id })
$roots = @($candidates | Where-Object {
  $info = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue
  if (-not $info) { return $true }
  $candidateIds -notcontains [int]$info.ParentProcessId
})

if ($ProcessId -gt 0) {
  $target = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $target) { Fail "PID $ProcessId is not running." }
  $targetPath = $null
  try { $targetPath = $target.Path } catch { $targetPath = $null }
  if ([string]::IsNullOrWhiteSpace($targetPath) -or [IO.Path]::GetFullPath($targetPath) -ne $exeFull) {
    Fail "PID $ProcessId is not the Hub executable: $exeFull"
  }
} elseif ($roots.Count -ge 1) {
  $target = $roots | Select-Object -First 1
} elseif ($candidates.Count -ge 1) {
  $target = $candidates | Select-Object -First 1
} else {
  Write-Output 'Hub is not running.'
  exit 0
}

# The shutdown signal is itself an Electron launch. An inherited ELECTRON_RUN_AS_NODE=1
# would make it run as plain Node, so it could neither trigger second-instance nor
# deliver --shutdown.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exeFull -ArgumentList '--shutdown' -WorkingDirectory (Split-Path -Parent $exeFull) -PassThru | Out-Null

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$stillRunning = $true
while ([DateTime]::UtcNow -lt $deadline) {
  if (-not (Get-Process -Id $target.Id -ErrorAction SilentlyContinue)) { $stillRunning = $false; break }
  Start-Sleep -Milliseconds 300
}
if ($stillRunning) { Fail "Hub PID $($target.Id) did not exit within $TimeoutSeconds seconds." }

# After the main process exits, confirm the whole tree was reclaimed so no orphan
# GPU/renderer child survives.
$leftover = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try {
    $procPath = $_.Path
    (-not [string]::IsNullOrWhiteSpace($procPath) -and [IO.Path]::GetFullPath($procPath) -eq $exeFull)
  } catch { $false }
})
if ($leftover.Count -gt 0) {
  Fail "Hub main process exited but $($leftover.Count) Hub process(es) remain: $(($leftover | ForEach-Object { $_.Id }) -join ', ')"
}
Write-Output "Hub stopped (PID $($target.Id)); no Hub processes remain."
exit 0
