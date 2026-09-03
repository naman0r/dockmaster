import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { TtlCache } from "@/lib/cache";
import { sampleProcesses } from "@/lib/processes";

const cache = new TtlCache(2500);

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("processes"))) {
      return Response.json(disabledSnapshot());
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { data, cachedAt, scanMs } = await cache.get(force, sampleProcesses);
    return Response.json(snapshot(true, { data, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
