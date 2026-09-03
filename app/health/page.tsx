"use client";

import { useCallback, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Toggle,
  useToast,
} from "@/components/ui";

type Check = {
  id: string;
  label: string;
  url: string;
  lastStatus: number | null;
  lastOk: boolean | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
};

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { checks: Check[] } | null;
};

export default function HealthPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/health"));
      setError("");
    } catch (err) {
      setError(`Checks unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 15_000);

  const runNow = useCallback(async () => {
    setChecking(true);
    try {
      setSnap(await apiGet<Snapshot>("/api/health?force=1"));
      setError("");
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setChecking(false);
    }
  }, [toast]);

  const add = useCallback(async () => {
    try {
      await apiPost("/api/health/checks", { label, url });
      setLabel("");
      setUrl("");
      toast("Check added.");
      await refresh();
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [label, url, refresh, toast]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiDelete(`/api/health/checks?id=${encodeURIComponent(id)}`);
        toast("Check removed.");
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { health: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const checks = snap?.data?.checks || [];

  return (
    <>
      <PageHeader
        eyebrow="Watchdeck"
        title="Is it up?"
        description="A tiny personal status page: localhost dev servers and anything else worth watching, checked with a 4s timeout."
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="toolbar">
        <Button busy={checking} onClick={runNow}>
          {checking ? "Checking…" : "Check all now"}
        </Button>
        <span className="hint mono">
          {snap?.cachedAt ? `updated ${new Date(snap.cachedAt).toLocaleTimeString()}` : "waiting…"}
        </span>
      </div>
      <ErrorNote message={error} />
      <div className="toolbar" style={{ gap: 8 }}>
        <input
          className="search"
          style={{ maxWidth: 200, background: "#080e19", paddingLeft: 12 }}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label"
        />
        <input
          className="search"
          style={{ maxWidth: 360, background: "#080e19", paddingLeft: 12 }}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
        />
        <Button variant="stop" onClick={add} disabled={!label || !url}>
          Add
        </Button>
      </div>
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : checks.length === 0 ? (
        <EmptyState
          glyph="[ ↑ ]"
          title="No checks yet"
          hint="Add a localhost URL or anything else you care about."
        />
      ) : (
        <div className="table">
          {checks.map((c) => (
            <div
              key={c.id}
              className="row"
              style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto auto" }}
            >
              <span className={`mono ${c.lastOk === null ? "quiet" : c.lastOk ? "ok-text" : "alarm-text"}`}>
                ●
              </span>
              <div className="trunc">
                <strong>{c.label}</strong>
                <div className="hint mono trunc" title={c.url}>
                  {c.url}
                  {c.error ? ` — ${c.error}` : ""}
                </div>
              </div>
              <span className="mono muted">{c.lastStatus ?? "—"}</span>
              <span className="mono muted">{c.latencyMs !== null ? `${c.latencyMs}ms` : "—"}</span>
              <Button variant="ghost" onClick={() => remove(c.id)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {checks.some((c) => c.lastOk === false) ? (
          <Badge variant="alarm">{checks.filter((c) => c.lastOk === false).length} down</Badge>
        ) : checks.length ? (
          <Badge variant="quiet">all green</Badge>
        ) : null}
      </div>
    </>
  );
}
