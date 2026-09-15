import { describe, expect, it } from "vitest";
import { parsePsOutput } from "./containers";

const row = (over: Record<string, string>) =>
  JSON.stringify({
    ID: "a".repeat(64),
    Image: "postgres:16",
    Names: "db",
    State: "running",
    Status: "Up 2 hours",
    Ports: "0.0.0.0:5432->5432/tcp",
    Labels: "com.docker.compose.project=shop,com.docker.compose.service=db",
    CreatedAt: "2026-09-01 10:00:00 +0000 UTC",
    ...over,
  });

describe("parsePsOutput", () => {
  it("reads one container per line and the compose project label", () => {
    const [c] = parsePsOutput(row({}) + "\n");
    expect(c.name).toBe("db");
    expect(c.project).toBe("shop");
    expect(c.ports).toContain("5432");
  });

  it("puts running containers first, then sorts by name", () => {
    const out = [
      row({ ID: "b".repeat(64), Names: "zed", State: "exited" }),
      row({ ID: "c".repeat(64), Names: "beta" }),
      row({ ID: "d".repeat(64), Names: "alpha" }),
    ].join("\n");
    expect(parsePsOutput(out).map((c) => c.name)).toEqual(["alpha", "beta", "zed"]);
  });

  it("drops malformed lines and ids that are not hex", () => {
    expect(parsePsOutput("not json\n" + row({ ID: "../etc" }))).toEqual([]);
  });
});
