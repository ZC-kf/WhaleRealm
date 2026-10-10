# FAQ and Troubleshooting

## Create-Instance Failures

Work through the message:

1. "Target folder must be empty": pick an empty folder or clear the chosen one and retry. The verify stage never touches your folder contents.
2. "Download link unavailable / download failed": check the network and retry; the official web version list comes from npm and the desktop list from the local certification manifest; failures roll back the staging artifacts per task ownership.
3. "Self-check failed": the downloaded package is incomplete — retry.
4. "Deployment capability insufficient: no certified isolated desktop portable package yet": both desktop editions can only deploy certified isolated portable runtimes — ordinary installers are never executed. Until certification completes, the type honestly shows as not creatable; historical installed artifacts are kept in place and can be run directly or inspected via "Scan".

## An Instance Won't Start

Check in order:

1. Make sure the distribution directory has not been deleted or moved: the instance record's runtimeRoot points at the source install directory, and removal or replacement breaks startup. Delete the instance, then scan / import again.
2. Make sure the port is usable: check the port on the details page and try a different one via "Port".
3. Restart WhaleRealm and try again.

## No Window Appears After Start

Check whether the system environment variable `ELECTRON_RUN_AS_NODE` is set. WhaleRealm removes it explicitly when starting instances, but if you launch the runtime by other means this variable degrades it into plain Node. Remove the variable and retry.

## Port Conflict

Changing a port auto-resolves conflicts. If another program occupies an instance's fixed port, open the repair page and use "Port +1" or change the port directly.

## A Card Shows "Instance Abnormal"

This means the instance's independent state (dsh-home or workspace) was changed externally while it was stopped, diverging from the mirror taken at the last stop. Options:

- Open the repair page to see the details (added / changed / removed files).
- If the changes are wanted → "Update mirror" to accept the current state as the new baseline.
- To discard external changes → "Restore" to return to the mirror state.
- Or roll back from a historical mirror (up to 5).

Note: running, starting and paused instances are exempt from mirror abnormality checks, because a session naturally writes state.

## Status Shows "Crashed"

The instance process exited unexpectedly. Open the repair page and use "Restart instance". If it keeps happening, report it with the version, system and log information to the community or GitHub Issues.

## Update Fails

- Check the network, then click "Check for updates" again.
- If automatic updates keep failing, download the installer manually from the Releases page and install over the current version.

## API Balance Query Fails

Make sure a DeepSeek API key is configured (`%USERPROFILE%\.dsh`). The balance query is read-only and does not affect instances.

## Leftover Processes After Exit

WhaleRealm reclaims tracked process trees on exit. If some remain, end them in Task Manager and include the reproduction steps in your report.

## Reporting Process

When reporting an issue, include: the app version (Settings → About), the OS version, the steps to reproduce, and a screenshot or redacted logs. Remove API keys, tokens and account information before sending. For issues that need follow-up, prefer GitHub Issues so they are not buried in chat.
