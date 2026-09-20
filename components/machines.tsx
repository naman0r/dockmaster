"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/client/api";
import type { Machine } from "@/lib/machines/config";
import { RemoteHarbor } from "./remote-harbor";
const MachineContext = createContext<{
  machine: Machine;
  machines: Machine[];
  select: (id: string) => void;
  reload: () => Promise<void>;
}>({
  machine: { id: "local", name: "This Mac" },
  machines: [],
  select: () => {},
  reload: async () => {},
});
export const useMachine = () => useContext(MachineContext);
export function MachineProvider({ children }: { children: ReactNode }) {
  const [machines, setMachines] = useState<Machine[]>([
    { id: "local", name: "This Mac" },
  ]);
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [id, setId] = useState("local");
  const [error, setError] = useState("");
  async function reload() {
    try {
      const r = await apiGet<{ machines: Machine[] }>("/api/machines");
      setMachines(r.machines);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void reload();
    try {
      const saved = sessionStorage.getItem("dockmaster-machine");
      if (saved) setId(saved);
    } catch {
      /* Selection still works when storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get("machine");
    if (requested && machines.some((m) => m.id === requested)) {
      setId(requested);
      try {
        sessionStorage.setItem("dockmaster-machine", requested);
      } catch {}
    }
  }, [pathname, machines]);
  const machine = machines.find((m) => m.id === id) || machines[0];
  return (
    <MachineContext.Provider
      value={{
        machine,
        machines,
        reload,
        select: (next) => {
          setId(next);
          const url = new URL(window.location.href);
          url.searchParams.delete("machine");
          window.history.replaceState(null, "", url);
          try {
            sessionStorage.setItem("dockmaster-machine", next);
          } catch {
            /* Keep selection in memory. */
          }
        },
      }}
    >
      {error && <p role="alert">Machine configuration unavailable: {error}</p>}
      {ready ? children : <p className="p-8 text-muted">Loading machines…</p>}
    </MachineContext.Provider>
  );
}
export function MachineSelector() {
  const { machine, machines, select } = useMachine();
  return (
    <label className="font-mono text-xs text-muted">
      Machine
      <select
        aria-label="Machine"
        value={machine.id}
        onChange={(e) => select(e.target.value)}
        className="mt-2 w-full rounded border border-line bg-surface p-2 text-ink"
      >
        {machines.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Clock() {
  // Rendered after mount so the server and client markup agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time className="ml-auto flex-none tabular-nums text-muted">
      {now
        ? `${now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} / ${now.toLocaleTimeString([], { hour12: false })}`
        : ""}
    </time>
  );
}

export function MachineBoundary({ children }: { children: ReactNode }) {
  const { machine } = useMachine();
  const pathname = usePathname();
  const remote = machine.id !== "local";
  return (
    <section key={`${JSON.stringify(machine)}:${pathname}`}>
      <div className="mb-7 flex items-center gap-3 border-b border-line pb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-quiet">
        {pathname !== "/settings" && (
          <>
            <span
              aria-hidden="true"
              className={`size-1.5 flex-none ${remote ? "bg-amber shadow-[0_0_8px_var(--color-amber)]" : "bg-accent shadow-[0_0_8px_var(--color-accent)]"}`}
            />
            <span className={`truncate ${remote ? "text-amber" : "text-muted"}`}>
              {pathname === "/notepad"
                ? "Shared notebook"
                : `Viewing ${machine.name}`}
              {pathname === "/notepad"
                ? " · stored on this Mac"
                : remote
                  ? " · Remote"
                  : " · Local"}
            </span>
          </>
        )}
        <Clock />
      </div>
      {remote && pathname === "/" ? (
        <RemoteHarbor />
      ) : remote &&
        ![
          "/ports",
          "/repos",
          "/worktrees",
          "/processes",
          "/health",
          "/hosts",
          "/secrets",
          "/disk",
          "/containers",
          "/agentwatch",
          "/settings",
          "/notepad",
        ].includes(pathname) ? (
        <div className="card-surface rounded-xl border border-line p-6">
          <h1 className="text-xl">This module is local-only</h1>
          <p className="mt-3 text-muted">
            Select This Mac to use this page. It remains local-only and unchanged
            by remote support.
          </p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
