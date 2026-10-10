# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'DSH inventory contract' {
  BeforeAll {
    $scriptRoot = Split-Path -Parent $PSScriptRoot
    $script:inventoryScript = Join-Path $scriptRoot 'inventory-dsh.ps1'
    $script:verifyScript = Join-Path $scriptRoot 'verify-assets.ps1'
  }

  It 'classifies known DSH roots without classifying unrelated browser sources as runtimes' {
    $root = Join-Path $TestDrive 'source'
    New-Item -ItemType Directory -Path (Join-Path $root 'deepseek-harness') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'dsh-browser') -Force | Out-Null
    $output = Join-Path $TestDrive 'inventory.json'

    $result = & $script:inventoryScript -Root $root -Output $output -AsObject

    ($result.items | Where-Object relativePath -eq 'deepseek-harness').kind | Should Be 'source'
    ($result.items | Where-Object relativePath -eq 'dsh-browser').kind | Should Not Be 'runtime'
  }

  It 'rejects an unverified migration manifest' {
    $manifest = Join-Path $TestDrive 'migration.json'
    Set-Content -LiteralPath $manifest -Value '{"verified":false,"entries":[]}' -Encoding utf8
    $powershell = (Get-Command powershell.exe).Source
    $arguments = "-NoProfile -NonInteractive -File `"$script:verifyScript`" -Manifest `"$manifest`""

    $process = Start-Process -FilePath $powershell -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden

    $process.ExitCode | Should Be 1
  }
}
