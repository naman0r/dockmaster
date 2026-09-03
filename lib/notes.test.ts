import { describe, expect, it } from "vitest";
import { validateText } from "./notes";

describe("validateText", () => {
  it("trims surrounding whitespace", () => {
    expect(validateText("  revdiff is great  ")).toBe("revdiff is great");
  });

  it("rejects non-strings and empties", () => {
    expect(() => validateText(42)).toThrow(/string/);
    expect(() => validateText("   ")).toThrow(/empty/);
    expect(() => validateText("")).toThrow(/empty/);
  });

  it("rejects oversized notes", () => {
    expect(() => validateText("x".repeat(10_001))).toThrow(/characters/);
  });

  it("accepts a normal note", () => {
    expect(() => validateText("a".repeat(10_000))).not.toThrow();
  });
});
