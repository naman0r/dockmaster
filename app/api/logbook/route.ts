import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { aggregate } from "@/lib/logbook/store";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("logbook"))) {
      return Response.json(disabledSnapshot());
    }
    const data = await aggregate();
    return Response.json(snapshot(true, { data, cachedAt: new Date().toISOString(), scanMs: 0 }));
  } catch (err) {
    return errorJson(err);
  }
}
