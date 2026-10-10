# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'process ancestry resolution' {
  $lib = "$PSScriptRoot\..\lib\process-ancestry.ps1"

  It 'includes an ancestor pid in a descendant chain' {
    . $lib
    $childScript = Join-Path $TestDrive 'child.ps1'
    'Start-Sleep -Seconds 45' | Set-Content -LiteralPath $childScript
    $parent = Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','$childScript' -WindowStyle Hidden -PassThru | ForEach-Object { `$_.Id } | Set-Content '$TestDrive\childpid.txt'; Start-Sleep -Seconds 45" -WindowStyle Hidden -PassThru
    try {
      $deadline = (Get-Date).AddSeconds(30)
      $childPid = 0
      while ((Get-Date) -lt $deadline -and $childPid -eq 0) {
        Start-Sleep -Milliseconds 500
        $f = Join-Path $TestDrive 'childpid.txt'
        if (Test-Path $f) { $childPid = [int](Get-Content -Raw $f).Trim() }
      }
      $childPid | Should Not Be 0
      $chain = @(Get-ProcessAncestry $childPid)
      ($chain -contains $parent.Id) | Should Be $true
      ($chain -contains $childPid) | Should Be $true
    } finally {
      Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent.ProcessId)" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Stop-Process -Id $parent.Id -Force -ErrorAction SilentlyContinue
    }
  }

  It 'does not include an unrelated pid in the chain' {
    . $lib
    $stranger = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -WindowStyle Hidden -PassThru
    $other = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -WindowStyle Hidden -PassThru
    try {
      $chain = @(Get-ProcessAncestry $stranger.Id)
      ($chain -contains $other.Id) | Should Be $false
    } finally {
      Stop-Process -Id $stranger.Id -Force -ErrorAction SilentlyContinue
      Stop-Process -Id $other.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
