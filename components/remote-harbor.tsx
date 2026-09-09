"use client";
import { useCallback, useState } from "react";
import { useMachine } from "./machines";
import { usePoll } from "./hooks";
import { apiGet } from "@/lib/client/api";
import type { Vitals } from "@/lib/vitals";
import type { MachineSnapshot } from "@/lib/machines/protocol";
import { ErrorNote, PageHeader } from "./ui";
export function RemoteHarbor() {
  const { machine } = useMachine();
  const [snap, setSnap] = useState<MachineSnapshot<Vitals> | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await apiGet<MachineSnapshot<Vitals>>(
        `/api/vitals?machine=${encodeURIComponent(machine.id)}`,
      );
      if (value.machineId !== machine.id)
        throw new Error("Machine response mismatch.");
      setSnap(value);
      setError(value.error || "");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [machine.id]);
  usePoll(refresh, 5000);
  const v = snap?.data;
  const metrics = v
    ? [
        [
          "Uptime",
          `${Math.floor(v.uptimeSeconds / 3600)}h ${Math.floor((v.uptimeSeconds % 3600) / 60)}m`,
        ],
        [
          "Load (1 minute)",
          v.loadAvg
            ? `${v.loadAvg[0].toFixed(2)} / ${v.cores} cores`
            : "Unavailable",
        ],
        [
          "Memory free",
          v.memFreePct === null ? "Unavailable" : `${v.memFreePct}%`,
        ],
        [
          "Disk free",
          v.disk
            ? `${(v.disk.freeKb / 1024 / 1024).toFixed(1)} GB / ${(v.disk.totalKb / 1024 / 1024).toFixed(1)} GB`
            : "Unavailable",
        ],
        [
          "Battery",
          v.battery
            ? `${v.battery.pct}% · ${v.battery.source} · ${v.battery.status}`
            : "Unavailable / no battery",
        ],
      ]
    : [];
  return (
    <>
      <PageHeader
        eyebrow="Remote system vitals"
        title={machine.name}
        description="Collected on this machine while this view is visible. Other modules are available on This Mac."
      />
      <ErrorNote message={error} />
      <p role="status" className="my-4 font-mono text-xs text-muted">
        {error && v
          ? "Stale · last successful snapshot"
          : snap?.state || (error ? "Unreachable" : "Loading")}
        {snap?.cachedAt &&
          ` · collected ${new Date(snap.cachedAt).toLocaleString()}`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="card-surface rounded-xl border border-line p-5"
          >
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 font-mono">{value}</p>
          </div>
        ))}
      </div>
      <a className="mt-6 inline-block text-accent" href="/ports">
        View listening ports →
      </a>
    </>
  );
}
