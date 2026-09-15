"use client";
import { useState } from "react";
import { useMachine } from "@/components/machines";
import { apiPost, apiDelete } from "@/lib/client/api";
import { Button, ErrorNote, PageHeader } from "@/components/ui";
import type { RemoteMachine } from "@/lib/machines/config";
import type { Info } from "@/lib/machines/protocol";
const empty = {
  name: "",
  destination: "",
  nodePath: "",
  companionPath: "",
  scanRoot: "",
};
export default function SettingsPage() {
  const { machines, reload, select } = useMachine();
  const [form, setForm] = useState<Partial<RemoteMachine>>(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [testing, setTesting] = useState("");
  function clearInfo(id: string) {
    setInfo((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/machines", form);
      if (form.id) clearInfo(form.id);
      await reload();
      setForm(empty);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test(id: string) {
    setTesting(id);
    clearInfo(id);
    setError("");
    try {
      const r = await apiPost<{ data: Info }>("/api/machines/test", { id });
      setInfo((p) => ({ ...p, [id]: r.data }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting("");
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Machines"
        description="Your dashboard stays on this Mac. Remote collectors run on demand over your existing SSH connection."
      />
      <ErrorNote message={error} />
      <div className="grid gap-3">
        {machines.map((m) => (
          <article
            key={m.id}
            className="card-surface rounded-xl border border-line p-5"
          >
            <h2 className="text-lg">{m.name}</h2>
            <p className="my-2 text-xs text-muted">
              {m.id === "local" ? "Built-in local machine" : m.destination}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => select(m.id)}>Select</Button>
              {m.id !== "local" && (
                <>
                  <Button
                    disabled={!!testing || busy}
                    onClick={() => {
                      setForm(m);
                      setError("");
                    }}
                  >
                    Edit
                  </Button>
                  <Button disabled={!!testing} onClick={() => void test(m.id)}>
                    {testing === m.id ? "Connecting…" : "Test connection"}
                  </Button>
                  <Button
                    disabled={!!testing || busy}
                    onClick={async () => {
                      if (!confirm(`Remove ${m.name} from Dockmaster?`)) return;
                      try {
                        await apiDelete(
                          `/api/machines?id=${encodeURIComponent(m.id)}`,
                        );
                        setInfo((p) => {
                          const n = { ...p };
                          delete n[m.id];
                          return n;
                        });
                        await reload();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
            {info[m.id] && (
              <p className="mt-3 break-all font-mono text-xs text-muted">
                Last test succeeded · {info[m.id].hostname} · {info[m.id].os} ·{" "}
                {info[m.id].user} · companion {info[m.id].version}
                <br />
                Scan root: {info[m.id].scanRoot}
                <br />
                Capabilities:{" "}
                {info[m.id].capabilities.join(", ") || "Unsupported OS"}
              </p>
            )}
          </article>
        ))}
      </div>
      <form
        onSubmit={save}
        className="mt-6 grid gap-4 rounded-xl border border-line p-5"
      >
        <h2 className="text-lg">
          {form.id ? "Edit remote machine" : "Add remote machine"}
        </h2>
        <p className="text-sm text-muted">
          Install the companion explicitly first (see docs/remote-machines.md).
          Saving does not connect or install anything. Test connection executes
          the configured companion using SSH host-key verification.
        </p>
        {(
          [
            ["name", "Display name", "Homelab"],
            [
              "destination",
              "SSH destination or alias",
              "you@homelab.example.ts.net",
            ],
            ["nodePath", "Absolute remote Node path", "/absolute/path/to/node"],
            [
              "companionPath",
              "Absolute remote companion path",
              "/Users/you/Services/dockmaster/companion.cjs",
            ],
            [
              "scanRoot",
              "Remote development root",
              "/Users/you/Developer",
            ],
          ] as const
        ).map(([key, label, placeholder]) => (
          <label key={key} className="text-sm text-muted">
            {label}
            <input
              required
              value={form[key] || ""}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder={placeholder}
              className="mt-1 block w-full rounded border border-line bg-surface p-3 text-ink"
            />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !!testing}>
            {busy ? "Saving…" : "Save machine"}
          </Button>
          {form.id && (
            <Button onClick={() => setForm(empty)}>Cancel edit</Button>
          )}
        </div>
      </form>
    </>
  );
}
