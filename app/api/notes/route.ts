import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { addNote, deleteNote, listNotes, updateNote } from "@/lib/notes";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const notes = await listNotes();
    return Response.json({
      enabled: true,
      cachedAt: notes[0]?.updatedAt ?? null,
      data: { notes },
    });
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (typeof body.id === "string") {
      return Response.json({ ok: true, note: await updateNote(body.id, body.text) });
    }
    return Response.json({ ok: true, note: await addNote(body.text) }, { status: 201 });
  } catch (err) {
    return errorJson(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }
    await deleteNote(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
