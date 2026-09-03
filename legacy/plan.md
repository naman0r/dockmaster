# Port Authority: build plan

`cd /Users/namanrusia/developer/port_authority && ./port_authority.py --open --verbose`

A local dashboard showing which dev servers are listening on this Mac, with a stop button.
It should also look polished and have a cool cyberpunk / hacker aesthetic. We can iterate on design once the functionality is solid.

---

## Scope

One local process that answers "what dev servers are running on this Mac right now, and let me stop them." Read-only awareness plus a stop button. Nothing else. It should show the working directory from which each dev server was initialized and the containing Git project when one exists.

Explicit non-goals, because they're what turn this from an afternoon into a month: no starting services, no config management, no log tailing, no remote hosts, no process metrics graphs, no auth/multi-user. But if any of these are free and really easy to add, we can add this as a MVP1 (current iteration is MVP0)

---

## Architecture

A single Python file, stdlib only. `http.server.ThreadingHTTPServer` bound to `127.0.0.1:9494`, serving three routes: the HTML page, a JSON snapshot, and a stop action. The HTML/CSS/JS lives as a string constant in the same file; source line count is less important than keeping the runtime and installation surface tiny.

Why this shape:

- The app has no third-party runtime dependencies: no venv, no `npm install`, and no lockfile to rot. Modern macOS does not guarantee a system Python, so setup requires Python 3.9+ and the installer records the absolute path of the interpreter currently running it.
- Single file means the LaunchAgent points at one path and nothing can go half-missing.
- Node is a defensible alternative, but your Node version manager is exactly the kind of thing that breaks a background agent silently.

Threading matters: `lsof` can occasionally take a few hundred milliseconds, and a blocking single-threaded server makes the UI feel broken. Discovery is demand-driven: while no dashboard is open, the resident process does no polling and should remain effectively idle.

Note on the port: `900000` from the original idea isn't valid — the max is 65535. `9494` is the default here.

---

## Data collection

Everything comes from three shell calls per uncached refresh. Each call has a short timeout, and a lock prevents simultaneous browser tabs from launching duplicate scans.

### 1. The listeners

Use field-mode output rather than parsing the human-readable table, which has misaligned columns and truncated command names:

```bash
lsof -nP -iTCP -sTCP:LISTEN -F pcLn +c 0
```

- `-n` skips DNS lookups, `-P` skips port-name lookups — both are pure latency.
- `+c 0` gives full command names instead of the 9-char truncation.
- Field mode emits one field per line, prefixed by a letter: `p` = pid, `c` = command, `L` = login name, `f` = starts a new file record, `n` = the address.

Parse as a small state machine: a `p` line opens a new process, subsequent `f`/`n` pairs are its sockets.

Address formats you must handle: `*:3000`, `127.0.0.1:3000`, `[::1]:3000`, `[::]:3000`. Take the port from after the last colon.

### 2. Process detail

One batched call for all PIDs found:

```bash
ps -o pid=,ppid=,uid=,lstart=,user=,command= -p 4821,4930,5102
```

Gives you the full argv (the useful part, since `node` alone tells you nothing), the parent PID for tree-killing, and a start time for uptime.

### 3. Working directory

Also batched:

```bash
lsof -a -d cwd -Fn -p 4821,4930,5102
```

The cwd is the single most valuable field in the whole tool. It's how you know that the `node` on 5173 is your client project and the one on 3000 is the API. Derive a display name from `basename(cwd)`, and ideally walk up to the nearest directory containing `.git` so nested packages resolve to the repo name.

---

## Shaping the data

**Group by PID, then by port.** One process often holds several ports, and a dual-stack bind shows up as two rows for the same port. Collapse those to one entry per (pid, port) with a list of bind addresses. If a parent and descendant both inherited the exact same listening socket (common with reloaders and multi-worker servers), show only the highest listening ancestor. Unrelated processes using SO_REUSEPORT remain separate.

**Bind scope is a real signal.** `127.0.0.1` is local only; `*` or `0.0.0.0` means anyone on your café wifi can hit your dev server. Surface that as a badge; it's the one thing in this tool that might actually save you.

**Classify from argv** with an ordered list of regex-to-label rules, first match wins:

```
vite · next · webpack · react-scripts · uvicorn · gunicorn ·
manage.py runserver · flask · rails · bun · deno · esbuild ·
storybook · jupyter · postgres · redis-server · mysqld ·
mongod · ollama · com.docker
```

Fall back to the executable's basename.

**Flag background processes** (`root`, paths under `/System`, `/usr/libexec`, `/Library/Apple`, and obvious `.app` helpers that do not match a dev-server rule) and hide them behind a toggle, defaulted off. Keep common local infrastructure such as Postgres, Redis, Ollama, Docker, and OrbStack visible. Preserve the API field name `is_system` for MVP0, but label the UI toggle "background services" so it describes the behavior honestly.

---

## API surface

| Route               | Returns                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `GET /`             | The page                                                                             |
| `GET /api/services` | `{ generated_at, services: [...] }`                                                  |
| `POST /api/stop`    | Body `{ pid, port, started_at, mode: "term" \| "kill" }` → `{ ok, still_listening }` |

Each service object: `pid`, `ppid`, `port`, `addresses`, `kind`, `project`, `cwd`, `argv`, `user`, `started_at`, `is_system`, `is_stoppable`.

Cache the snapshot for ~1.5s so a background tab and a foreground tab don't double the `lsof` load. A stop request forces a fresh snapshot and must match the PID, port, and process start time shown to the user; this prevents a stale row from signaling a newly reused PID.

---

## Stop semantics

This is the part that's easy to get wrong. `npm run dev` is a wrapper: npm spawns node, node spawns esbuild workers. SIGTERM to the npm PID leaves the child holding the port, which is the exact frustration you're building this to avoid.

So: build a pid→ppid map from `ps -eo pid=,ppid=`, compute the target's descendants, and signal the whole tree. Deepest first, then the parent.

Don't reach for `killpg`. It's what Ctrl-C does and it's usually correct, but in the edge case where the process group leader is your shell, you kill your terminal. Walking the tree explicitly is a few more lines and can't do that.

### Guards, before sending anything

- Never PID 1.
- Never your own PID, and never any PID on your own ancestor chain. Without this, one click can kill launchd or the terminal that started the tool.
- Never a process owned by a different user. Apply the same ownership and ancestor guards to every descendant before signaling it.
- Refuse Docker and OrbStack proxy processes; killing their backends breaks the runtime rather than stopping one container. Mark them `is_stoppable: false` and label the bridge. Resolving container names would require an extra runtime-specific command and belongs in MVP1.

### Escalation as UI, not as policy

Send SIGTERM, then poll for up to ~3 seconds. If the port is still bound, the row's button becomes "Force stop" in red, which sends SIGKILL. Never auto-escalate — graceful shutdown is how a dev server flushes state, and a tool that silently SIGKILLs will eventually cost you something.

---

## Security

Not paranoia, an actual hole: any website you visit can POST to `http://localhost:9494`. A page with a kill endpoint and no protection is a page where `evil.com` can shut down your database.

Three cheap defenses, all of them:

1. Bind to `127.0.0.1` explicitly, never `0.0.0.0`.
2. Require a custom request header carrying an unpredictable per-process token on API requests. The page receives it in its initial HTML. Custom headers force a CORS preflight, and your server simply never approves preflights, so cross-origin requests die before they are sent; the token adds defense in depth.
3. Validate `Origin` (must be absent or your own origin) and `Host` (must be `127.0.0.1:9494`, `[::1]:9494`, or `localhost:9494`) on every API request. The Host check also blocks DNS rebinding. The allowed port follows the configured listen port.

Keep `GET /api/services` unauthenticated if you like, but a website learning your open ports is mild fingerprinting, so applying the same checks costs nothing.

---

## The page

Poll `/api/services` every 2.5s, pause on `document.hidden` via `visibilitychange`. Vanilla JS, no framework, no build step.

**Layout.** The port number is the identifier you actually think in, so give it a wide left column at large type, like a numbered berth on a dock. Everything else is the manifest for that berth: project name, kind badge, uptime, PID, truncated cwd, bind-scope badge. Actions on the right: "Open" (a link to `http://localhost:PORT`) and "Stop." Opening a wildcard bind through localhost is safe; the exposure badge still makes its wider network scope clear. Some non-HTTP listeners will naturally show a browser error.

**Chrome above the list.** Occupied-port count, a search box filtering across port/project/kind/argv, a "show system processes" checkbox, and a quiet last-updated indicator.

**Empty state** should be an invitation, not an error: "Nothing listening. Start a dev server and it'll appear here."

**Restraint.** No charts, no CPU sparklines, no color-coded severity. The information density is already high. One accent color, one alarm color for force-stop.

---

## Keeping it running

A LaunchAgent at `~/Library/LaunchAgents/com.portauthority.app.plist`, with keys `Label`, `ProgramArguments`, `RunAtLoad` true, `KeepAlive` true, `ProcessType` set to `Background`, and `StandardOutPath`/`StandardErrorPath` pointed at `~/Library/Logs/`. Use absolute paths in `ProgramArguments` (`sys.executable` and the resolved full script path) because launchd gives you a minimal PATH. Add `--uninstall` as the inverse operation.

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.portauthority.app.plist
launchctl kickstart -k gui/$(id -u)/com.portauthority.app   # restart after edits
```

Wrap all of this in a `--install` flag on the script so future-you doesn't have to remember plist XML.

Then `open http://localhost:9494` becomes a bookmark, or a Raycast/Alfred keyword.

---

## Known gotchas

- macOS Control Center holds **5000 and 7000** for AirPlay Receiver. Your tool will show them and you'll be briefly confused. Consider a note on those two rows.
- Root-owned listeners are largely invisible to non-root `lsof`. Don't fix this by running the agent as root; just note in the UI that system services need `sudo lsof`.
- A port in `TIME_WAIT` after a crash won't appear in a LISTEN-filtered query but can still block rebinding. Out of scope, worth knowing when the tool "lies."

---

## Build order

1. **Prototype as a CLI** — parse `lsof` into JSON, pretty-print a table. This is 80% of the actual difficulty, and you'll immediately find the parsing edge cases. (~45 min)
2. **Serve that JSON** from `http.server` on 127.0.0.1. (~15 min)
3. **Static page** that polls and renders rows. (~1 hr)
4. **Stop endpoint** with tree-walk and every guard. (~45 min)
5. **`--install`** and the LaunchAgent. (~30 min)
6. **Polish** — search, system toggle, force-stop escalation, empty state, keyboard focus.

Ship after step 3. Steps 1–3 already solve the original question, and you'll learn what you actually want from step 4 by living with it for a day.

---

## Appendix: the shell equivalents

Worth having regardless of whether you build the tool.

```bash
alias ports='lsof -nP -iTCP -sTCP:LISTEN'

lsof -nP -iTCP:3000 -sTCP:LISTEN                 # who has port 3000?
kill -TERM $(lsof -t -iTCP:3000 -sTCP:LISTEN)    # evict them
```

`lsof` piped into `fzf` gets you 70% of the tool in a shell alias, and things like Orbstack's process view cover parts of it. Build anyway if the appeal is the always-there dashboard, but check that the polished version beats a one-line alias for how you actually work.
