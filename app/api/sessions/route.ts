import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { scanSessions, sessionsCache } from "@/lib/sessions";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("agentwatch"))) {
      return Response.json(disabledSnapshot());
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { data, cachedAt, scanMs } = await sessionsCache.get(force, () => scanSessions(force));
    return Response.json(snapshot(true, { data, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
