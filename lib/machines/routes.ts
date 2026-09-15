import { readJsonBody, HttpError } from "@/lib/http";
import { machineSnapshot, machineAction } from "./backend";
import { type Action, type ReadOperation } from "./protocol";
export const requestedMachine = (req: Request) =>
  new URL(req.url).searchParams.get("machine") ||
  req.headers.get("x-dockmaster-machine") ||
  "local";
export async function remoteRoute(req: Request): Promise<Response | null> {
  const id = requestedMachine(req);
  if (id === "local") return null;
  const url = new URL(req.url);
  const module = url.pathname.split("/")[2] as ReadOperation;
  if (req.method === "GET" || url.pathname === "/api/repos/refresh")
    return Response.json(
      await machineSnapshot(
        id,
        module,
        url.searchParams.get("force") === "1" || req.method === "POST",
      ),
    );
  const body =
    req.method === "DELETE"
      ? { id: url.searchParams.get("id") }
      : await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Expected an action object.");
  const actionName: Record<string, string> = {
    "/api/ports/stop": "ports.stop",
    "/api/processes/kill": "processes.kill",
    "/api/worktrees/remove": "worktrees.remove",
    "/api/worktrees/prune": "worktrees.prune",
    "/api/worktrees/delete-branch": "worktrees.delete-branch",
    "/api/hosts/profiles": "hosts.save",
    "/api/hosts/delete": "hosts.delete",
    "/api/hosts/apply": "hosts.apply",
    "/api/disk/clean": "disk.clean",
    "/api/containers/stop": "containers.stop",
    "/api/health/checks":
      req.method === "DELETE" ? "health.remove" : "health.add",
  };
  const action = actionName[url.pathname];
  if (!action) throw new HttpError(403, "Unsupported remote operation.");
  return Response.json(
    await machineAction(
      id,
      { ...body, action } as Action,
      req.headers.get("x-dockmaster-lease") || "",
    ),
  );
}
