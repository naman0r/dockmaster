"use client";

import { useCallback, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  SearchInput,
  Toggle,
  useToast,
} from "@/components/ui";
import styles from "./page.module.css";

type Service = {
  pid: number;
  ppid: number;
  port: number;
  addresses: string[];
  kind: string;
  project: string;
  cwd: string;
  argv: string;
  user: string;
  startedAt: string;
  isSystem: boolean;
  isStoppable: boolean;
  isExposed: boolean;
  note: string;
};

type PortsSnapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { services: Service[] } | null;
  scanMs?: number;
};

function identity(s: Service): string {
  return [s.pid, s.port, s.startedAt].join(":");
}

function compactPath(p: string, user: string): string {
  if (!p) return "working directory unavailable";
  const prefix = `/Users/${user}`;
  return p === prefix || p.startsWith(`${prefix}/`) ? `~${p.slice(prefix.length)}` : p;
}

function formatUptime(startedAt: string): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "uptime unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function searchable(s: Service): string {
  return [s.port, s.project, s.kind, s.cwd, s.argv, s.user, s.addresses.join(" ")]
    .join(" ")
    .toLowerCase();
}

export default function PortsPage() {
  const [snap, setSnap] = useState<PortsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [pendingForce, setPendingForce] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<PortsSnapshot>("/api/ports");
      setSnap(data);
      setError("");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 2500);

  const visible = useMemo(() => {
    const services = snap?.data?.services || [];
    const needle = query.trim().toLowerCase();
    return services.filter((s) => {
      if (!showSystem && s.isSystem) return false;
      return !needle || searchable(s).includes(needle);
    });
  }, [snap, query, showSystem]);

  const uniquePorts = useMemo(() => new Set(visible.map((s) => s.port)).size, [visible]);

  const requestStop = useCallback(
    async (service: Service, mode: "term" | "kill") => {
      const key = identity(service);
      if (mode === "kill") {
        const ok = window.confirm(
          `Force stop ${service.project} on port ${service.port}? Unsaved state may be lost.`,
        );
        if (!ok) return;
      }
      setStopping((prev) => new Set(prev).add(key));
      try {
        const result = await apiPost<{
          stillListening: boolean;
        }>("/api/ports/stop", {
          pid: service.pid,
          port: service.port,
          startedAt: service.startedAt,
          mode,
        });
        if (result.stillListening && mode === "term") {
          setPendingForce((prev) => new Set(prev).add(key));
          toast(`${service.project} is still listening. Force stop is now available.`, true);
        } else if (result.stillListening) {
          toast(`Port ${service.port} is still occupied by a listener.`, true);
        } else {
          setPendingForce((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          toast(`${service.project} released port ${service.port}.`);
        }
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setStopping((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        await refresh();
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { ports: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  return (
    <>
      <PageHeader
        eyebrow="Port authority"
        title="Listening berths"
        description="Every server holding a TCP port on this Mac. Stop sends SIGTERM to the whole process tree; force stop is a separate confirmed step, never automatic."
        right={
          <Toggle checked={enabled} onChange={toggleModule} label="Module on" />
        }
      />
      <div className="toolbar">
        <div className="grow">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="port, project, kind, command…"
          />
        </div>
        <Toggle checked={showSystem} onChange={setShowSystem} label="Background services" />
        <span className="hint mono">
          {snap?.cachedAt
            ? `updated ${new Date(snap.cachedAt).toLocaleTimeString()}${
                snap.scanMs !== undefined ? ` / ${snap.scanMs}ms` : ""
              }`
            : "scanning…"}
        </span>
      </div>
      <ErrorNote message={error} />
      <div className="section-heading">
        <span>Active berths</span>
        <span>
          {uniquePorts} ports / {visible.length} entries
        </span>
      </div>
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : visible.length === 0 ? (
        <EmptyState
          glyph={query ? "[ ? ]" : "[ : ]"}
          title={query ? "No matching berths" : "Nothing listening"}
          hint={
            query
              ? "Try a port, project name, process kind, or command."
              : "Start a dev server and it will appear here."
          }
        />
      ) : (
        <div className={styles.services}>
          {visible.map((s) => {
            const key = identity(s);
            const force = pendingForce.has(key);
            const busy = stopping.has(key);
            return (
              <article
                key={key}
                className={`${styles.service}${s.isExposed ? ` ${styles.exposed}` : ""}`}
              >
                <div className={styles.berth}>
                  <div className={styles.portNumber}>
                    <span className={styles.colon}>:</span>
                    {s.port}
                  </div>
                  <div className={styles.listen}>TCP / LISTEN</div>
                </div>
                <div className={styles.manifest}>
                  <div className={styles.titleLine}>
                    <h3 className={styles.project} title={s.project}>
                      {s.project}
                    </h3>
                    <Badge>{s.kind}</Badge>
                    <Badge variant={s.isExposed ? "exposed" : "scope"}>
                      {s.isExposed ? "LAN exposed" : "Local only"}
                    </Badge>
                  </div>
                  <div className={`mono muted trunc ${styles.cwd}`} title={s.cwd}>
                    cwd {compactPath(s.cwd, s.user)}
                  </div>
                  <div className={styles.meta}>
                    <span>PID {s.pid}</span>
                    <span>PPID {s.ppid}</span>
                    <span>{formatUptime(s.startedAt)}</span>
                    <span>{s.user}</span>
                    <span className="mono quiet">{s.addresses.join(" ")}</span>
                  </div>
                  <div className={`mono quiet trunc ${styles.argv}`} title={s.argv}>
                    $ {s.argv}
                  </div>
                  {s.note ? <div className={`alarm-text ${styles.note}`}>{s.note}</div> : null}
                </div>
                <div className={styles.actions}>
                  <a
                    className="btn"
                    href={`http://localhost:${s.port}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open
                  </a>
                  {s.isStoppable ? (
                    <Button
                      variant={force ? "force" : "stop"}
                      busy={busy}
                      onClick={() => requestStop(s, force ? "kill" : "term")}
                    >
                      {busy ? (force ? "Forcing…" : "Stopping…") : force ? "Force stop" : "Stop"}
                    </Button>
                  ) : (
                    <Button disabled title="System, background, runtime bridge, or Dockmaster process">
                      Protected
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
