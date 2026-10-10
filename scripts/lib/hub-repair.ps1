# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
# ---------------------------------------------------------------------------
# Self-repair units for the DSH Desktop Instance Hub launcher.
#
# ASCII only: PowerShell 5.1 reads a BOM-less .ps1 with the system code page, so
# non-ASCII text can be mis-decoded and abort the script with a bogus error such
# as "The variable '$x' cannot be retrieved because it has not been set".
#
# Every function here is pure enough to unit-test (scripts/tests/hub-repair.Tests.ps1)
# and reports what it did instead of silently assuming success.
# ---------------------------------------------------------------------------

# Electron inherits ELECTRON_RUN_AS_NODE from a DSH host shell and then runs as
# plain Node, rejecting its own switches with "bad option: --user-data-dir".
# Returns $true when a value was actually removed.
function Clear-HostOnlyElectronEnv {
  $names = @('ELECTRON_RUN_AS_NODE')
  $removed = $false
  foreach ($name in $names) {
    if (Test-Path "Env:\$name") {
      Remove-Item "Env:\$name" -Force -ErrorAction SilentlyContinue
      $removed = $true
    }
  }
  return $removed
}

# A corrupt instance registry would make the Hub throw on startup. Back the broken
# file up (never delete outright) and let the Hub recreate a clean registry.
# Status: ok | repaired | absent
function Repair-InstanceRegistry {
  param([Parameter(Mandatory = $true)][string]$HubRoot)
  $file = Join-Path $HubRoot 'hub-data\instances.json'
  if (-not (Test-Path -LiteralPath $file)) {
    return [pscustomobject]@{ Status = 'absent'; Path = $file; Backup = $null }
  }
  $raw = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
  $valid = $false
  if ($raw) {
    try { $null = $raw | ConvertFrom-Json; $valid = $true } catch { $valid = $false }
  }
  if ($valid) {
    return [pscustomobject]@{ Status = 'ok'; Path = $file; Backup = $null }
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$file.corrupt-$stamp"
  Move-Item -LiteralPath $file -Destination $backup -Force
  return [pscustomobject]@{ Status = 'repaired'; Path = $file; Backup = $backup }
}

# electron-builder and the electron npm package both need path.txt next to dist.
# Recreating it from an existing binary is safe; inventing the binary is not.
# Status: ok | repaired | missing-dist
function Repair-ElectronPathFile {
  param([Parameter(Mandatory = $true)][string]$ElectronRoot)
  $exe = Join-Path $ElectronRoot 'dist\electron.exe'
  $pathFile = Join-Path $ElectronRoot 'path.txt'
  if (-not (Test-Path -LiteralPath $exe)) {
    return [pscustomobject]@{ Status = 'missing-dist'; Path = $pathFile; Executable = $exe }
  }
  $current = $null
  if (Test-Path -LiteralPath $pathFile) { $current = (Get-Content -LiteralPath $pathFile -Raw).Trim() }
  if ($current -eq 'electron.exe') {
    return [pscustomobject]@{ Status = 'ok'; Path = $pathFile; Executable = $exe }
  }
  Set-Content -LiteralPath $pathFile -Value 'electron.exe' -NoNewline -Encoding ASCII
  return [pscustomobject]@{ Status = 'repaired'; Path = $pathFile; Executable = $exe }
}

# Names (not guesses) of the artifacts a launch needs, so the doctor can decide
# whether to rebuild rather than failing with an opaque Electron error.
# Possible keys: hubExecutable | rendererBundle | mainBundle | electronDist
function Get-MissingHubArtifacts {
  param([Parameter(Mandatory = $true)][string]$HubRoot)
  $checks = [ordered]@{
    hubExecutable  = (Join-Path $HubRoot 'hub\release\win-unpacked\WhaleRealm.exe')
    rendererBundle = (Join-Path $HubRoot 'hub\dist\index.html')
    mainBundle     = (Join-Path $HubRoot 'hub\dist-electron\main.js')
    electronDist   = (Join-Path $HubRoot 'hub\node_modules\electron\dist\electron.exe')
  }
  $missing = @()
  foreach ($key in $checks.Keys) {
    if (-not (Test-Path -LiteralPath $checks[$key])) { $missing += $key }
  }
  # Return an object rather than a bare array: an empty array emitted from a
  # function collapses to $null, and under Set-StrictMode the caller's .Count
  # then throws instead of reporting "nothing missing".
  return [pscustomobject]@{ Items = $missing; Checked = $checks }
}

# Resolve the artifact paths the doctor works with, so nothing is hard-coded twice.
function Get-HubLayout {
  param([Parameter(Mandatory = $true)][string]$HubRoot)
  $root = [IO.Path]::GetFullPath($HubRoot)
  return [pscustomobject]@{
    Root            = $root
    HubProject      = (Join-Path $root 'hub')
    Executable      = (Join-Path $root 'hub\release\win-unpacked\WhaleRealm.exe')
    ExecutableDir   = (Join-Path $root 'hub\release\win-unpacked')
    ElectronRoot    = (Join-Path $root 'hub\node_modules\electron')
    Vite            = (Join-Path $root 'hub\node_modules\.bin\vite.cmd')
    ElectronBuilder = (Join-Path $root 'hub\node_modules\.bin\electron-builder.cmd')
    Registry        = (Join-Path $root 'hub-data\instances.json')
    LogDir          = (Join-Path $root 'logs')
    RunnerRoot      = (Join-Path $root 'runtimes\0.1.7-alpha.1')
    Runner          = (Join-Path $root 'runtimes\0.1.7-alpha.1\DeepSeek Harness.exe')
    ArchiveDir      = (Join-Path $root 'hub-archives')
  }
}

# All processes belonging to the packaged Hub, plus which of them are roots.
# Electron children (GPU / renderer / utility) share the exact same image path,
# so only a process whose parent is outside the set can hold the instance lock.
function Get-HubProcessSet {
  param([Parameter(Mandatory = $true)][string]$Executable)
  $exeFull = [IO.Path]::GetFullPath($Executable)
  $all = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      $p = $_.Path
      (-not [string]::IsNullOrWhiteSpace($p) -and [IO.Path]::GetFullPath($p) -eq $exeFull)
    } catch { $false }
  })
  $ids = @($all | ForEach-Object { $_.Id })
  $roots = @($all | Where-Object {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue
    if (-not $info) { return $true }
    $ids -notcontains [int]$info.ParentProcessId
  })
  return [pscustomobject]@{ All = $all; Roots = $roots; Executable = $exeFull }
}
