import { remoteRoute } from "@/lib/machines/routes";
import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { scanDisk, diskCache } from "@/lib/disk";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const remote = await remoteRoute(req);
    if (remote) return remote;
    if (!(await moduleEnabled("disk"))) {
      return Response.json(disabledSnapshot());
    }
    const params = new URL(req.url).searchParams;
    // Harbor peeks: a du over the dev root is too heavy to run for a summary card.
    if (params.get("peek") === "1") return Response.json(snapshot(true, diskCache.peek()));
    const force = params.get("force") === "1";
    const { data, cachedAt, scanMs } = await diskCache.get(force, scanDisk);
    return Response.json(snapshot(true, { data, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
