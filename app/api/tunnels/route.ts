import { z } from "zod";
import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { requestedMachine } from "@/lib/machines/routes";
import {
  listTunnels,
  openTunnel,
  closeTunnel,
  reconcileTunnels,
} from "@/lib/machines/tunnels";
const payload = z
  .object({
    pid: z.number().int().min(2),
    port: z.number().int().min(1).max(65535),
    startedAt: z.string().min(1).max(100),
    localPort: z.number().int().min(1024).max(65535).optional(),
  })
  .strict();
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = requestedMachine(req);
  await reconcileTunnels(id);
  return Response.json({ machineId: id, tunnels: listTunnels(id) });
}
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const parsed = payload.safeParse(await readJsonBody(req));
    if (!parsed.success)
      return Response.json(
        { error: "Invalid listener identity or local port." },
        { status: 400 },
      );
    return Response.json(
      await openTunnel(
        requestedMachine(req),
        req.headers.get("x-dockmaster-lease") || "",
        parsed.data,
      ),
    );
  } catch (e) {
    return errorJson(e);
  }
}
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  closeTunnel(
    new URL(req.url).searchParams.get("id") || "",
    requestedMachine(req),
  );
  return Response.json({ ok: true });
}
