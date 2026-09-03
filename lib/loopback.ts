// Edge-safe (no node imports): middleware.ts runs this on every request.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Only the hostname matters for DNS rebinding: a rebound domain still shows
// up as the attacker's name in Host. A browser always sends the port it
// actually connected to, so checking it would add nothing.
export function hostIsLoopback(host: string): boolean {
  const lower = host.trim().toLowerCase();
  const name = lower.startsWith("[")
    ? lower.slice(0, lower.indexOf("]") + 1)
    : lower.split(":")[0];
  return LOOPBACK_HOSTS.has(name);
}
