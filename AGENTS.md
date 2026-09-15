# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
`CLAUDE.md` is a symlink to `AGENTS.md`; edit `AGENTS.md`. The same notes apply to any coding agent and to human contributors.

## Commands

```bash
npm run dev            # Next dev server on 127.0.0.1:36252 (loads .env first via scripts/serve.mjs)
npm run build && npm start   # production; the mode to leave running
npm run typecheck      # tsc --noEmit
npm test               # vitest, all lib/**/*.test.ts
npx vitest run lib/ports          # one directory
npx vitest run lib/disk.test.ts   # one file
npx vitest run -t "parses du"     # one test by name
npm run companion:build           # bundles scripts/companion.ts for remote Macs
```

Tests cover parsers and safety guards only. There are no UI or route tests; verify pages by running the app.

## Architecture

One Next.js 15 process, App Router, no database. Every module is the same four pieces:

1. `lib/<module>.ts` (or `lib/<module>/`): scanner plus any guarded action. Pure parse functions are exported and unit tested; process-spawning code goes through `lib/exec.ts`.
2. `app/api/<module>/route.ts`: `guard(req)`, then `remoteRoute(req)`, then module-enabled check, then the scanner behind a `TtlCache`. Actions live in sibling `route.ts` files (`stop`, `clean`, `kill`) and take a JSON body.
3. `app/<module>/page.tsx`: client component, `useMachineApi()` for fetches, `usePoll()` for refresh. Nothing polls while the tab is hidden.
4. A card in `app/page.tsx` (Harbor), a link in `lib/navigation.ts`, and an entry in `MODULES` in `lib/settings.ts` so the module can be switched off.

`lib/machines/` makes the same modules run on another Mac over SSH. The dashboard spawns `companion.cjs` there and speaks newline-delimited JSON (`protocol.ts`). To make a module remote-capable, add it to `READ_OPERATIONS` and its zod payload schema in `protocol.ts`, dispatch it in `collector.ts`, allow its routes in `allowlist.ts` and `routes.ts`, handle its action in `actions.ts`, and bump `COMPANION_VERSION` (the SSH handshake rejects mismatches; `ssh.test.ts` pins the string). Payload schemas strip unknown keys, so a new field that is not in the schema silently disappears on remote machines.

### Invariants that must survive any change

- Bind loopback only. `middleware.ts` rejects non-loopback `Host`; `lib/guard.ts` checks `Origin` and the per-process token. Never add a route that skips `guard`.
- Nothing scans unless a page is open. No `setInterval` on the server, no background timers. Caches are `TtlCache` with short TTLs and request coalescing.
- Destructive actions re-verify identity against a fresh scan and return 409 when the row is stale (PID + `startedAt`, worktree `revision`, container id). They refuse PID 1, other users' processes, Dockmaster's own ancestors, and anything outside the dev root. Symlinked targets are refused for deletes.
- 401 means the token rotated (client reloads once); 403 means a guard refused the action. Do not reuse one for the other.
- Secrets previews are redacted server-side; the API never returns full secret text. The companion additionally blanks `argv` and previews before sending over SSH.
- Bulk git work runs through `mapLimit` with concurrency 4 to 6.

### Conventions

- Settings and every data file live under `DOCKMASTER_DATA_DIR` (default `~/.dockmaster`), written atomically via a `.tmp` rename.
- Absolute binary paths for system tools (`/usr/sbin/lsof`, `/bin/ps`, `/usr/bin/du`); launchd gives the server a minimal `PATH`.
- Ports and Processes pages use nautical copy in headers only; data labels stay literal.
- macOS only. `lsof`, `du`, `osascript`, and the LaunchAgent are Darwin-specific; the companion refuses other platforms.
