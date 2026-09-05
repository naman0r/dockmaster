"use client";

import { useCallback, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import {
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  useToast,
} from "@/components/ui";

type Note = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { notes: Note[] } | null;
};

function formatWhen(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function NotepadPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/notes"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  usePoll(refresh, 30_000);

  const add = useCallback(async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/notes", { text: draft });
      setDraft("");
      await refresh();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }, [draft, refresh, toast]);

  const saveEdit = useCallback(
    async (id: string) => {
      if (!editDraft.trim()) return;
      try {
        await apiPost("/api/notes", { id, text: editDraft });
        setEditingId(null);
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      }
    },
    [editDraft, refresh, toast],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiDelete(`/api/notes?id=${encodeURIComponent(id)}`);
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      }
    },
    [refresh, toast],
  );

  const notes = useMemo(() => snap?.data?.notes || [], [snap]);
  const composerClasses =
    "w-full resize-y rounded-lg border border-line-bright bg-[#080e19] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink caret-accent outline-none transition-colors placeholder:text-quiet focus:border-accent";

  return (
    <>
      <PageHeader
        eyebrow="Scratch pad"
        title="Notepad"
        description="Dev notes that live on this machine — tools you found, commands you'll forget, ideas between tasks. Stored locally, never synced anywhere."
      />
      <ErrorNote message={error} />

      <div className="card-surface mb-5 rounded-xl border border-line p-4">
        <textarea
          className={composerClasses}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void add();
          }}
          placeholder="note down something you found, a command you'll forget, or an idea between tasks"
          spellCheck={false}
        />
        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.08em] text-quiet">
            {draft.length > 0 ? `${draft.length} chars` : "⌘⏎ to save"}
          </span>
          <Button
            variant="stop"
            busy={busy}
            disabled={!draft.trim()}
            onClick={add}
          >
            Add note
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
          Notes
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-quiet">
          {notes.length} {notes.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          glyph="[ n ]"
          title="Nothing noted yet"
          hint="Jot down a tool, a snippet, or what you were in the middle of."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => {
            const editing = editingId === note.id;
            const edited = note.updatedAt !== note.createdAt;
            return (
              <article
                key={note.id}
                className="card-surface group rounded-xl border border-line px-4 py-3.5 transition-colors hover:border-line-bright"
              >
                {editing ? (
                  <>
                    <textarea
                      className={composerClasses}
                      rows={3}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                          void saveEdit(note.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      spellCheck={false}
                    />
                    <div className="mt-2.5 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                      <Button variant="stop" onClick={() => saveEdit(note.id)}>
                        Save
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
                      {note.text}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] tracking-[0.06em] text-quiet">
                        {formatWhen(note.createdAt)}
                        {edited
                          ? ` · edited ${formatWhen(note.updatedAt)}`
                          : ""}
                      </span>
                      <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingId(note.id);
                            setEditDraft(note.text);
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => remove(note.id)}>
                          Delete
                        </Button>
                      </span>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
