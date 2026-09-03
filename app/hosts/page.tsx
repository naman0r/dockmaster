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

type HostEntry = {
  ip: string;
  hostnames: string[];
  comment: string | null;
  enabled: boolean;
  raw: string;
};

type ProfileLite = {
  id: string;
  name: string;
  createdAt: string;
  lineCount: number;
};

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: {
    entries: HostEntry[];
    profiles: ProfileLite[];
    activeProfile: string | null;
  } | null;
};

export default function HostsPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/hosts"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  usePoll(refresh, 20_000);

  const act = useCallback(
    async (key: string, url: string, body: Record<string, unknown>, done: string) => {
      setBusy(key);
      try {
        await apiPost(url, body);
        toast(done);
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { hosts: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const data = snap?.data;

  return (
    <>
      <PageHeader
        eyebrow="Charts"
        title="Hosts & DNS profiles"
        description="/etc/hosts with switchable profiles. Applying a profile opens a macOS admin prompt, replaces the whole file, and always backs up the current one first."
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : !data ? (
        <EmptyState glyph="[…]" title="Reading /etc/hosts" />
      ) : (
        <>
          <div className="section-heading">
            <span>Current /etc/hosts</span>
            <span>
              {data.activeProfile ? `active profile: ${data.activeProfile}` : "no profile active"}
            </span>
          </div>
          <Card className="pad">
            <div className="table" style={{ gap: 4 }}>
              {data.entries.map((e, i) => (
                <div
                  key={i}
                  className="mono trunc"
                  style={{ opacity: e.enabled ? 1 : 0.45, fontSize: 12 }}
                  title={e.raw}
                >
                  {!e.enabled ? <span className="quiet">off </span> : null}
                  <span style={{ color: e.enabled ? "var(--accent)" : undefined }}>{e.ip || "—"}</span>
                  {"  "}
                  <span className="muted">{e.hostnames.join(" ")}</span>
                  {e.comment ? <span className="quiet"> {e.comment}</span> : null}
                </div>
              ))}
            </div>
          </Card>

          <div className="section-heading">
            <span>Profiles</span>
            <span>{data.profiles.length} saved</span>
          </div>
          <Card className="pad">
            <div className="toolbar" style={{ marginBottom: data.profiles.length ? 14 : 0 }}>
              <input
                className="search"
                style={{ maxWidth: 260, background: "#080e19", paddingLeft: 12 }}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="new profile name"
              />
              <Button
                variant="stop"
                disabled={!profileName.trim()}
                busy={busy === "save-current"}
                onClick={() =>
                  act(
                    "save-current",
                    "/api/hosts/profiles",
                    { name: profileName.trim() },
                    "Saved current /etc/hosts as a profile.",
                  ).then(() => setProfileName(""))
                }
              >
                Save current
              </Button>
            </div>
            {data.profiles.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>
                No profiles yet. &quot;Save current&quot; snapshots the live /etc/hosts; apply any
                profile to switch back and forth.
              </p>
            ) : (
              <div className="table">
                {data.profiles.map((p) => (
                  <div
                    key={p.id}
                    className="row"
                    style={{ gridTemplateColumns: "minmax(0,1fr) auto auto auto", padding: "12px 16px" }}
                  >
                    <div className="trunc">
                      <strong>{p.name}</strong>
                      <span className="hint mono" style={{ marginLeft: 10 }}>
                        {p.lineCount} lines · {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {data.activeProfile === p.name ? <Badge variant="quiet">active</Badge> : <span />}
                    <Button
                      variant="force"
                      busy={busy === `apply:${p.id}`}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Apply "${p.name}"? This REPLACES /etc/hosts with the profile content. A backup of the current file is saved first.`,
                          )
                        )
                          return;
                        void act("apply:" + p.id, "/api/hosts/apply", { id: p.id }, `Applied ${p.name}.`);
                      }}
                    >
                      Apply
                    </Button>
                    <Button
                      variant="ghost"
                      busy={busy === `del:${p.id}`}
                      onClick={() => {
                        if (!window.confirm(`Delete profile "${p.name}"?`)) return;
                        void act("del:" + p.id, "/api/hosts/delete", { id: p.id }, "Profile deleted.");
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <p className="hint" style={{ marginTop: 12 }}>
            Backups land in ~/.dockmaster/hosts-backups/ before every apply. DNS cache is flushed
            after each write.
          </p>
        </>
      )}
    </>
  );
}
