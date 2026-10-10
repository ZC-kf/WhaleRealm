# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
Describe 'stop hub' {
  It 'fails closed when the Hub executable is not packaged' {
    & "$PSScriptRoot\..\stop-hub.ps1" -HubRoot (Join-Path $TestDrive 'no-hub')
    $LASTEXITCODE | Should Be 1
  }
}
