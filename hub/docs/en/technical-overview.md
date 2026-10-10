# Internals and Technical Overview

This document explains WhaleRealm's internal structure and key mechanisms, for understanding the software's behavior and for developers reading the source.

## Overall Structure

WhaleRealm is built on Electron with three layers:

- Main process (`hub/electron/`): instance lifecycle, mirrors, port allocation, process supervision, settings storage.
- Preload bridge (`hub/electron/preload.ts`): exposes a whitelisted API via `contextBridge`.
- Renderer (`hub/src/`): the React UI, calling main-process capabilities through `useLauncherApi`.

Main and renderer share the IPC channel names in `constants.ts` and the types in `types.ts`; the preload surface and the main-process registration surface come from the same definitions.

## Data Directories

- userData: `settings.json`, `hub-root.txt`, `launcher-assets` (images), `process-supervisor` (supervisor script).
- hubRoot: resolved as `DSH_HUB_ROOT` environment variable → `hub-root.txt` → parent of the process cwd (development fallback). Under hubRoot: `hub-data` (instances.json, skipped-installs.json), `manifests` (runtime-catalog.json), `instances` (one directory per instance), `shared/skills`.

## Instance Model

Each instance is a registry record (instances.json) with id, runtimeRoot (a reference to the source install directory), dshHome, electronUserData, workspace, logs, port, lockName and other fields. Runtime state (running / stopped / paused / crashed) lives only in the in-memory state machine, never on disk.

## Isolation Model

Code and state are separated:

- Code: the source install directory referenced by runtimeRoot is shared read-only; `DeepSeek Harness.exe` is spawned in place.
- State: dsh-home, electron-user-data and workspace are independent per instance, as are port and single-instance lock.

On start, state is redirected to the instance's own directories through `--user-data-dir` and environment variables (`DSH_HOME`, `DSH_DESKTOP_*`); the inherited `ELECTRON_RUN_AS_NODE` is deleted so the runner cannot degrade into plain Node.

## Mirror Model

When an instance stops, its dsh-home and workspace are copied to `mirror/` under the instance root, together with a `mirror.json` manifest (relative path → size / mtimeMs). Differences while stopped come from comparing size and mtimeMs file by file, yielding added / changed / removed. Before each new snapshot the current mirror is archived to `mirror-history/`, capped at 5. Snapshots and comparisons both skip node_modules, .git, .pnpm and caches.

## Process Management

- Single-instance lock: `dsh-desktop-<id>` prevents duplicate starts of one instance.
- Pause / resume: `NtSuspendProcess` / `NtResumeProcess` freeze and thaw the whole process tree, keeping memory state.
- Exit reclamation: an independent supervisor records every tracked pid and can end process trees outside Electron if WhaleRealm crashes; normal exit runs stop-all → supervisor cleanup → local-handle fallback.

## Port Allocation

Each instance owns a loopback port (default 19387). Changing a port checks conflicts with other instances and actual availability; on conflict, allocation probes cyclically from the target for the next free port.

## Create-Instance Catalog and Pipeline

- Version catalog (`instance-catalog.ts`): the official web edition lists versions from the npm `@deepseek-ai/dsh` metadata, keeping only versions that pass integrity verification (download links are npm tarballs). Both desktop editions list only **certified** portable zip packages from `manifests/isolated-runtimes.json` (`desktop-assets.ts` re-validates source, patch, receipt and the twelve acceptance checks item by item); with no certified entry the catalog honestly returns "no certified isolated desktop portable package yet" and never falls back to installers. Results are not cached; the list is fetched live when a type is chosen.
- Creation pipeline (`instance-create.ts` + `create-runtime.ts` + `adapters/`): verify (link HEAD, empty target folder, task journal on disk) → download and deploy → self-check → register. For the official web edition, deployment = self-contained portable Node.js + `npm install @deepseek-ai/dsh`, and the self-check really boots `dsh web` and probes it over HTTP before registering; starting the instance runs the service on its own port with an isolated `DSH_HOME` and opens the browser. Desktop deployment = downloading the certified zip and extracting it into staging, publishing only after per-file receipt verification. The whole deployment runs inside a **staging transaction owned by the task** (`create-transaction.ts`): the target folder stays untouched until publish, failures roll back per task ownership, and if the app exits mid-way the task journal remains so the next launch can delete the staging artifacts per ownership only after "Confirm cleanup" — files outside the task are never touched.
- Instance kind (`instanceKind`): detected from the package name (`@deepseek-ai`/`deepseek-harness`) plus the executable name; legacy instances are backfilled on `list`.

## UI Data Flow

UI state is centralized in `use-launcher-store`: instance list, runtime states (5 s polling), token usage, balance (10 s polling), mirror diffs (5 s parallel polling of stopped instances). Start / stop / pause / resume refresh related state immediately to avoid stale display.

## Documentation i18n Mechanism

Built-in documents live under `docs/<language-code>/` in the install directory, organized by document id. The UI lists document titles in the current language (titles and descriptions come from the translation tables), and reading a document tries the current language, then English, then Simplified Chinese. Adding a document later only requires files under the docs directory plus title entries in the translation tables.
