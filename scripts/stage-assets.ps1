# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Inventory,
  [Parameter(Mandatory = $true)]
  [string]$DestinationRoot,
  [Parameter(Mandatory = $false)]
  [ValidatePattern('^[A-Za-z0-9._-]{1,80}$')]
  [string]$BackupToken
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

function Copy-DirectorySafely([string]$Source, [string]$Destination) {
  $temporary = "$Destination.staging-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  & robocopy.exe $Source $temporary /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /XD node_modules .git .dsh-build target | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed for $Source with exit code $LASTEXITCODE" }
  if (Test-Path -LiteralPath $Destination) {
    if ([string]::IsNullOrWhiteSpace($BackupToken)) { throw "Destination already exists: $Destination; supply -BackupToken to replace it" }
    $backup = "$Destination.backup-$BackupToken"
    if (Test-Path -LiteralPath $backup) { throw "Backup destination already exists: $backup" }
    Move-Item -LiteralPath $Destination -Destination $backup
  }
  Move-Item -LiteralPath $temporary -Destination $Destination
}

$inventoryPath = (Resolve-Path -LiteralPath $Inventory).Path
# NOTE: the local variable must not be named $inventory. PowerShell variables are
# case-insensitive, so it would collide with the [string]$Inventory parameter and the
# parsed object would be coerced back to a string, making .items unreachable.
$catalog = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
$hubRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $inventoryPath)))
$destinationRootFull = [System.IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\')
$importsRoot = [System.IO.Path]::GetFullPath((Join-Path $hubRoot 'imports')).TrimEnd('\')
if (-not ($destinationRootFull -eq $importsRoot -or $destinationRootFull.StartsWith("$importsRoot\", [StringComparison]::OrdinalIgnoreCase))) {
  throw "Destination must be inside $importsRoot"
}

New-Item -ItemType Directory -Path $destinationRootFull -Force | Out-Null
$entries = @()
$allowedKinds = @('source', 'source-audit', 'runtime', 'related-source', 'artifact', 'backup')
foreach ($item in @($catalog.items | Where-Object { $allowedKinds -contains $_.kind })) {
  $source = [System.IO.Path]::GetFullPath($item.path)
  if ($source -eq [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh')) -or $source.StartsWith("$([System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh')))\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage active user DSH state: $source"
  }
  $destination = [System.IO.Path]::GetFullPath((Join-Path $destinationRootFull $item.relativePath))
  if (-not (Test-Path -LiteralPath $source)) { throw "Source disappeared: $source" }
  if (Test-Path -LiteralPath $source -PathType Container) {
    Copy-DirectorySafely $source $destination
    $sourceHash = Get-TreeHash $source
    $destinationHash = Get-TreeHash $destination
    $kind = 'directory'
    $bytes = ((Get-ChildItem -LiteralPath $destination -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum)
  } else {
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    if (Test-Path -LiteralPath $destination) {
      if ([string]::IsNullOrWhiteSpace($BackupToken)) { throw "Destination already exists: $destination; supply -BackupToken to replace it" }
      $backup = "$destination.backup-$BackupToken"
      if (Test-Path -LiteralPath $backup) { throw "Backup destination already exists: $backup" }
      Move-Item -LiteralPath $destination -Destination $backup
    }
    Copy-Item -LiteralPath $source -Destination $destination
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $kind = 'file'
    $bytes = (Get-Item -LiteralPath $destination).Length
  }
  # PowerShell 5.1 cannot use "if" inside a parenthesised expression such as
  # [int64](if ... ); it parses "if" as a command name at runtime. Compute first.
  $byteValue = [int64]0
  if ($null -ne $bytes) { $byteValue = [int64]$bytes }
  $entries += [ordered]@{
    sourceId = $item.relativePath
    destinationId = $item.relativePath
    source = $source
    destination = $destination
    relativePath = $item.relativePath
    sourceKind = $item.kind
    kind = $kind
    bytes = $byteValue
    sourceHash = $sourceHash
    destinationHash = $destinationHash
  }
}

$manifest = [ordered]@{
  schema = 'dsh-hub.migration.v1'
  generatedAt = [DateTime]::UtcNow.ToString('o')
  verified = (@($entries).Count -gt 0 -and (@($entries | Where-Object { $_.sourceHash -ne $_.destinationHash }).Count -eq 0))
  entries = @($entries)
}
$migrationPath = Join-Path $hubRoot 'manifests\migration.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $migrationPath) -Force | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $migrationPath -Encoding UTF8
$manifest
