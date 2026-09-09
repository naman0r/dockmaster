"use client";
import { useCallback, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import { useMachine } from "./machines";
import { usePoll } from "./hooks";
import { Button } from "./ui";
import type { Service } from "@/lib/ports/scan";
import type { TunnelInfo } from "@/lib/machines/tunnels";
export function OpenRemotePort({
  service,
  lease,
}: {
  service: Service;
  lease: () => string;
}) {
  const { machine } = useMachine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const result = await apiRequest<TunnelInfo>(
        `/api/tunnels?machine=${encodeURIComponent(machine.id)}`,
        {
          method: "POST",
          headers: { "X-Dockmaster-Lease": lease() },
          body: JSON.stringify({
            pid: service.pid,
            port: service.port,
            startedAt: service.startedAt,
          }),
        },
      );
      setUrl(result.url);
      if (tab) tab.location.href = result.url;
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button busy={busy} disabled={!lease()} onClick={() => void open()}>
        Open locally
      </Button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent"
        >
          {new URL(url).host}
        </a>
      )}
      {error && (
        <p role="alert" className="max-w-60 text-xs text-alarm">
          {error}
        </p>
      )}
    </>
  );
}
export function TunnelList() {
  const { machine } = useMachine();
  const [items, setItems] = useState<TunnelInfo[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await apiRequest<{ tunnels: TunnelInfo[] }>(
        `/api/tunnels?machine=${encodeURIComponent(machine.id)}`,
      );
      setItems(r.tunnels);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [machine.id]);
  usePoll(refresh, 3000, machine.id !== "local");
  if (machine.id === "local") return null;
  return (
    <div className="mb-4 space-y-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="flex flex-wrap items-center gap-3 rounded border border-line p-3 text-xs"
        >
          <span>
            {machine.name}:{t.remotePort} →{" "}
          </span>
          <a
            href={t.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent"
          >
            localhost:{t.localPort}
          </a>
          <Button
            onClick={async () => {
              try {
                await apiRequest(
                  `/api/tunnels?machine=${encodeURIComponent(machine.id)}&id=${t.id}`,
                  { method: "DELETE" },
                );
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Close tunnel
          </Button>
          {t.error && <span className="text-alarm">{t.error}</span>}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
