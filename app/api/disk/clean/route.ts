import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString } from "@/lib/http";
import { cleanTarget } from "@/lib/disk";
import { recordAction } from "@/lib/receipt";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const result = await cleanTarget(asString(body.path, "path"));
    await recordAction("artifact", 1, result.freedKb);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return errorJson(err);
  }
}
