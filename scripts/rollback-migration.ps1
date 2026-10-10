# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $false)][string]$SourceId,
  [Parameter(Mandatory = $false)][string]$DestinationId,
  [switch]$WhatIf
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { [Console]::Error.WriteLine($Message); exit 1 }
function Get-TreeHash([string]$Path) {
  $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction Stop |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|\.dsh-build|target)\\' } |
    Sort-Object FullName)
  $lines = foreach ($file in $files) {
    $relative = $file.FullName.Substring($Path.TrimEnd('\').Length).TrimStart('\').ToLowerInvariant()
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$relative|$($file.Length)|$hash"
  }
  $payload = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$data = Get-Content -LiteralPath (Resolve-Path -LiteralPath $Manifest) -Raw | ConvertFrom-Json
if (-not $data.verified) { Fail 'Migration manifest is not verified; refusing rollback.' }
if ([string]::IsNullOrWhiteSpace($SourceId) -or [string]::IsNullOrWhiteSpace($DestinationId)) { Fail 'Explicit source and destination ids are required.' }
$entry = @($data.entries | Where-Object { $_.sourceId -eq $SourceId -and $_.destinationId -eq $DestinationId })
if ($entry.Count -ne 1) { Fail "Migration pair not found: $SourceId -> $DestinationId" }
$source = [IO.Path]::GetFullPath([string]$entry[0].source)
$destination = [IO.Path]::GetFullPath([string]$entry[0].destination)
$hubRoot = [IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent (Resolve-Path -LiteralPath $Manifest))))
$activeDsh = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
$importsRoot = [IO.Path]::GetFullPath((Join-Path $hubRoot 'imports'))
if ($source -eq $activeDsh -or $source.StartsWith("$activeDsh\", [StringComparison]::OrdinalIgnoreCase)) { Fail 'Refusing to remove active user DSH state.' }
if ([IO.Path]::GetPathRoot($source) -ne [IO.Path]::GetPathRoot($hubRoot)) { Fail 'Rollback source must remain on the Hub drive.' }
if (-not ($destination -eq $importsRoot -or $destination.StartsWith("$importsRoot\", [StringComparison]::OrdinalIgnoreCase))) { Fail 'Rollback destination must be inside imports.' }
if (-not (Test-Path -LiteralPath $destination)) { Fail "Destination does not exist: $destination" }
$kind = [string]$entry[0].kind
if ($kind -eq 'file') { $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
else { $actualHash = Get-TreeHash $destination }
if ($actualHash -ne [string]$entry[0].destinationHash) { Fail 'Destination content does not match the recorded hash; refusing rollback.' }
if ($WhatIf) { Write-Output "Would restore $source from $destination"; exit 0 }
if (Test-Path -LiteralPath $source) { Fail "Source already exists; refusing overwrite: $source" }
New-Item -ItemType Directory -Path (Split-Path -Parent $source) -Force | Out-Null
Copy-Item -LiteralPath $destination -Destination $source -Recurse -Force
Write-Output "Rollback restored $source"
exit 0
