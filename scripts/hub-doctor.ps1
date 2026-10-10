# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
<#
  hub-doctor.ps1 - self-healing launcher for the DSH Desktop Instance Hub.

  Design goal: a double click must end with the Hub open. Every known failure mode
  observed on this machine is detected and repaired automatically, and the launch
  is verified against real process state instead of being assumed successful.

  ASCII only (PowerShell 5.1 mis-decodes BOM-less non-ASCII scripts).
#>
[CmdletBinding()]
param(
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [switch]$ForceRebuild,
  [int]$LaunchTimeoutSeconds = 60,
  [switch]$Quiet
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\hub-repair.ps1')

$script:LogLines = New-Object System.Collections.Generic.List[string]
$script:Actions = New-Object System.Collections.Generic.List[string]

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  $script:LogLines.Add($line)
  if (-not $Quiet) { Write-Host $line }
}

function Add-Action([string]$Message) {
  $script:Actions.Add($Message)
  Write-Log "[repair] $Message"
}

function Fail([string]$Message, [int]$Code = 1) {
  Write-Log "[FATAL] $Message"
  Flush-Log
  if (-not $Quiet) {
    Write-Host ''
    Write-Host "The Hub could not be started: $Message" -ForegroundColor Red
    Write-Host "Full log: $script:LogPath"
  }
  exit $Code
}

function Flush-Log {
  try {
    if (-not (Test-Path -LiteralPath $script:LogDir)) { New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null }
    Add-Content -LiteralPath $script:LogPath -Value ($script:LogLines -join [Environment]::NewLine) -Encoding UTF8
    Add-Content -LiteralPath $script:LogPath -Value ('-' * 72) -Encoding UTF8
  } catch { }
}

function Invoke-Tool([string]$Path, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) { Fail "$Label tool is missing: $Path" }
  Write-Log "[build] $Label ..."
  $output = & $Path @Arguments 2>&1
  $code = $LASTEXITCODE
  foreach ($line in @($output | Select-Object -Last 12)) { Write-Log "  | $line" }
  if ($code -ne 0) { Fail "$Label failed with exit code $code" }
  Write-Log "[build] $Label completed"
}

# --------------------------------------------------------------------------
# 0. Layout, logging, environment
# --------------------------------------------------------------------------
$layout = Get-HubLayout -HubRoot $HubRoot
$script:LogDir = $layout.LogDir
$script:LogPath = Join-Path $script:LogDir ('hub-launch-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))

if (-not (Test-Path -LiteralPath $layout.Root)) { Fail "Hub root does not exist: $($layout.Root)" }
if (-not (Test-Path -LiteralPath $layout.HubProject)) { Fail "Hub project is missing: $($layout.HubProject)" }

Write-Log "=== hub-doctor start ==="
Write-Log "hubRoot=$($layout.Root)"

if (Clear-HostOnlyElectronEnv) {
  Add-Action 'removed inherited ELECTRON_RUN_AS_NODE (would otherwise start the Hub as plain Node)'
}

$env:DSH_HUB_ROOT = $layout.Root
$env:DSH_HUB_MODE = 'desktop'

# --------------------------------------------------------------------------
# 1. Repair persisted state that would make the Hub throw on startup
# --------------------------------------------------------------------------
$registry = Repair-InstanceRegistry -HubRoot $layout.Root
switch ($registry.Status) {
  'repaired' { Add-Action "instance registry was corrupt; backed up to $($registry.Backup) so the Hub can rebuild it" }
  'absent'   { Write-Log '[state] no instance registry yet (first run)' }
  default    { Write-Log '[state] instance registry ok' }
}

$electronRootState = Repair-ElectronPathFile -ElectronRoot $layout.ElectronRoot
if ($electronRootState.Status -eq 'repaired') { Add-Action 'recreated hub\node_modules\electron\path.txt' }

# --------------------------------------------------------------------------
# 2. Repair build artifacts (only what is actually missing)
# --------------------------------------------------------------------------
function Restore-ElectronDist {
  $version = '43.7.3'
  $expectedSha = 'b11a1bf50c1fc4eb8b9ca99cfbb557daab284d739b20f45c1b3b6ce9f673cb32'
  $zip = Join-Path $layout.ArchiveDir "electron-v$version-win32-x64.zip"
  $dist = Join-Path $layout.ElectronRoot 'dist'

  $usable = $false
  if (Test-Path -LiteralPath $zip) {
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -eq $expectedSha) { $usable = $true } else { Write-Log "[build] cached electron zip hash mismatch ($actual); re-downloading" }
  }
  if (-not $usable) {
    New-Item -ItemType Directory -Path $layout.ArchiveDir -Force | Out-Null
    $url = "https://github.com/electron/electron/releases/download/v$version/electron-v$version-win32-x64.zip"
    Write-Log "[build] downloading $url"
    & curl.exe -fL --retry 3 --retry-delay 2 --max-time 900 $url -o $zip
    if ($LASTEXITCODE -ne 0) { Fail "could not download Electron $version (curl exit $LASTEXITCODE)" }
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expectedSha) { Fail "downloaded Electron zip hash mismatch: $actual" }
    Write-Log "[build] electron zip verified sha256=$actual"
  }
  if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
  Write-Log '[build] extracting electron dist ...'
  Expand-Archive -LiteralPath $zip -DestinationPath $dist -Force
  if (-not (Test-Path -LiteralPath (Join-Path $dist 'electron.exe'))) { Fail 'electron extraction produced no electron.exe' }
  $pathFile = Join-Path $layout.ElectronRoot 'path.txt'
  Set-Content -LiteralPath $pathFile -Value 'electron.exe' -NoNewline -Encoding ASCII
  Add-Action "restored hub electron $version dist and path.txt"
}

$missing = @((Get-MissingHubArtifacts -HubRoot $layout.Root).Items)
if ($ForceRebuild) {
  $missing = @('rendererBundle', 'mainBundle', 'hubExecutable')
  Write-Log '[build] forced rebuild requested'
}
if ($missing.Count -gt 0) { Write-Log ("[build] missing artifacts: " + ($missing -join ', ')) }

if ($missing -contains 'electronDist') { Restore-ElectronDist }

if (($missing -contains 'rendererBundle') -or ($missing -contains 'mainBundle')) {
  Invoke-Tool -Path $layout.Vite -Arguments @('build') -WorkingDirectory $layout.HubProject -Label 'vite build'
  Add-Action 'rebuilt hub renderer and main bundles'
}

$stillMissing = @((Get-MissingHubArtifacts -HubRoot $layout.Root).Items)
if (($stillMissing -contains 'hubExecutable') -or $ForceRebuild) {
  $env:CI = '1'
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  Invoke-Tool -Path $layout.ElectronBuilder -Arguments @('--win', '--x64', '--dir', '--publish', 'never') -WorkingDirectory $layout.HubProject -Label 'electron-builder'
  Add-Action 'repackaged hub\release\win-unpacked\WhaleRealm.exe'
}

$finalMissing = @((Get-MissingHubArtifacts -HubRoot $layout.Root).Items)
if (@($finalMissing | Where-Object { $_ -ne 'electronDist' }).Count -gt 0) {
  Fail ("required artifacts are still missing after repair: " + ($finalMissing -join ', '))
}

if (-not (Test-Path -LiteralPath $layout.Runner)) {
  Write-Log "[warn] official Desktop runner is absent: $($layout.Runner)"
  Write-Log '[warn] the Hub will open, but instances cannot start until runtimes\0.1.7-alpha.1 exists.'
}

# --------------------------------------------------------------------------
# 3. Deal with an existing Hub process before launching another one
# --------------------------------------------------------------------------
function Get-RootProcess {
  $set = Get-HubProcessSet -Executable $layout.Executable
  if (@($set.Roots).Count -ge 1) { return ($set.Roots | Select-Object -First 1) }
  if (@($set.All).Count -ge 1) { return ($set.All | Select-Object -First 1) }
  return $null
}

function Stop-HubTree {
  $set = Get-HubProcessSet -Executable $layout.Executable
  foreach ($proc in @($set.All)) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    if (@((Get-HubProcessSet -Executable $layout.Executable).All).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return (@((Get-HubProcessSet -Executable $layout.Executable).All).Count -eq 0)
}

$existing = Get-RootProcess
if ($existing) {
  if ($existing.Responding) {
    Write-Log "[state] Hub already running and responsive (PID $($existing.Id)); bringing it to the front"
    Start-Process -FilePath $layout.Executable -WorkingDirectory $layout.ExecutableDir | Out-Null
    Start-Sleep -Seconds 3
    Flush-Log
    if (-not $Quiet) {
      Write-Host ''
      Write-Host "[OK] DSH Hub was already running (PID $($existing.Id)) and has been brought to the front." -ForegroundColor Green
    }
    exit 0
  }
  Write-Log "[state] Hub PID $($existing.Id) is not responding; terminating it before relaunch"
  if (-not (Stop-HubTree)) { Fail 'an unresponsive Hub process could not be terminated' }
  Add-Action 'terminated an unresponsive Hub process tree before relaunching'
}

# --------------------------------------------------------------------------
# 3b. Reap instances orphaned by a Hub that was force-killed
#
# Windows does NOT terminate children when a parent dies, so killing the Hub from
# Task Manager leaves its Desktop instances running with no owner. This reaper is
# strictly path-scoped to <hubRoot>\runtimes so the user's live DSH Desktop install
# (D:\DSH-Desktop\DeepSeek Harness.exe) can never be matched or touched.
# Instance registry state is untouched: hub-data\instances.json persists, and the
# running/stopped markers live only in Hub memory, so nothing stale is left behind.
# --------------------------------------------------------------------------
function Remove-OrphanedInstances {
  $runtimesRoot = [IO.Path]::GetFullPath((Join-Path $layout.Root 'runtimes'))
  if (-not (Test-Path -LiteralPath $runtimesRoot)) { return @() }
  $reaped = @()
  foreach ($proc in @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
    $path = $null
    try { $path = $proc.Path } catch { $path = $null }
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    $full = [IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith("$runtimesRoot\", [StringComparison]::OrdinalIgnoreCase)) { continue }
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
    $reaped += $proc.Id
  }
  # Plain array return; callers wrap with @() so the empty case stays countable.
  return $reaped
}

$orphans = @(Remove-OrphanedInstances)
if ($orphans.Count -gt 0) {
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $left = @(Remove-OrphanedInstances)
    if ($left.Count -eq 0) { break }
    Start-Sleep -Milliseconds 400
  }
  Add-Action ("reaped {0} instance process(es) orphaned by a previous Hub exit: {1}" -f $orphans.Count, ($orphans -join ', '))
  Write-Log '[state] instance registry preserved; runtime markers are Hub-memory only, so no stale state remains'
}

# --------------------------------------------------------------------------
# 4. Launch, then verify against real process state (retry once)
# --------------------------------------------------------------------------
function Test-LaunchedHub([System.Diagnostics.Process]$Started, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $root = Get-RootProcess
    if ($root) {
      $title = $root.MainWindowTitle
      if ($title -eq 'Error') { return @{ Ok = $false; Reason = 'startup error dialog'; Title = $title } }
      if ($title -like '*WhaleRealm*') { return @{ Ok = $true; Reason = 'visible window'; Title = $title; Pid = $root.Id } }
      if ($title -eq '' -and $root.Responding) { return @{ Ok = $true; Reason = 'running (window hidden in tray)'; Title = $title; Pid = $root.Id } }
    } elseif (-not $Started.HasExited) {
      # still booting, keep waiting
    } else {
      $set = Get-HubProcessSet -Executable $layout.Executable
      if (@($set.All).Count -eq 0) { return @{ Ok = $false; Reason = 'process exited during startup'; Title = '' } }
    }
    Start-Sleep -Milliseconds 700
  }
  return @{ Ok = $false; Reason = "not healthy within $TimeoutSeconds seconds"; Title = '' }
}

$attempt = 0
$launched = $null
while ($attempt -lt 2) {
  $attempt += 1
  Write-Log "[launch] attempt $attempt : starting $($layout.Executable)"
  $proc = Start-Process -FilePath $layout.Executable -WorkingDirectory $layout.ExecutableDir -PassThru
  $result = Test-LaunchedHub -Started $proc -TimeoutSeconds $LaunchTimeoutSeconds
  if ($result.Ok) {
    $launched = $result
    Write-Log "[launch] healthy: pid=$($result.Pid) reason='$($result.Reason)'"
    break
  }
  Write-Log "[launch] attempt $attempt failed: $($result.Reason)"
  if ($attempt -lt 2) {
    Add-Action "launch attempt $attempt failed ($($result.Reason)); cleaning up and retrying"
    if (-not (Stop-HubTree)) { Write-Log '[launch] cleanup did not fully clear the tree' }
    Start-Sleep -Seconds 2
  } else {
    $set = Get-HubProcessSet -Executable $layout.Executable
    Write-Log ("[diag] hub processes remaining: " + (@($set.All | ForEach-Object { "$($_.Id):$($_.MainWindowTitle)" }) -join ' | '))
    Write-Log '[diag] recent application errors:'
    try {
      Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = (Get-Date).AddMinutes(-5) } -MaxEvents 5 -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Log ("  | " + ($_.Message -split "`n")[0]) }
    } catch { }
    Fail "the Hub did not become healthy ($($result.Reason)). See section 11 of the usage guide, items 1-3."
  }
}

Flush-Log
if (-not $Quiet) {
  Write-Host ''
  Write-Host '[OK] DSH Hub is running.' -ForegroundColor Green
  Write-Host "     pid : $($launched.Pid)"
  Write-Host "     exe : $($layout.Executable)"
  if ($script:Actions.Count -gt 0) {
    Write-Host ''
    Write-Host '     Auto-repaired during this launch:'
    foreach ($action in $script:Actions) { Write-Host "       - $action" }
  }
  Write-Host ''
  Write-Host '     NOTE: clicking X only HIDES the Hub to the system tray; it stays resident.'
  Write-Host '           To quit, use the tray icon Exit item.'
  Write-Host '           If the Hub is ever force-killed, the next launch automatically reaps'
  Write-Host '           its orphaned instances and keeps your instance registry intact.'
  Write-Host ''
  Write-Host "     Log: $script:LogPath"
}
exit 0
