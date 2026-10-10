# Instance Import and Operation

This document explains how WhaleRealm handles a DeepSeek Harness desktop distribution from discovery and import through start, run, stop and mirror backup.

## 1. Distribution Discovery

Two entry points share the same judgment logic: full-machine scan (Scan and import in Settings / home) and manual import (enter a directory).

Scan candidate sources: top-level directories of all logical drives, top level of `Program Files` and `Program Files (x86)`, one level of `%LOCALAPPDATA%\Programs` and `%LOCALAPPDATA%`, `InstallLocation` under registry `Uninstall`, install directories inferred from running process image paths, plus additionally configured runtime directories and a skip list.

For each candidate directory: `findExecutable` (look for `DeepSeek Harness.exe` or `dsh-desktop.exe`) → `readVersion` → `verifyInstall` (check for `resources/app` or `resources/app.asar`, the evidence of a complete distribution that can actually open) → `isolatableFor` (grade by `manifests/runtime-catalog.json`) → `flavorFor` (desktop / web).

Grades: A / B can be hosted in isolation and imported as startable instances; C is listed but not hosted; unlisted distributions are always treated as not hostable (fail-closed). The import button is enabled only when `verifyInstall` passes; other entries are grayed out.

## 2. Import

Clicking import runs: verify the executable exists → judge isolatable (not hostable → listed only, no instance created) → deduplicate (an already registered runtimeRoot is returned directly) → generate the instance id → `registry.create` writes `hub-data/instances.json` → `snapshotMirror` creates the initial mirror.

The instance registry saves atomically: write a temp file, rename the current file to `.bak`, then rename the temp file into place.

### Create-Instance Pipeline

The toolbar "Create instance" entry runs a four-stage pipeline (`instance-create.ts`):

1. Verify: probe the download link (HEAD) and require the target folder to be absent or empty — failures at this stage never clean the folder (it may belong to the user);
2. Download and deploy: download into a **staging folder owned by this task**, deploy there and report progress (the target folder stays untouched until publish);
3. Self-check: artifact integrity plus a real runtime self-check; on error the staging artifacts are rolled back and cleaned per task ownership;
4. Register: reuse the import flow (deduplicate → create → naming → port → initial mirror), then publish into the target folder.

The three forms:

- Official web edition: the runtime is the npm package `@deepseek-ai/dsh` (only versions that pass integrity verification are listed). Deployment = a self-contained portable Node.js inside the instance folder + `npm install` of dsh; the self-check really starts `dsh web` and probes it over HTTP; the instance is registered as "official web edition". Starting it runs the local service on the instance's own port (`DSH_HOME` points at the instance state root, isolated from other instances) and opens the browser once ready.
- Community desktop edition: creatable only through "Create instance" deploying a **certified isolated portable zip runtime** (source and acceptance evidence are registered in `manifests/isolated-runtimes.json`; every file is checked against a receipt); ordinary installers are never executed. Its isolation interface is now verified (2026-10, main-branch source): the official `$DSH_HOME` data-directory isolation IS honored, but the desktop shell's own configuration (port `.store.dat`, window state, CLI shim registration) is machine-wide and the port has no environment override, so until isolation certification (twelve checks including parallel dual instances, private data, distinct ports and locks) fully passes, no creatable version is offered and the version list honestly reports unavailability (fail-closed); historical installed artifacts are kept and can be run directly or inspected via "Scan".
- Official desktop edition: likewise deployable only through the certified isolated portable runtime channel (source pinned to the official build and its isolation patches); before certification the version list honestly reports unavailability and never falls back to the website installer.

### Handling of the Source Install Directory

Import is strictly read-only toward the source install directory: nothing in it is copied, moved, modified or deleted.

- The source directory path is stored as the `runtimeRoot` field — a reference pointing to the directory that contains `DeepSeek Harness.exe`.
- The only things import actually writes are the registry file and the initial mirror under the instance root; `dsh-home`, `workspace` and others are created on demand at first start.
- On start, the runner launches `DeepSeek Harness.exe` in place from `runtimeRoot` (binaries shared read-only), then redirects runtime state to the instance's own directories via `--user-data-dir` and environment variables. Deleting or replacing the source install directory therefore breaks every instance that references it.

## 3. Instance Data Layout

Every instance owns independent directories under `hubRoot/instances/<id>/`:

| Path | Purpose |
|---|---|
| `dsh-home/` | DSH_HOME: config, profiles, sessions, storages, skills |
| `electron-user-data/` | Electron user data (Chromium profile) |
| `workspace/` | Workspace, used as the runner's cwd |
| `logs/` | Runtime logs |
| `mirror/` | Current mirror |
| `mirror-history/` | Historical mirrors |

`hubRoot` resolves in this order: the `DSH_HUB_ROOT` environment variable → the persisted value in `userData/hub-root.txt` → the parent of the process cwd (development fallback). The result is written back to `hub-root.txt`.

Other fields: `port` (loopback, default 19387), `lockName` (`dsh-desktop-<id>` single-instance lock), `skillsSource`, `enabled`, `autoStart`.

Path safety: instance ids must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; the instance root must stay inside `hubRoot`, blocking `..` path escapes.

## 4. Isolation

Isolation targets runtime state and data, not code: code is shared read-only and runs in place; state is separated at four layers — directory, process, network and environment.

- Directory: one independent tree per instance; skills and similar resources are physically copied into the instance's own `dsh-home/skills`, never symlinked or shared by pointer.
- Process: each instance spawns its own runner process; the single-instance lock prevents duplicate starts; runtime state lives in an in-memory state machine and is never persisted.
- Network: each instance owns a loopback port `127.0.0.1:<port>`, listening locally only.
- Environment: `DSH_HOME` and `DSH_DESKTOP_INSTANCE_ID / USER_DATA / WORKSPACE / PORT / LOCK` are injected so all state points at the instance's own directories; the inherited `ELECTRON_RUN_AS_NODE` is deleted so the runner cannot degrade into plain Node.
- fail-closed: unlisted distributions are always treated as not hostable.

## 5. Start and Run

Start: read the instance record → mark running (port change and deletion are blocked while running) → spawn the runner:

```
spawn(runtimeRoot/DeepSeek Harness.exe, ['--user-data-dir', electronUserData], {
  cwd: workspace,
  env: injected environment,
  windowsHide: false,
})
```

`windowsHide` is explicitly false: the desktop distribution is a GUI app, and setting it to true would hide all its windows. On success the state becomes ready (with pid and url); on failure, crashed.

State machine: stopped → starting → ready ⇄ paused; a failed start lands in crashed. State lives in memory only.

Pause uses `NtSuspendProcess` to freeze the whole process tree (main process plus GPU, renderer and utility children), keeping memory state; resume uses `NtResumeProcess`. Both first collect descendant processes recursively, then act on each.

## 6. Stop

Stop: end the instance process → clear the running mark → create the post-stop mirror snapshot (awaited, so every instance has a baseline after stopping).

## 7. Mirror

The mirror treats the stop moment as the baseline; any later deviation is found by comparing file lists.

- Structure: `mirror/` holds the current baseline — a `mirror.json` manifest plus copies of `dsh-home` and `workspace`. The manifest records only each file's relative path, size and mtimeMs; it stores no file content.
- Scope: only `dsh-home` (including skills) and `workspace`; electron-user-data, logs and other regenerable runtime artifacts are excluded.
- Excluded directories: `node_modules`, `.git`, `.pnpm` and caches, skipped by both snapshot and comparison.
- Snapshot: archive the current mirror to `mirror-history/<timestamp>/` → rebuild `mirror/` → copy directories → write the manifest → prune history to at most 5.

Comparison checks size and mtimeMs file by file: present now but not in the manifest → added; both present but size or mtimeMs differ → changed; in the manifest but gone → removed. Any of the three non-empty means a difference: the card shows "abnormal" and clicking it opens the repair page.

- Restore: delete added files, overwrite changed and removed files from the mirror, returning to the baseline.
- History rollback: restore from any historical snapshot (up to 5).

Detection and start validation:

- The main process compares all stopped instances in parallel every 5 seconds (running, starting and paused instances are exempt because sessions naturally write state). Read-only and cheap.
- Before starting, a diff runs first; on differences a dialog offers "Update mirror and start / Restore mirror and start / Cancel" to avoid entering a run with dirty state.
- At startup, missing mirrors are backfilled: instances without a snapshot get an initial baseline.

## 8. Port Allocation

When changing a port, the ports of other instances form a reserved set; if the target is taken or unavailable, allocation probes cyclically from the target through 1..65535 and returns the first free port.

## 9. Delete

- Unregister: registration only is removed; files and mirrors are kept, with optional temporary / permanent scan skip.
- Full removal: the instance root (including mirror, workspace, logs) moves to the recycle bin, then the registration is removed and the port released.

Both modes stop the instance and clear the running mark first, and can optionally move desktop shortcuts that point at the instance to the recycle bin.

## 10. Process Tree Reclamation on Exit

At startup an independent process supervisor (a child process depending only on Node built-ins) records the pid of every process WhaleRealm starts. If WhaleRealm crashes or is force-killed, the supervisor can still end the tracked process trees from outside Electron.

Exit runs in order: stop all instances → supervisor reaps tracked process trees → local-handle cleanup as a fallback. On Windows it first collects descendants recursively via WMI and stops them in reverse, then uses `taskkill /t /f` as a safety net for children that escaped the parent tree.
