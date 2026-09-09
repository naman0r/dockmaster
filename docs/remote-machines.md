# Remote machines (first milestone)

Dockmaster's browser and coordinating backend stay on the main Mac and bind to loopback. Ports and Vitals use a machine backend: existing collectors locally, or the same collectors bundled into an on-demand Node companion over SSH. No cloud telemetry, remote HTTP listener, network token, reverse SSH access, or companion LaunchAgent is needed.

## Build and install the companion explicitly

From the main Mac checkout:

```sh
npm install
npm run companion:build
```

This produces `dist/companion.cjs`, a standalone bundle with no remote npm installation required. It requires Node 20.12+ and currently supports macOS only. The tested runtimes are Node 24.21.0 (main Mac) and 24.20.0 (homelab). Linux/Pi collectors are not implemented.

Verify SSH in Terminal first, preserving host-key verification. If the key is unknown, verify its fingerprint through a trusted channel before accepting it. Dockmaster uses batch mode and cannot display interactive password, passphrase, or host-key prompts.

```sh
ssh namanrusia@m1max-homelab.tailaaa918.ts.net
```

Install the reviewed local bundle (these commands create/update only this companion file):

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes namanrusia@m1max-homelab.tailaaa918.ts.net 'mkdir -p /Users/namanrusia/Services/dockmaster'
scp -o BatchMode=yes -o StrictHostKeyChecking=yes dist/companion.cjs namanrusia@m1max-homelab.tailaaa918.ts.net:/Users/namanrusia/Services/dockmaster/companion.cjs
```

`npm run agent:install` still means installing the **full local dashboard** as a macOS LaunchAgent. It does not install a companion. The companion starts automatically through SSH when Test connection or a supported view requests it. Merely saving an entry does not execute anything.

## Settings → Machines

Add these verified values for the homelab:

| Field | Value |
| --- | --- |
| Display name | `Homelab` |
| SSH destination | `namanrusia@m1max-homelab.tailaaa918.ts.net` |
| Absolute remote Node path | `/Users/namanrusia/.local/share/mise/installs/node/24.20.0/bin/node` |
| Absolute remote companion path | `/Users/namanrusia/Services/dockmaster/companion.cjs` |
| Development root | `/Users/namanrusia/developer` |

Save, then **Test connection**. The result identifies hostname, OS, user, companion version, scan root, and capabilities. Select **Homelab** from the sidebar, then open Harbor for vitals or Ports for listeners. Node upgrades may change the absolute runtime path; edit the entry accordingly.

Entries have stable UUIDs and are saved atomically to `machines.json` under `DOCKMASTER_DATA_DIR` (default `~/.dockmaster`) with mode 0600. Existing `settings.json` module toggles are preserved without migration. Ports respects the dashboard's existing module toggle; change that toggle on This Mac. Machine selection is per browser tab and survives navigation/reloads through session storage. If browser storage is unavailable it remains in memory.

SSH credentials are never stored in this configuration or sent to the browser. Use the existing user's SSH config, keys, macOS Keychain, or an explicitly configured IdentityAgent. Avoid relying solely on an interactive shell's SSH_AUTH_SOCK. The existing dashboard LaunchAgent records its own absolute Node path; the remote Node path above likewise avoids shell PATH/shim assumptions. Batch SSH with only HOME, USER and a system PATH was verified on the main Mac.

## Connection and data behavior

- Protocol version 1, companion version 1.0.0. A handshake advertises capabilities before reads. Mismatches require rebuilding/reinstalling the matching bundle.
- Only `hello`, `ports`, and `vitals` requests exist. There is no arbitrary command or mutation operation. SSH command construction quotes validated absolute paths and rejects option-shaped destinations.
- One multiplexed request stream per configured machine in the coordinating Node process. Up to eight pending requests, UUID request IDs, 2 MiB byte-bounded newline frames, validated nested payloads, 12-second deadlines, eight-second SSH connection timeout.
- SSH uses no PTY, strict host-key verification, batch authentication, and keepalives. Diagnostics are classified into fixed messages; raw SSH stderr is not returned or logged.
- Failures reject pending requests. Demand-driven retries back off from one to 30 seconds; no background scan/retry loop and no automatic action replay. Idle connections close after 45 seconds. Closing stdin/SSH terminates the companion.
- Collectors retain their short TTL caches. Concurrent reads coalesce, and browser polls never overlap within a view. Hidden tabs skip polls; unmounted views stop polling. Switching machines or editing the selected configuration remounts the view so late responses cannot populate the new view.
- Results carry a trusted coordinating `machineId`, target collection `cachedAt`, receipt `receivedAt`, and explicit ready/disabled/stale/unreachable/unsupported state. Last successful remote snapshots stay in backend memory and are labeled stale on failure; restarting the backend clears them. Unreachable does not mean powered off.
- Remote full process arguments are omitted and `isStoppable` is false. Process classification/project association still runs on the target. Remote links to browser localhost and stop controls are unavailable. A later tunnel feature can provide safe opening.
- Other modules show a local-only explanation for remote selections. The command palette is available on This Mac only in this milestone, avoiding local search results under a remote selection. Remote Harbor requests only vitals; it does not scan unrelated modules.

## Troubleshooting and removal

**Unknown/changed host key:** use Terminal to verify the destination's identity and resolve the known_hosts entry. Do not disable verification.

**Authentication unavailable:** verify `ssh -o BatchMode=yes` works as the user launching Dockmaster. Check SSH config/Keychain/IdentityAgent when Terminal works but launchd does not. No credential or raw SSH diagnostic is displayed by Dockmaster.

**Companion/Node not found:** verify both absolute paths on the target. A mise/nvm shim may depend on shell setup; prefer the resolved Node binary.

**Version mismatch / malformed response:** rebuild from the same checkout and replace the companion file. Stdout must contain only protocol messages; remote shell startup banners can break framing. Test connection reconnects immediately and clears the old connection/snapshots.

**Unreachable/stale:** check Tailscale, SSH and whether the homelab is awake. Its known closed-lid sleep/FileVault limitations remain unresolved. This feature changes no power settings.

Remove the machine in Settings to close its connection and discard its snapshots/configuration. The companion bundle stays on disk until explicitly removed:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes namanrusia@m1max-homelab.tailaaa918.ts.net 'rm /Users/namanrusia/Services/dockmaster/companion.cjs'
```

No persistent remote service needs uninstalling. Temporary test listeners are never installed persistently.

## Isolated local review

An existing Dockmaster process may use this checkout's `.next` output. Build and run the review instance with a separate build/data directory and port:

```sh
DOCKMASTER_BUILD_DIR=.next-remote npm run build
DOCKMASTER_BUILD_DIR=.next-remote DOCKMASTER_PORT=36253 DOCKMASTER_DATA_DIR=/private/tmp/dockmaster-remote-validation npm start
```

Open `http://127.0.0.1:36253/settings`. The validation data directory already contains the tested Homelab entry on this machine. It is temporary and separate from your normal settings. Keep the same build-directory variable for build and start. The default dashboard startup and `agent:install` continue to use `.next`.

## Verified 2026-09-09

Execution host `namanmacpro`, user `namanrusia`, checkout `/Users/namanrusia/developer/dockmaster`, branch `feat/remote-machines`. All implementation changes are left unstaged; no commit was created.

- Baseline: typecheck, 101 tests, production build passed.
- Final checks: all 124 tests (20 files), typecheck, companion build, and isolated production build passed.
- New tests cover persistence/settings preservation, concurrent saves, machine/port isolation, stale snapshots, nonblocking local reads, protocol framing and nested validation, SSH reuse/deadlines/disconnects/backoff/idle cleanup/version mismatch, action guards, late-response switching, hidden/inactive polling, unsupported module gating, and disabled remote opening/actions.
- Actual guarded HTTP requests added and tested Homelab in a temporary data directory. Identity was `m1max-homelab`, Darwin, user `namanrusia`, companion 1.0.0, root `/Users/namanrusia/developer`.
- Remote Ports returned seven listeners during the test; Vitals returned 10 cores and 96% memory free at that sample.
- Temporary loopback listeners on port 39187 on both Macs produced distinct machine IDs/PIDs. Both test listeners were stopped afterward.
- Terminating only the exact installed test companion produced a stale Ports snapshot with its original collection timestamp. Local Vitals remained ready. A subsequent remote request reconnected successfully.
- Minimal-environment SSH authentication and the absolute remote Node binary were verified. An actual installed LaunchAgent GUI session was not restarted/tested.
- Idle cleanup was verified: no companion or temporary port-39187 listener remained after the idle period.
- The existing main-Mac dashboard was not restarted and still returned HTTP 200 at final verification. An initial test sharing `.next` hit a server-rendering error; the isolated `.next-remote` production build served HTTP successfully.
- Browser connection discovery returned no available browser. React DOM interaction tests and live HTTP/SSH checks passed; a visual browser walkthrough remains unverified.

Next useful increment: loopback-bound SSH tunnels for remote “Open locally,” with explicit lifecycle and collision handling. Additional read-only modules can follow the same backend contract. Remote mutations, historical metrics, continuous companions, Linux collectors, remote palette search, and all-machines aggregation remain deferred.
