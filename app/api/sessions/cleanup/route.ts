import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString } from "@/lib/http";
import { cleanupWorkspace } from "@/lib/sessions";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    return Response.json({ ok: true, ...(await cleanupWorkspace(asString(body.path, "path"))) });
  } catch (err) {
    return errorJson(err);
  }
}
