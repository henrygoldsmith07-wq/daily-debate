import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  orders: [] as Array<{ table: string; col: string; ascending: boolean }>,
  soloRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("./backend/server", () => ({
  createClient: async () => ({
    from(table: string) {
      h.calls.push(table);
      const result =
        table === "solo_debates"
          ? [...h.soloRows]
          : table === "daily_topics"
            ? [{ id: "t1", title: "Topic one" }]
            : [];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "or"]) builder[m] = () => builder;
      builder.order = (col: string, opts?: { ascending?: boolean }) => {
        h.orders.push({ table, col, ascending: opts?.ascending !== false });
        if (table === "solo_debates" && opts?.ascending === false) result.reverse();
        return builder;
      };
      builder.limit = () => Promise.resolve({ data: result, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null });
      return builder;
    },
  }),
}));

import { buildArgumentDnaForUser } from "./argumentDnaServer";

function debate(i: number) {
  return {
    id: `d${i}`,
    topic_id: "t1",
    total_score: 70,
    round_count: 3,
    status: "completed",
    completed_at: `2026-10-0${i}T10:00:00Z`,
    created_at: `2026-10-0${i}T09:00:00Z`,
  };
}

describe("buildArgumentDnaForUser", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.orders.length = 0;
    h.soloRows = [1, 2, 3].map(debate);
  });

  it("reads every debate's turns in one query, not one per debate", async () => {
    await buildArgumentDnaForUser("u1");
    expect(h.calls.filter((t) => t === "solo_debate_turns")).toHaveLength(1);
  });

  it("selects the newest debates (descending) so heavy users keep recent history", async () => {
    await buildArgumentDnaForUser("u1");
    const solo = h.orders.find((o) => o.table === "solo_debates");
    const pvp = h.orders.find((o) => o.table === "pvp_matches");
    expect(solo).toMatchObject({ col: "completed_at", ascending: false });
    expect(pvp).toMatchObject({ col: "completed_at", ascending: false });
  });

  it("skips the turns read when there are no completed debates", async () => {
    h.soloRows = [];
    await buildArgumentDnaForUser("u1");
    expect(h.calls).not.toContain("solo_debate_turns");
  });
});
