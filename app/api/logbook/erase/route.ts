import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { erase } from "@/lib/logbook/store";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as { scope?: unknown };
    if (body.scope !== "day" && body.scope !== "all") {
      return Response.json({ error: 'scope must be "day" or "all".' }, { status: 400 });
    }
    await erase(body.scope);
    return Response.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
