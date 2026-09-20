import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { scanAgentWatch, agentWatchCache } from "@/lib/agentwatch";
import { buildReceipt, readActions } from "@/lib/receipt";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("agentwatch"))) {
      return Response.json(disabledSnapshot());
    }
    const watch = await agentWatchCache.get(false, scanAgentWatch);
    const data = buildReceipt(Date.now(), watch.data.sessions, await readActions());
    return Response.json(snapshot(true, { data, cachedAt: watch.cachedAt }));
  } catch (err) {
    return errorJson(err);
  }
}
