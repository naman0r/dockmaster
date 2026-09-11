import { describe, it, expect } from "vitest";
import { assertCleanable, parseDu } from "@/lib/disk";

const root = "/Users/me/Developer";
const home = "/Users/me";

describe("assertCleanable", () => {
  it("allows artifact dirs under the dev root and known home caches", () => {
    expect(() => assertCleanable(`${root}/app/node_modules`, root, home)).not.toThrow();
    expect(() => assertCleanable(`${root}/mono/packages/web/.next`, root, home)).not.toThrow();
    expect(() => assertCleanable(`${home}/Library/Caches/Homebrew`, root, home)).not.toThrow();
  });

  it("refuses anything else", () => {
    for (const target of [
      root,
      `${root}/app`,
      `${root}/app/src`,
      `${root}/app/node_modules/..`,
      `${root}/app/node_modules/`,
      `${home}/Library`,
      `${home}/Library/Caches`,
      "/tmp/node_modules",
      "node_modules",
      `${root}-other/app/node_modules`,
    ])
      expect(() => assertCleanable(target, root, home), target).toThrow();
  });
});

describe("parseDu", () => {
  it("maps sizes to paths and skips noise", () => {
    const sizes = parseDu("1234\t/a/b\ndu: /a/c: Permission denied\n8\t/a/c d\n");
    expect(sizes.get("/a/b")).toBe(1234);
    expect(sizes.get("/a/c d")).toBe(8);
    expect(sizes.size).toBe(2);
  });
});
