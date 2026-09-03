import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { dataDir, ensureDataDir } from "@/lib/settings";
import { HttpError } from "@/lib/http";

export type Note = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_TEXT = 10_000;

export function validateText(text: unknown): string {
  if (typeof text !== "string") {
    throw new HttpError(400, "text must be a string.");
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new HttpError(400, "Note text must not be empty.");
  }
  if (trimmed.length > MAX_TEXT) {
    throw new HttpError(400, `Note text must be at most ${MAX_TEXT} characters.`);
  }
  return trimmed;
}

function notesFile(): string {
  return path.join(dataDir(), "notes.json");
}

export async function readNotes(): Promise<Note[]> {
  try {
    const raw = await fs.readFile(notesFile(), "utf8");
    const parsed = JSON.parse(raw) as Note[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeNotes(notes: Note[]): Promise<void> {
  await ensureDataDir();
  const file = notesFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(notes, null, 2));
  await fs.rename(tmp, file);
}

// Newest first: a notepad of "things I just learned" reads top-down.
export async function listNotes(): Promise<Note[]> {
  return (await readNotes()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export async function addNote(text: unknown): Promise<Note> {
  const clean = validateText(text);
  const now = new Date().toISOString();
  const note: Note = { id: crypto.randomUUID(), text: clean, createdAt: now, updatedAt: now };
  await writeNotes([note, ...(await readNotes())]);
  return note;
}

export async function updateNote(id: unknown, text: unknown): Promise<Note> {
  if (typeof id !== "string" || !id) {
    throw new HttpError(400, "id must be a non-empty string.");
  }
  const clean = validateText(text);
  const notes = await readNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) {
    throw new HttpError(404, "No note with that id.");
  }
  note.text = clean;
  note.updatedAt = new Date().toISOString();
  await writeNotes(notes);
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  const notes = await readNotes();
  const next = notes.filter((n) => n.id !== id);
  if (next.length === notes.length) {
    throw new HttpError(404, "No note with that id.");
  }
  await writeNotes(next);
}
