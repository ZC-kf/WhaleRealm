# Quick Start

This guide walks first-time users through installation and running the first instance.

## Install

1. Download the latest `WhaleRealm-x.x.x-setup.exe` (Windows 10 / 11, x64).
2. Run the installer and follow the wizard.
3. Launch WhaleRealm from the Start Menu or desktop shortcut.

## Import the First Instance

The main window opens on the instance list:

1. Click "Scan and import" to search this machine for installed DSH desktop distributions, or "Manual import" and enter a distribution directory.
2. In the discovery list, only verified distributions (with a resources package structure that can actually open) can be imported; unverified entries are grayed out with a hint.
3. Click the import button on a verified entry. The instance appears in the list with an initial mirror created automatically.

## Create an Instance (No Existing Distribution Needed)

1. Click "Create instance" in the toolbar.
2. Enter the instance name and path (the target folder must be empty; use "Choose folder" to pick one).
3. Pick the instance type (official web / community desktop / official desktop); versions are fetched automatically after choosing, then select a version.
4. Confirm: the app advances through the real stages with live progress — verifying the download link and target folder → downloading and deploying (with a percentage) → integrity self-check → registering the instance. An 8-character task ID is shown next to the progress (hover for the full ID) for diagnostics and recovery.
5. While creating, the cancel button turns into "Cancel creation": the app asks the main process to roll back and clean up per task ownership; the form stays locked until the task finishes, then shows "Cancelled".
6. Any failure shows the error and the failed stage honestly; the form is kept so you can adjust the path or network and retry directly. Failures are never reported as success.
7. Note: the official web edition deploys a self-contained Node.js runtime and the dsh dependencies automatically (the first creation downloads for a few minutes); afterwards click "Start" to run the local service and open the browser. Both desktop editions are deployed only through certified isolated portable runtimes — ordinary installers are never executed. If a version has not finished isolation certification yet, the version list honestly reports it as unavailable; wait for a certified release instead of installing via an installer and importing afterwards.

### Recovering Unfinished Tasks

If the app exits or is interrupted mid-creation, the next launch shows "Unfinished creation tasks found": each entry lists the task ID, target path and process state. "Confirm cleanup" makes the main process remove that task's staging artifacts per task ownership — files outside a task are never touched; tasks whose process still runs get a warning first. "Remind me later" only hides the notice; it reappears on the next launch.

## Start and Stop

- Click "Start" on an instance card and wait for the status dot to turn green (running).
- Click "Stop" to end the instance; a mirror snapshot is created automatically after stopping.
- "Pause" freezes the instance process tree (memory state kept); "Resume" continues; "Restart" stops then starts again.

## Common Operations

- Details: inspect isolation paths, port and runtime information.
- Port: change the instance loopback port; conflicts are resolved automatically.
- Repair: handle port conflicts, abnormal exits and mirror differences in one place.
- Delete: unregister only (files kept) or full removal (moved to the recycle bin).

## Settings

Open settings from the top-right icon; sections are Appearance / Behavior / Window / Data / Language / About:

- Appearance: theme, accent color, launcher background and opacity, style presets.
- Behavior: auto-minimize / auto-close after launch, confirmation for dangerous actions, toast switch.
- Data: API balance alert threshold, first-run guide.
- Language: 9 interface languages, applied instantly.
- About: version updates, community, project documentation.

## Tray

Closing the main window keeps WhaleRealm in the tray by default. The tray panel supports scrolling between running instances, stop / pause / restart, and single-click expand / double-click start for stopped instances.

## Next Steps

- "Instance Import and Operation" explains the full import, isolation and mirror mechanisms.
- "Internals and Technical Overview" explains the implementation.
- Check "FAQ and Troubleshooting" first when something goes wrong.
