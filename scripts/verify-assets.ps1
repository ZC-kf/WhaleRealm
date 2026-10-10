# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$data = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($data.schema -ne 'dsh-hub.migration.v1') {
  Write-Error 'Unsupported migration manifest schema.'
  exit 1
}
if (-not $data.verified) {
  Write-Error 'Migration manifest is not marked verified.'
  exit 1
}

$failed = $false
foreach ($entry in @($data.entries)) {
  if (-not (Test-Path -LiteralPath $entry.destination)) {
    Write-Error "Missing staged destination: $($entry.destination)"
    $failed = $true
    continue
  }
  if ($entry.kind -eq 'file') {
    $actual = (Get-FileHash -LiteralPath $entry.destination -Algorithm SHA256).Hash.ToLowerInvariant()
  } else {
    $actual = Get-TreeHash $entry.destination
  }
  if ($actual -ne $entry.destinationHash) {
    Write-Error "Hash mismatch: $($entry.destination) expected $($entry.destinationHash), got $actual"
    $failed = $true
  }
}
if ($failed) { exit 1 }
Write-Output "Verified $(@($data.entries).Count) staged entries."
exit 0
