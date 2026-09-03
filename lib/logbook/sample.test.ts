import { describe, expect, it } from "vitest";
import { parseOsascriptOutput, attributeProject } from "./sample";

describe("parseOsascriptOutput", () => {
  it("splits app and title at the first linefeed", () => {
    expect(parseOsascriptOutput("Code\nfile.ts — my-repo — Visual Studio Code")).toEqual({
      app: "Code",
      title: "file.ts — my-repo — Visual Studio Code",
    });
  });

  it("keeps the full title even when it contains commas", () => {
    expect(parseOsascriptOutput("Code\na, b, c")).toEqual({ app: "Code", title: "a, b, c" });
  });

  it("treats an empty title line as no title", () => {
    expect(parseOsascriptOutput("Finder\n")).toEqual({ app: "Finder", title: "" });
  });

  it("handles app-only output", () => {
    expect(parseOsascriptOutput("Finder")).toEqual({ app: "Finder", title: "" });
  });
});

describe("attributeProject", () => {
  const names = ["port_authority", "dockmaster", "auribus-2"];

  it("matches a project name in the title case-insensitively", () => {
    expect(
      attributeProject("Code", "plan.md — Dockmaster — Visual Studio Code", names),
    ).toBe("dockmaster");
  });

  it("prefers the earliest match", () => {
    expect(attributeProject("iTerm2", "vim ~/Developer/dockmaster ../PORT_AUTHORITY", names)).toBe(
      "dockmaster",
    );
  });

  it("extracts a browser domain", () => {
    expect(
      attributeProject("Safari", "Dashboard — grafana.example.dev — Safari", names),
    ).toBe("grafana.example.dev");
  });

  it("falls back to the app name", () => {
    expect(attributeProject("Slack", "general — Slack", names)).toBe("Slack");
  });

  it("editor with no matching project falls back to app", () => {
    expect(attributeProject("Code", "Untitled — Visual Studio Code", names)).toBe("Code");
  });
});
