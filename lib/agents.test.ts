import { describe, expect, it } from "vitest";
import { agentFromPlist, parseLaunchctlList } from "./agents";

const list = "PID\tStatus\tLabel\n91467\t0\thomebrew.mxcl.postgresql@14\n-\t-9\tcom.example.idle\n";

describe("parseLaunchctlList", () => {
  it("reads pid, last exit, and label, skipping the header", () => {
    const rows = parseLaunchctlList(list);
    expect(rows.get("homebrew.mxcl.postgresql@14")).toEqual({ pid: 91467, lastExit: 0 });
    expect(rows.get("com.example.idle")).toEqual({ pid: null, lastExit: -9 });
    expect(rows.has("Label")).toBe(false);
  });
});

describe("agentFromPlist", () => {
  const live = parseLaunchctlList(list);

  it("marks loaded jobs and joins ProgramArguments", () => {
    const a = agentFromPlist("/x/pg.plist", {
      Label: "homebrew.mxcl.postgresql@14",
      ProgramArguments: ["/opt/pg", "-D", "/data"],
      KeepAlive: true,
    }, live)!;
    expect(a.loaded).toBe(true);
    expect(a.pid).toBe(91467);
    expect(a.program).toBe("/opt/pg -D /data");
    expect(a.keepAlive).toBe(true);
  });

  it("falls back to the file name for the label and treats KeepAlive dicts as on", () => {
    const a = agentFromPlist("/x/com.foo.plist", { Program: "/bin/foo", KeepAlive: { SuccessfulExit: false } }, live)!;
    expect(a.label).toBe("com.foo");
    expect(a.loaded).toBe(false);
    expect(a.pid).toBeNull();
    expect(a.keepAlive).toBe(true);
    expect(a.runAtLoad).toBe(false);
  });
});
