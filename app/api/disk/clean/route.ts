import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString } from "@/lib/http";
import { cleanTarget } from "@/lib/disk";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    return Response.json({ ok: true, ...(await cleanTarget(asString(body.path, "path"))) });
  } catch (err) {
    return errorJson(err);
  }
}
