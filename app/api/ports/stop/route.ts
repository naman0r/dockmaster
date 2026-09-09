import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { stopService } from "@/lib/ports/stop";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    const body = await readJsonBody(req);
    return Response.json(await stopService(body));
  } catch (err) {
    return errorJson(err);
  }
}
