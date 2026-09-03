import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { scanServices } from "@/lib/ports/scan";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("ports"))) {
      return Response.json(disabledSnapshot());
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { services, cachedAt, scanMs } = await scanServices(force);
    return Response.json(snapshot(true, { data: { services }, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
