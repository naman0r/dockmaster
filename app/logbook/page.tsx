"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Toggle,
  useToast,
} from "@/components/ui";
import { logbookIntervalMs } from "@/lib/config.client";

type Bucket = { app: string; project: string; minutes: number; first: string; last: string };

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: {
    sessionActive: boolean;
    today: Bucket[];
    week: Array<{ project: string; minutes: number }>;
  } | null;
};

function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

function clockTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
}

export default function LogbookPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [tickError, setTickError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [lastTick, setLastTick] = useState<string>("");
  const tickingRef = useRef(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Snapshot>("/api/logbook");
      setSnap(data);
      setEnabled(data.enabled);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  usePoll(refresh, 15_000);

  const heartbeat = useCallback(async () => {
    if (document.hidden || tickingRef.current || !enabled) return;
    tickingRef.current = true;
    try {
      const result = await apiPost<{ ok: boolean; idle?: boolean; app?: string; project?: string }>(
        "/api/logbook/tick",
        {},
      );
      setTickError("");
      if (result.app) {
        setLastTick(`${result.project} via ${result.app}`);
      }
    } catch (err) {
      setTickError((err as Error).message);
    } finally {
      tickingRef.current = false;
    }
  }, [enabled]);

  // Heartbeat only while this page is open, visible, and tracking is on.
  useEffect(() => {
    if (!enabled) return;
    void heartbeat();
    const timer = window.setInterval(heartbeat, logbookIntervalMs());
    return () => window.clearInterval(timer);
  }, [enabled, heartbeat]);

  const toggleTracking = useCallback(
    async (next: boolean) => {
      const previous = enabled;
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { logbook: next } });
        if (!next) setTickError("");
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(previous);
      }
    },
    [refresh, toast],
  );

  const erase = useCallback(
    async (scope: "day" | "all") => {
      const message =
        scope === "day"
          ? "Erase today's logbook entries?"
          : "Erase the ENTIRE logbook history? This cannot be undone.";
      if (!window.confirm(message)) return;
      try {
        await apiPost("/api/logbook/erase", { scope });
        toast(scope === "day" ? "Erased today." : "Erased everything.");
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      }
    },
    [refresh, toast],
  );

  const data = snap?.data;

  return (
    <>
      <PageHeader
        eyebrow="Logbook"
        title="Which project had you"
        description="Samples the frontmost app only while this page is open and visible. Nothing runs in the background: close the tab and tracking stops. Window titles are never stored."
        right={<Toggle checked={enabled} onChange={toggleTracking} label="Track while open" />}
      />
      <ErrorNote message={tickError || error} />
      {tickError ? (
        <p className="hint" style={{ marginTop: -6 }}>
          Heartbeat paused until you toggle tracking off and on again.
        </p>
      ) : null}
      <div className="toolbar">
        {enabled ? (
          <Badge variant={data?.sessionActive ? "quiet" : "scope"}>
            {data?.sessionActive ? "recording" : "waiting for first tick"}
          </Badge>
        ) : (
          <Badge variant="quiet">off</Badge>
        )}
        {lastTick ? (
          <span className="hint mono">
            last sample: {lastTick} ({clockTime(new Date().toISOString())})
          </span>
        ) : null}
      </div>
      {snap?.enabled === false && !enabled ? (
        <EmptyState
          glyph="[ ]"
          title="Tracking off"
          hint="Flip the toggle above. The first tick may ask for Automation permission once."
        />
      ) : (
        <>
          <div className="grid2" style={{ alignItems: "start" }}>
            <Card className="pad">
              <h3 style={{ margin: "0 0 12px" }}>Today</h3>
              {!data || data.today.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>
                  No entries yet today.
                </p>
              ) : (
                <div className="table" style={{ gap: 6 }}>
                  {data.today.map((b, i) => (
                    <div
                      key={i}
                      className="row"
                      style={{ gridTemplateColumns: "minmax(0,1fr) auto auto", padding: "10px 14px" }}
                    >
                      <div className="trunc">
                        <strong>{b.project}</strong>
                        <div className="hint mono">
                          {b.app} · {clockTime(b.first)}–{clockTime(b.last)}
                        </div>
                      </div>
                      <span className="mono muted">{formatMinutes(b.minutes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="pad">
              <h3 style={{ margin: "0 0 12px" }}>This week</h3>
              {!data || data.week.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>
                  No entries in the last 7 days.
                </p>
              ) : (
                <div className="table" style={{ gap: 6 }}>
                  {data.week.map((w) => (
                    <div
                      key={w.project}
                      className="row"
                      style={{ gridTemplateColumns: "minmax(0,1fr) auto", padding: "10px 14px" }}
                    >
                      <span className="trunc">{w.project}</span>
                      <span className="mono muted">{formatMinutes(w.minutes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <Button variant="ghost" onClick={() => erase("day")}>
              Erase today
            </Button>
            <Button variant="force" onClick={() => erase("all")}>
              Erase everything
            </Button>
          </div>
        </>
      )}
    </>
  );
}
