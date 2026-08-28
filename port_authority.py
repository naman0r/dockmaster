#!/usr/bin/env python3
"""Port Authority: a tiny, local dashboard for listening development servers."""

from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlsplit


APP_NAME = "Port Authority"
VERSION = "0.1.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9494
CACHE_TTL_SECONDS = 1.5
COMMAND_TIMEOUT_SECONDS = 3.0
LAUNCH_AGENT_LABEL = "com.portauthority.app"
AUTH_HEADER = "X-Port-Authority-Token"

LSOF = shutil.which("lsof") or "/usr/sbin/lsof"
PS = shutil.which("ps") or "/bin/ps"
LAUNCHCTL = "/bin/launchctl"
OPEN = "/usr/bin/open"


class CommandError(RuntimeError):
    """A required local command could not produce a usable result."""


class StopError(RuntimeError):
    """A stop request was invalid or unsafe."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def run_command(
    argv: List[str],
    *,
    timeout: float = COMMAND_TIMEOUT_SECONDS,
    allowed_returncodes: Iterable[int] = (0,),
) -> str:
    """Run a small, trusted argv without a shell and return stdout."""
    env = os.environ.copy()
    env["LC_ALL"] = "C"
    try:
        result = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            env=env,
        )
    except FileNotFoundError as exc:
        raise CommandError(f"Required command not found: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise CommandError(f"{Path(argv[0]).name} timed out after {timeout:g}s") from exc

    if result.returncode not in set(allowed_returncodes):
        detail = result.stderr.strip() or f"exit status {result.returncode}"
        raise CommandError(f"{Path(argv[0]).name} failed: {detail}")
    return result.stdout


def parse_address(value: str) -> Optional[Tuple[str, int]]:
    """Parse lsof names such as *:3000, 127.0.0.1:3000, and [::1]:3000."""
    match = re.search(r":(\d+)(?:\s+\(LISTEN\))?$", value)
    if not match:
        return None
    port = int(match.group(1))
    if not 1 <= port <= 65535:
        return None
    address = value[: match.start()]
    if address.startswith("[") and address.endswith("]"):
        address = address[1:-1]
    return (address or "*", port)


def parse_listener_output(output: str) -> Dict[int, Dict[str, Any]]:
    """Parse lsof field mode into processes containing port/address sets."""
    processes: Dict[int, Dict[str, Any]] = {}
    current: Optional[Dict[str, Any]] = None

    for raw_line in output.splitlines():
        if not raw_line:
            continue
        field, value = raw_line[0], raw_line[1:]
        if field == "p":
            try:
                pid = int(value)
            except ValueError:
                current = None
                continue
            current = processes.setdefault(
                pid, {"pid": pid, "command": "", "user": "", "ports": {}}
            )
        elif current is not None and field == "c":
            current["command"] = value
        elif current is not None and field == "L":
            current["user"] = value
        elif current is not None and field == "n":
            parsed = parse_address(value)
            if parsed is None:
                continue
            address, port = parsed
            current["ports"].setdefault(port, set()).add(address)

    return {pid: item for pid, item in processes.items() if item["ports"]}


def parse_started_at(parts: List[str]) -> str:
    raw = " ".join(parts)
    try:
        local_time = datetime.strptime(raw, "%a %b %d %H:%M:%S %Y")
        return local_time.astimezone().isoformat(timespec="seconds")
    except ValueError:
        return raw


def parse_process_details(output: str) -> Dict[int, Dict[str, Any]]:
    """Parse: pid, ppid, uid, lstart, user, command."""
    details: Dict[int, Dict[str, Any]] = {}
    for line in output.splitlines():
        parts = line.strip().split(None, 9)
        if len(parts) < 9:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
            uid = int(parts[2])
        except ValueError:
            continue
        details[pid] = {
            "pid": pid,
            "ppid": ppid,
            "uid": uid,
            "started_at": parse_started_at(parts[3:8]),
            "user": parts[8],
            "argv": parts[9].strip() if len(parts) == 10 else "",
        }
    return details


def parse_cwd_output(output: str) -> Dict[int, str]:
    cwds: Dict[int, str] = {}
    current_pid: Optional[int] = None
    for raw_line in output.splitlines():
        if not raw_line:
            continue
        field, value = raw_line[0], raw_line[1:]
        if field == "p":
            try:
                current_pid = int(value)
            except ValueError:
                current_pid = None
        elif field == "n" and current_pid is not None:
            cwds[current_pid] = value
    return cwds


KIND_RULES = [
    (
        re.compile(r"(?:^|\s)(?:\S*/)?port_authority\.py(?:\s|$)", re.I),
        "Port Authority",
        True,
    ),
    (re.compile(r"\bvite\b", re.I), "Vite", True),
    (re.compile(r"\bnext(?:-server)?\b|[/\\]next\b", re.I), "Next.js", True),
    (re.compile(r"\bwebpack\b", re.I), "Webpack", True),
    (re.compile(r"\breact-scripts\b", re.I), "React", True),
    (re.compile(r"\buvicorn\b", re.I), "Uvicorn", True),
    (re.compile(r"\bgunicorn\b", re.I), "Gunicorn", True),
    (re.compile(r"\bmanage\.py\s+runserver\b", re.I), "Django", True),
    (re.compile(r"\bflask\b", re.I), "Flask", True),
    (re.compile(r"\brails(?:\s+server|\s+s)\b|\bpuma\b", re.I), "Rails", True),
    (re.compile(r"\bstorybook\b", re.I), "Storybook", True),
    (re.compile(r"\bjupyter\b", re.I), "Jupyter", True),
    (re.compile(r"\bpython\S*\s+-m\s+http\.server\b", re.I), "Python HTTP", True),
    (re.compile(r"\bbun\b", re.I), "Bun", True),
    (re.compile(r"\bdeno\b", re.I), "Deno", True),
    (re.compile(r"\besbuild\b", re.I), "esbuild", True),
    (re.compile(r"\bpostgres(?:ql)?\b", re.I), "Postgres", True),
    (re.compile(r"\bredis-server\b", re.I), "Redis", True),
    (re.compile(r"\bmysqld\b", re.I), "MySQL", True),
    (re.compile(r"\bmongod\b", re.I), "MongoDB", True),
    (re.compile(r"\bollama\b", re.I), "Ollama", True),
    (re.compile(r"\bcom\.docker\b|docker desktop", re.I), "Docker bridge", True),
    (re.compile(r"\borbstack\b", re.I), "OrbStack bridge", True),
]

INFRASTRUCTURE_KINDS = {
    "Postgres",
    "Redis",
    "MySQL",
    "MongoDB",
    "Ollama",
    "Docker bridge",
    "OrbStack bridge",
}


def fallback_kind(argv: str, command: str) -> str:
    candidate = ""
    if argv:
        try:
            words = shlex.split(argv)
            candidate = words[0] if words else ""
        except ValueError:
            candidate = argv.split(None, 1)[0] if argv.split() else ""
    candidate = Path(candidate).name if candidate else command
    return candidate or "Unknown"


def classify(argv: str, command: str = "") -> Tuple[str, bool]:
    haystack = f"{argv} {command}".strip()
    for pattern, label, is_dev in KIND_RULES:
        if pattern.search(haystack):
            return label, is_dev
    return fallback_kind(argv, command), False


def find_project(cwd: str) -> str:
    """Return the nearest Git worktree/repository name, else the cwd basename."""
    if not cwd or cwd == "/":
        return ""
    current = Path(cwd)
    fallback = current.name
    for _ in range(20):
        try:
            if (current / ".git").exists():
                return current.name
        except OSError:
            break
        parent = current.parent
        if parent == current:
            break
        current = parent
    return fallback


def is_loopback_address(address: str) -> bool:
    if address.lower() == "localhost":
        return True
    if address in {"*", "0.0.0.0", "::"}:
        return False
    try:
        return ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False


def is_background_process(uid: int, argv: str, cwd: str, known_dev: bool) -> bool:
    if uid == 0:
        return True
    lowered = argv.lower()
    system_prefixes = (
        "/system/",
        "/usr/libexec/",
        "/library/apple/",
        "/library/privilegedhelpertools/",
    )
    if lowered.startswith(system_prefixes):
        return True
    if known_dev:
        return False
    python_framework_wrapper = "/python.app/contents/macos/python" in lowered
    if (
        ".app/contents/" in lowered or lowered.startswith("/applications/")
    ) and not python_framework_wrapper:
        return True
    return not cwd or cwd == "/"


def is_runtime_bridge(argv: str, kind: str) -> bool:
    lowered = argv.lower()
    return (
        kind in {"Docker bridge", "OrbStack bridge"}
        or "com.docker" in lowered
        or "orbstack" in lowered
    )


def address_sort_key(address: str) -> Tuple[int, str]:
    return (0 if is_loopback_address(address) else 1, address)


def has_listening_ancestor(
    pid: int,
    port: int,
    listeners: Dict[int, Dict[str, Any]],
    details: Dict[int, Dict[str, Any]],
) -> bool:
    """Detect an inherited socket already represented by a listening ancestor."""
    seen = {pid}
    cursor = details.get(pid, {}).get("ppid")
    while isinstance(cursor, int) and cursor > 1 and cursor not in seen:
        seen.add(cursor)
        ancestor = listeners.get(cursor)
        if ancestor is not None and port in ancestor["ports"]:
            return True
        parent_detail = details.get(cursor)
        if parent_detail is None:
            break
        cursor = parent_detail.get("ppid")
    return False


def read_process_table() -> Dict[int, Tuple[int, int]]:
    output = run_command([PS, "-axo", "pid=,ppid=,uid="])
    table: Dict[int, Tuple[int, int]] = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        try:
            pid, ppid, uid = map(int, parts)
        except ValueError:
            continue
        table[pid] = (ppid, uid)
    return table


def ancestor_chain(pid: int, table: Dict[int, Tuple[int, int]]) -> Set[int]:
    ancestors: Set[int] = {1, pid}
    cursor = pid
    while cursor in table:
        parent = table[cursor][0]
        if parent <= 1 or parent in ancestors:
            ancestors.add(max(parent, 1))
            break
        ancestors.add(parent)
        cursor = parent
    return ancestors


def descendant_order(pid: int, table: Dict[int, Tuple[int, int]]) -> List[int]:
    """Return descendants deepest-first, followed by pid itself."""
    children: Dict[int, List[int]] = {}
    for child, (parent, _uid) in table.items():
        children.setdefault(parent, []).append(child)

    depths: Dict[int, int] = {}
    stack = [(pid, 0)]
    seen = {pid}
    while stack:
        parent, depth = stack.pop()
        for child in children.get(parent, []):
            if child in seen:
                continue
            seen.add(child)
            depths[child] = depth + 1
            stack.append((child, depth + 1))

    ordered = sorted(depths, key=lambda item: (-depths[item], item))
    ordered.append(pid)
    return ordered


class Scanner:
    """Demand-driven, coalesced service discovery with a very short cache."""

    def __init__(
        self,
        *,
        protected_pids: Optional[Set[int]] = None,
        cache_ttl: float = CACHE_TTL_SECONDS,
    ) -> None:
        self.protected_pids = protected_pids or {1, os.getpid()}
        self.cache_ttl = cache_ttl
        self._lock = threading.Lock()
        self._cached: Optional[Dict[str, Any]] = None
        self._cached_at = 0.0

    def invalidate(self) -> None:
        with self._lock:
            self._cached_at = 0.0

    def snapshot(self, *, force: bool = False) -> Dict[str, Any]:
        with self._lock:
            now = time.monotonic()
            if (
                not force
                and self._cached is not None
                and now - self._cached_at < self.cache_ttl
            ):
                return self._cached
            snapshot = self._collect()
            self._cached = snapshot
            self._cached_at = time.monotonic()
            return snapshot

    def _collect(self) -> Dict[str, Any]:
        started = time.monotonic()
        listener_output = run_command(
            [LSOF, "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLn", "+c", "0"],
            allowed_returncodes=(0, 1),
        )
        listeners = parse_listener_output(listener_output)
        if not listeners:
            return self._result([], started)

        pid_csv = ",".join(str(pid) for pid in sorted(listeners))
        detail_output = run_command(
            [
                PS,
                "-o",
                "pid=,ppid=,uid=,lstart=,user=,command=",
                "-p",
                pid_csv,
            ],
            allowed_returncodes=(0, 1),
        )
        cwd_output = run_command(
            [LSOF, "-a", "-d", "cwd", "-F", "n", "-p", pid_csv],
            allowed_returncodes=(0, 1),
        )
        details = parse_process_details(detail_output)
        cwds = parse_cwd_output(cwd_output)
        project_cache: Dict[str, str] = {}
        services: List[Dict[str, Any]] = []
        current_uid = os.getuid()

        for pid, listener in listeners.items():
            detail = details.get(pid)
            if detail is None:
                continue
            cwd = cwds.get(pid, "")
            argv = detail["argv"] or listener["command"]
            kind, known_dev = classify(argv, listener["command"])
            if cwd not in project_cache:
                project_cache[cwd] = find_project(cwd)
            project = project_cache[cwd]
            if kind in INFRASTRUCTURE_KINDS and not cwd.startswith(
                str(Path.home()) + os.sep
            ):
                project = kind
            is_system = is_background_process(detail["uid"], argv, cwd, known_dev)
            protected = (
                pid <= 1
                or pid in self.protected_pids
                or detail["uid"] != current_uid
                or is_system
                or is_runtime_bridge(argv, kind)
            )

            for port, raw_addresses in listener["ports"].items():
                if has_listening_ancestor(pid, port, listeners, details):
                    continue
                addresses = sorted(raw_addresses, key=address_sort_key)
                exposed = any(not is_loopback_address(item) for item in addresses)
                note = ""
                if port in {5000, 7000} and (
                    "controlcenter" in argv.lower()
                    or "controlcenter" in listener["command"].lower()
                ):
                    note = "Usually macOS AirPlay Receiver"
                elif is_runtime_bridge(argv, kind):
                    note = "Managed by the container runtime"

                services.append(
                    {
                        "pid": pid,
                        "ppid": detail["ppid"],
                        "port": port,
                        "addresses": addresses,
                        "kind": kind,
                        "project": project or kind,
                        "cwd": cwd,
                        "argv": argv,
                        "user": detail["user"] or listener["user"],
                        "started_at": detail["started_at"],
                        "is_system": is_system,
                        "is_stoppable": not protected,
                        "is_exposed": exposed,
                        "note": note,
                    }
                )

        services.sort(key=lambda service: (service["port"], service["pid"]))
        return self._result(services, started)

    @staticmethod
    def _result(services: List[Dict[str, Any]], started: float) -> Dict[str, Any]:
        generated = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        return {
            "generated_at": generated.replace("+00:00", "Z"),
            "scan_ms": round((time.monotonic() - started) * 1000, 1),
            "services": services,
        }


class Stopper:
    """Validate an exact snapshot identity, then signal only a safe process tree."""

    def __init__(self, scanner: Scanner, protected_pids: Set[int]) -> None:
        self.scanner = scanner
        self.protected_pids = set(protected_pids)
        self.uid = os.getuid()

    @staticmethod
    def _validated_payload(payload: Dict[str, Any]) -> Tuple[int, int, str, str]:
        pid = payload.get("pid")
        port = payload.get("port")
        started_at = payload.get("started_at")
        mode = payload.get("mode")
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 1:
            raise StopError("pid must be an integer greater than 1")
        if (
            isinstance(port, bool)
            or not isinstance(port, int)
            or not 1 <= port <= 65535
        ):
            raise StopError("port must be an integer from 1 to 65535")
        if not isinstance(started_at, str) or not started_at:
            raise StopError("started_at is required")
        if mode not in {"term", "kill"}:
            raise StopError('mode must be "term" or "kill"')
        return pid, port, started_at, mode

    def stop(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        pid, port, started_at, mode = self._validated_payload(payload)
        snapshot = self.scanner.snapshot(force=True)
        service = next(
            (
                item
                for item in snapshot["services"]
                if item["pid"] == pid
                and item["port"] == port
                and hmac.compare_digest(item["started_at"], started_at)
            ),
            None,
        )
        if service is None:
            raise StopError(
                "That listener changed since the last refresh. The list has been updated.",
                409,
            )
        if not service["is_stoppable"]:
            raise StopError("That process is protected and cannot be stopped here.", 403)

        table = read_process_table()
        current = table.get(pid)
        if current is None:
            raise StopError("That process has already exited.", 409)
        if current[1] != self.uid:
            raise StopError("That process belongs to another user.", 403)

        protected = self.protected_pids | ancestor_chain(os.getpid(), table)
        order = descendant_order(pid, table)
        if any(candidate in protected or candidate <= 1 for candidate in order):
            raise StopError("Refusing to signal Port Authority or its ancestor chain.", 403)

        signaled: List[int] = []
        sig = signal.SIGTERM if mode == "term" else signal.SIGKILL
        for candidate in order:
            process = table.get(candidate)
            if process is None or process[1] != self.uid:
                continue
            try:
                os.kill(candidate, sig)
                signaled.append(candidate)
            except ProcessLookupError:
                continue
            except PermissionError as exc:
                raise StopError(f"Permission denied while signaling PID {candidate}.", 403) from exc

        self.scanner.invalidate()
        timeout = 3.0 if mode == "term" else 1.0
        deadline = time.monotonic() + timeout
        still_listening = self._port_is_listening(port)
        while still_listening and time.monotonic() < deadline:
            time.sleep(0.15)
            still_listening = self._port_is_listening(port)

        self.scanner.invalidate()
        return {
            "ok": True,
            "mode": mode,
            "signaled": signaled,
            "still_listening": still_listening,
        }

    @staticmethod
    def _port_is_listening(port: int) -> bool:
        output = run_command(
            [LSOF, "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-F", "p"],
            timeout=1.5,
            allowed_returncodes=(0, 1),
        )
        return any(line.startswith("p") for line in output.splitlines())


HTML_PAGE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#070b14">
  <title>Port Authority</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23070b14'/%3E%3Cpath d='M18 45V19h17c8 0 13 4 13 11s-5 11-13 11H26v4h-8Zm8-12h9c3 0 5-1 5-3s-2-3-5-3h-9v6Z' fill='%2368a9ff'/%3E%3C/svg%3E">
  <style>
    :root {
      --ink: #f2f6fc;
      --muted: #8593a8;
      --quiet: #526178;
      --accent: #68a9ff;
      --accent-soft: rgba(104, 169, 255, .10);
      --alarm: #ff6b6b;
      --alarm-soft: rgba(255, 107, 107, .10);
      --surface: #0b111c;
      --surface-raised: #101927;
      --line: #1c2a3e;
      --line-bright: #304965;
      --shadow: rgba(0, 0, 0, .42);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    html { min-height: 100%; background: #070b14; }

    body {
      min-width: 320px;
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(circle at 82% -10%, rgba(104, 169, 255, .10), transparent 31rem),
        radial-gradient(circle at -8% 72%, rgba(104, 169, 255, .05), transparent 26rem),
        #070b14;
    }

    body::before {
      position: fixed;
      inset: 0;
      z-index: -1;
      content: "";
      pointer-events: none;
      opacity: .34;
      background-image:
        linear-gradient(rgba(104, 169, 255, .028) 1px, transparent 1px),
        linear-gradient(90deg, rgba(104, 169, 255, .028) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: linear-gradient(to bottom, black, transparent 84%);
    }

    button, input { font: inherit; }

    button, a { -webkit-tap-highlight-color: transparent; }

    .shell {
      width: min(1160px, calc(100% - 40px));
      margin: 0 auto;
      padding: 48px 0 34px;
    .masthead {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 28px;
      margin-bottom: 30px;
    }

    .identity { display: flex; align-items: center; gap: 16px; }

    .mark {
      position: relative;
      display: grid;
      width: 54px;
      height: 54px;
      place-items: center;
      color: var(--accent);
      border: 1px solid var(--line-bright);
      border-radius: 13px;
      background: linear-gradient(145deg, rgba(104, 169, 255, .09), transparent);
      box-shadow: inset 0 0 24px rgba(104, 169, 255, .05), 0 16px 40px var(--shadow);
      font: 700 17px/1 var(--mono);
      letter-spacing: -.08em;
    }

    .mark::after {
      position: absolute;
      right: -3px;
      bottom: -3px;
      width: 8px;
      height: 8px;
      content: "";
      border: 2px solid #070b14;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 14px rgba(104, 169, 255, .7);
    }

    .eyebrow {
      margin: 0 0 7px;
      color: var(--accent);
      font: 600 10px/1.2 var(--mono);
      letter-spacing: .2em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font: 650 clamp(25px, 4vw, 36px)/1 var(--sans);
      letter-spacing: -.04em;
    }

    .connection {
      display: flex;
      align-items: center;
      gap: 9px;
      padding-bottom: 5px;
      color: var(--muted);
      font: 500 11px/1 var(--mono);
      letter-spacing: .06em;
    }

    .pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(104, 169, 255, .4);
      animation: ping 2.4s ease-out infinite;
    }

    @keyframes ping {
      60%, 100% { box-shadow: 0 0 0 8px rgba(104, 169, 255, 0); }
    }

    .console {
      position: relative;
      overflow: hidden;
      margin-bottom: 16px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(11, 17, 28, .86);
      box-shadow: 0 28px 80px var(--shadow);
      backdrop-filter: blur(16px);
    }

    .console::before {
      position: absolute;
      top: 0;
      left: 26px;
      width: 72px;
      height: 1px;
      content: "";
      background: var(--accent);
      box-shadow: 0 0 15px rgba(104, 169, 255, .8);
    }

    .controls {
      display: grid;
      grid-template-columns: minmax(190px, .75fr) minmax(280px, 1.55fr) minmax(210px, .85fr);
      align-items: stretch;
    }

    .counter, .search-wrap, .toggle-wrap {
      min-height: 112px;
      padding: 25px 28px;
    }

    .search-wrap, .toggle-wrap { border-left: 1px solid var(--line); }

    .counter { display: flex; align-items: baseline; gap: 12px; }

    .count {
      color: var(--accent);
      font: 500 45px/.9 var(--mono);
      letter-spacing: -.08em;
      text-shadow: 0 0 24px rgba(104, 169, 255, .16);
    }

    .count-label {
      max-width: 90px;
      color: var(--muted);
      font: 600 10px/1.4 var(--mono);
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .field-label {
      display: block;
      margin-bottom: 12px;
      color: var(--quiet);
      font: 600 9px/1 var(--mono);
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .search {
      width: 100%;
      padding: 0 0 11px 24px;
      color: var(--ink);
      caret-color: var(--accent);
      border: 0;
      border-bottom: 1px solid var(--line-bright);
      border-radius: 0;
      outline: 0;
      background: transparent;
      font: 500 14px/1 var(--mono);
      background-image:
        linear-gradient(45deg, transparent 42%, var(--muted) 42%, var(--muted) 58%, transparent 58%),
        linear-gradient(-45deg, transparent 42%, var(--muted) 42%, var(--muted) 58%, transparent 58%);
      background-position: 2px 7px, 8px 13px;
      background-repeat: no-repeat;
      background-size: 8px 8px;
      transition: border-color .18s ease;
    }

    .search::placeholder { color: var(--quiet); }
    .search:focus { border-color: var(--accent); }

    .toggle-wrap { display: flex; flex-direction: column; justify-content: center; }

    .toggle {
      display: flex;
      align-items: center;
      gap: 11px;
      color: var(--muted);
      cursor: pointer;
      font: 550 12px/1.35 var(--mono);
    }

    .toggle input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }

    .switch {
      position: relative;
      flex: 0 0 auto;
      width: 34px;
      height: 19px;
      border: 1px solid var(--line-bright);
      border-radius: 20px;
      background: #080e19;
      transition: border-color .18s ease, background .18s ease;
    }

    .switch::after {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 11px;
      height: 11px;
      content: "";
      border-radius: 50%;
      background: var(--quiet);
      transition: transform .18s ease, background .18s ease;
    }

    .toggle input:checked + .switch {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .toggle input:checked + .switch::after {
      background: var(--accent);
      transform: translateX(15px);
    }

    .toggle input:focus-visible + .switch { outline: 2px solid var(--accent); outline-offset: 3px; }

    .strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 13px 20px;
      color: var(--quiet);
      border-top: 1px solid var(--line);
      background: rgba(5, 9, 16, .3);
      font: 500 9px/1 var(--mono);
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .strip strong { color: var(--muted); font-weight: 600; }

    .error {
      display: none;
      margin: 14px 0;
      padding: 13px 16px;
      color: #ffc3c3;
      border: 1px solid rgba(255, 107, 107, .28);
      border-radius: 10px;
      background: var(--alarm-soft);
      font: 500 12px/1.5 var(--mono);
    }

    .error.visible { display: block; }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 27px 2px 12px;
      color: var(--muted);
      font: 600 10px/1 var(--mono);
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .section-heading span:last-child { color: var(--quiet); letter-spacing: .08em; }

    .services { display: grid; gap: 10px; }

    .service {
      position: relative;
      display: grid;
      grid-template-columns: 164px minmax(0, 1fr) auto;
      min-height: 142px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(115deg, rgba(15, 23, 35, .96), rgba(10, 16, 26, .96));
      box-shadow: 0 12px 30px rgba(0, 0, 0, .16);
      transition: border-color .18s ease, transform .18s ease, background .18s ease;
    }

    .service:hover {
      border-color: var(--line-bright);
      background: linear-gradient(115deg, rgba(17, 26, 40, .98), rgba(10, 16, 26, .98));
      transform: translateY(-1px);
    }

    .service.exposed::after {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      height: 1px;
      content: "";
      background: linear-gradient(90deg, transparent, var(--alarm), transparent);
      opacity: .48;
    }

    .berth {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 24px 25px;
      border-right: 1px solid var(--line);
      background:
        linear-gradient(135deg, rgba(104, 169, 255, .055), transparent 62%),
        repeating-linear-gradient(90deg, transparent 0 11px, rgba(104, 169, 255, .02) 11px 12px);
    }

    .port {
      color: var(--ink);
      font: 500 clamp(29px, 4vw, 40px)/1 var(--mono);
      letter-spacing: -.08em;
    }

    .colon { color: var(--accent); }

    .listen {
      margin: 11px 0 0 3px;
      color: var(--quiet);
      font: 600 8px/1 var(--mono);
      letter-spacing: .18em;
    }

    .manifest {
      min-width: 0;
      padding: 22px 26px;
    }

    .title-line {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 10px;
      margin-bottom: 11px;
    }

    .project {
      min-width: 0;
      overflow: hidden;
      margin: 0;
      color: var(--ink);
      font-size: 17px;
      font-weight: 640;
      letter-spacing: -.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      flex: 0 0 auto;
      padding: 5px 7px 4px;
      color: var(--accent);
      border: 1px solid rgba(104, 169, 255, .25);
      border-radius: 5px;
      background: var(--accent-soft);
      font: 650 8px/1 var(--mono);
      letter-spacing: .09em;
      text-transform: uppercase;
    }

    .badge.scope {
      color: var(--muted);
      border-color: var(--line-bright);
      background: rgba(255, 255, 255, .018);
    }

    .badge.scope.exposed {
      color: var(--alarm);
      border-color: rgba(255, 107, 107, .28);
      background: var(--alarm-soft);
    }

    .cwd, .argv {
      overflow: hidden;
      color: var(--muted);
      font: 500 11px/1.45 var(--mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cwd { margin-bottom: 10px; }
    .cwd::before { color: var(--accent); content: "cwd  "; opacity: .7; }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 16px;
      color: var(--quiet);
      font: 550 9px/1.3 var(--mono);
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .meta span { position: relative; }
    .meta span + span::before {
      position: absolute;
      left: -10px;
      color: var(--line-bright);
      content: "/";
    }

    .argv { margin-top: 10px; color: var(--quiet); }

    .note {
      margin-top: 8px;
      color: var(--alarm);
      font: 550 9px/1.35 var(--mono);
      letter-spacing: .03em;
    }

    .actions {
      display: flex;
      min-width: 118px;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      padding: 22px 22px 22px 10px;
    }

    .action {
      display: inline-flex;
      min-width: 104px;
      min-height: 37px;
      align-items: center;
      justify-content: center;
      padding: 0 14px;
      color: var(--muted);
      border: 1px solid var(--line-bright);
      border-radius: 8px;
      outline: 0;
      background: transparent;
      cursor: pointer;
      font: 650 9px/1 var(--mono);
      letter-spacing: .1em;
      text-decoration: none;
      text-transform: uppercase;
      transition: color .16s ease, border-color .16s ease, background .16s ease;
    }

    .action:hover { color: var(--ink); border-color: var(--muted); }
    .action:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .action.stop { color: var(--accent); border-color: rgba(104, 169, 255, .3); }
    .action.stop:hover { background: var(--accent-soft); border-color: var(--accent); }
    .action.force { color: var(--alarm); border-color: rgba(255, 107, 107, .38); }
    .action.force:hover { background: var(--alarm-soft); border-color: var(--alarm); }
    .action:disabled { color: var(--quiet); border-color: var(--line); cursor: not-allowed; opacity: .58; }
    .action.busy { cursor: wait; animation: breathe 1s ease-in-out infinite alternate; }

    @keyframes breathe { to { opacity: .48; } }

    .empty {
      display: grid;
      min-height: 245px;
      padding: 34px;
      place-items: center;
      text-align: center;
      border: 1px dashed var(--line-bright);
      border-radius: 14px;
      background: rgba(11, 17, 28, .55);
    }

    .empty-glyph {
      margin-bottom: 18px;
      color: var(--accent);
      font: 500 30px/1 var(--mono);
      letter-spacing: -.12em;
      opacity: .8;
    }

    .empty h2 { margin: 0 0 8px; font-size: 17px; }
    .empty p { margin: 0; color: var(--muted); font: 500 11px/1.55 var(--mono); }

    .toast {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 10;
      max-width: min(380px, calc(100vw - 48px));
      padding: 13px 16px;
      color: var(--ink);
      border: 1px solid var(--line-bright);
      border-radius: 9px;
      background: #111c2b;
      box-shadow: 0 20px 60px rgba(0, 0, 0, .48);
      font: 550 11px/1.4 var(--mono);
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity .18s ease, transform .18s ease;
    }

    .toast.visible { opacity: 1; transform: translateY(0); }
    .toast.alarm { color: #ffc1c1; border-color: rgba(255, 107, 107, .36); }

    footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 22px 3px 0;
      color: var(--quiet);
      font: 500 9px/1.5 var(--mono);
      letter-spacing: .05em;
    }

    footer span:last-child { text-align: right; }

    @media (max-width: 810px) {
      .shell { width: min(100% - 24px, 700px); padding-top: 26px; }
      .masthead { align-items: flex-start; }
      .connection { padding-top: 8px; }
      .controls { grid-template-columns: 1fr 1.6fr; }
      .toggle-wrap { min-height: 76px; grid-column: 1 / -1; border-top: 1px solid var(--line); border-left: 0; }
      .service { grid-template-columns: 126px minmax(0, 1fr); }
      .actions { grid-column: 1 / -1; flex-direction: row; padding: 0 18px 18px; }
      .action { flex: 1; }
    }

    @media (max-width: 560px) {
      .shell { width: calc(100% - 18px); padding-top: 19px; }
      .masthead { margin-bottom: 20px; }
      .mark { width: 46px; height: 46px; }
      .connection span:last-child { display: none; }
      .controls { grid-template-columns: 1fr; }
      .counter, .search-wrap, .toggle-wrap { min-height: auto; padding: 21px; }
      .search-wrap, .toggle-wrap { border-top: 1px solid var(--line); border-left: 0; }
      .service { grid-template-columns: 1fr; }
      .berth { min-height: 90px; padding: 20px 22px; border-right: 0; border-bottom: 1px solid var(--line); }
      .listen { margin-top: 7px; }
      .manifest { padding: 20px 22px; }
      .actions { padding: 0 22px 20px; }
      footer { flex-direction: column; }
      footer span:last-child { text-align: left; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div class="identity">
        <div class="mark" aria-hidden="true">PA</div>
        <div>
          <p class="eyebrow">Local berth monitor</p>
          <h1>Port Authority</h1>
        </div>
      </div>
      <div class="connection" title="Bound to this computer only">
        <span class="pulse" aria-hidden="true"></span>
        <span>127.0.0.1 / SECURE LOCAL</span>
      </div>
    </header>

    <section class="console" aria-label="Dashboard controls">
      <div class="controls">
        <div class="counter">
          <strong class="count" id="count">—</strong>
          <span class="count-label" id="count-label">scanning berths</span>
        </div>
        <label class="search-wrap">
          <span class="field-label">Filter manifest</span>
          <input class="search" id="search" type="search" placeholder="port, project, kind, command…" autocomplete="off" spellcheck="false">
        </label>
        <div class="toggle-wrap">
          <span class="field-label">Visibility</span>
          <label class="toggle">
            <input id="show-system" type="checkbox">
            <span class="switch" aria-hidden="true"></span>
            <span>Show background services</span>
          </label>
        </div>
      </div>
      <div class="strip">
        <span>Scanner <strong id="scanner-state">initializing</strong></span>
        <span id="last-updated">Awaiting first sweep</span>
      </div>
    </section>

    <div class="error" id="error" role="alert"></div>

    <div class="section-heading">
      <span>Active berths</span>
      <span id="result-summary">—</span>
    </div>
    <section class="services" id="services" aria-live="polite" aria-busy="true"></section>

    <footer>
      <span>PA/0.1 · LISTEN sockets only · polling pauses when hidden</span>
      <span>LAN EXPOSED means the service accepts non-loopback traffic</span>
    </footer>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
    "use strict";

    const AUTH_TOKEN = __TOKEN_JSON__;
    const state = {
      services: [],
      query: "",
      showSystem: false,
      fetching: false,
      pendingForce: new Set(),
      stopping: new Set(),
      toastTimer: null
    };

    const nodes = {
      count: document.getElementById("count"),
      countLabel: document.getElementById("count-label"),
      search: document.getElementById("search"),
      showSystem: document.getElementById("show-system"),
      scannerState: document.getElementById("scanner-state"),
      lastUpdated: document.getElementById("last-updated"),
      error: document.getElementById("error"),
      services: document.getElementById("services"),
      resultSummary: document.getElementById("result-summary"),
      toast: document.getElementById("toast")
    };

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function identity(service) {
      return [service.pid, service.port, service.started_at].join(":");
    }

    function compactPath(path, user) {
      if (!path) return "working directory unavailable";
      const prefix = "/Users/" + user;
      return path === prefix || path.startsWith(prefix + "/")
        ? "~" + path.slice(prefix.length)
        : path;
    }

    function formatUptime(startedAt) {
      const started = Date.parse(startedAt);
      if (!Number.isFinite(started)) return "uptime unknown";
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      if (seconds < 60) return seconds + "s uptime";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + "m uptime";
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h " + (minutes % 60) + "m uptime";
      return Math.floor(hours / 24) + "d " + (hours % 24) + "h uptime";
    }

    function searchable(service) {
      return [
        service.port,
        service.project,
        service.kind,
        service.cwd,
        service.argv,
        service.user,
        service.addresses.join(" ")
      ].join(" ").toLowerCase();
    }

    function visibleServices() {
      const needle = state.query.trim().toLowerCase();
      return state.services.filter(function(service) {
        if (!state.showSystem && service.is_system) return false;
        return !needle || searchable(service).includes(needle);
      });
    }

    function badge(text, extraClass) {
      return element("span", "badge" + (extraClass ? " " + extraClass : ""), text);
    }

    function makeService(service) {
      const key = identity(service);
      const card = element("article", "service" + (service.is_exposed ? " exposed" : ""));

      const berth = element("div", "berth");
      const port = element("div", "port");
      port.appendChild(element("span", "colon", ":"));
      port.appendChild(document.createTextNode(String(service.port)));
      berth.appendChild(port);
      berth.appendChild(element("div", "listen", "TCP / LISTEN"));

      const manifest = element("div", "manifest");
      const titleLine = element("div", "title-line");
      const project = element("h2", "project", service.project);
      project.title = service.project;
      titleLine.appendChild(project);
      titleLine.appendChild(badge(service.kind));
      titleLine.appendChild(
        badge(
          service.is_exposed ? "LAN exposed" : "Local only",
          "scope" + (service.is_exposed ? " exposed" : "")
        )
      );
      manifest.appendChild(titleLine);

      const cwd = element("div", "cwd", compactPath(service.cwd, service.user));
      cwd.title = service.cwd || "Working directory unavailable";
      manifest.appendChild(cwd);

      const meta = element("div", "meta");
      meta.appendChild(element("span", "", "PID " + service.pid));
      meta.appendChild(element("span", "", "PPID " + service.ppid));
      meta.appendChild(element("span", "", formatUptime(service.started_at)));
      meta.appendChild(element("span", "", service.user));
      manifest.appendChild(meta);

      const argv = element("div", "argv", "$ " + service.argv);
      argv.title = service.argv;
      manifest.appendChild(argv);
      if (service.note) manifest.appendChild(element("div", "note", service.note));

      const actions = element("div", "actions");
      const open = element("a", "action", "Open");
      open.href = "http://localhost:" + service.port + "/";
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.setAttribute("aria-label", "Open port " + service.port + " in a new tab");
      actions.appendChild(open);

      const force = state.pendingForce.has(key);
      const stop = element(
        "button",
        "action stop" + (force ? " force" : ""),
        force ? "Force stop" : "Stop"
      );
      stop.type = "button";
      const busy = state.stopping.has(key);
      stop.disabled = !service.is_stoppable || busy;
      if (busy) {
        stop.classList.add("busy");
        stop.textContent = force ? "Forcing…" : "Stopping…";
      } else if (!service.is_stoppable) {
        stop.textContent = "Protected";
        stop.title = "System, background, runtime bridge, or Port Authority process";
      } else {
        stop.addEventListener("click", function() {
          requestStop(service, force ? "kill" : "term");
        });
      }
      actions.appendChild(stop);

      card.appendChild(berth);
      card.appendChild(manifest);
      card.appendChild(actions);
      return card;
    }

    function emptyState(isSearch) {
      const empty = element("div", "empty");
      const inner = element("div");
      inner.appendChild(element("div", "empty-glyph", isSearch ? "[ ? ]" : "[ : ]"));
      inner.appendChild(
        element("h2", "", isSearch ? "No matching berths" : "Nothing listening")
      );
      inner.appendChild(
        element(
          "p",
          "",
          isSearch
            ? "Try a port, project name, process kind, or command."
            : "Start a dev server and it will appear here."
        )
      );
      empty.appendChild(inner);
      return empty;
    }

    function render() {
      const services = visibleServices();
      const uniquePorts = new Set(services.map(function(item) { return item.port; }));
      nodes.count.textContent = String(uniquePorts.size).padStart(2, "0");
      nodes.countLabel.textContent = uniquePorts.size === 1 ? "occupied port" : "occupied ports";
      nodes.resultSummary.textContent =
        services.length + " manifest " + (services.length === 1 ? "entry" : "entries");
      nodes.services.replaceChildren();
      if (!services.length) {
        nodes.services.appendChild(emptyState(Boolean(state.query.trim())));
      } else {
        const fragment = document.createDocumentFragment();
        services.forEach(function(service) {
          fragment.appendChild(makeService(service));
        });
        nodes.services.appendChild(fragment);
      }
      nodes.services.setAttribute("aria-busy", "false");
    }

    function showError(message) {
      nodes.error.textContent = message || "";
      nodes.error.classList.toggle("visible", Boolean(message));
    }

    function showToast(message, alarm) {
      window.clearTimeout(state.toastTimer);
      nodes.toast.textContent = message;
      nodes.toast.classList.toggle("alarm", Boolean(alarm));
      nodes.toast.classList.add("visible");
      state.toastTimer = window.setTimeout(function() {
        nodes.toast.classList.remove("visible");
      }, 3600);
    }

    async function readJson(response) {
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        payload = {};
      }
      if (!response.ok) {
        if (response.status === 403) {
          try {
            const lastReload = Number(sessionStorage.getItem("pa-auth-reload") || "0");
            if (Date.now() - lastReload > 10000) {
              sessionStorage.setItem("pa-auth-reload", String(Date.now()));
              window.location.reload();
            }
          } catch (_error) {}
        }
        throw new Error(payload.error || "Request failed (" + response.status + ")");
      }
      return payload;
    }

    async function refresh() {
      if (state.fetching || document.hidden) return;
      state.fetching = true;
      nodes.scannerState.textContent = "sweeping";
      try {
        const response = await fetch("/api/services", {
          cache: "no-store",
          headers: { "X-Port-Authority-Token": AUTH_TOKEN }
        });
        const payload = await readJson(response);
        try { sessionStorage.removeItem("pa-auth-reload"); } catch (_error) {}
        state.services = Array.isArray(payload.services) ? payload.services : [];
        nodes.lastUpdated.textContent =
          "Updated " + new Date(payload.generated_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
        nodes.scannerState.textContent = "online / " + payload.scan_ms + "ms";
        showError("");
        render();
      } catch (error) {
        nodes.scannerState.textContent = "offline";
        showError("Scanner unavailable: " + error.message);
      } finally {
        state.fetching = false;
      }
    }

    async function requestStop(service, mode) {
      const key = identity(service);
      if (mode === "kill") {
        const confirmed = window.confirm(
          "Force stop " + service.project + " on port " + service.port + "? Unsaved state may be lost."
        );
        if (!confirmed) return;
      }
      state.stopping.add(key);
      render();
      try {
        const response = await fetch("/api/stop", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Port-Authority-Token": AUTH_TOKEN
          },
          body: JSON.stringify({
            pid: service.pid,
            port: service.port,
            started_at: service.started_at,
            mode: mode
          })
        });
        const payload = await readJson(response);
        if (payload.still_listening && mode === "term") {
          state.pendingForce.add(key);
          showToast(service.project + " is still listening. Force stop is now available.", true);
        } else if (payload.still_listening) {
          showToast("Port " + service.port + " is still occupied by a listener.", true);
        } else {
          state.pendingForce.delete(key);
          showToast(service.project + " released port " + service.port + ".", false);
        }
      } catch (error) {
        showToast(error.message, true);
      } finally {
        state.stopping.delete(key);
        await refresh();
        render();
      }
    }

    nodes.search.addEventListener("input", function(event) {
      state.query = event.target.value;
      render();
    });

    nodes.showSystem.addEventListener("change", function(event) {
      state.showSystem = event.target.checked;
      try { localStorage.setItem("pa-show-background", String(state.showSystem)); } catch (_error) {}
      render();
    });

    document.addEventListener("visibilitychange", function() {
      if (!document.hidden) refresh();
    });

    try {
      state.showSystem = localStorage.getItem("pa-show-background") === "true";
      nodes.showSystem.checked = state.showSystem;
    } catch (_error) {}

    refresh();
    window.setInterval(refresh, 2500);
  </script>
</body>
</html>
"""


class PortAuthorityServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        address: Tuple[str, int],
        scanner: Scanner,
        stopper: Stopper,
        *,
        verbose: bool = False,
    ) -> None:
        self.scanner = scanner
        self.stopper = stopper
        self.auth_token = secrets.token_urlsafe(24)
        self.verbose = verbose
        super().__init__(address, RequestHandler)
        self.listen_port = int(self.server_address[1])

    @property
    def allowed_hosts(self) -> Set[str]:
        return {
            f"127.0.0.1:{self.listen_port}",
            f"localhost:{self.listen_port}",
            f"[::1]:{self.listen_port}",
        }


class RequestHandler(BaseHTTPRequestHandler):
    server: PortAuthorityServer
    server_version = "PortAuthority/" + VERSION
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.server.verbose:
            super().log_message(fmt, *args)

    def _request_is_local(self) -> bool:
        host = self.headers.get("Host", "").lower()
        if host not in self.server.allowed_hosts:
            return False
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        return origin.lower() == "http://" + host

    def _token_is_valid(self) -> bool:
        supplied = self.headers.get(AUTH_HEADER, "")
        return bool(supplied) and hmac.compare_digest(supplied, self.server.auth_token)

    def _send(
        self,
        status: int,
        body: bytes,
        content_type: str,
        *,
        html: bool = False,
    ) -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            if html:
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'; "
                    "script-src 'unsafe-inline'; img-src data:; connect-src 'self'; "
                    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
                )
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A tab can disappear while an lsof scan is in flight.
            return

    def _json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _reject_untrusted(self, *, require_token: bool) -> bool:
        if not self._request_is_local():
            self._json(403, {"error": "Untrusted Host or Origin."})
            return True
        if require_token and not self._token_is_valid():
            self._json(403, {"error": "Missing or invalid local request token."})
            return True
        return False

    def do_HEAD(self) -> None:
        self._handle_get()

    def do_GET(self) -> None:
        self._handle_get()

    def _handle_get(self) -> None:
        path = urlsplit(self.path).path
        if path == "/":
            if self._reject_untrusted(require_token=False):
                return
            page = HTML_PAGE.replace(
                "__TOKEN_JSON__", json.dumps(self.server.auth_token)
            ).encode("utf-8")
            self._send(200, page, "text/html; charset=utf-8", html=True)
            return
        if path == "/api/services":
            if self._reject_untrusted(require_token=True):
                return
            try:
                self._json(200, self.server.scanner.snapshot())
            except CommandError as exc:
                self._json(503, {"error": str(exc)})
            except Exception as exc:
                if self.server.verbose:
                    print(f"scan failed: {exc!r}", file=sys.stderr, flush=True)
                self._json(500, {"error": "Service discovery failed."})
            return
        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/stop":
            self._json(404, {"error": "Not found."})
            return
        if self._reject_untrusted(require_token=True):
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._json(415, {"error": "Content-Type must be application/json."})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if not 1 <= length <= 4096:
            self._json(400, {"error": "Request body must be 1–4096 bytes."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"error": "Request body is not valid JSON."})
            return
        if not isinstance(payload, dict):
            self._json(400, {"error": "Request body must be a JSON object."})
            return
        try:
            result = self.server.stopper.stop(payload)
            self._json(200, result)
        except StopError as exc:
            self._json(exc.status, {"error": str(exc)})
        except CommandError as exc:
            self._json(503, {"error": str(exc)})
        except Exception as exc:
            if self.server.verbose:
                print(f"stop failed: {exc!r}", file=sys.stderr, flush=True)
            self._json(500, {"error": "The stop request failed."})

    def do_OPTIONS(self) -> None:
        self._json(405, {"error": "CORS preflight is not allowed."})


def port_number(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be an integer") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be from 1 to 65535")
    return port


def launch_agent_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LAUNCH_AGENT_LABEL}.plist"


def launch_domain() -> str:
    return f"gui/{os.getuid()}"


def install_launch_agent(port: int) -> None:
    if sys.platform != "darwin":
        raise RuntimeError("--install is supported on macOS only")
    script_path = Path(__file__).resolve()
    python_path = Path(sys.executable).resolve()
    plist_path = launch_agent_path()
    logs_dir = Path.home() / "Library" / "Logs"
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "Label": LAUNCH_AGENT_LABEL,
        "ProgramArguments": [
            str(python_path),
            str(script_path),
            "--port",
            str(port),
        ],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "ThrottleInterval": 10,
        "StandardOutPath": str(logs_dir / "PortAuthority.log"),
        "StandardErrorPath": str(logs_dir / "PortAuthority.error.log"),
    }
    temporary = plist_path.with_suffix(".plist.tmp")
    with temporary.open("wb") as handle:
        plistlib.dump(payload, handle, sort_keys=False)
    os.replace(temporary, plist_path)

    subprocess.run(
        [LAUNCHCTL, "bootout", f"{launch_domain()}/{LAUNCH_AGENT_LABEL}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    result = subprocess.run(
        [LAUNCHCTL, "bootstrap", launch_domain(), str(plist_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "launchctl bootstrap failed")
    print(f"Installed {APP_NAME} at {plist_path}")
    print(f"Open http://localhost:{port}")


def uninstall_launch_agent() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("--uninstall is supported on macOS only")
    plist_path = launch_agent_path()
    subprocess.run(
        [LAUNCHCTL, "bootout", f"{launch_domain()}/{LAUNCH_AGENT_LABEL}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if plist_path.exists():
        plist_path.unlink()
        print(f"Removed {plist_path}")
    else:
        print(f"{APP_NAME} was not installed.")
    print("Log files were left in ~/Library/Logs.")


def build_runtime() -> Tuple[Scanner, Stopper, Set[int]]:
    try:
        table = read_process_table()
        protected = ancestor_chain(os.getpid(), table)
    except CommandError:
        protected = {1, os.getpid(), os.getppid()}
    scanner = Scanner(protected_pids=protected)
    stopper = Stopper(scanner, protected)
    return scanner, stopper, protected


def serve(port: int, *, open_browser: bool, verbose: bool) -> int:
    scanner, stopper, _protected = build_runtime()
    try:
        server = PortAuthorityServer(
            (DEFAULT_HOST, port), scanner, stopper, verbose=verbose
        )
    except OSError as exc:
        print(f"{APP_NAME} could not bind to {DEFAULT_HOST}:{port}: {exc}", file=sys.stderr)
        return 1

    url = f"http://localhost:{server.listen_port}"
    print(f"{APP_NAME} {VERSION} listening at {url}", flush=True)
    if open_browser:
        subprocess.run(
            [OPEN, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
    finally:
        server.server_close()
    return 0


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="A tiny local dashboard for listening development servers."
    )
    parser.add_argument("--port", type=port_number, default=DEFAULT_PORT)
    parser.add_argument(
        "--scan",
        action="store_true",
        help="print one JSON snapshot and exit",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        dest="open_browser",
        help="open the dashboard after starting",
    )
    parser.add_argument("--verbose", action="store_true", help="log HTTP requests and errors")
    parser.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--install",
        action="store_true",
        help="install and start the per-user macOS LaunchAgent",
    )
    actions.add_argument(
        "--uninstall",
        action="store_true",
        help="stop and remove the macOS LaunchAgent (logs are preserved)",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    if sys.version_info < (3, 9):
        print(f"{APP_NAME} requires Python 3.9 or newer.", file=sys.stderr)
        return 1
    args = make_parser().parse_args(argv)
    try:
        if args.install:
            install_launch_agent(args.port)
            return 0
        if args.uninstall:
            uninstall_launch_agent()
            return 0
        if args.scan:
            scanner, _stopper, _protected = build_runtime()
            print(json.dumps(scanner.snapshot(force=True), indent=2))
            return 0
        return serve(args.port, open_browser=args.open_browser, verbose=args.verbose)
    except (CommandError, RuntimeError) as exc:
        print(f"{APP_NAME}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
