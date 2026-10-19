import { describe, expect, it } from "vitest";
import type { BackendClient } from "./backend/server";
import { getFactorRatings } from "./ratings";

// Minimal chainable stub: every builder method returns itself and awaiting it
// yields the canned rows for that table.
function fakeDb(tables: Record<string, unknown[]>): { db: BackendClient; limits: number[] } {
  const limits: number[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in", "not"]) builder[m] = () => builder;
      builder.limit = (n: number) => {
        limits.push(n);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [] });
      return builder;
    },
  } as unknown as BackendClient;
  return { db, limits };
}

const scores = (n: number) => ({ depth: n, evidence: n, logic: n, rebuttal: n, clarity: n });

describe("getFactorRatings", () => {
  it("returns null when the user has no debates", async () => {
    const { db } = fakeDb({ solo_debates: [] });
    expect(await getFactorRatings(db, "u1")).toBeNull();
  });

  it("returns null when no turn has been scored", async () => {
    const { db } = fakeDb({ solo_debates: [{ id: "d1" }], solo_debate_turns: [{ scores: null }] });
    expect(await getFactorRatings(db, "u1")).toBeNull();
  });

  it("averages each factor over scored turns and counts rounds", async () => {
    const { db, limits } = fakeDb({
      solo_debates: [{ id: "d1" }, { id: "d2" }],
      solo_debate_turns: [{ scores: scores(2) }, { scores: null }, { scores: scores(4) }],
    });
    expect(await getFactorRatings(db, "u1")).toEqual({ ...scores(3), roundsScored: 2 });
    expect(limits).toEqual([10]);
  });
});
