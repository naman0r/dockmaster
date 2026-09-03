# Dockmaster

Local dev dashboard for macOS: one console for everything running on your machine.

Dockmaster grew out of [Port Authority](legacy/port_authority.py) — the single-file port
dashboard now lives in `legacy/` for reference. The idea scaled: a dev tool should know
what's on your machine, and it should be able to *safely* act on it.

<img width="400" alt="overview" src="https://github.com/user-attachments/assets/6f99f6d1-4071-4bdf-90b9-b952337ccc30" />

## Modules

| Module    | What it does |
| --------- | ------------ |
| **Harbor**    | Landing overview: one live card per module plus a system vitals strip (uptime, load, memory, disk, battery). |
| **Ports**     | Every listening dev server (lsof/ps), with a guarded stop button. Full Port Authority behavior: tree-kill, SIGTERM-then-confirmed-SIGKILL, PID-reuse protection, LAN-exposure badges. |
| **Repos**     | Status board for every git repo under your dev root: dirty files, ahead/behind, stale branches, last commit. |
| **Worktrees** | Linked worktrees and branches older than 30 days. Remove worktrees, prune, delete branches — main worktree and default branches are off limits. |
| **Health**    | "Is it up?" — a personal status page for localhost services and external URLs, with status code and latency. |
| **Hosts**     | /etc/hosts viewer with profiles. Applying opens the macOS admin prompt (no sudoers edits), always backs up first, flushes the DNS cache. |
| **Processes** | Instantaneous CPU (two ps samples, one second apart) and memory. Stop is guarded like Ports: own processes only, never PID 1 or Dockmaster's ancestors. |
| **Secrets**   | Credential-shaped strings in *tracked* files across all repos (AWS/Slack/GitHub/Google/OpenAI keys, private key blocks, generic assignments). Previews are redacted server-side; the API never returns full secret text. Also lists untracked .env files (the good kind). |
| **Logbook**   | "Which project had you today" — samples the frontmost app via osascript. Fully demand-driven: it records only while the page is open and visible. Window titles are never stored. |
| **Notepad**   | Local scratch pad: timestamped dev notes (tools you found, snippets, ideas) stored in `~/.dockmaster/notes.json`. |

Every scanning module can be switched off from its own page (persisted in `~/.dockmaster/settings.json`).

## Resource discipline

Nothing scans unless someone is looking:

- All discovery is demand-driven with a short TTL cache and request coalescing.
- Frontend polling pauses when the tab is hidden (`visibilitychange`).
- The Logbook heartbeat only runs while its page is open and tracking is on; there is
  no background timer anywhere in the server.
- Bulk git scans run with bounded concurrency (4-6 processes).

A running Dockmaster idles near zero; the Next.js server itself is the main resident cost.

## Run it

Requirements: macOS, Node 20+.

~~~bash
npm install
cp .env.example .env   # optional: all values have defaults
npm run dev            # http://localhost:3000
~~~

Production (lower memory, no file watching):

~~~bash
npm run build
npm start
~~~

### Configuration (.env)

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PORT` | `3000` (`4310` under the LaunchAgent) | Loopback listen port. Read from the shell environment, not from `.env`. |
| `DOCKMASTER_DATA_DIR` | `~/.dockmaster` | Settings, profiles, logbook, backups |
| `DOCKMASTER_DEV_ROOT` | `~/Developer` | Where the repo scanner walks |
| `DOCKMASTER_WALK_DEPTH` | `3` | Repo scan depth |
| `DOCKMASTER_LOGBOOK_INTERVAL_MS` | `10000` | Logbook sample interval |

No private information is hardcoded; everything comes from the environment or your
local data dir.

## Keep it running

Install a per-user LaunchAgent (run a production build first):

~~~bash
npm run build
npm run agent:install     # com.dockmaster.app, starts at login on port 4310
npm run agent:uninstall
~~~

Logs land in `~/.dockmaster/logs/`.

## Security model

The dashboard can kill processes and rewrite /etc/hosts, so it defends itself the way
Port Authority did:

1. Binds to `127.0.0.1` only; middleware rejects any non-loopback `Host` header (DNS
   rebinding).
2. API requests require a per-process token injected into the page; a custom header
   forces a CORS preflight, which is answered without CORS headers so the browser
   blocks the real request. A missing or stale token is a 401; action refusals are 403.
3. `Origin` is validated on every API request.
4. Destructive actions re-verify identity against a fresh scan (stale rows 409), and
   the process-tree kill refuses PID 1, Dockmaster itself, its ancestors, and any
   process owned by another user.

## Development

~~~bash
npm run typecheck
npm test        # vitest — parsers and safety guards
~~~

The legacy single-file tool and its build notes are in `legacy/`.
