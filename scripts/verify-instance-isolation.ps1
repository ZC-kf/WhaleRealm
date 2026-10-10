# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Evidence,
  [string]$HubRoot = $(if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' })
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { [Console]::Error.WriteLine($Message); exit 1 }

# A port belongs to an instance when the listener PID is that instance's PID or one of its
# descendants; a listener outside the instance's own process tree is a real violation.
. (Join-Path $PSScriptRoot 'lib\process-ancestry.ps1')

$hubRoot = [IO.Path]::GetFullPath($HubRoot).TrimEnd('\')
$data = Get-Content -LiteralPath (Resolve-Path -LiteralPath $Evidence) -Raw | ConvertFrom-Json
if (@($data.instances).Count -ne 2) { Fail 'Isolation evidence must contain exactly two instances.' }
$items = @($data.instances)

$stateFields = @('dshHome','userData','desktopProfile','logs','lockName','port','pid','skillPaths')
foreach ($field in $stateFields) {
  $values = @($items | ForEach-Object { [string]$_.$field })
  if (($values | Sort-Object -Unique).Count -ne 2) { Fail "Duplicate isolation field: $field" }
}

foreach ($item in $items) {
  $id = [string]$item.id
  $expectedRoot = [IO.Path]::GetFullPath((Join-Path $hubRoot ('instances\' + $id)))
  foreach ($field in @('dshHome','userData','desktopProfile','logs')) {
    $path = [IO.Path]::GetFullPath([string]$item.$field)
    if (-not ($path -eq $expectedRoot -or $path.StartsWith("$expectedRoot\", [StringComparison]::OrdinalIgnoreCase))) {
      Fail "Field $field for $id is not under its instance root: $path"
    }
    if (-not (Test-Path -LiteralPath $path)) { Fail "Field $field for $id does not exist: $path" }
  }
  foreach ($skill in @($item.skillPaths)) {
    if (-not (Test-Path -LiteralPath ([IO.Path]::GetFullPath([string]$skill)))) { Fail "Skill path does not exist for ${id}: $skill" }
  }
  $pidValue = [int]$item.pid
  if ($pidValue -le 0) { Fail "Instance $id has no live PID." }
  if (-not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { Fail "Instance $id PID $pidValue is not running." }
  $port = [int]$item.port
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' } |
    Select-Object -First 1
  if (-not $listener) { Fail "Instance $id port $port is not listening." }
  $owner = [int]$listener.OwningProcess
  $ancestry = @(Get-ProcessAncestry $owner)
  if (-not $ancestry.Contains($pidValue)) {
    Fail "Instance $id port $port is owned by PID $owner, which is outside the process tree of PID $pidValue."
  }
  Write-Output "Instance ${id}: port $port listener PID $owner is inside process tree of PID $pidValue."
}

if (-not $data.distinct.roots -or -not $data.distinct.ports -or -not $data.distinct.locks -or -not $data.distinct.skills) { Fail 'Evidence distinct flags are not all true.' }
Write-Output 'Instance isolation evidence verified against live state.'
exit 0
