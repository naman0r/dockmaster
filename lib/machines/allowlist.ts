const READ_OPERATIONS = [
  "ports",
  "vitals",
  "repos",
  "worktrees",
  "processes",
  "health",
  "hosts",
  "secrets",
  "disk",
  "containers",
];
export function remoteRouteAllowed(method: string, pathname: string): boolean {
  if (
    method === "GET" &&
    READ_OPERATIONS.some((op) => pathname === `/api/${op}`)
  )
    return true;
  if (
    method === "POST" &&
    [
      "/api/repos/refresh",
      "/api/ports/stop",
      "/api/processes/kill",
      "/api/worktrees/remove",
      "/api/worktrees/prune",
      "/api/worktrees/delete-branch",
      "/api/hosts/apply",
      "/api/hosts/profiles",
      "/api/hosts/delete",
      "/api/health/checks",
      "/api/disk/clean",
      "/api/containers/stop",
      "/api/tunnels",
    ].includes(pathname)
  )
    return true;
  return (
    (method === "DELETE" &&
      ["/api/health/checks", "/api/tunnels"].includes(pathname)) ||
    (method === "GET" && pathname === "/api/tunnels")
  );
}
