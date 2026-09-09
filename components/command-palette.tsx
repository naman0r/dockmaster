"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMachineApi } from "./machine-api";
import {
  MODULE_COMMANDS,
  searchCommands,
  targetHref,
  type Command,
} from "@/lib/command-palette";
import type { Snapshot } from "@/lib/types";
import type { RepoRow } from "@/lib/repos/scan";
import type { Service } from "@/lib/ports/scan";
import type { Note } from "@/lib/notes";

export function CommandPalette() {
  const router = useRouter();
  const { apiGet, machine } = useMachineApi();
  const scopedHref = (href: string) => {
    const url = new URL(href, "http://local");
    if (url.pathname !== "/notepad")
      url.searchParams.set("machine", machine.id);
    return url.pathname + url.search + url.hash;
  };
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [commands, setCommands] = useState<Command[]>(MODULE_COMMANDS);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const results = searchCommands(commands, query);
  const selected = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        if (!event.repeat) setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const modal = dialog.current!;
    modal.showModal();
    input.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setQuery("");
    setActive(0);
    setCommands(MODULE_COMMANDS);
    setUnavailable([]);
    setLoading(true);
    let cancelled = false;

    // Fetch only on open. Existing APIs honor disabled modules and scan caches.
    const sources = [
      {
        label: "Projects",
        load: async (): Promise<Command[]> => {
          const snap =
            await apiGet<Snapshot<{ repos: RepoRow[] }>>("/api/repos");
          return snap.enabled
            ? (snap.data?.repos ?? []).map((r) => ({
                id: `${machine.id}:repo:${r.path}`,
                label: r.name,
                detail: `${r.branch} · ${r.path}`,
                group: "Projects",
                glyph: "RP",
                href: scopedHref(
                  targetHref(
                    "/repos",
                    "repo",
                    machine.id === "local" ? r.path : `${machine.id}:${r.path}`,
                  ),
                ),
              }))
            : [];
        },
      },
      {
        label: "Ports",
        load: async (): Promise<Command[]> => {
          const snap =
            await apiGet<Snapshot<{ services: Service[] }>>("/api/ports");
          return snap.enabled
            ? (snap.data?.services ?? []).map((s) => ({
                id: `${machine.id}:port:${s.pid}:${s.port}`,
                label: `:${s.port} · ${s.project}`,
                detail: `${s.kind} · ${s.cwd}`,
                keywords: `${s.pid} ${s.argv}`,
                group: "Ports",
                glyph: "PT",
                href: scopedHref(
                  targetHref(
                    "/ports",
                    "port",
                    machine.id === "local"
                      ? `${s.pid}:${s.port}`
                      : `${machine.id}:${s.pid}:${s.port}`,
                  ),
                ),
              }))
            : [];
        },
      },
      {
        label: "Notes",
        load: async (): Promise<Command[]> => {
          const snap = await apiGet<Snapshot<{ notes: Note[] }>>("/api/notes");
          return snap.enabled
            ? (snap.data?.notes ?? []).map((n) => ({
                id: `note:${n.id}`,
                label: n.text.split("\n")[0].slice(0, 100),
                detail: "Open in Notepad",
                keywords: n.text,
                group: "Notes",
                glyph: "NP",
                href: targetHref("/notepad", "note", n.id),
              }))
            : [];
        },
      },
    ];
    void Promise.allSettled(
      sources.map(async (source) => {
        try {
          const items = await source.load();
          if (!cancelled) setCommands((current) => [...current, ...items]);
        } catch {
          if (!cancelled)
            setUnavailable((current) => [...current, source.label]);
        }
      }),
    ).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      modal.close();
      document.body.style.overflow = overflow;
      previousFocus.current?.focus();
    };
  }, [open, machine.id]);

  useEffect(() => {
    if (open)
      document
        .getElementById(`command-option-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, selected, query]);

  const choose = (command: Command) => {
    setOpen(false);
    router.push(command.href);
    // Also handle selecting another result on the current page.
    window.dispatchEvent(
      new CustomEvent("dockmaster:navigate", { detail: command.href }),
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex items-center justify-between gap-5 rounded-lg border border-line-bright bg-surface px-3 py-2 text-xs text-muted transition-colors hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span>Search anything</span>
        <kbd className="font-mono text-[10px] text-quiet">⌘K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Command palette"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const first = input.current;
          const last =
            dialog.current?.querySelector<HTMLButtonElement>("button");
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className="command-palette fixed inset-x-0 top-[15vh] m-0 mx-auto w-[min(640px,calc(100%-24px))] max-h-[75dvh] overflow-hidden rounded-2xl border border-line-bright bg-surface p-0 text-ink shadow-[0_30px_120px_#0009] backdrop:bg-black/65 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <input
            ref={input}
            role="combobox"
            aria-label="Search modules, projects, ports and notes"
            aria-expanded={open}
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-activedescendant={
              results.length ? `command-option-${selected}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (results.length)
                  setActive(
                    (selected +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      results.length) %
                      results.length,
                  );
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (results[selected]) choose(results[selected]);
              }
            }}
            placeholder="Search modules, projects, ports, notes…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-quiet"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close command palette"
            className="rounded border border-line px-1.5 py-1 font-mono text-[10px] text-muted hover:text-ink"
          >
            Esc
          </button>
        </div>
        <div
          id="command-results"
          role="listbox"
          tabIndex={-1}
          aria-label="Search results"
          className="max-h-[48dvh] overflow-y-auto p-2"
        >
          {results.map((command, index) => (
            <div
              key={command.id}
              id={`command-option-${index}`}
              role="option"
              aria-selected={selected === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(command)}
              onMouseMove={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 ${selected === index ? "bg-accent/10 text-ink" : "text-muted"}`}
            >
              <span
                aria-hidden="true"
                className="w-6 flex-none font-mono text-[10px] text-accent"
              >
                {command.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{command.label}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-muted">
                  {command.detail}
                </div>
              </div>
              <span className="flex-none font-mono text-[9px] uppercase tracking-wider text-quiet">
                {command.group}
              </span>
            </div>
          ))}
          {!results.length && (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {loading
                ? "Searching local data…"
                : "No matches. Try a project name, port or note."}
            </p>
          )}
        </div>
        <div
          role="status"
          className="border-t border-line px-5 py-2 font-mono text-[10px] text-muted"
        >
          {loading
            ? "Loading projects, ports and notes…"
            : unavailable.length
              ? `${unavailable.join(", ")} unavailable. Other results are ready.`
              : `${results.length} results · ↑ ↓ navigate · Enter open · Esc close`}
        </div>
      </dialog>
    </>
  );
}
