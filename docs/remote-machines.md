# Remote machines

Dockmaster runs its UI and coordinating backend on the main Mac, bound to loopback. The browser communicates only with that backend. An on-demand Node companion runs the shared collectors and guarded actions on each configured Mac over SSH. No cloud telemetry backend, remote HTTP listener, router forwarding, or reverse SSH access is required. Tailscale supplies reachability, including away from home when both machines are online and awake.

## Supported features

| Module | Remote behavior |
| --- | --- |
| Harbor | System CPU utilization, load, uptime, non-free/total RAM, memory pressure, disk and battery |
| Ports | Listeners, guarded stop/force-stop, managed SSH forwarding with “Open locally” |
| Repos | Git status, changes, ahead/behind, branch/commit information and refresh |
| Worktrees | Inspection, guarded removal, pruning and stale-branch deletion |
| Processes | One-second per-process CPU samples and resident memory; guarded termination |
| Health | Checks stored and executed on the selected target; localhost means that target |
| Hosts | Read and save/delete profiles; applying profiles requires the optional fixed privileged helper |
| Secrets | Tracked-file scanning and complete preview redaction before results leave the target |
| Disk | Artifact and cache measurement under the target's root and home; guarded clean of the same allowlisted paths |
| Notepad | One shared notebook in the coordinating Mac’s data directory, independent of selection |
| Logbook | Local-only, unchanged; remote selection shows that limitation |

The command palette searches the selected machine’s repositories and ports plus the shared notebook. Navigation targets and row identities are machine-scoped. There is no all-machines aggregation. Linux/Pi collectors are not implemented; unsupported platforms report no capabilities.

## Build and explicitly install the companion

From the main Mac checkout:

```sh
npm install
npm run companion:build
```

The output, `dist/companion.cjs`, is a standalone bundle. No remote npm installation or persistent companion service is needed. Node 20.12+ is required; tested runtimes are 24.21.0 on the main Mac and 24.20.0 on the homelab.

First verify SSH in Terminal, preserving host-key verification:

```sh
ssh namanrusia@m1max-homelab.tailaaa918.ts.net
```

If a host key is unknown or changed, verify its fingerprint through a trusted channel before accepting/replacing it. Dockmaster uses batch SSH and cannot present password/passphrase/host-key prompts.

Install the reviewed local bundle:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes namanrusia@m1max-homelab.tailaaa918.ts.net 'mkdir -p /Users/namanrusia/Services/dockmaster'
scp -o BatchMode=yes -o StrictHostKeyChecking=yes dist/companion.cjs namanrusia@m1max-homelab.tailaaa918.ts.net:/Users/namanrusia/Services/dockmaster/companion.cjs.next
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes namanrusia@m1max-homelab.tailaaa918.ts.net 'mv /Users/namanrusia/Services/dockmaster/companion.cjs.next /Users/namanrusia/Services/dockmaster/companion.cjs'
```

The companion starts automatically when a supported view or Test connection needs it. It exits on SSH/stdin closure or after 45 idle seconds. `npm run agent:install` still installs the **full coordinating dashboard** as a Mac LaunchAgent; it does not install a companion.

## Settings → Machines

Use these verified values:

| Field | Homelab value |
| --- | --- |
| Display name | `Homelab` |
| SSH destination | `namanrusia@m1max-homelab.tailaaa918.ts.net` |
| Absolute remote Node path | `/Users/namanrusia/.local/share/mise/installs/node/24.20.0/bin/node` |
| Absolute remote companion path | `/Users/namanrusia/Services/dockmaster/companion.cjs` |
| Development root | `/Users/namanrusia/developer` |

Save, Test connection, then select Homelab in the sidebar. Saving does not install or execute anything. Test connection explicitly executes the configured companion and reports hostname, OS, user, version, root, and capabilities. An updated companion requires Test connection or a coordinating backend restart to replace an existing session.

Protocol and companion versions are now **2 / 2.1.0**. The earlier Ports/Vitals-only companion is incompatible; rebuild/install from this checkout. Update the absolute Node path if the remote Node version changes.

Machine UUIDs persist independently of names/hostnames in `machines.json` under `DOCKMASTER_DATA_DIR` (default `~/.dockmaster`), written atomically with mode 0600. Existing module settings remain in `settings.json`. Module toggles currently apply dashboard-wide and are changed on This Mac. Selection persists per browser tab; Notepad stays shared.

Health checks and Hosts profiles are stored on the remote machine in **`data/` beside the companion bundle**, separate from any existing remote dashboard’s `~/.dockmaster`. Keep that directory when upgrading the bundle. Repository discovery uses the configured root; the companion does not load the checkout’s `.env`.

SSH credentials are not stored in machine configuration or sent to browser code. Use the launching user’s SSH config/keys, Keychain, or explicitly configured IdentityAgent. Avoid relying solely on an interactive terminal’s SSH_AUTH_SOCK. The absolute remote Node binary avoids mise/nvm PATH assumptions. Minimal-environment batch SSH was verified; an actual installed dashboard LaunchAgent session was not restarted for testing.

## Open locally / managed forwarding

Click **Open locally** on a remote listener. Dockmaster validates its current identity, binds a listener to `127.0.0.1` on the coordinating Mac, and forwards browser TCP connections with SSH `-W` to the verified target address. Existing SSH-config forwarding rules stay disabled. There is no public or wildcard Mac-side listener.

The preferred local port is the remote port; an occupied port falls back to an automatically allocated port. The mapping is displayed above Ports, and repeated opening reuses it. The API additionally accepts an explicit `localPort` (1024–65535), which fails clearly when occupied. This supports a later persistent-mapping UI without changing the transport.

Each active browser TCP stream has an SSH forwarding process; the local mapping is reused. The tunnel survives navigation and machine switching while in use, and can be closed explicitly. Five minutes without active sockets closes the mapping; idle sockets also have a five-minute timeout. Removing/editing a machine closes its managed mappings. Closing the coordinating backend closes its listeners and streams. Mappings are not persisted across restarts, and failed TCP streams are never replayed.

SSH forwarding permission is required only for opening ports, not telemetry. If the SSH server rejects forwarding, the mapping reports an actionable error after a connection attempt. HTTP is the default launch URL; non-HTTP services may use the displayed forwarded address in their own clients. HTTPS-only applications may require changing the scheme. Applications with fixed callback/origin URLs may need a specific local port.

## Action and data safeguards

- Shared, versioned schemas validate every request and nested response. No arbitrary shell-command operation exists. SSH destinations reject option injection; all configured remote paths are quoted.
- One companion stream per machine, concurrent reads coalesced, short collector caches, bounded pending requests and 2 MiB frames. Hello/Ports/Vitals deadlines are 12 seconds; heavier reads allow 120 seconds and actions 45 seconds. Idle cleanup starts only after pending requests complete.
- Demand-driven reconnection backs off from one to 30 seconds. Hidden tabs and unmounted views stop scans; slow browser polls do not overlap. Switching/editing a machine remounts its view and discards late results.
- Snapshots carry coordinating machine identity, target collection time and receipt time. Failures retain labeled stale snapshots in memory without blocking local reads. Unreachable does not imply powered off.
- Mutations require a recent (90-second) module snapshot from the same live companion session. Its one-use lease is consumed before sending. A disconnected action cannot reconnect automatically or replay. Ambiguous failures explicitly require inspecting target state before retrying.
- Remote confirmations name the machine. Ports validates PID/port/start time against a fresh scan. Process termination checks start time and ownership and protects the companion/ancestor chain; each candidate’s identity is rechecked before signaling. Cross-user/protected processes are refused.
- Worktree mutations canonicalize the repository, Git metadata and removal target against the configured root, compare current Git metadata against the displayed revision, and preserve existing default-branch, main-worktree and dirty-worktree safeguards. Force actions remain explicit. External Git/filesystem writers are not locked by Dockmaster; identity checks reduce races but are not OS-level atomic process handles or filesystem transactions.
- Remote command arguments are omitted. Secrets scans skip symlink candidates and redact previews fully on the target. Raw SSH diagnostics and command errors are not forwarded as browser error text.

## Optional privileged Hosts helper

Reading Hosts and managing profiles work without installation. Applying `/etc/hosts` requires this separate, reviewed helper; Dockmaster does **not** install it or alter sudoers automatically. The homelab’s real Hosts file and privilege configuration were not changed during validation.

Review `scripts/dockmaster-hosts-helper`. It accepts only a bounded JSON document containing replacement content and the expected current SHA-256 digest, requires the localhost mapping, uses fixed paths, rejects symlink targets, backs up the original under `/var/db/dockmaster`, and atomically replaces `/private/etc/hosts`. It accepts no filename, shell command, or command-line arguments. It uses macOS `/usr/bin/python3` in isolated mode; verify that runtime exists first.

On the target, copy the reviewed helper somewhere temporary, then deliberately install it using an administrator account:

```sh
sudo install -d -o root -g wheel -m 755 /usr/local/libexec
sudo install -o root -g wheel -m 755 /path/to/reviewed/dockmaster-hosts-helper /usr/local/libexec/dockmaster-hosts-helper
sudo visudo -f /etc/sudoers.d/dockmaster-hosts
```

For the homelab’s `namanrusia` user, the narrowly scoped rule is:

```sudoers
namanrusia ALL=(root) NOPASSWD: /usr/local/libexec/dockmaster-hosts-helper ""
```

The empty quoted argument list restricts invocation to **no arguments**. The helper and its parent directories must remain root-owned and not writable by the SSH user. Run `sudo visudo -c` to validate configuration. Refresh Hosts; Apply becomes available when the helper is authorized. This grants that user the ability to replace the Hosts file through the validated helper, not a general-purpose root shell. Updating the helper requires another explicit administrator installation.

To remove the privilege integration, remove its sudoers file using an administrator account and delete the helper. Keep `/var/db/dockmaster` backups until you deliberately discard them. For rollback, inspect and restore the desired backup with administrator privileges and flush the DNS cache.

## Troubleshooting and removal

Unknown host key: verify identity in Terminal. Authentication failure: check batch SSH as the dashboard’s user, including Keychain/IdentityAgent under launchd. Missing Node/companion: verify absolute paths. Version/malformed protocol: install the matching bundle and ensure shell startup does not print banners on stdout. Stale data: check SSH, Tailscale and whether the machine is awake. The homelab’s closed-lid sleep and FileVault recovery limitations remain unresolved; this work changes no power settings.

Remove a machine in Settings to close its companion and tunnels and discard local configuration/snapshots. The remote bundle/data remain until explicitly removed. Delete `/Users/namanrusia/Services/dockmaster/companion.cjs` to uninstall the ordinary companion; retain `data/` if you want to keep its checks/profiles. No companion LaunchAgent needs uninstalling.

## Isolated local review and verification

An existing dashboard uses this checkout. Keep review builds/data separate:

```sh
DOCKMASTER_BUILD_DIR=.next-remote npm run build
DOCKMASTER_BUILD_DIR=.next-remote DOCKMASTER_PORT=36253 DOCKMASTER_DATA_DIR=/private/tmp/dockmaster-remote-validation npm start
```

Open `http://127.0.0.1:36253/settings`. Temporary validation settings already contain Homelab on the main Mac. Use the same build-directory variable for build/start. Normal startup and `agent:install` continue to use `.next`.

Verified 2026-09-09 from `namanmacpro`, user `namanrusia`, checkout `/Users/namanrusia/developer/dockmaster`, branch `feat/remote-machines`; PR #5. The original milestone was committed/pushed before expanding the feature set.

- Final checks: 142 Vitest tests, three isolated Python helper tests, TypeScript checking, companion bundle and production build passed.
- Baseline: 101 tests, typecheck and production build passed. The initial remote slice subsequently passed 124 tests and actual same-port/disconnect/reconnect checks.
- Expanded live checks: all eight remote read modules returned ready. System CPU/RAM and process samples were collected on the homelab. A fixture secret was fully redacted before transport.
- A fixture HTTP server on port 39188 was opened through the forward while the same local port was occupied. Port fallback, HTTP content, mapping reuse, and explicit cleanup passed.
- Health create/run/delete used target-local HTTP. Hosts read/save/delete used isolated data; `/etc/hosts` remained untouched. A disposable Git worktree was removed, its branch deleted, and pruning exercised. A fixture process was terminated through Processes. A stale process identity was refused; a separate fixture listener was stopped through the guarded Ports action. Existing services were not terminated.
- Fixtures used `/Users/namanrusia/Services/dockmaster/validation`, separate from normal companion data. Temporary machine entries, mappings, test listeners and the fixture directory were removed afterward.
- Unit/DOM tests cover protocol validation, connection loss/backoff, lease/session isolation, no replay, identity checks, symlink escapes, forwarding collisions/reuse, hidden polling, machine switching, shared Notepad and guarded UI requests. Run `npm test` with permission to bind loopback sockets. Run `python3 scripts/test-hosts-helper.py` for isolated helper validation; it never touches the real Hosts file.
- Browser automation had no connected browser, so visual walkthrough remains unverified. Real privileged Hosts application, actual LaunchAgent-session behavior, and an outside-home network test remain manual validation items. Linux, continuous historical monitoring and persistent tunnel mappings remain future work.

Memory usage excludes file-backed and purgeable cache using macOS `vm_stat` counters. Cached memory is shown separately; unused RAM is physical free memory, not the `memory_pressure` free percentage. Values can differ slightly from Activity Monitor due to sampling and accounting. Rebuild and install companion 2.0.1 for this correction.

Verified 2026-09-09 from `namanmacpro` through the guarded local API: homelab companion 2.0.1 reported 34.31 GiB used, 28.18 GiB cached, and 2.36% physical free memory. Installed at `/Users/namanrusia/Services/dockmaster/companion.cjs`; the previous bundle is saved beside it as `companion.cjs.before-memory-fix`. Only the Dockmaster companion connection was refreshed. Restoring the backup also requires the matching backend version. Activity Monitor comparison used the supplied screenshot, not simultaneous samples.

Companion 2.0.2 collects process names and start times together and rejects PID reuse between CPU samples. Tunnel creation stays bound to the validated SSH configuration and rechecks authorization after binding the local port. Upgrade the companion for the process identity fix.

Verified 2026-09-09: installed companion 2.0.2 on the homelab and refreshed only its Dockmaster connection. The guarded dashboard API returned 36 homelab and 39 local process rows with names and start identities. No processes were signaled. The previous homelab bundle is `companion.cjs.before-identity-fix` (rollback requires its matching backend). Configuration-change tunnel races are covered by isolated loopback tests.

Verified 2026-09-11: installed companion 2.1.0 (Disk) on the homelab at `/Users/namanrusia/Services/dockmaster/companion.cjs` over SSH and ran its hello handshake with the configured Node binary; it reported capabilities including `disk`. The previous bundle is saved as `companion.cjs.before-disk` (it was the parallel agents-branch 2.1.0 build; restoring it requires that branch's backend). Nothing was cleaned or scanned on the homelab during installation.
