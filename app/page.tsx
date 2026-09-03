"use client";

import { useCallback, useState } from "react";
import { apiGet } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import { Card, ErrorNote, PageHeader } from "@/components/ui";

type SnapshotLite = {
  enabled: boolean;
  cachedAt: string | null;
  data: unknown;
};

type ModuleCard = {
  href: string;
  glyph: string;
  title: string;
  description: string;
  endpoint: string;
  describe: (snap: SnapshotLite) => string;
};

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

const MODULES: ModuleCard[] = [
  {
    href: "/ports",
    glyph: "PT",
    title: "Ports",
    description: "Every listening dev server, with a guarded stop button.",
    endpoint: "/api/ports",
    describe: (s) => {
      const services = (s.data as { services?: unknown[] } | null)?.services;
      return `${countOf(services)} listeners`;
    },
  },
  {
    href: "/repos",
    glyph: "RP",
    title: "Repos",
    description: "What every repository under your dev root is up to.",
    endpoint: "/api/repos",
    describe: (s) => {
      const repos = (s.data as { repos?: Array<{ dirty: number; ahead: number }> } | null)?.repos || [];
      const dirty = repos.filter((r) => r.dirty > 0).length;
      const ahead = repos.filter((r) => r.ahead > 0).length;
      return `${repos.length} repos · ${dirty} dirty · ${ahead} unpushed`;
    },
  },
  {
    href: "/worktrees",
    glyph: "WT",
    title: "Worktrees",
    description: "Linked worktrees, pruneables, and stale branches.",
    endpoint: "/api/worktrees",
    describe: (s) => {
      const data = s.data as { repos?: Array<{ worktrees: unknown[] }> } | null;
      const total = (data?.repos || []).reduce((acc, r) => acc + countOf(r.worktrees), 0);
      return `${total} worktrees`;
    },
  },
  {
    href: "/health",
    glyph: "HL",
    title: "Health",
    description: "Is it up? Localhost services and anything else you care about.",
    endpoint: "/api/health",
    describe: (s) => {
      const checks = (s.data as { checks?: Array<{ lastOk: boolean | null }> } | null)?.checks || [];
      const down = checks.filter((c) => c.lastOk === false).length;
      return down ? `${down} of ${checks.length} down` : `${checks.length} checks green`;
    },
  },
  {
    href: "/hosts",
    glyph: "HS",
    title: "Hosts",
    description: "/etc/hosts with profiles, applied through a system prompt.",
    endpoint: "/api/hosts",
    describe: (s) => {
      const data = s.data as { entries?: unknown[]; activeProfile?: string | null } | null;
      return `${countOf(data?.entries)} entries${data?.activeProfile ? ` · ${data.activeProfile}` : ""}`;
    },
  },
  {
    href: "/processes",
    glyph: "PC",
    title: "Processes",
    description: "CPU and memory hogs, sampled live.",
    endpoint: "/api/processes",
    describe: (s) => {
      const top = (s.data as { sample?: Array<{ command: string; cpuPct: number }> } | null)?.sample?.[0];
      return top ? `${top.command} at ${top.cpuPct.toFixed(0)}% cpu` : "sampling…";
    },
  },
  {
    href: "/secrets",
    glyph: "SC",
    title: "Secrets",
    description: "Committed .env files and credential-shaped strings across repos.",
    endpoint: "/api/secrets",
    describe: (s) => {
      const findings = (s.data as { findings?: unknown[] } | null)?.findings;
      const n = countOf(findings);
      return n ? `${n} findings` : "no findings";
    },
  },
  {
    href: "/logbook",
    glyph: "LB",
    title: "Logbook",
    description: "Which project had you, sampled from the frontmost app.",
    endpoint: "/api/logbook",
    describe: (s) => {
      const data = s.data as { today?: Array<{ project: string; minutes: number }>; sessionActive?: boolean } | null;
      const top = data?.today?.[0];
      if (!top) return data?.sessionActive ? "recording…" : "no entries today";
      return `${top.project} · ${top.minutes}m today`;
    },
  },
  {
    href: "/notepad",
    glyph: "NP",
    title: "Notepad",
    description: "Local scratch pad for dev notes and tools worth remembering.",
    endpoint: "/api/notes",
    describe: (s) => {
      const n = countOf((s.data as { notes?: unknown[] } | null)?.notes);
      return n === 1 ? "1 note" : `${n} notes`;
    },
  },
];

export default function OverviewPage() {
  const [snaps, setSnaps] = useState<Record<string, SnapshotLite | null>>({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled(
      MODULES.map(async (m) => [m.href, await apiGet<SnapshotLite>(m.endpoint)] as const),
    );
    const next: Record<string, SnapshotLite | null> = {};
    let failed = false;
    for (const result of results) {
      if (result.status === "fulfilled") next[result.value[0]] = result.value[1];
      else failed = true;
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
      />
      <ErrorNote message={error} />
      <div className="grid gap-3.5 grid-cols-2 max-[560px]:grid-cols-1">
        {MODULES.map((m) => {
          const snap = snaps[m.href];
          return (
            <Card key={m.href} className="p-[22px_24px]">
              <div className="mb-3.5 flex items-start gap-[13px]">
                <span className="grid size-9 flex-none place-items-center rounded-[9px] border border-line-bright bg-accent/10 font-mono text-[11px] font-bold leading-none text-accent">
                  {m.glyph}
                </span>
                <div>
                  <h3 className="mt-0.5 mb-[5px] text-[15px]">{m.title}</h3>
                  <p className="text-[11.5px] leading-[1.5] text-muted truncate">{m.description}</p>
                </div>
              </div>
              <p className="mb-3.5 min-h-[34px] text-[12px] tracking-[0.02em] text-muted">
                {snap === undefined
                  ? "…"
                  : snap === null
                    ? "unreachable"
                    : snap.enabled
                      ? m.describe(snap)
                      : "module off"}
              </p>
              <a
                className="inline-flex min-h-9 min-w-[88px] items-center justify-center rounded-lg border px-4 font-mono text-[10px] font-[650] uppercase tracking-[0.1em] no-underline transition-colors border-accent/30 text-accent hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                href={m.href}
              >
                Open
              </a>
            </Card>
          );
        })}
      </div>
    </>
  );
}
