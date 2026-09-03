import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { scanRepos } from "@/lib/repos/scan";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("repos"))) {
      return Response.json(disabledSnapshot());
    }
    const started = Date.now();
    const data = await scanRepos();
    return Response.json(
      snapshot(true, {
        data,
        cachedAt: new Date().toISOString(),
        scanMs: Date.now() - started,
      }),
    );
  } catch (err) {
    return errorJson(err);
  }
}
