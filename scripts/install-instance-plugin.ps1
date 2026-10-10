# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
<#
  install-instance-plugin.ps1 - register a DSH plugin into ONE instance's own desktop
  profile, keeping every instance's plugin config and data fully independent.

  Source kinds:
    directory  shared\plugins\<name>\package.json  -> copied into instances\<id>\plugins\<name>
               so the pnpm "file:" junction target stays inside that instance instead of
               pointing at shared state.
    tarball    shared\plugins\<name>-<version>.tgz -> referenced directly. pnpm extracts a
               tarball into the instance's own store, so the installed copy is per-instance
               even though the pinned artifact is shared read-only.

  Registration is MERGED into the profile's existing package.json. An earlier version of
  this script rewrote package.json from a fixed template, which silently dropped every
  previously registered plugin - installing a second plugin wiped the first.

  ASCII only: PowerShell 5.1 mis-decodes a BOM-less non-ASCII script.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstanceId,
  [Parameter(Mandatory = $true)][string]$PluginName,
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }),
  [string]$SourceRoot = '',
  [string]$Tarball = '',
  [string]$Pnpm = '',
  [switch]$SkipInstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hubRoot = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Join-Path $hubRoot 'shared\plugins' }
if ([string]::IsNullOrWhiteSpace($Pnpm)) { $Pnpm = Join-Path $hubRoot 'upstream\deepseek-harness\node_modules\.bin\pnpm.cmd' }

function Fail([string]$Message) { Write-Host "[FATAL] $Message" -ForegroundColor Red; exit 1 }
function Step([string]$Message) { Write-Host "[step] $Message" }

# --- guards -------------------------------------------------------------------
$registryPath = Join-Path $hubRoot 'hub-data\instances.json'
if (-not (Test-Path -LiteralPath $registryPath)) { Fail "instance registry missing: $registryPath" }
# No @() wrapper: ConvertFrom-Json already returns Object[] for a top-level JSON array and
# wrapping it again yields one element that IS the array, so $r.id member-enumerates into
# "a b c" and never matches. This trap was hit three times in this project.
$records = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$record = $null
foreach ($r in $records) { if ([string]$r.id -eq $InstanceId) { $record = $r } }
if ($null -eq $record) { Fail "instance '$InstanceId' is not registered in the Hub" }

$instanceRoot = [string]$record.root
if ([string]::IsNullOrWhiteSpace($instanceRoot)) { $instanceRoot = Join-Path $hubRoot "instances\$InstanceId" }
if (-not (Test-Path -LiteralPath $instanceRoot)) { Fail "instance root missing: $instanceRoot" }

# --- resolve the plugin source ------------------------------------------------
$sourceDir = Join-Path $SourceRoot $PluginName
$sourceKind = ''
$installedFrom = ''

if (-not [string]::IsNullOrWhiteSpace($Tarball)) {
  if (-not (Test-Path -LiteralPath $Tarball)) { Fail "tarball not found: $Tarball" }
  $sourceKind = 'tarball'
  $installedFrom = [IO.Path]::GetFullPath($Tarball)
} elseif (Test-Path -LiteralPath (Join-Path $sourceDir 'package.json')) {
  $sourceKind = 'directory'
  $installedFrom = $sourceDir
} else {
  $candidates = @(Get-ChildItem -LiteralPath $SourceRoot -File -Filter "$PluginName-*.tgz" -ErrorAction SilentlyContinue)
  if ($candidates.Count -ge 1) {
    $sourceKind = 'tarball'
    $installedFrom = $candidates[0].FullName
  } else {
    Fail "no plugin source for '$PluginName' in $SourceRoot (expected a directory with package.json, or <name>-<version>.tgz)"
  }
}
Step "plugin source: $sourceKind -> $installedFrom"

$profileDir = Join-Path $instanceRoot 'dsh-home\profiles\desktop'
if (-not (Test-Path -LiteralPath $profileDir)) {
  Write-Host "[warn] profile dir absent, creating it: $profileDir"
  Write-Host '[warn] the Desktop app normally scaffolds this on first launch. A hand-made profile'
  Write-Host '       keeps its package.json across launch (verified), and the app adds the rest.'
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

# --- 1. directory sources get a per-instance physical copy --------------------
$fileSpec = ''
if ($sourceKind -eq 'directory') {
  $pluginTarget = Join-Path $instanceRoot "plugins\$PluginName"
  Step "copying plugin source into the instance: $pluginTarget"
  New-Item -ItemType Directory -Path (Split-Path -Parent $pluginTarget) -Force | Out-Null
  & robocopy.exe $installedFrom $pluginTarget /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP /MT:16 /XD node_modules .git | Out-Null
  $rcExit = $LASTEXITCODE
  if ($rcExit -ge 8) { Fail "robocopy failed with exit code $rcExit" }
  $copied = @(Get-ChildItem -LiteralPath $pluginTarget -Recurse -File -Force -ErrorAction SilentlyContinue)
  Write-Host ("[step] copied {0} files (robocopy exit {1})" -f $copied.Count, $rcExit)
  $fileSpec = 'file:' + ($pluginTarget -replace '\\', '/')
} else {
  # A pinned tarball is shared read-only; pnpm extracts it per instance.
  $fileSpec = 'file:' + ($installedFrom -replace '\\', '/')
}

# --- 2. MERGE the registration into this instance's own package.json ---------
$packagePath = Join-Path $profileDir 'package.json'
$pkg = $null
if (Test-Path -LiteralPath $packagePath) {
  Copy-Item -LiteralPath $packagePath -Destination "$packagePath.pre-$PluginName" -Force
  Write-Host "[step] backed up package.json to package.json.pre-$PluginName"
  try { $pkg = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $pkg = $null }
  if ($null -eq $pkg) { Write-Host '[warn] existing package.json did not parse; starting from the default template' }
}
if ($null -eq $pkg) {
  $pkg = [pscustomobject]@{
    name = 'dsh-profile-desktop'
    private = $true
    dependencies = [pscustomobject]@{}
    dsh = [pscustomobject]@{ profile = [pscustomobject]@{ bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app') } }
  }
}
if (-not ($pkg.PSObject.Properties.Name -contains 'name')) { $pkg | Add-Member -NotePropertyName name -NotePropertyValue 'dsh-profile-desktop' }
if (-not ($pkg.PSObject.Properties.Name -contains 'dependencies')) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $pkg.dependencies) { $pkg.dependencies = [pscustomobject]@{} }
if (-not ($pkg.PSObject.Properties.Name -contains 'dsh') -or $null -eq $pkg.dsh) {
  $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force
}
if ($null -eq $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{ bundles = @() }) -Force }

$beforeDeps = @($pkg.dependencies.PSObject.Properties.Name)
if ($beforeDeps -contains $PluginName) { $pkg.dependencies.$PluginName = $fileSpec }
else { $pkg.dependencies | Add-Member -NotePropertyName $PluginName -NotePropertyValue $fileSpec }

$bundles = @()
if ($null -ne $pkg.dsh.profile.bundles) { $bundles = @($pkg.dsh.profile.bundles) }
$beforeBundles = @($bundles)
if ($bundles -notcontains $PluginName) { $bundles += $PluginName }
$pkg.dsh.profile.bundles = $bundles

$json = $pkg | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($packagePath, $json, (New-Object Text.UTF8Encoding($false)))
Step "registered '$PluginName'; bundles now: $($bundles -join ', ')"
Write-Host ("[step] preserved {0} pre-existing dependency(ies): {1}" -f $beforeDeps.Count, $(if ($beforeDeps.Count -gt 0) { $beforeDeps -join ', ' } else { '(none)' }))

# verify the merge round-trips and kept every prior registration
$check = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$checkBundles = @($check.dsh.profile.bundles)
foreach ($prior in $beforeBundles) {
  if ($checkBundles -notcontains $prior) { Fail "merge lost a previously registered bundle: $prior" }
}
if ($checkBundles -notcontains $PluginName) { Fail "merge did not register $PluginName" }

# --- 3. install into this instance's own node_modules ------------------------
if (-not $SkipInstall) {
  if (-not (Test-Path -LiteralPath $Pnpm)) { Fail "pnpm not found: $Pnpm" }
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Step "running pnpm install inside $profileDir"
  Push-Location $profileDir
  try {
    & $Pnpm install 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host "  | $_" }
    $pnpmExit = $LASTEXITCODE
  } finally { Pop-Location }
  if ($pnpmExit -ne 0) { Fail "pnpm install failed with exit code $pnpmExit" }
}

# --- 4. verify independence: nothing may resolve outside this instance -------
$installed = Join-Path $profileDir "node_modules\$PluginName"
if (-not (Test-Path -LiteralPath $installed)) { Fail "install produced no node_modules\$PluginName" }
$item = Get-Item -LiteralPath $installed -Force
$linkType = ''
$target = ''
if ($item.LinkType) { $linkType = [string]$item.LinkType; $target = [string]$item.Target }
if ([string]::IsNullOrWhiteSpace($target)) {
  $insideInstance = $true
} else {
  $insideInstance = $target.StartsWith($instanceRoot, [StringComparison]::OrdinalIgnoreCase)
  if (($target -like '*shared\plugins*') -or ($target -like "*$env:USERPROFILE*")) {
    Fail "installed plugin resolves to shared or user-profile state: $target"
  }
}
if (-not $insideInstance) { Fail "installed plugin target is not inside the instance root: $target" }

# every registered bundle must still be present after this install
$presentBundles = @()
foreach ($b in $checkBundles) {
  $bPath = Join-Path $profileDir ("node_modules\" + ($b -replace '/', '\'))
  if (Test-Path -LiteralPath $bPath) { $presentBundles += $b }
}

Write-Host ''
Write-Host '[OK] plugin registered and installed for this instance only.' -ForegroundColor Green
Write-Host ("  instance        : {0}" -f $InstanceId)
Write-Host ("  plugin          : {0}" -f $PluginName)
Write-Host ("  sourceKind      : {0}" -f $sourceKind)
Write-Host ("  installedFrom   : {0}" -f $installedFrom)
Write-Host ("  profile         : {0}" -f $profileDir)
Write-Host ("  linkType        : {0}" -f $(if ([string]::IsNullOrWhiteSpace($linkType)) { '(real directory)' } else { $linkType }))
Write-Host ("  linkTarget      : {0}" -f $(if ([string]::IsNullOrWhiteSpace($target)) { '(none)' } else { $target }))
Write-Host ("  insideInstance  : {0}" -f $insideInstance)
Write-Host ("  bundles declared: {0}" -f ($checkBundles -join ', '))
Write-Host ("  bundles in node_modules (base bundles resolve from the app runtime, not the profile): {0}" -f $(if ($presentBundles.Count -gt 0) { $presentBundles -join ', ' } else { '(none - expected for third-party-only profiles)' }))
Write-Host ''
Write-Host 'Mount proof: launch the instance once, then look for the plugin data dir it creates'
Write-Host ("  cyber          : {0}\dsh-home\dsh-plugin-cyber\default\audit.jsonl  (event plugin.load)" -f $instanceRoot)
Write-Host ("  layered-memory : {0}\dsh-home\memory\  (its cordis.patch.yml defaults dataDir to `$DSH_HOME/memory)" -f $instanceRoot)
exit 0
