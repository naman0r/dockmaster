# Contributing

Dockmaster is one Next.js process that reads your Mac and acts on it carefully. Small, focused PRs land fastest. Open an issue first for anything that adds a dependency or changes the security model.

## Setup

```bash
npm install
npm run dev            # http://localhost:36252
npm run typecheck
npm test
```

macOS only. The scanners shell out to `lsof`, `ps`, `du`, and `osascript`.

## Adding a module

Copy the shape of the Disk module (`git log --stat 3005405` lists every file it touched). A module is:

| Piece | Where | Notes |
| --- | --- | --- |
| Scanner and guarded action | `lib/<module>.ts` | Export pure parse functions; spawn through `lib/exec.ts` with absolute binary paths. |
| Unit test | `lib/<module>.test.ts` | Parsers and safety guards. One small `vitest` file. |
| Read route | `app/api/<module>/route.ts` | `guard(req)`, `remoteRoute(req)`, `moduleEnabled`, then a `TtlCache`. |
| Action route | `app/api/<module>/<verb>/route.ts` | Re-verify identity against a fresh scan; 409 when stale, 403 when refused. |
| Page | `app/<module>/page.tsx` | `useMachineApi()` for fetches, `usePoll()` so nothing scans while the tab is hidden. |
| Registration | `lib/settings.ts`, `lib/navigation.ts`, `app/page.tsx` | Module toggle, sidebar link, Harbor card. |
| Remote support | `lib/machines/protocol.ts`, `collector.ts`, `allowlist.ts`, `routes.ts`, `actions.ts` | Add the read operation, its zod schema, and the action; bump `COMPANION_VERSION` and the pin in `ssh.test.ts`. |

Remote payload schemas strip unknown keys. A field you add to a scanner but not to the schema disappears silently on remote machines.

## Rules every change keeps

- Loopback only. Every route calls `guard`. No new listeners, no CORS headers.
- No background work. No server timers; polling lives in pages and pauses when hidden.
- Destructive actions re-check identity (PID plus start time, worktree revision, container id) and refuse system processes, other users, symlinks, and anything outside the dev root.
- Secrets never leave the process unredacted.
- Comment the why, not the what. Match the file you are in.

## Before you open a PR

```bash
npm run typecheck && npm test && npm run build
```

Describe what you verified by hand (which page, which machine). There are no UI tests; the reviewer will run it.
