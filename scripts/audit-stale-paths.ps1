# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
<#
  audit-stale-paths.ps1 - find references to DSH asset paths that no longer exist.

  Run this after ANY relocation. It matches both the plain form (D:\foo) and the
  JSON-escaped form (D:\\foo), because a naive single-backslash regex silently misses
  every manifest - that false negative was hit for real during this project.

  Hits are classified, because not every reference should be rewritten:
    MUST-FIX  current-state catalogues and anything that is executed or resolved at runtime
    FROZEN    historical evidence snapshots; rewriting them falsifies the record
    BY-DESIGN the relocation script's own input list

  ASCII only: PowerShell 5.1 mis-decodes a BOM-less non-ASCII script.
#>
[CmdletBinding()]
param(
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [string]$MoveRecord = '',
  [string]$Desktop = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hubRoot = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($MoveRecord)) { $MoveRecord = Join-Path $hubRoot 'manifests\archive-moves.txt' }
if ([string]::IsNullOrWhiteSpace($Desktop)) { $Desktop = [Environment]::GetFolderPath('Desktop') }

# old path -> new path
$map = [ordered]@{}
if (Test-Path -LiteralPath $MoveRecord) {
  foreach ($line in @(Get-Content -LiteralPath $MoveRecord)) {
    if ($line -match '^#' -or [string]::IsNullOrWhiteSpace($line)) { continue }
    $fields = $line -split '\|'
    if ($fields.Count -ge 2) { $map[$fields[0]] = $fields[1] }
  }
}
if ($map.Count -eq 0) { Write-Host "No move record found at $MoveRecord; nothing to audit."; exit 0 }
$olds = @($map.Keys)

# Files whose recorded paths are historical evidence and must stay frozen.
$frozen = @('asset-inventory.json', 'migration.json', 'source-lock.json', 'archive-moves.txt', 'runner-patches.json')
# Files that legitimately contain the OLD paths because they perform the move.
$byDesign = @('archive-dsh-assets.ps1')

$hits = New-Object System.Collections.Generic.List[object]
function Add-Hit([string]$Class, [string]$Where, [string]$Old, [string]$Detail) {
  $hits.Add([pscustomobject]@{ Class = $Class; Where = $Where; OldPath = $Old; NewPath = $map[$Old]; Detail = $Detail })
}

function Scan-TextFile([string]$Path, [string]$Class) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $lines = @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    foreach ($old in $olds) {
      if ($line.Contains($old) -or $line.Contains($old.Replace('\', '\\'))) {
        Add-Hit $Class ("{0}:{1}" -f $Path, ($i + 1)) $old $line.Trim()
      }
    }
  }
}

function Get-ClassFor([string]$FileName) {
  if ($frozen -contains $FileName) { return 'FROZEN' }
  if ($byDesign -contains $FileName) { return 'BY-DESIGN' }
  return 'MUST-FIX'
}

Write-Host "=== auditing $($olds.Count) relocated paths ==="

# 1. Hub manifests, scripts and docs
$scanFiles = New-Object System.Collections.Generic.List[string]
foreach ($dir in @((Join-Path $hubRoot 'manifests'), (Join-Path $hubRoot 'scripts'))) {
  if (Test-Path -LiteralPath $dir) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Include '*.json', '*.ps1', '*.ts', '*.cjs', '*.cmd', '*.md' -ErrorAction SilentlyContinue)) {
      $scanFiles.Add($f.FullName)
    }
  }
}
foreach ($f in @(Get-ChildItem -LiteralPath $hubRoot -File -Filter '*.md' -ErrorAction SilentlyContinue)) { $scanFiles.Add($f.FullName) }
foreach ($f in $scanFiles) { Scan-TextFile $f (Get-ClassFor ([IO.Path]::GetFileName($f))) }

# 2. Instance registry and Hub config are runtime-resolved, so any hit is a real break.
$registry = Join-Path $hubRoot 'hub-data\instances.json'
Scan-TextFile $registry 'MUST-FIX'

# 3. Documents on the Desktop
if (Test-Path -LiteralPath $Desktop) {
  foreach ($f in @(Get-ChildItem -LiteralPath $Desktop -File -Filter '*.md' -ErrorAction SilentlyContinue)) {
    Scan-TextFile $f.FullName 'MUST-FIX'
  }
}

# 4. Shortcuts: resolve the real target instead of grepping binary .lnk bytes.
$shell = New-Object -ComObject WScript.Shell
$lnkDirs = @($Desktop, (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'), (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'))
foreach ($dir in $lnkDirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  foreach ($lnk in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter '*.lnk' -Force -ErrorAction SilentlyContinue)) {
    try {
      $sc = $shell.CreateShortcut($lnk.FullName)
      foreach ($value in @($sc.TargetPath, $sc.WorkingDirectory)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        foreach ($old in $olds) {
          if ($value.StartsWith($old, [StringComparison]::OrdinalIgnoreCase)) {
            Add-Hit 'MUST-FIX' $lnk.FullName $old $value
          }
        }
      }
    } catch { }
  }
}

# 5. Autostart and scheduled tasks
$runKeys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
)
# StrictMode turns any $null member access into a terminating error, and scheduled
# tasks / registry values can legitimately be empty, so every probe is guarded.
try {
  foreach ($key in $runKeys) {
    if (-not (Test-Path $key)) { continue }
    $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($null -eq $props) { continue }
    foreach ($name in @($props.PSObject.Properties.Name)) {
      if ($name -like 'PS*') { continue }
      $value = ''
      try { if ($null -ne $props.$name) { $value = [string]($props.$name -join ' ') } } catch { $value = '' }
      foreach ($old in $olds) { if ($value -like "*$old*") { Add-Hit 'MUST-FIX' "$key\$name" $old $value } }
    }
  }
} catch { Write-Host "[warn] registry autostart scan skipped: $($_.Exception.Message)" }

try {
  foreach ($task in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
    if ($null -eq $task) { continue }
    $actions = @()
    try { if ($null -ne $task.Actions) { $actions = @($task.Actions) } } catch { $actions = @() }
    foreach ($action in $actions) {
      if ($null -eq $action) { continue }
      $execute = ''
      $arguments = ''
      try { if ($null -ne $action.Execute) { $execute = [string]$action.Execute } } catch { }
      try { if ($null -ne $action.Arguments) { $arguments = [string]$action.Arguments } } catch { }
      $command = "$execute $arguments"
      foreach ($old in $olds) {
        if ($command -like "*$old*") {
          $taskName = ''
          try { $taskName = ("Task {0}{1}" -f $task.TaskPath, $task.TaskName) } catch { $taskName = 'Task <unknown>' }
          Add-Hit 'MUST-FIX' $taskName $old $command
        }
      }
    }
  }
} catch { Write-Host "[warn] scheduled task scan skipped: $($_.Exception.Message)" }

# 6. The live DSH home is read-only here: report, never modify.
$liveHome = Join-Path $env:USERPROFILE '.dsh'
if (Test-Path -LiteralPath $liveHome) {
  Scan-TextFile (Join-Path $liveHome 'settings.yaml') 'MUST-FIX'
  $profiles = Join-Path $liveHome 'profiles'
  if (Test-Path -LiteralPath $profiles) {
    foreach ($f in @(Get-ChildItem -LiteralPath $profiles -Recurse -File -Include '*.yml', '*.yaml', '*.json' -Force -ErrorAction SilentlyContinue | Select-Object -First 200)) {
      Scan-TextFile $f.FullName 'MUST-FIX'
    }
  }
}

# 7. Report
$groups = $hits | Group-Object Class
foreach ($group in $groups) {
  Write-Host ''
  Write-Host "--- $($group.Name) ($($group.Count)) ---"
  foreach ($hit in $group.Group) {
    Write-Host ("  {0}" -f $hit.Where)
    Write-Host ("      old: {0}" -f $hit.OldPath)
    Write-Host ("      new: {0}" -f $hit.NewPath)
    if ($hit.Detail) { Write-Host ("      line: {0}" -f $hit.Detail) }
  }
}
$mustFix = @($hits | Where-Object { $_.Class -eq 'MUST-FIX' })
Write-Host ''
Write-Host ("total hits={0}  mustFix={1}  frozen={2}  byDesign={3}" -f $hits.Count, $mustFix.Count, @($hits | Where-Object { $_.Class -eq 'FROZEN' }).Count, @($hits | Where-Object { $_.Class -eq 'BY-DESIGN' }).Count)

$out = Join-Path $hubRoot 'manifests\stale-path-audit.txt'
$report = New-Object System.Collections.Generic.List[string]
$report.Add('# stale path audit ' + (Get-Date).ToUniversalTime().ToString('o'))
$report.Add('# class|where|oldPath|newPath')
foreach ($hit in $hits) { $report.Add(('{0}|{1}|{2}|{3}' -f $hit.Class, $hit.Where, $hit.OldPath, $hit.NewPath)) }
Set-Content -LiteralPath $out -Value ($report -join [Environment]::NewLine) -Encoding UTF8
Write-Host "report: $out"

if ($mustFix.Count -gt 0) { exit 2 }
exit 0
