# Port Authority

A tiny local dashboard for seeing which development servers are listening on your Mac—and stopping them without hunting through terminal tabs.

Port Authority is one Python file, uses only the standard library, and does no discovery work while the dashboard is closed. When the page is open, it scans on demand with macOS's built-in <code>lsof</code> and <code>ps</code> tools.

## Run it

Requirements: macOS, Python 3.9 or newer, <code>lsof</code>, and <code>ps</code>.

~~~bash
chmod +x port_authority.py
./port_authority.py --open
~~~

The dashboard binds only to <code>127.0.0.1</code> and defaults to [http://localhost:9494](http://localhost:9494).

Useful commands:

~~~bash
./port_authority.py --scan          # print one JSON snapshot
./port_authority.py --port 9595     # use another local port
./port_authority.py --verbose       # include HTTP request logs
~~~

## Keep it running

Install a per-user macOS LaunchAgent:

~~~bash
./port_authority.py --install
~~~

The installer records the absolute paths of the current Python interpreter and this script, then starts <code>com.portauthority.app</code>. Keep the script at the same path; rerun <code>--install</code> if either path changes.

To stop the agent and remove its plist:

~~~bash
./port_authority.py --uninstall
~~~

Uninstalling preserves <code>~/Library/Logs/PortAuthority.log</code> and <code>PortAuthority.error.log</code>.

## What it shows

- One entry for each listening (PID, port), with dual-stack addresses collapsed
- Process kind, Git project, exact working directory, command, owner, and uptime
- A prominent warning when a listener accepts non-loopback traffic
- Background and macOS services behind an optional toggle
- Protected Docker/OrbStack bridges that cannot be killed from the dashboard

Search matches ports, projects, kinds, commands, users, paths, and bind addresses.

## Stop safety

A normal stop sends <code>SIGTERM</code> to the selected process and its descendants, deepest first. If the port remains occupied after three seconds, the UI offers a separately confirmed <code>SIGKILL</code>; it never escalates automatically.

Before signaling, Port Authority:

- refreshes discovery and matches the PID, port, and process start time to prevent stale PID reuse
- refuses PID 1, itself, and every process in its ancestor chain
- refuses processes owned by another user, background/system processes, and container-runtime bridges
- validates every descendant in the process tree

The HTTP API is loopback-only. API requests also require a per-process token, an exact local <code>Host</code>, and a matching <code>Origin</code>; CORS preflights are rejected.

## Development

Run the focused standard-library test suite:

~~~bash
python3 -m unittest -v
~~~

The app intentionally has no package manager, virtual environment, build step, external fonts, analytics, or runtime dependencies.
