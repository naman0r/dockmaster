import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { stopService } from "@/lib/ports/stop";
import { recordAction } from "@/lib/receipt";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    const body = await readJsonBody(req);
    const result = await stopService(body);
    await recordAction("server", result.stillListening ? 0 : 1);
    return Response.json(result);
  } catch (err) {
    return errorJson(err);
  }
}
