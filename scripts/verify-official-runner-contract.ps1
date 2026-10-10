# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
$hubRoot = if ($env:DSH_HUB_ROOT) { $env:DSH_HUB_ROOT } else { Join-Path $PSScriptRoot '..' }
$hostSource = Get-Content -LiteralPath (Join-Path $hubRoot 'upstream\deepseek-harness\apps\desktop-host\src\index.ts') -Raw
$desktopSource = Get-Content -LiteralPath (Join-Path $hubRoot 'upstream\deepseek-harness\apps\desktop\src\main.ts') -Raw
if ($hostSource -notmatch 'DSH_DESKTOP_PORT') { throw 'host port env missing' }
if ($hostSource -match "args: \['--no-open', '--port', '19387'\]") { throw 'hard-coded port remains' }
if ($desktopSource -notmatch "app\.setPath\('userData'") { throw 'userData override missing' }
if ($desktopSource.IndexOf("app.setPath('userData'") -gt $desktopSource.IndexOf('const ownsDesktopInstance')) { throw 'userData override is after lock claim' }
Write-Output 'official runner instance contract: PASS'
