# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'hub self-repair units' {
  $lib = "$PSScriptRoot\..\lib\hub-repair.ps1"

  Context 'host-only electron environment' {
    It 'removes an inherited ELECTRON_RUN_AS_NODE so the Hub starts as a GUI app' {
      . $lib
      $env:ELECTRON_RUN_AS_NODE = '1'
      $removed = Clear-HostOnlyElectronEnv
      $removed | Should Be $true
      $env:ELECTRON_RUN_AS_NODE | Should Be $null
    }

    It 'reports nothing removed when the variable was already absent' {
      . $lib
      Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      $removed = Clear-HostOnlyElectronEnv
      $removed | Should Be $false
    }
  }

  Context 'instance registry repair' {
    It 'leaves a valid registry untouched' {
      . $lib
      $root = Join-Path $TestDrive 'ok-hub'
      $dir = Join-Path $root 'hub-data'
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      $file = Join-Path $dir 'instances.json'
      '[{"id":"stable","port":19391}]' | Set-Content -LiteralPath $file -Encoding UTF8
      $result = Repair-InstanceRegistry -HubRoot $root
      $result.Status | Should Be 'ok'
      (Test-Path -LiteralPath $file) | Should Be $true
    }

    It 'backs up and clears a corrupt registry so the Hub can start fresh' {
      . $lib
      $root = Join-Path $TestDrive 'bad-hub'
      $dir = Join-Path $root 'hub-data'
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      $file = Join-Path $dir 'instances.json'
      '{"id": broken json' | Set-Content -LiteralPath $file -Encoding UTF8
      $result = Repair-InstanceRegistry -HubRoot $root
      $result.Status | Should Be 'repaired'
      (Test-Path -LiteralPath $file) | Should Be $false
      (Test-Path -LiteralPath $result.Backup) | Should Be $true
      (Get-Content -Raw -LiteralPath $result.Backup) | Should Match 'broken json'
    }

    It 'reports absent when there is no registry yet' {
      . $lib
      $root = Join-Path $TestDrive 'empty-hub'
      New-Item -ItemType Directory -Path $root -Force | Out-Null
      $result = Repair-InstanceRegistry -HubRoot $root
      $result.Status | Should Be 'absent'
    }
  }

  Context 'electron dist repair' {
    It 'recreates a missing path.txt when the electron binary is present' {
      . $lib
      $electronRoot = Join-Path $TestDrive 'electron'
      $dist = Join-Path $electronRoot 'dist'
      New-Item -ItemType Directory -Path $dist -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $dist 'electron.exe') -Value 'stub' -Encoding ASCII
      $result = Repair-ElectronPathFile -ElectronRoot $electronRoot
      $result.Status | Should Be 'repaired'
      (Get-Content -Raw -LiteralPath (Join-Path $electronRoot 'path.txt')).Trim() | Should Be 'electron.exe'
    }

    It 'reports ok when path.txt already matches' {
      . $lib
      $electronRoot = Join-Path $TestDrive 'electron-ok'
      $dist = Join-Path $electronRoot 'dist'
      New-Item -ItemType Directory -Path $dist -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $dist 'electron.exe') -Value 'stub' -Encoding ASCII
      Set-Content -LiteralPath (Join-Path $electronRoot 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ASCII
      $result = Repair-ElectronPathFile -ElectronRoot $electronRoot
      $result.Status | Should Be 'ok'
    }

    It 'reports a missing dist instead of pretending to repair' {
      . $lib
      $electronRoot = Join-Path $TestDrive 'electron-none'
      New-Item -ItemType Directory -Path $electronRoot -Force | Out-Null
      $result = Repair-ElectronPathFile -ElectronRoot $electronRoot
      $result.Status | Should Be 'missing-dist'
    }
  }

  Context 'artifact inventory' {
    It 'lists every missing artifact for an empty hub root' {
      . $lib
      $root = Join-Path $TestDrive 'bare-hub'
      New-Item -ItemType Directory -Path $root -Force | Out-Null
      $missing = @((Get-MissingHubArtifacts -HubRoot $root).Items)
      ($missing -contains 'hubExecutable') | Should Be $true
      ($missing -contains 'rendererBundle') | Should Be $true
      ($missing -contains 'mainBundle') | Should Be $true
      ($missing -contains 'electronDist') | Should Be $true
    }

    It 'reports nothing missing when every artifact exists' {
      . $lib
      $root = Join-Path $TestDrive 'full-hub'
      New-Item -ItemType Directory -Path (Join-Path $root 'hub\release\win-unpacked') -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $root 'hub\dist') -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $root 'hub\dist-electron') -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $root 'hub\node_modules\electron\dist') -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $root 'hub\release\win-unpacked\WhaleRealm.exe') -Value 'stub' -Encoding ASCII
      Set-Content -LiteralPath (Join-Path $root 'hub\dist\index.html') -Value '<html></html>' -Encoding ASCII
      Set-Content -LiteralPath (Join-Path $root 'hub\dist-electron\main.js') -Value '// stub' -Encoding ASCII
      Set-Content -LiteralPath (Join-Path $root 'hub\node_modules\electron\dist\electron.exe') -Value 'stub' -Encoding ASCII
      $missing = @((Get-MissingHubArtifacts -HubRoot $root).Items)
      ($missing.Count) | Should Be 0
    }
  }
}
