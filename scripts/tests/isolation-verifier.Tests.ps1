# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'instance isolation verifier' {
  It 'rejects fabricated evidence with nonexistent paths' {
    $root = Join-Path $TestDrive 'iso'
    $evidence = Join-Path $root 'evidence.json'
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $instances = @(
      @{ id = 'stable'; pid = 999991; port = 19991; dshHome = (Join-Path $root 'nope1'); userData = (Join-Path $root 'nope1b'); desktopProfile = (Join-Path $root 'nope1c'); logs = (Join-Path $root 'nope1d'); lockName = 'lock-a'; skillPaths = @((Join-Path $root 'skill1')) },
      @{ id = 'beta'; pid = 999992; port = 19992; dshHome = (Join-Path $root 'nope2'); userData = (Join-Path $root 'nope2b'); desktopProfile = (Join-Path $root 'nope2c'); logs = (Join-Path $root 'nope2d'); lockName = 'lock-b'; skillPaths = @((Join-Path $root 'skill2')) }
    )
    @{ instances = $instances; distinct = @{ roots = $true; ports = $true; locks = $true; skills = $true } } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidence
    & "$PSScriptRoot\..\verify-instance-isolation.ps1" -Evidence $evidence -HubRoot $root
    $LASTEXITCODE | Should Be 1
  }
}
