# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'rollback migration guard' {
  It 'refuses to delete a source when the migration manifest is not verified' {
    $manifest = Join-Path $TestDrive 'unverified.json'
    @{ verified = $false; entries = @() } | ConvertTo-Json | Set-Content -LiteralPath $manifest
    & "$PSScriptRoot\..\rollback-migration.ps1" -Manifest $manifest -SourceId 'source-a' -DestinationId 'dest-a'
    $LASTEXITCODE | Should Be 1
  }

  It 'requires explicit source and destination ids' {
    $manifest = Join-Path $TestDrive 'verified.json'
    @{ verified = $true; entries = @() } | ConvertTo-Json | Set-Content -LiteralPath $manifest
    & "$PSScriptRoot\..\rollback-migration.ps1" -Manifest $manifest
    $LASTEXITCODE | Should Be 1
  }

  It 'refuses a verified manifest whose destination is outside imports' {
    $root = Join-Path $TestDrive 'outside-imports'
    $manifest = Join-Path (Join-Path $root 'manifests') 'migration.json'
    $destination = Join-Path (Join-Path $root 'arbitrary') 'asset.txt'
    $source = Join-Path (Join-Path $root 'original') 'asset.txt'
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $manifest) -Force | Out-Null
    @{ verified = $true; entries = @(@{ sourceId = 'source-a'; destinationId = 'dest-a'; source = $source; destination = $destination; kind = 'file'; sourceHash = ('0' * 64); destinationHash = ('0' * 64) }) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest
    & "$PSScriptRoot\..\rollback-migration.ps1" -Manifest $manifest -SourceId 'source-a' -DestinationId 'dest-a'
    $LASTEXITCODE | Should Be 1
  }

  It 'rejects a destination whose content does not match the recorded hash' {
    $root = Join-Path $TestDrive 'tampered-hash'
    $imports = Join-Path $root 'imports'
    $destination = Join-Path $imports 'asset.txt'
    $source = Join-Path (Join-Path $root 'original') 'asset.txt'
    $manifest = Join-Path (Join-Path $root 'manifests') 'migration.json'
    New-Item -ItemType Directory -Path $imports -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $manifest) -Force | Out-Null
    Set-Content -LiteralPath $destination -Value 'tampered' -NoNewline
    @{ verified = $true; entries = @(@{ sourceId = 'source-a'; destinationId = 'dest-a'; source = $source; destination = $destination; kind = 'file'; sourceHash = ('0' * 64); destinationHash = ('0' * 64) }) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest
    & "$PSScriptRoot\..\rollback-migration.ps1" -Manifest $manifest -SourceId 'source-a' -DestinationId 'dest-a'
    $LASTEXITCODE | Should Be 1
    (Test-Path -LiteralPath $source) | Should Be $false
  }
}
