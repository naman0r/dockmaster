"use client";

import { useCallback, useState } from "react";
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

type Finding = {
  repo: string;
  path: string;
  line: number;
  ruleLabel: string;
  severity: "high" | "warning";
  preview: string;
};

type Untracked = { repo: string; path: string };

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: {
    scannedRepos: number;
    findings: Finding[];
    untrackedEnvFiles: Untracked[];
  } | null;
  scanMs?: number;
};

export default function SecretsPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [rescanning, setRescanning] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/secrets"));
      setError("");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 60_000);

  const rescan = useCallback(async () => {
    setRescanning(true);
    try {
      setSnap(await apiGet<Snapshot>("/api/secrets?force=1"));
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setRescanning(false);
    }
  }, [toast]);

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { secrets: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const data = snap?.data;
  const grouped = new Map<string, Finding[]>();
  for (const f of data?.findings || []) {
    const list = grouped.get(f.repo) || [];
    list.push(f);
    grouped.set(f.repo, list);
  }

  return (
    <>
      <PageHeader
        eyebrow="Bloodhound"
        title="Secrets audit"
        description="Credential-shaped strings in TRACKED files across every repo, plus .env hygiene. Previews are redacted; the server never returns full secret text."
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="toolbar">
        <Button busy={rescanning} onClick={rescan}>
          {rescanning ? "Scanning…" : "Rescan"}
        </Button>
        <span className="hint mono">
          {data
            ? `${data.scannedRepos} repos${
                snap?.scanMs !== undefined ? ` / ${snap.scanMs}ms` : ""
              }${snap?.cachedAt ? ` · ${new Date(snap.cachedAt).toLocaleTimeString()}` : ""}`
            : "scanning…"}
        </span>
      </div>
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : !data ? (
        <EmptyState glyph="[…]" title="Walking your dev root" />
      ) : (
        <>
          <div className="section-heading">
            <span>Tracked findings</span>
            <span>{data.findings.length} total</span>
          </div>
          {data.findings.length === 0 ? (
            <EmptyState
              glyph="[ ✓ ]"
              title="No tracked findings"
              hint="Nothing credential-shaped is committed. Recheck after adding repos."
            />
          ) : (
            [...grouped.entries()].map(([repo, findings]) => (
              <Card key={repo} className="pad" style={{ marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 10px" }}>{repo}</h3>
                <div className="table" style={{ gap: 6 }}>
                  {findings.map((f, i) => (
                    <div
                      key={i}
                      className="row"
                      style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", padding: "10px 14px" }}
                    >
                      <Badge variant={f.severity === "high" ? "alarm" : "scope"}>{f.ruleLabel}</Badge>
                      <div className="trunc">
                        <span className="mono muted">
                          {f.path}:{f.line}
                        </span>
                        <span className="hint mono" style={{ marginLeft: 10 }}>
                          {f.preview}
                        </span>
                      </div>
                      <Badge variant="alarm">committed</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
          <div className="section-heading">
            <span>Untracked .env files</span>
            <span>{data.untrackedEnvFiles.length} (the good kind)</span>
          </div>
          {data.untrackedEnvFiles.length === 0 ? (
            <p className="hint">No local .env files sitting untracked.</p>
          ) : (
            <Card className="pad">
              <div className="table" style={{ gap: 4 }}>
                {data.untrackedEnvFiles.map((u, i) => (
                  <div key={i} className="mono trunc" style={{ fontSize: 12 }}>
                    <span style={{ color: "var(--accent)" }}>{u.repo}</span>
                    <span className="muted"> {u.path}</span>
                    <span className="quiet"> — not committed</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
