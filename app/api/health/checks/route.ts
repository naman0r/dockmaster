import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString } from "@/lib/http";
import { addCheck, removeCheck, runAllChecks, resultsCache } from "@/lib/health";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const check = await addCheck(asString(body.label, "label"), asString(body.url, "url"));
    resultsCache.invalidate();
    return Response.json({ ok: true, check });
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
    await removeCheck(id);
    resultsCache.invalidate();
    return Response.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const results = await runAllChecks();
    resultsCache.invalidate();
    return Response.json({ ok: true, results });
  } catch (err) {
    return errorJson(err);
  }
}
