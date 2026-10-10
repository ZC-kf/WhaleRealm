# DSH Desktop Instance Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a visual Electron/React Hub under `D:\Dsh-Hub-HIDM` that launches multiple official DeepSeek Harness Desktop instances with independent state roots, ports, locks, workspaces, logs, versions, plugins, and Skills.

**Architecture:** Start from the `rirko/dsh-melody-launcher` Electron/React UI patterns, but replace its single `RuntimeController` with an instance-indexed supervisor. Use the current official `deepseek-ai/deepseek-harness` release at commit `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61` (`0.1.7-alpha.1`), whose Desktop runtime is split between `apps/desktop` and `apps/desktop-host`; do not use the older local `apps/electron` fork as the official runtime. Build a minimal official source patch that reads `DSH_DESKTOP_PORT` in `apps/desktop-host/src/index.ts`, while the Hub launches one OS Electron process per instance with explicit `DSH_HOME`, `DSH_DESKTOP_INSTANCE_ID`, `DSH_DESKTOP_USER_DATA`, `DSH_DESKTOP_PORT`, and `--user-data-dir`. Migration is copy-first and manifest-driven: original D: paths remain intact until hash verification and isolated smoke tests pass.

**Tech Stack:** Electron, React, TypeScript, Vite, Vitest, official DeepSeek Harness Desktop runtime, Node.js 22+, pnpm 11.7+, PowerShell migration scripts, SHA-256 manifests.

**Spec:** `D:\Dsh-Hub-HIDM\docs\superpowers\specs\2026-09-22-dsh-desktop-instance-hub-design.md`

## Global Constraints

- The current `D:\DSH-Desktop` process on `127.0.0.1:3080` must not be stopped or modified during staging.
- The current `C:\Users\Lenovo\.dsh` and `C:\Users\Lenovo\AppData\Roaming\DeepSeek Harness` state roots are snapshot-only inputs; never move or delete them automatically.
- Every managed instance must live below `D:\Dsh-Hub-HIDM\instances\<id>` and must have distinct `dsh-home`, `electron-user-data`, `profiles\desktop`, workspace, log, port, and lock values.
- Renderer code never writes profile files, credentials, or migration manifests directly; all mutations go through validated Electron main-process IPC and atomic writers.
- Existing D: sources remain recoverable until a separate explicit cleanup action after acceptance.
- Every production behavior change follows RED -> GREEN -> REFACTOR, with a test observed failing before implementation.
- Do not claim desktop-mode or isolation support until a real two-instance smoke test records the paths, PIDs, ports, lock names, and loaded Skill evidence.

---

### Task 1: Establish the Central Workspace and Asset Inventory

**Files:**
- Create: `D:\Dsh-Hub-HIDM\manifests\asset-inventory.json`
- Create: `D:\Dsh-Hub-HIDM\manifests\migration.json`
- Create: `D:\Dsh-Hub-HIDM\scripts\inventory-dsh.ps1`
- Create: `D:\Dsh-Hub-HIDM\scripts\stage-assets.ps1`
- Create: `D:\Dsh-Hub-HIDM\scripts\verify-assets.ps1`
- Create: `D:\Dsh-Hub-HIDM\backups\README.md`

**Interfaces:**
- `inventory-dsh.ps1 -Root D:\ -Output manifests\asset-inventory.json` emits classified source, binary, archive, plugin, and backup records without modifying sources.
- `stage-assets.ps1 -Inventory manifests\asset-inventory.json -DestinationRoot D:\Dsh-Hub-HIDM\imports` copies only approved D: assets and writes source/destination hashes.
- `verify-assets.ps1 -Manifest manifests\migration.json` exits nonzero on missing files, size mismatch, or SHA-256 mismatch.

- [ ] **Step 1: Write the failing inventory contract test**

Create `scripts/tests/inventory-contract.Tests.ps1` with these assertions:

```powershell
Describe 'DSH inventory contract' {
  It 'classifies known DSH roots without classifying unrelated browser sources as runtimes' {
    $inventory = & "$PSScriptRoot\..\inventory-dsh.ps1" -Root $TestDrive -Output "$TestDrive\inventory.json" -AsObject
    ($inventory.items | Where-Object path -eq 'deepseek-harness').kind | Should -Be 'source'
    ($inventory.items | Where-Object path -eq 'dsh-browser').kind | Should -Not -Be 'runtime'
  }

  It 'records a source hash for every staged file' {
    $result = & "$PSScriptRoot\..\verify-assets.ps1" -Manifest "$TestDrive\migration.json"
    $LASTEXITCODE | Should -Be 1
  }
}
```

- [ ] **Step 2: Run the test and confirm the expected missing-script failure**

Run:

```powershell
Invoke-Pester D:\Dsh-Hub-HIDM\scripts\tests\inventory-contract.Tests.ps1 -Output Detailed
```

Expected: FAIL because the inventory and verification scripts do not exist yet.

- [ ] **Step 3: Implement inventory, copy-first staging, and hash verification**

Use `Get-ChildItem`, `Get-FileHash -Algorithm SHA256`, and JSON serialization. Classify at minimum:

```text
source: D:\deepseek-harness, D:\DSH-Desktop-source-audit
runtime: D:\DSH-Desktop, D:\deepseek-harness-desktop
related-source: D:\dsh-browser
artifact: D:\dsh-worktable\*.tgz, release archives, installers
backup: paths containing backup, baseline, or audit
```

The staging script must refuse a destination outside `D:\Dsh-Hub-HIDM\imports`, use a temporary sibling during copy, then atomically rename it. It must never call `Remove-Item` on a source path.

- [ ] **Step 4: Re-run the inventory tests and inspect generated manifests**

Run:

```powershell
Invoke-Pester D:\Dsh-Hub-HIDM\scripts\tests\inventory-contract.Tests.ps1 -Output Detailed
Get-Content D:\Dsh-Hub-HIDM\manifests\asset-inventory.json | ConvertFrom-Json
```

Expected: tests pass and the manifest contains explicit source paths, kinds, byte counts, and timestamps.

- [ ] **Step 5: Stage only the approved D: assets and verify them**

Run:

```powershell
pwsh -File D:\Dsh-Hub-HIDM\scripts\inventory-dsh.ps1 -Root D:\ -Output D:\Dsh-Hub-HIDM\manifests\asset-inventory.json
pwsh -File D:\Dsh-Hub-HIDM\scripts\stage-assets.ps1 -Inventory D:\Dsh-Hub-HIDM\manifests\asset-inventory.json -DestinationRoot D:\Dsh-Hub-HIDM\imports
pwsh -File D:\Dsh-Hub-HIDM\scripts\verify-assets.ps1 -Manifest D:\Dsh-Hub-HIDM\manifests\migration.json
```

Expected: source directories remain present and verification exits 0.

---

### Task 2: Import the Hub UI and Pin the Upstream Sources

**Files:**
- Create: `D:\Dsh-Hub-HIDM\hub\` from `rirko/dsh-melody-launcher` at a recorded commit
- Create: `D:\Dsh-Hub-HIDM\upstream\deepseek-harness\` from the official repository at a recorded commit containing `apps/desktop`
- Create: `D:\Dsh-Hub-HIDM\manifests\source-lock.json`
- Modify: `D:\Dsh-Hub-HIDM\hub\package.json`
- Test: `D:\Dsh-Hub-HIDM\hub\tests\baseline.test.ts`

**Interfaces:**
- `source-lock.json` records repository URL, commit SHA, package versions, Node/pnpm floors, and local source paths.
- The Hub build remains runnable from `D:\Dsh-Hub-HIDM\hub` without reading the current user profile.

- [ ] **Step 1: Clone/pin sources without touching the live installation**

Use a shallow clone or an existing local mirror, then record exact SHAs:

```powershell
git clone --filter=blob:none --no-checkout https://github.com/rirko/dsh-melody-launcher.git D:\Dsh-Hub-HIDM\hub
git -C D:\Dsh-Hub-HIDM\hub rev-parse HEAD | Out-File D:\Dsh-Hub-HIDM\manifests\hub-commit.txt -Encoding ascii
git clone --filter=blob:none --no-checkout https://github.com/deepseek-ai/deepseek-harness.git D:\Dsh-Hub-HIDM\upstream\deepseek-harness
git -C D:\Dsh-Hub-HIDM\upstream\deepseek-harness fetch --depth=1 origin master
git -C D:\Dsh-Hub-HIDM\upstream\deepseek-harness checkout origin/master
git -C D:\Dsh-Hub-HIDM\upstream\deepseek-harness rev-parse HEAD | Out-File D:\Dsh-Hub-HIDM\manifests\official-desktop-commit.txt -Encoding ascii
```

If GitHub is unavailable, use the existing D: repositories only after proving their remote and commit match the source lock; do not silently substitute the community Electron fork for the official source.

- [ ] **Step 2: Write the baseline test before modifications**

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

it('has a pinned source lock and a buildable Hub package', async () => {
  const lock = JSON.parse(await readFile(new URL('../../manifests/source-lock.json', import.meta.url), 'utf8'))
  expect(lock.hub.repository).toContain('dsh-melody-launcher')
  expect(lock.officialDesktop.repository).toContain('deepseek-ai/deepseek-harness')
  expect(lock.officialDesktop.appsDesktop).toBe(true)
})
```

- [ ] **Step 3: Run the baseline test and confirm it fails for the missing lock**

Run from `D:\Dsh-Hub-HIDM\hub`:

```powershell
pnpm exec vitest run tests/baseline.test.ts
```

Expected: FAIL because the source lock has not been generated.

- [ ] **Step 4: Create the source lock and install the Hub dependencies**

Use the pinned Hub `package.json` and lockfile. Do not run an unrestricted dependency upgrade. Run:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

- [ ] **Step 5: Verify the imported baseline before changing behavior**

Expected: the upstream Hub tests/build complete with no source modifications beyond the new lock and target metadata. Record test counts in `manifests/source-lock.json`.

---

### Task 3: Add Instance Path, Lock, Environment, and Port Contracts

**Files:**
- Create: `hub/electron/instance-types.ts`
- Create: `hub/electron/instance-paths.ts`
- Create: `hub/electron/instance-env.ts`
- Create: `hub/electron/instance-lock.ts`
- Create: `hub/electron/port-allocator.ts`
- Create: `hub/tests/instance-paths.test.ts`
- Create: `hub/tests/instance-env.test.ts`
- Create: `hub/tests/port-allocator.test.ts`

**Interfaces:**

```ts
export interface DesktopInstanceRecord {
  id: string
  name: string
  version: string
  runtimeRoot: string
  dshHome: string
  electronUserData: string
  desktopProfile: string
  workspace: string
  port: number
  lockName: string
  skillsSource: string
  enabled: boolean
  autoStart: boolean
}

export function resolveInstancePaths(root: string, id: string): DesktopInstanceRecord
export function buildInstanceEnvironment(record: DesktopInstanceRecord, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function lockNameForInstance(id: string): string
export async function allocateLoopbackPort(preferred: number, reserved: Set<number>): Promise<number>
```

- [ ] **Step 1: Write failing tests for path separation**

```ts
it('creates every mutable state root below the instance root', () => {
  const a = resolveInstancePaths('D:\\Dsh-Hub-HIDM', 'stable')
  const b = resolveInstancePaths('D:\\Dsh-Hub-HIDM', 'beta')
  expect(a.dshHome).not.toBe(b.dshHome)
  expect(a.electronUserData).not.toBe(b.electronUserData)
  expect(a.desktopProfile).toBe(`${a.dshHome}\\profiles\\desktop`)
  expect(a.lockName).not.toBe(b.lockName)
  expect(a.dshHome.startsWith('D:\\Dsh-Hub-HIDM\\instances\\stable')).toBe(true)
})
```

- [ ] **Step 2: Run the path tests and confirm they fail because modules are absent**

```powershell
pnpm exec vitest run tests/instance-paths.test.ts tests/instance-env.test.ts tests/port-allocator.test.ts
```

Expected: FAIL with module/function-not-found errors.

- [ ] **Step 3: Implement normalized paths and explicit environment propagation**

`buildInstanceEnvironment` must set only instance-owned values:

```ts
return {
  ...base,
  DSH_HOME: record.dshHome,
  DSH_DESKTOP_INSTANCE_ID: record.id,
  DSH_DESKTOP_USER_DATA: record.electronUserData,
  DSH_DESKTOP_PORT: String(record.port),
}
```

Reject relative roots, traversal outside the Hub root, duplicate IDs, and ports outside 1..65535.

- [ ] **Step 4: Implement deterministic lock names and a loopback-only port allocator**

Lock names must be derived from a validated instance ID and never from user-visible display names. Port allocation probes `127.0.0.1` and skips reserved ports.

- [ ] **Step 5: Run the focused tests and verify green**

```powershell
pnpm exec vitest run tests/instance-paths.test.ts tests/instance-env.test.ts tests/port-allocator.test.ts
```

Expected: all focused tests pass with no writes outside the test temp directory.

---

### Task 4: Make the Official Desktop Runner Instance-Aware

**Files:**
- Modify: `upstream/deepseek-harness/apps/desktop/src/paths.ts`
- Modify: `upstream/deepseek-harness/apps/desktop/src/single-instance.ts`
- Modify: `upstream/deepseek-harness/apps/desktop/src/main.ts`
- Modify: `upstream/deepseek-harness/apps/desktop/src/host-process.ts`
- Create: `upstream/deepseek-harness/apps/desktop/src/instance-context.ts`
- Test: `upstream/deepseek-harness/apps/desktop/tests/instance-context.spec.ts`
- Test: `upstream/deepseek-harness/apps/desktop/tests/single-instance.spec.ts`
- Test: `upstream/deepseek-harness/apps/desktop/tests/host-port.spec.ts`

**Interfaces:**

```ts
export interface DesktopInstanceContext {
  id: string
  dshHome: string
  userData: string
  port: number
  workspace: string
  lockName: string
}

export function readDesktopInstanceContext(env: NodeJS.ProcessEnv): DesktopInstanceContext
export function applyDesktopInstancePaths(app: Electron.App, context: DesktopInstanceContext): void
export function claimDesktopSingleInstanceFor(context: DesktopInstanceContext, app: DesktopSingleInstanceApplication, focusOwner: () => void): boolean
```

- [ ] **Step 1: Write failing tests for environment parsing and default rejection**

```ts
it('requires an explicit instance id and absolute state roots', () => {
  expect(() => readDesktopInstanceContext({ DSH_DESKTOP_INSTANCE_ID: 'x' })).toThrow()
  expect(readDesktopInstanceContext({
    DSH_DESKTOP_INSTANCE_ID: 'stable',
    DSH_HOME: 'D:\\Dsh-Hub-HIDM\\instances\\stable\\dsh-home',
    DSH_DESKTOP_USER_DATA: 'D:\\Dsh-Hub-HIDM\\instances\\stable\\electron-user-data',
    DSH_DESKTOP_PORT: '19391',
  }).port).toBe(19391)
})
```

- [ ] **Step 2: Run the runner tests and confirm the expected red state**

```powershell
pnpm --dir D:\Dsh-Hub-HIDM\upstream\deepseek-harness exec vitest run apps/desktop/tests/instance-context.spec.ts apps/desktop/tests/single-instance.spec.ts apps/desktop/tests/host-port.spec.ts
```

Expected: FAIL because the instance context exports and test files do not exist.

- [ ] **Step 3: Apply instance paths before Electron readiness and before lock ownership**

The entrypoint must read environment context before calling `requestSingleInstanceLock`. It must set `app.setPath('userData', context.userData)` and ensure the path exists before any Electron state access. Profile resolution must use `context.dshHome` and retain `profiles\desktop` semantics.

- [ ] **Step 4: Thread the port and workspace through the official Host startup**

The Host command/config path must receive the validated loopback port and workspace without allowing arbitrary host binding. Reject non-loopback hosts and conflicting port values.

- [ ] **Step 5: Run the focused official runner tests**

```powershell
pnpm --dir D:\Dsh-Hub-HIDM\upstream\deepseek-harness exec vitest run apps/desktop/tests/instance-context.spec.ts apps/desktop/tests/single-instance.spec.ts apps/desktop/tests/host-port.spec.ts
```

Expected: all instance-context tests pass. Do not start a real Desktop yet; that belongs to the integration task.

---

### Task 5: Replace the Hub’s Single Runtime With an Instance Supervisor

**Files:**
- Create: `hub/electron/instance-store.ts`
- Create: `hub/electron/instance-supervisor.ts`
- Modify: `hub/electron/ipc.ts`
- Modify: `hub/electron/main.ts`
- Modify: `hub/src/types.ts`
- Create: `hub/tests/instance-store.test.ts`
- Create: `hub/tests/instance-supervisor.test.ts`

**Interfaces:**

```ts
export interface InstanceSupervisor {
  list(): Promise<DesktopInstanceRecord[]>
  create(input: CreateInstanceInput): Promise<DesktopInstanceRecord>
  update(id: string, patch: UpdateInstanceInput): Promise<DesktopInstanceRecord>
  remove(id: string): Promise<void>
  start(id: string): Promise<RuntimeSnapshot>
  stop(id: string): Promise<RuntimeSnapshot>
  restart(id: string): Promise<RuntimeSnapshot>
  snapshot(id: string): RuntimeSnapshot
  subscribe(listener: (event: RuntimeEvent) => void): () => void
}
```

- [ ] **Step 1: Write failing store and supervisor tests**

```ts
it('persists two records atomically without collapsing their roots', async () => {
  const store = createInstanceStore(tempRoot)
  const a = await store.create({ name: 'Stable', version: '0.1.3', port: 19391 })
  const b = await store.create({ name: 'Beta', version: '0.1.4', port: 19392 })
  expect(a.dshHome).not.toBe(b.dshHome)
  expect((await store.list())).toHaveLength(2)
})

it('does not stop a process belonging to another instance', async () => {
  const supervisor = createTestSupervisor()
  await supervisor.start('stable')
  await supervisor.start('beta')
  await supervisor.stop('stable')
  expect(supervisor.snapshot('beta').status).toBe('ready')
})
```

- [ ] **Step 2: Run the tests and confirm they fail before implementation**

```powershell
pnpm exec vitest run tests/instance-store.test.ts tests/instance-supervisor.test.ts
```

Expected: FAIL because the multi-instance services do not exist.

- [ ] **Step 3: Implement atomic instance persistence and validation**

Persist to `D:\Dsh-Hub-HIDM\hub-data\instances.json` with a `.tmp` write, flush/close, rename, and `.bak` preservation. Reject duplicate IDs, roots outside the Hub root, and invalid ports before writing.

- [ ] **Step 4: Implement process launch and process-tree cleanup**

Spawn the runner with the instance environment, cwd, port, and log file. Track PID and child-tree identity by instance ID. On Hub shutdown, stop only tracked children; never enumerate and kill unrelated `DeepSeek Harness.exe` processes.

- [ ] **Step 5: Wire typed IPC and event streaming**

Expose instance CRUD, start/stop/restart, snapshot, and log subscription through preload contracts. Redact `DSH_HOME` credentials and command secrets from renderer events.

- [ ] **Step 6: Run supervisor/store tests and the Hub typecheck**

```powershell
pnpm exec vitest run tests/instance-store.test.ts tests/instance-supervisor.test.ts
pnpm run build
```

Expected: focused tests and TypeScript build pass.

---

### Task 6: Build the Multi-Instance Hub UI

**Files:**
- Modify: `hub/src/App.tsx`
- Modify: `hub/src/types.ts`
- Modify: `hub/src/styles.css`
- Create or modify: `hub/src/components/InstanceList.tsx`
- Create or modify: `hub/src/components/InstanceCard.tsx`
- Create or modify: `hub/src/components/InstanceEditor.tsx`
- Create or modify: `hub/src/components/RuntimeLogPanel.tsx`
- Test: `hub/tests/instance-manager-ui.test.tsx`

**Interfaces:**
- UI consumes only the typed preload API from Task 5.
- UI renders status transitions from events; it does not poll profile files.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('renders two instances with separate status and port values', async () => {
  render(<App />)
  expect(await screen.findByText('Stable')).toBeVisible()
  expect(await screen.findByText('Beta')).toBeVisible()
  expect(screen.getByText('19391')).toBeVisible()
  expect(screen.getByText('19392')).toBeVisible()
})

it('routes start to the selected instance only', async () => {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'Start Stable' }))
  expect(window.launcher.startInstance).toHaveBeenCalledWith('stable')
  expect(window.launcher.startInstance).not.toHaveBeenCalledWith('beta')
})
```

- [ ] **Step 2: Run the UI tests and confirm red**

```powershell
pnpm exec vitest run tests/instance-manager-ui.test.tsx
```

Expected: FAIL because the instance views and typed calls are absent.

- [ ] **Step 3: Implement the instance list/editor/card/log surfaces**

Use stable dimensions, explicit status labels, port/version chips, path disclosure, and clear disabled states. Keep the page utilitarian and dense; do not add a marketing landing page. Use the existing launcher visual language and `lucide-react` icons.

- [ ] **Step 4: Wire live events and CRUD actions**

After create/update/delete/start/stop/restart, refresh from the authoritative main-process snapshot. Preserve selected instance across event updates. Display a clear warning when a path is outside the Hub root or a migration source is unverified.

- [ ] **Step 5: Run UI tests and build**

```powershell
pnpm exec vitest run tests/instance-manager-ui.test.tsx
pnpm run build
```

Expected: tests and build pass.

---

### Task 7: Seed Skills, Profiles, and Safe Migration Copies

**Files:**
- Create: `hub/electron/skill-registry.ts`
- Create: `hub/electron/migration-service.ts`
- Modify: `hub/electron/ipc.ts`
- Create: `hub/tests/skill-registry.test.ts`
- Create: `hub/tests/migration-service.test.ts`
- Modify: `scripts/stage-assets.ps1`
- Modify: `scripts/verify-assets.ps1`

**Interfaces:**

```ts
export function resolveSkillSource(instance: DesktopInstanceRecord, skillName: string): string
export async function seedInstanceSkills(instance: DesktopInstanceRecord, names: string[]): Promise<SkillSeedResult>
export async function createMigrationSnapshot(source: string, destination: string): Promise<MigrationSnapshot>
```

- [ ] **Step 1: Write failing tests for Skill path resolution and no-cross-write behavior**

```ts
it('resolves skills inside the instance home, never the active user home', () => {
  const instance = fixtureInstance('stable')
  expect(resolveSkillSource(instance, 'vuln-scan')).toBe(
    'D:\\Dsh-Hub-HIDM\\instances\\stable\\dsh-home\\skills\\vuln-scan',
  )
  expect(resolveSkillSource(instance, 'vuln-scan')).not.toContain('C:\\Users\\Lenovo\\.dsh')
})
```

- [ ] **Step 2: Run focused tests and confirm red**

```powershell
pnpm exec vitest run tests/skill-registry.test.ts tests/migration-service.test.ts
```

Expected: FAIL because the services are not implemented.

- [ ] **Step 3: Implement canonical Skill registry and instance seeding**

Use `shared\skills` as the canonical read source. Validate Skill directory names and `SKILL.md` presence. Use copy or controlled junction creation only under the instance root; record source hash and target path in the instance manifest.

- [ ] **Step 4: Implement migration snapshots and source preservation**

The service must copy DSH source/runtime/plugin artifacts into `imports`, write hashes, and refuse to overwrite a non-empty destination unless the caller supplies an explicit backup token. It must not migrate active C: state automatically.

- [ ] **Step 5: Run migration/Skill tests and verify manifests**

```powershell
pnpm exec vitest run tests/skill-registry.test.ts tests/migration-service.test.ts
pwsh -File D:\Dsh-Hub-HIDM\scripts\verify-assets.ps1 -Manifest D:\Dsh-Hub-HIDM\manifests\migration.json
```

Expected: tests pass and the manifest points to only D: destination roots.

---

### Task 8: Build and Run the Official Runner in Two Isolated Instances

**Files:**
- Modify: `upstream/deepseek-harness/apps/desktop/package.json` or the current official Desktop build manifest
- Create: `scripts/build-official-runner.ps1`
- Create: `scripts/smoke-two-instances.ps1`
- Create: `scripts/verify-instance-isolation.ps1`
- Create: `manifests/runtime-build.json`
- Test: `hub/tests/two-instance-smoke.test.ts`

**Interfaces:**
- `build-official-runner.ps1 -Version 0.1.3-alpha.1` produces a pinned runner under `runtimes\0.1.3-alpha.1` and writes hashes.
- `smoke-two-instances.ps1 -First stable -Second beta` launches two instances through the Hub, waits for readiness, and emits JSON evidence.
- `verify-instance-isolation.ps1 -Evidence D:\Dsh-Hub-HIDM\manifests\two-instance-smoke.json` fails if any mutable root, port, PID, lock name, or loaded Skill path is duplicated.

- [ ] **Step 1: Write the smoke-test harness and expected evidence schema**

```json
{
  "instances": [
    { "id": "stable", "pid": 0, "port": 19391, "dshHome": "D:\\Dsh-Hub-HIDM\\instances\\stable\\dsh-home", "userData": "D:\\Dsh-Hub-HIDM\\instances\\stable\\electron-user-data", "desktopProfile": "D:\\Dsh-Hub-HIDM\\instances\\stable\\dsh-home\\profiles\\desktop", "skillPaths": [] },
    { "id": "beta", "pid": 0, "port": 19392, "dshHome": "D:\\Dsh-Hub-HIDM\\instances\\beta\\dsh-home", "userData": "D:\\Dsh-Hub-HIDM\\instances\\beta\\electron-user-data", "desktopProfile": "D:\\Dsh-Hub-HIDM\\instances\\beta\\dsh-home\\profiles\\desktop", "skillPaths": [] }
  ],
  "distinct": { "roots": true, "ports": true, "locks": true, "skills": true }
}
```

- [ ] **Step 2: Run the smoke harness before the runner exists and verify it fails closed**

```powershell
pwsh -File D:\Dsh-Hub-HIDM\scripts\smoke-two-instances.ps1 -First stable -Second beta
```

Expected: nonzero exit with a structured “runner not built” diagnostic; no process is spawned.

- [ ] **Step 3: Build the official runner from the pinned official source**

Run the official prerequisite/build commands for the checked-out source, then package the runner into `runtimes\<version>`. Do not use `D:\DSH-Desktop-source-audit` as an official artifact unless its provenance is explicitly recorded as a downstream fork.

- [ ] **Step 4: Start two isolated Desktop instances through the Hub**

Use separate temporary test instances under `D:\Dsh-Hub-HIDM\instances\smoke-a` and `smoke-b`. Do not import the active user profile. Use a no-model/API-key startup path if the official runner permits it; otherwise use copied test credentials only.

- [ ] **Step 5: Verify actual isolation evidence**

```powershell
pwsh -File D:\Dsh-Hub-HIDM\scripts\verify-instance-isolation.ps1 -Evidence D:\Dsh-Hub-HIDM\manifests\two-instance-smoke.json
```

Check process command lines, listening ports, `profiles\desktop`, Electron userData, lock files/names, logs, and Skill resolution paths. Expected: both windows are official Desktop mode and every mutable state root is distinct.

---

### Task 9: Final Build, Packaging, and Rollback Documentation

**Files:**
- Create: `D:\Dsh-Hub-HIDM\scripts\start-hub.ps1`
- Create: `D:\Dsh-Hub-HIDM\scripts\stop-hub.ps1`
- Create: `D:\Dsh-Hub-HIDM\scripts\rollback-migration.ps1`
- Create: `D:\Dsh-Hub-HIDM\README.md`
- Modify: `D:\Dsh-Hub-HIDM\manifests\source-lock.json`
- Modify: `D:\Dsh-Hub-HIDM\manifests\runtime-build.json`

- [ ] **Step 1: Write rollback script tests**

```powershell
Describe 'rollback' {
  It 'refuses to delete a source when the migration manifest is not verified' {
    & "$PSScriptRoot\..\rollback-migration.ps1" -Manifest "$TestDrive\unverified.json"
    $LASTEXITCODE | Should -Be 1
  }
}
```

- [ ] **Step 2: Run rollback tests and confirm red**

```powershell
Invoke-Pester D:\Dsh-Hub-HIDM\scripts\tests\rollback.Tests.ps1 -Output Detailed
```

Expected: FAIL before the rollback guard exists.

- [ ] **Step 3: Implement start/stop/rollback scripts and user documentation**

`start-hub.ps1` must set only Hub-owned environment variables and launch the Hub. `stop-hub.ps1` must call the Hub’s IPC shutdown path before using process-tree fallback. `rollback-migration.ps1` must require a verified manifest and explicit source/destination IDs; it must never remove active C: state.

- [ ] **Step 4: Run the complete verification matrix**

```powershell
pnpm --dir D:\Dsh-Hub-HIDM\hub test
pnpm --dir D:\Dsh-Hub-HIDM\hub run build
pwsh -File D:\Dsh-Hub-HIDM\scripts\verify-assets.ps1 -Manifest D:\Dsh-Hub-HIDM\manifests\migration.json
pwsh -File D:\Dsh-Hub-HIDM\scripts\verify-instance-isolation.ps1 -Evidence D:\Dsh-Hub-HIDM\manifests\two-instance-smoke.json
```

Expected: all commands exit 0; the smoke evidence contains two official Desktop processes and distinct state roots.

- [ ] **Step 5: Record verification evidence and leave original paths intact**

Write the final verification summary, test counts, source SHAs, runtime hashes, current active-instance note, and rollback locations into `D:\Dsh-Hub-HIDM\manifests\verification.json`. Do not delete or move the original D: sources in this plan.
