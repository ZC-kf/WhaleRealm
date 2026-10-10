# Software Introduction

WhaleRealm (鲸域) is a local multi-instance manager for the DeepSeek Harness desktop app. It lets several DSH desktop instances run on the same machine independently and in parallel: every instance has its own isolated runtime space — a separate DSH_HOME, Electron user data, workspace, port and single-instance lock — so different tasks can progress without interfering with each other.

## Feature Overview

### Multi-instance Management

- Scan and import: automatically search this machine for installed DSH desktop distributions; verified distributions can be imported as instances directly.
- Manual import: import a distribution from a chosen directory.
- Create instance: enter a name, path, type and version; the app downloads, deploys and imports automatically (official web, community desktop, official desktop).
- Card / list views: switch between the two; cards show status, port, path, isolation and token usage.

### Instance Operations

- Start, stop, pause (freeze the process tree), resume and restart.
- Open the instance directory, change the port (conflicts are resolved automatically), inspect isolation details.
- Repair entry: port conflicts, abnormal exits and mirror differences are handled in one place.
- Delete: unregister only (files kept) or full removal (moved to the recycle bin).

### Strong Isolation

Each instance has its own DSH_HOME, Electron user data, workspace, port and single-instance lock; state roots are never shared.

### Mirror Snapshots

A mirror is created automatically after an instance stops. While an instance is stopped, external changes to its state are detected by comparison; you can update the mirror or restore from it, with up to 5 historical mirrors kept.

### Global Search

The main search bar finds instances and settings entries; the settings search bar locates sections, with keyboard navigation and Enter to jump.

### Appearance

Themes (Forest / Ocean / Berry / Graphite), custom accent color, launcher background and opacity, style presets, header texts and footer slogan, plus per-card and settings backgrounds.

### Tray and Panel

Tray panel: scroll to switch between running instances, with stop / pause / restart; a stopped instance expands on single click and starts on double click. The tray has its own style and background.

### Behavior and Data

Auto-minimize / auto-close after launch, confirmation for dangerous actions, desktop shortcut cleanup on delete / import, toast switch, API balance alert threshold, and a first-run guide.

### Multiple Languages

9 interface languages built in, applied instantly.

### Project Documentation

Settings → About → Project Documentation provides built-in manuals that follow the current interface language.

## Download and Install

- Download the latest `WhaleRealm-x.x.x-setup.exe` from the Releases page.
- Supports Windows 10 / 11 (x64).
- Run the installer and follow the wizard; launch from the Start Menu or desktop shortcut afterwards.

The app locates DSH distributions and runtimes through the `DSH_HUB_ROOT` environment variable or the `hub-root.txt` file next to the installation; the result is resolved and persisted on first launch.

## Isolation Scope and Limits

Isolation scope: each instance has its own DSH_HOME, Electron user data, workspace, port and single-instance lock; state roots are never shared.

Limits:

- Shared runtime directories are never deleted; deleting an instance only removes that instance's own files and registration, moved to the recycle bin.
- Unregister keeps disk files and mirrors, so the instance can be imported again later.
- WhaleRealm is an independent community project, not an official DeepSeek product.

## Feedback and Community

- Reporting issues: include the app version, OS version, steps to reproduce and a screenshot or redacted logs. Remove API keys, tokens and account information before sending.
- Suggestions: describe what you want to achieve, where you are stuck and how the software could help.
- For issues that need follow-up, prefer GitHub Issues so they are not buried in chat.

## Development and Contribution

- Stack: Electron + React 19 + Vite + TypeScript.
- Install: `npm install`; build: `npm run build`; test: `npm test`; package: `npm run package:win` (China mirrors recommended).
- Issues and Pull Requests are welcome.

## Open Source and Credits

WhaleRealm is an independent community project, not an official DeepSeek product. Copyright and licenses of third-party projects belong to their respective owners; see the third-party license files in the project.

License: this software is licensed under the GNU GPL v3.0 or later (GPL-3.0-or-later). Additional attribution requirement: any distribution of this program or its derivative works must keep the copyright notice and author attribution (Copyright (C) 2026 Linfeng / 凛枫) in a prominent position. Third-party components are distributed under their own licenses; see THIRD_PARTY_NOTICES.md.
