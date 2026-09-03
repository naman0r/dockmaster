import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import { readChecks, runAllChecks, resultsCache, type CheckResult } from "@/lib/health";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("health"))) {
      return Response.json(disabledSnapshot());
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const checks = await readChecks();
    const { data, cachedAt, scanMs } = await resultsCache.get(force, runAllChecks);
    // Checks added since the last run appear with null results.
    const byId = new Map(data.map((r) => [r.id, r]));
    const merged: CheckResult[] = checks.map(
      (c) =>
        byId.get(c.id) || {
          id: c.id,
          label: c.label,
          url: c.url,
          lastStatus: null,
          lastOk: null,
          latencyMs: null,
          checkedAt: null,
          error: "not checked yet",
        },
    );
    return Response.json(snapshot(true, { data: { checks: merged }, cachedAt, scanMs }));
  } catch (err) {
    return errorJson(err);
  }
}
