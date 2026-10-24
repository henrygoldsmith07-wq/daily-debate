import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], debates: 3 }));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    from(table: string) {
      h.calls.push(table);
      const result =
        table === "solo_debates"
          ? Array.from({ length: h.debates }, (_, i) => ({
              id: `d${i + 1}`,
              completed_at: `2026-10-0${i + 1}T10:00:00Z`,
              format: "standard",
            }))
          : [];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "not", "in"]) builder[m] = () => builder;
      builder.limit = () => Promise.resolve({ data: result, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null });
      return builder;
    },
  }),
}));

import { buildJourneyInputsForUser } from "./skillJourneyServer";

describe("buildJourneyInputsForUser", () => {
  beforeEach(() => {
    h.calls.length = 0;
  });

  it("reads all debates' turns in one query, not one per debate", async () => {
    h.debates = 3;
    await buildJourneyInputsForUser("u1");
    expect(h.calls.filter((t) => t === "solo_debate_turns")).toHaveLength(1);
  });

  it("skips the turns read when there are no completed debates", async () => {
    h.debates = 0;
    const out = await buildJourneyInputsForUser("u1");
    expect(h.calls).not.toContain("solo_debate_turns");
    expect(out.weaknessRows).toEqual([]);
  });
});
