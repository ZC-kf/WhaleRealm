# WhaleRealm · 鲸域

**A Windows multi-instance manager for DeepSeek Harness.**

[简体中文](README.md) · [Downloads](https://github.com/ZC-kf/WhaleRealm/releases/latest) · [Quick start](hub/docs/en/quick-start.md) · [Issues](https://github.com/ZC-kf/WhaleRealm/issues)

WhaleRealm gives each DSH instance its own runtime, data, workspace, browser profile, port and process tree. Creation, shutdown and removal operate on instance-owned resources to avoid overwriting other DSH installations and data.

## Download and start

Requires **Windows 10/11 x64**.

| File | Purpose |
| --- | --- |
| [WhaleRealm-1.0.0-setup.exe](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-setup.exe) | Installer; recommended for most users |
| [WhaleRealm-1.0.0-x64.zip](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-x64.zip) | Portable app; extract into a writable folder and run WhaleRealm.exe |
| [WhaleRealm-1.0.0-source.zip](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/WhaleRealm-1.0.0-source.zip) | Source and documentation for this release |
| [SHA256SUMS.txt](https://github.com/ZC-kf/WhaleRealm/releases/download/v1.0.0/SHA256SUMS.txt) | SHA-256 checksums |

Open WhaleRealm → **New instance** → choose a type, name and empty directory → create → start. The community runtime is bundled and needs extraction on first deployment. Creating an official Web instance requires a network connection for its initial downloads.

## Version 1.0.0 support

| Runtime | Status |
| --- | --- |
| Community Desktop 0.21.0, managed r5 | Certified and bundled in both installer and portable distributions |
| Official Web @deepseek-ai/dsh 0.2.0-rc.2 | Supported on-demand deployment with a private Electron browser host per instance |
| Official Desktop | Not certified; creation stays disabled for uncertified artifacts, and ordinary upstream installers are never run |

Certification binds a specific version and artifact digest, not every upstream release. The official Desktop candidate did not pass sustained HTTP availability checks; an environment exemption is not a passing certification. See [release status](docs/release-readiness.md).

## Features and isolation

- Private data, workspace, cache, logs, browser profile, port and lock per instance.
- Windows Job ownership of process trees; stopping A does not terminate B by process name.
- Staged deployment, integrity verification, ownership-aware rollback and interrupted-creation recovery.
- Instance discovery, snapshots, tray controls and nine interface languages.
- Existing explicit instance paths remain in place; no automatic migration of old installations or personal credentials.

Isolation prevents ordinary instance conflicts. It is not a security sandbox against malicious software running under the same OS account.

## Updates

The app checks this repository's latest stable GitHub Release and displays an update notification. You can also check from **Settings → About**. **Version 1.0.0 does not silently install unattended updates.** The update button opens the release page. Download the installer, stop instances and exit WhaleRealm, then run the installer. For the portable edition, extract into a new application directory while retaining the existing instance data location.

The update repository is fixed to ZC-kf/WhaleRealm. This app uses its own GitHub Release check, so latest.yml is not required.

## Development

The Hub uses Electron, React, TypeScript and Vite. Runtime adapters also involve upstream Electron and Rust/Tauri projects. Dependency versions are locked in hub/package-lock.json.

```powershell
cd hub
npm ci
npm run dev
npm run build
npm test
```

Packaging requires the exact managed runtime referenced by the manifest. The community r5 ZIP is included under resources/runtimes/ in the portable release. Place that archive at the extraResources source location specified in hub/package.json, then run npm run package:win or npm run package:portable. Runtime binaries and instance data are not committed to the source repository.

```powershell
# Repository root
node scripts/generate-third-party-notices.mjs --check
node scripts/verify-isolated-release.mjs
```

[Quick start](hub/docs/en/quick-start.md) · [Troubleshooting](hub/docs/en/troubleshooting.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Licensing

First-party Hub code is licensed under [GPL-3.0-or-later](LICENSE). Third-party components retain their own licenses: see [notices](THIRD_PARTY_NOTICES.md), the [Hub dependency license index](hub/licenses/third-party-index.json), and [source provenance](manifests/source-provenance.json).

**The community Desktop upstream includes additional terms prohibiting commercial secondary development. Do not treat that component as plain MIT or assume the Hub's GPL declaration overrides those terms.** Read the full upstream terms before using or redistributing it. Bundled artwork is retained under the author's distribution authorization.

Copyright (C) 2026 凛枫 (Linfeng).
