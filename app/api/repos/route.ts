import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { TtlCache } from "@/lib/cache";
import { scanRepos } from "@/lib/repos/scan";

const cache = new TtlCache(60_000);

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("repos"))) {
      return Response.json(disabledSnapshot());
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { data, cachedAt, scanMs } = await cache.get(force, scanRepos);
    return Response.json(snapshot(true, { data, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
