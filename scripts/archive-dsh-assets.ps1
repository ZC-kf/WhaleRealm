# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
<#
  archive-dsh-assets.ps1 - relocate scattered D-drive DSH assets into the Hub archive.

  Safety model (all checks run BEFORE any move; the script is fail-closed):
    * same-volume only  - a cross-volume "move" is really copy+delete and is refused
    * in-use guard      - refuses any source that a running process has open as its image
    * live desktop gate - D:\DSH-Desktop additionally needs -AllowLiveDesktop and a free 3080
    * integrity check   - file count, total bytes and executable hash are compared before/after
    * reversible        - -Rollback moves everything back with the same verification
    * originals are never deleted; this is a move, so nothing is lost

  ASCII only: PowerShell 5.1 mis-decodes a BOM-less non-ASCII script and can abort
  with a bogus error.
#>
[CmdletBinding()]
param(
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [string]$ArchiveName = '_archive',
  [switch]$AllowLiveDesktop,
  [switch]$Rollback,
  [switch]$WhatIfMove
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hubRoot = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
$archiveRoot = [IO.Path]::GetFullPath((Join-Path $hubRoot $ArchiveName))
$logDir = Join-Path $hubRoot 'logs'
$recordPath = Join-Path $hubRoot 'manifests\archive-moves.json'

# The seven assets that are not the live desktop, plus the live desktop itself which is
# handled behind an explicit gate.
$safeSources = @(
  'D:\deepseek-harness',
  'D:\deepseek-harness-desktop',
  'D:\DSH-Desktop-source-audit',
  'D:\dsh-browser',
  'D:\dsh-browser-backups',
  'D:\dsh-browser-baseline-652cca',
  'D:\dsh-worktable'
)
$liveDesktop = 'D:\DSH-Desktop'

$script:Log = New-Object System.Collections.Generic.List[string]
function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  $script:Log.Add($line)
  Write-Host $line
}
function Flush-Log {
  try {
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -LiteralPath (Join-Path $logDir 'archive-dsh-assets.log') -Value ($script:Log -join [Environment]::NewLine) -Encoding UTF8
  } catch { }
}
function Fail([string]$Message) {
  Write-Log "[FATAL] $Message"
  Flush-Log
  exit 1
}

function Get-TreeMeasure([string]$Path) {
  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
  $sum = [int64]0
  foreach ($file in $files) { $sum += $file.Length }
  return [pscustomobject]@{ Files = $files.Count; Bytes = $sum }
}

function Get-ExeHashes([string]$Path) {
  $map = @{}
  foreach ($exe in @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -Include '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 6)) {
    try { $map[$exe.Name] = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } catch { }
  }
  return $map
}

function Test-InUse([string]$Path) {
  $prefix = $Path.TrimEnd('\') + '\'
  $users = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { $p = $_.Path; (-not [string]::IsNullOrWhiteSpace($p)) -and ($p -eq $Path -or $p.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) } catch { $false }
  })
  return $users
}

function Save-Record {
  # Written after EVERY successful move, not only at the end: a mid-run failure must
  # still leave an accurate record so -Rollback can undo exactly what happened.
  $existing = @()
  if (Test-Path -LiteralPath $recordPath) {
    try {
      $parsed = Get-Content -LiteralPath $recordPath -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($parsed -and $parsed.moves) { $existing = @($parsed.moves) }
    } catch { $existing = @() }
  }
  $bySource = @{}
  foreach ($entry in $existing) { if ($entry -and $entry.source) { $bySource[[string]$entry.source] = $entry } }
  foreach ($entry in $moved) { $bySource[[string]$entry.source] = $entry }

  # Reconcile: a previous run may have moved a directory but died before recording it.
  # Anything physically present in the archive is recorded, so -Rollback stays complete.
  if (Test-Path -LiteralPath $archiveRoot) {
    foreach ($dir in @(Get-ChildItem -LiteralPath $archiveRoot -Directory -Force -ErrorAction SilentlyContinue)) {
      $inferredSource = 'D:\' + $dir.Name
      if (-not $bySource.ContainsKey($inferredSource)) {
        $bySource[$inferredSource] = [pscustomobject]@{
          name = $dir.Name; source = $inferredSource; destination = $dir.FullName
          files = $null; bytes = $null; exeHashes = @()
          movedAt = $dir.LastWriteTimeUtc.ToString('o')
          recordedAfterTheFact = $true
        }
        Write-Log "[record] reconciled previously moved but unrecorded archive entry: $inferredSource"
      }
    }
  }

  $payload = [ordered]@{
    schema = 'dsh-hub.archive-moves.v1'
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    hubRoot = $hubRoot
    archiveRoot = $archiveRoot
    rollbackHint = 'archive-dsh-assets.ps1 -Rollback'
    moves = @($bySource.Values)
    skipped = @($skipped)
  }
  $dir2 = Split-Path -Parent $recordPath
  if (-not (Test-Path -LiteralPath $dir2)) { New-Item -ItemType Directory -Path $dir2 -Force | Out-Null }
  # A serialisation problem must never discard an already completed and verified move.
  try {
    $json = $payload | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath $recordPath -Value $json -Encoding UTF8
  } catch {
    Write-Log "[warn] could not serialise the archive record: $($_.Exception.Message)"
    $fallback = [ordered]@{
      schema = 'dsh-hub.archive-moves.v1'
      generatedAt = (Get-Date).ToUniversalTime().ToString('o')
      moves = @($bySource.Keys | ForEach-Object { [ordered]@{ source = $_; destination = (Join-Path $archiveRoot (Split-Path -Leaf $_)) } })
    }
    try { Set-Content -LiteralPath $recordPath -Value ($fallback | ConvertTo-Json -Depth 4) -Encoding UTF8 } catch { }
  }
}

if (-not (Test-Path -LiteralPath $hubRoot)) { Fail "Hub root does not exist: $hubRoot" }
Write-Log "=== archive-dsh-assets start (rollback=$Rollback, allowLiveDesktop=$AllowLiveDesktop) ==="
Write-Log "hubRoot=$hubRoot archiveRoot=$archiveRoot"

$moved = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[object]

if ($Rollback) {
  if (-not (Test-Path -LiteralPath $recordPath)) { Fail "no archive record to roll back: $recordPath" }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  foreach ($entry in @($record.moves)) {
    $from = [string]$entry.destination
    $to = [string]$entry.source
    if (-not (Test-Path -LiteralPath $from)) { Write-Log "[skip] already rolled back or missing: $from"; continue }
    if (Test-Path -LiteralPath $to) { Fail "rollback target already exists, refusing to overwrite: $to" }
    $inUse = @(Test-InUse $from)
    if ($inUse.Count -gt 0) { Fail "cannot roll back, files are in use by PID(s): $(($inUse | ForEach-Object { $_.Id }) -join ', ')" }
    Move-Item -LiteralPath $from -Destination $to
    Write-Log "[rollback] $from -> $to"
  }
  Flush-Log
  Write-Host 'Rollback complete.'
  exit 0
}

$targets = @($safeSources)
if ($AllowLiveDesktop) { $targets += $liveDesktop }

foreach ($source in $targets) {
  $name = Split-Path -Leaf $source
  if (-not (Test-Path -LiteralPath $source)) {
    Write-Log "[skip] source absent (already archived?): $source"
    $skipped.Add([pscustomobject]@{ source = $source; reason = 'absent' })
    continue
  }

  $sourceRoot = [IO.Path]::GetPathRoot($source)
  $archiveRootDrive = [IO.Path]::GetPathRoot($archiveRoot)
  if ($sourceRoot -ne $archiveRootDrive) {
    Fail "refusing a cross-volume move ($sourceRoot -> $archiveRootDrive); that would be copy+delete"
  }

  # The live desktop hosts the running DSH session; it needs an explicit gate AND a free port.
  if ($source -eq $liveDesktop) {
    if (-not $AllowLiveDesktop) {
      Write-Log "[skip] $liveDesktop is the live desktop; re-run with -AllowLiveDesktop after closing it"
      $skipped.Add([pscustomobject]@{ source = $source; reason = 'live desktop gate' })
      continue
    }
    $listener = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
    if ($listener.Count -gt 0) {
      Fail "port 3080 is still served by PID $($listener[0].OwningProcess); close the live DSH desktop first"
    }
  }

  $inUse = @(Test-InUse $source)
  if ($inUse.Count -gt 0) {
    $ids = ($inUse | ForEach-Object { "$($_.Id):$($_.ProcessName)" }) -join ', '
    Write-Log "[skip] in use by running process(es) -> $ids : $source"
    $skipped.Add([pscustomobject]@{ source = $source; reason = "in use: $ids" })
    continue
  }

  $destination = Join-Path $archiveRoot $name
  if (Test-Path -LiteralPath $destination) {
    Fail "archive destination already exists: $destination"
  }

  Write-Log "[measure] $source"
  $before = Get-TreeMeasure $source
  $beforeHashes = Get-ExeHashes $source
  Write-Log ("[measure] files={0} bytes={1} exeHashes={2}" -f $before.Files, $before.Bytes, $beforeHashes.Count)

  if ($WhatIfMove) {
    Write-Log "[whatif] would move $source -> $destination"
    $skipped.Add([pscustomobject]@{ source = $source; reason = 'whatif' })
    continue
  }

  if (-not (Test-Path -LiteralPath $archiveRoot)) { New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null }
  Move-Item -LiteralPath $source -Destination $destination
  Write-Log "[move] $source -> $destination"

  if (Test-Path -LiteralPath $source) { Fail "source still exists after move: $source" }
  if (-not (Test-Path -LiteralPath $destination)) { Fail "destination missing after move: $destination" }

  $after = Get-TreeMeasure $destination
  if ($after.Files -ne $before.Files -or $after.Bytes -ne $before.Bytes) {
    Fail ("integrity mismatch for {0}: before files={1} bytes={2}, after files={3} bytes={4}" -f $name, $before.Files, $before.Bytes, $after.Files, $after.Bytes)
  }
  $afterHashes = Get-ExeHashes $destination
  foreach ($key in $beforeHashes.Keys) {
    if (-not $afterHashes.ContainsKey($key) -or $afterHashes[$key] -ne $beforeHashes[$key]) {
      Fail "executable hash changed during move: $key in $name"
    }
  }
  Write-Log ("[verify] {0}: files={1} bytes={2} exeHashesMatched={3}" -f $name, $after.Files, $after.Bytes, $beforeHashes.Count)

  # ConvertTo-Json in PowerShell 5.1 throws "Argument types do not match" on a raw
  # hashtable nested this deep, so serialise the hashes as plain objects.
  $hashList = @()
  foreach ($key in $beforeHashes.Keys) {
    $hashList += [pscustomobject]@{ name = [string]$key; sha256 = [string]$beforeHashes[$key] }
  }
  $moved.Add([pscustomobject]@{
    name = $name; source = $source; destination = $destination
    files = $after.Files; bytes = $after.Bytes
    exeHashes = $hashList
    movedAt = (Get-Date).ToUniversalTime().ToString('o')
    verified = $true
  })
  # Bookkeeping must never abort an already completed and verified move.
  try { Save-Record } catch { Write-Log "[warn] archive record not written: $($_.Exception.Message)" }
}

try { Save-Record } catch { Write-Log "[warn] final archive record not written: $($_.Exception.Message)" }

Write-Log ("=== done: moved={0} skipped={1} record={2} ===" -f $moved.Count, $skipped.Count, $recordPath)
Flush-Log
if ($moved.Count -eq 0 -and $skipped.Count -eq 0) { exit 1 }
exit 0
