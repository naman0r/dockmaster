"use client";

import { useCallback, useState } from "react";
import { apiGet } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import { ErrorNote, PageHeader } from "@/components/ui";

type SnapshotLite = {
  enabled: boolean;
  cachedAt: string | null;
  data: unknown;
};

type Metric = { value: string; label: string; tone?: "alarm" | "ok" };

type ModuleCard = {
  href: string;
  glyph: string;
  title: string;
  description: string;
  endpoint: string;
  metric: (snap: SnapshotLite) => Metric;
};

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

type Vitals = {
  uptimeSeconds: number;
  loadAvg: [number, number, number] | null;
  memFreePct: number | null;
  disk: { freeKb: number; totalKb: number; usedPct: number } | null;
  battery: { pct: number; source: string; status: string } | null;
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatGb(kb: number): string {
  const gb = kb / 1024 / 1024;
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
}

function vitalCells(v: Vitals): Array<{ label: string; value: string; alarm?: boolean }> {
  return [
    { label: "uptime", value: formatUptime(v.uptimeSeconds) },
    v.loadAvg && { label: "load", value: v.loadAvg.map((n) => n.toFixed(2)).join("  ") },
    v.memFreePct !== null && { label: "mem free", value: `${v.memFreePct}%` },
    v.disk && {
      label: "disk",
      value: `${formatGb(v.disk.freeKb)} of ${formatGb(v.disk.totalKb)}`,
      alarm: v.disk.usedPct >= 90,
    },
    v.battery && {
      label: "battery",
      value: `${v.battery.pct}% ${v.battery.status}`,
      alarm: v.battery.status === "discharging" && v.battery.pct < 20,
    },
  ].filter(Boolean) as Array<{ label: string; value: string; alarm?: boolean }>;
}

const MODULES: ModuleCard[] = [
  {
    href: "/ports",
    glyph: "PT",
    title: "Ports",
    description: "Every listening dev server, with a guarded stop button.",
    endpoint: "/api/ports",
    metric: (s) => {
      const n = countOf((s.data as { services?: unknown[] } | null)?.services);
      return { value: String(n), label: n === 1 ? "listener" : "listeners" };
    },
  },
  {
    href: "/repos",
    glyph: "RP",
    title: "Repos",
    description: "What every repository under your dev root is up to.",
    endpoint: "/api/repos",
    metric: (s) => {
      const repos = (s.data as { repos?: Array<{ dirty: number; ahead: number }> } | null)?.repos || [];
      const dirty = repos.filter((r) => r.dirty > 0).length;
      const ahead = repos.filter((r) => r.ahead > 0).length;
      return { value: String(repos.length), label: `${dirty} dirty · ${ahead} unpushed` };
    },
  },
  {
    href: "/worktrees",
    glyph: "WT",
    title: "Worktrees",
    description: "Linked worktrees, pruneables, and stale branches.",
    endpoint: "/api/worktrees",
    metric: (s) => {
      const data = s.data as { repos?: Array<{ worktrees: unknown[] }> } | null;
      const total = (data?.repos || []).reduce((acc, r) => acc + countOf(r.worktrees), 0);
      return { value: String(total), label: total === 1 ? "worktree" : "worktrees" };
    },
  },
  {
    href: "/health",
    glyph: "HL",
    title: "Health",
    description: "Is it up? Localhost services and anything else you care about.",
    endpoint: "/api/health",
    metric: (s) => {
      const checks = (s.data as { checks?: Array<{ lastOk: boolean | null }> } | null)?.checks || [];
      const down = checks.filter((c) => c.lastOk === false).length;
      return down
        ? { value: String(down), label: `of ${checks.length} down`, tone: "alarm" }
        : { value: String(checks.length), label: "checks green", tone: "ok" };
    },
  },
  {
    href: "/hosts",
    glyph: "HS",
    title: "Hosts",
    description: "/etc/hosts with profiles, applied through a system prompt.",
    endpoint: "/api/hosts",
    metric: (s) => {
      const data = s.data as { entries?: unknown[]; activeProfile?: string | null } | null;
      return { value: String(countOf(data?.entries)), label: data?.activeProfile || "entries" };
    },
  },
  {
    href: "/processes",
    glyph: "PC",
    title: "Processes",
    description: "CPU and memory hogs, sampled live.",
    endpoint: "/api/processes",
    metric: (s) => {
      const top = (s.data as { sample?: Array<{ command: string; cpuPct: number }> } | null)?.sample?.[0];
      return top
        ? { value: `${top.cpuPct.toFixed(0)}%`, label: top.command }
        : { value: "—", label: "sampling" };
    },
  },
  {
    href: "/secrets",
    glyph: "SC",
    title: "Secrets",
    description: "Committed .env files and credential-shaped strings across repos.",
    endpoint: "/api/secrets",
    metric: (s) => {
      const n = countOf((s.data as { findings?: unknown[] } | null)?.findings);
      return n
        ? { value: String(n), label: n === 1 ? "finding" : "findings", tone: "alarm" }
        : { value: "0", label: "findings", tone: "ok" };
    },
  },
  {
    href: "/logbook",
    glyph: "LB",
    title: "Logbook",
    description: "Which project had you, sampled from the frontmost app.",
    endpoint: "/api/logbook",
    metric: (s) => {
      const data = s.data as { today?: Array<{ project: string; minutes: number }>; sessionActive?: boolean } | null;
      const top = data?.today?.[0];
      if (!top) return { value: "—", label: data?.sessionActive ? "recording" : "nothing today" };
      return { value: `${top.minutes}m`, label: top.project };
    },
  },
  {
    href: "/notepad",
    glyph: "NP",
    title: "Notepad",
    description: "Local scratch pad for dev notes and tools worth remembering.",
    endpoint: "/api/notes",
    metric: (s) => {
      const n = countOf((s.data as { notes?: unknown[] } | null)?.notes);
      return { value: String(n), label: n === 1 ? "note" : "notes" };
    },
  },
];

function berth(m: ModuleCard, snap: SnapshotLite | null | undefined): Metric & { pending?: boolean } {
  if (snap === undefined) return { value: "··", label: "reading", pending: true };
  if (snap === null) return { value: "!", label: "unreachable", tone: "alarm" };
  if (!snap.enabled) return { value: "—", label: "module off" };
  return m.metric(snap);
}

const VALUE_TONE = { alarm: "text-alarm", ok: "text-ok" } as const;

export default function OverviewPage() {
  const [snaps, setSnaps] = useState<Record<string, SnapshotLite | null>>({});
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      ...MODULES.map(async (m) => [m.href, await apiGet<SnapshotLite>(m.endpoint)] as const),
      apiGet<SnapshotLite>("/api/vitals").then((v) => ["/api/vitals", v] as const),
    ]);
    const next: Record<string, SnapshotLite | null> = {};
    let failed = false;
    for (const result of results) {
      if (result.status !== "fulfilled") {
        failed = true;
        continue;
      }
      const [key, value] = result.value;
      if (key === "/api/vitals") setVitals((value.data as Vitals) ?? null);
      else next[key] = value;
    }
    setSnaps(next);
    setError(failed ? "One or more modules are unreachable." : "");
  }, []);

  usePoll(refresh, 5000);

  return (
    <>
      <PageHeader
        eyebrow="Local berth monitor"
        title="The harbor at a glance"
        description="Everything Dockmaster knows right now. Modules only scan while a page is open, and each can be switched off from its own page."
        right={
          <span className="flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-quiet">
            <span
              aria-hidden="true"
              className={`size-1.5 animate-breathe rounded-full ${error ? "bg-alarm" : "bg-ok"}`}
            />
            live · 5s
          </span>
        }
      />
      <ErrorNote message={error} />
      <div className="card-surface mb-3.5 flex flex-wrap divide-x divide-line overflow-hidden rounded-[14px] border border-line">
        {vitals ? (
          vitalCells(vitals).map((c) => (
            <div key={c.label} className="flex min-w-[132px] grow flex-col gap-[7px] px-5 py-3">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-quiet">
                {c.label}
              </span>
              <span className={`font-mono text-[13px] ${c.alarm ? "text-alarm" : "text-ink"}`}>
                {c.value}
              </span>
            </div>
          ))
        ) : (
          <span className="px-5 py-[22px] font-mono text-[11px] text-quiet">reading system…</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3.5 max-[900px]:grid-cols-1">
        {MODULES.map((m) => {
          const b = berth(m, snaps[m.href]);
          return (
            <a
              key={m.href}
              href={m.href}
              className={`card-surface group relative grid min-h-[118px] grid-cols-[150px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-line no-underline transition-[border-color,transform] hover:-translate-y-px hover:border-line-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[420px]:grid-cols-[112px_minmax(0,1fr)]${
                b.tone === "alarm"
                  ? " after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-px after:exposed-line after:opacity-50"
                  : ""
              }`}
            >
              <div className="berth-bg flex flex-col justify-center gap-2 border-r border-line px-5 py-[18px]">
                <div
                  className={`font-mono text-[clamp(26px,3vw,32px)] leading-none tracking-[-0.07em] ${
                    b.pending ? "animate-breathe text-quiet" : b.tone ? VALUE_TONE[b.tone] : "text-ink"
                  }`}
                >
                  {b.value}
                </div>
                <div className="font-mono text-[9px] font-semibold uppercase leading-[1.45] tracking-[0.12em] text-quiet">
                  {b.label}
                </div>
              </div>
              <div className="flex min-w-0 flex-col justify-center px-[22px] py-[18px] max-[420px]:px-4">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="truncate text-[15px] text-ink">{m.title}</h3>
                  <span
                    aria-hidden="true"
                    className="flex-none font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-quiet transition-colors group-hover:text-accent"
                  >
                    {m.glyph}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11.5px] leading-[1.5] text-muted">{m.description}</p>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}
