import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { snapshot, disabledSnapshot } from "@/lib/types";
import {
  parseHosts,
  readHostsFile,
  readProfiles,
} from "@/lib/hosts";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("hosts"))) {
      return Response.json(disabledSnapshot());
    }
    const content = await readHostsFile();
    const profiles = await readProfiles();
    const active = profiles.find((p) => p.content === content);
    return Response.json(
      snapshot(true, {
        data: {
          entries: parseHosts(content),
          profiles: profiles.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt,
            lineCount: p.content.split("\n").filter(Boolean).length,
          })),
          activeProfile: active?.name || null,
        },
        cachedAt: new Date().toISOString(),
        scanMs: 0,
      }),
    );
  } catch (err) {
    return errorJson(err);
  }
}
