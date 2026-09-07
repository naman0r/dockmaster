import { describe, expect, it } from "vitest";
import { MODULE_COMMANDS, searchCommands, targetHref, targetId, type Command } from "./command-palette";

const projects: Command[] = [
  { id: "a", label: "api", detail: "main · /work/api", group: "Projects", glyph: "RP", href: "/repos" },
  { id: "b", label: "api-client", detail: "feature/login · /personal/api-client", group: "Projects", glyph: "RP", href: "/repos" },
  { id: "c", label: "backend", detail: "main · /work/api-server", group: "Projects", glyph: "RP", href: "/repos" },
];

describe("palette search", () => {
  it("shows module navigation before a query is entered", () => {
    expect(searchCommands([...MODULE_COMMANDS, ...projects], "  ")).toEqual(MODULE_COMMANDS);
  });
  it("ranks exact names above prefixes and path matches", () => {
    expect(searchCommands([...projects].reverse(), "API").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("matches all words across a project's name, branch and path", () => {
    expect(searchCommands(projects, " api   feature/login ").map((c) => c.id)).toEqual(["b"]);
    expect(searchCommands(projects, "api missing")).toEqual([]);
  });
  it("searches note bodies beyond the visible preview", () => {
    const note: Command = { id: "n", label: "Useful commands", detail: "Open in Notepad", keywords: "redis-cli ping", group: "Notes", glyph: "NP", href: "/notepad" };
    expect(searchCommands([note], "redis ping")).toEqual([note]);
  });
  it("encodes paths without colliding or changing the destination route", () => {
    const identity = "/Developer/my repo/#日本%?";
    const url = new URL(targetHref("/repos", "repo", identity), "http://localhost");
    expect(url.pathname).toBe("/repos");
    expect(decodeURIComponent(url.hash.slice(1))).toBe(targetId("repo", identity));
    expect(targetId("repo", "/a/b")).not.toBe(targetId("repo", "/a%2Fb"));
  });
});
