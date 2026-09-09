import { describe, expect, it } from "vitest";
import { parseChanges } from "./status";

describe("repository change breakdown", () => {
  it("separates tracked changes, untracked files, and grouped folders", () => {
    expect(parseChanges(['## main...origin/main', ' M existing.ts', 'M  staged.ts', 'MM both.ts', 'AM new.ts', ' D gone.ts', 'RM old.ts -> renamed.ts', 'C  original.ts -> copy.ts', ' T type-change', '?? new.txt', '?? output/', '?? "folder with spaces/"', '!! ignored', ''].join('\n'))).toEqual({
      modified: 4, added: 1, deleted: 1, renamed: 1, copied: 1,
      conflicted: 0, untrackedFiles: 1, untrackedFolders: 2,
    });
  });
  it("counts every unmerged status as one conflict rather than added or deleted", () => {
    const result = parseChanges(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].map((s) => `${s} file`).join('\n'));
    expect(result.conflicted).toBe(7);
    expect(Object.values(result).reduce((sum, n) => sum + n, 0)).toBe(7);
  });
  it("does not split quoted filenames containing escaped newlines", () => {
    expect(parseChanges(' M "a\\nb.txt"\nR  "old\\nname" -> "new\\nname"\n').modified).toBe(1);
    expect(parseChanges('R  "old\\nname" -> "new\\nname"\n').renamed).toBe(1);
  });
  it("does not count the header or ignored paths", () => {
    expect(Object.values(parseChanges('## main\n!! ignored/\n')).every((n) => n === 0)).toBe(true);
  });
});
