# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [Parameter(Mandatory = $true)]
  [string]$Output,
  [switch]$AsObject
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Classification([string]$Name, [bool]$IsDirectory) {
  if ($IsDirectory) {
    switch -Regex ($Name) {
      '^deepseek-harness$' { return 'source' }
      '^DSH-Desktop-source-audit$' { return 'source-audit' }
      '^DSH-Desktop$' { return 'runtime' }
      '^deepseek-harness-desktop$' { return 'runtime' }
      '^dsh-browser$' { return 'related-source' }
      '^dsh-browser-(backups|baseline-.+)$' { return 'backup' }
      '^dsh-worktable$' { return 'artifact' }
      default { return 'unclassified' }
    }
  }
  if ($Name -match '(?i)deepseek|dsh|harness' -and $Name -match '(?i)\.(tgz|tar\.gz|zip|exe|msi|dmg|7z)$') {
    return 'artifact'
  }
  return 'unclassified'
}

function Get-DirectorySummary([string]$Path) {
  $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|\.dsh-build|target)\\' })
  $measure = $files | Measure-Object -Property Length -Sum
  $bytes = if ($null -eq $measure -or $null -eq $measure.Sum) { 0 } else { $measure.Sum }
  $latestItem = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $latest = if ($null -eq $latestItem) { $null } else { $latestItem.LastWriteTime }
  return [ordered]@{
    fileCount = $files.Count
    bytes = [int64]$bytes
    latestWriteTime = if ($latest) { $latest.ToUniversalTime().ToString('o') } else { $null }
  }
}

$rootPath = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$items = @()
$knownDirectories = @(
  'deepseek-harness',
  'DSH-Desktop-source-audit',
  'DSH-Desktop',
  'deepseek-harness-desktop',
  'dsh-browser',
  'dsh-browser-backups',
  'dsh-browser-baseline-652cca',
  'dsh-worktable'
)

foreach ($name in $knownDirectories) {
  $path = Join-Path $rootPath $name
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
  $summary = Get-DirectorySummary $path
  $items += [ordered]@{
    relativePath = $name
    path = $path
    kind = Get-Classification $name $true
    exists = $true
    lastWriteTime = (Get-Item -LiteralPath $path).LastWriteTime.ToUniversalTime().ToString('o')
    fileCount = $summary.fileCount
    bytes = $summary.bytes
    latestWriteTime = $summary.latestWriteTime
  }
}

$rootFiles = @(Get-ChildItem -LiteralPath $rootPath -File -Force -ErrorAction SilentlyContinue |
  Where-Object { (Get-Classification $_.Name $false) -eq 'artifact' })
foreach ($file in $rootFiles) {
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $items += [ordered]@{
    relativePath = $file.Name
    path = $file.FullName
    kind = 'artifact'
    exists = $true
    lastWriteTime = $file.LastWriteTime.ToUniversalTime().ToString('o')
    fileCount = 1
    bytes = [int64]$file.Length
    sha256 = $hash
  }
}

$result = [ordered]@{
  schema = 'dsh-hub.asset-inventory.v1'
  generatedAt = [DateTime]::UtcNow.ToString('o')
  root = $rootPath
  items = @($items)
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8
if ($AsObject) { [pscustomobject]$result }
