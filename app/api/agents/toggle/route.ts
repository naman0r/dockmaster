import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { toggleAgent } from "@/lib/agents";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    return Response.json(await toggleAgent(body.label, body.loaded));
  } catch (err) {
    return errorJson(err);
  }
}
