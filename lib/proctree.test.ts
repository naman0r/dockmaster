import { describe, expect, it } from "vitest";
import { ancestorChain, descendantOrder, type ProcRow } from "./proctree";

function table(rows: Array<[number, number, number]>): Map<number, ProcRow> {
  return new Map(rows.map(([pid, ppid, uid]) => [pid, { pid, ppid, uid }]));
}

describe("ancestorChain", () => {
  it("walks to the root", () => {
    const t = table([
      [1, 0, 0],
      [10, 1, 501],
      [20, 10, 501],
      [30, 20, 501],
    ]);
    expect(ancestorChain(30, t)).toEqual(new Set([1, 30, 20, 10]));
  });

  it("includes a missing parent once, then stops", () => {
    const t = table([[30, 999, 501]]);
    expect(ancestorChain(30, t)).toEqual(new Set([1, 30, 999]));
  });

  it("breaks on cycles", () => {
    const t = table([
      [10, 20, 501],
      [20, 10, 501],
    ]);
    expect(ancestorChain(10, t)).toEqual(new Set([1, 10, 20]));
  });
});

describe("descendantOrder", () => {
  it("orders deepest first and includes the target last", () => {
    const t = table([
      [1, 0, 501],
      [2, 1, 501],
      [3, 2, 501],
      [4, 2, 501],
      [5, 3, 501],
    ]);
    expect(descendantOrder(2, t)).toEqual([5, 3, 4, 2]);
  });

  it("returns just the target for a leaf", () => {
    const t = table([[2, 1, 501]]);
    expect(descendantOrder(2, t)).toEqual([2]);
  });

  it("skips children that are not in the table", () => {
    const t = table([
      [2, 1, 501],
      [3, 2, 501],
    ]);
    expect(descendantOrder(2, t)).toEqual([3, 2]);
  });
});
