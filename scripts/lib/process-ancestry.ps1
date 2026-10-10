# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Linfeng (WhaleRealm)
# Resolve a process's ancestor chain (leaf first) so callers can decide whether one PID
# owns another through the process tree. The Desktop host listens from a child of the
# Electron main process, so port ownership must be judged by ancestry, not equality.
function Get-ProcessAncestry([int]$Leaf) {
  $chain = New-Object System.Collections.Generic.List[int]
  $current = $Leaf
  for ($depth = 0; $depth -lt 24 -and $current -gt 0; $depth += 1) {
    if ($chain.Contains($current)) { break }
    $chain.Add($current)
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    $current = [int]$proc.ParentProcessId
  }
  return $chain
}
