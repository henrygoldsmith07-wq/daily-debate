import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/backend/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let rows = [...(h.tables[table] ?? [])];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), q),
        not: () => q,
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
      };
      return q;
    },
  }),
}));

import {
  failedRetestVerdictsForUser,
  successfulRepairRetestAnchors,
  unresolvedRepairRetestAnchors,
} from "./repairRetestServer";

beforeEach(() => {
  h.tables = {
    repair_results: [
      { id: "r1", user_id: "u", succeeded: true, debate_id: "d1", target_kind: "evidence", created_at: "2026-06-02T10:00:00Z" },
      { id: "r1b", user_id: "u", succeeded: true, debate_id: "d1", target_kind: "evidence", created_at: "2026-06-05T10:00:00Z" },
      { id: "r2", user_id: "u", succeeded: true, debate_id: "d2", target_kind: "bogus_kind", created_at: "2026-06-03T10:00:00Z" },
      { id: "r5", user_id: "u", succeeded: true, debate_id: "d5", target_kind: "logic", created_at: "2026-06-07T10:00:00Z" },
      { id: "r3", user_id: "u", succeeded: true, debate_id: "d3", target_kind: "evidence", created_at: "2026-06-04T10:00:00Z" },
    ],
    solo_debates: [
      { id: "d1", user_id: "u", topic_id: "t1" },
      { id: "d3", user_id: "u", topic_id: "t3" },
      { id: "d5", user_id: "u", topic_id: "t5" },
    ],
    repair_retests: [
      { user_id: "u", repair_result_id: "r3", observable: true, completed_at: "2026-06-06T10:00:00Z", demonstrated: false },
      { user_id: "u", repair_result_id: "r1", observable: true, completed_at: "garbage", demonstrated: true },
    ],
  };
});

describe("repairRetestServer", () => {
  it("ignores unknown repair kinds and collapses retries to the earliest success", async () => {
    const anchors = await successfulRepairRetestAnchors("u");
    const ids = anchors.map((a) => a.repairResultId).sort();
    expect(ids).toEqual(["r1", "r3", "r5"]);
  });

  it("leaves out repairs that already have an observable retest", async () => {
    const open = await unresolvedRepairRetestAnchors("u");
    expect(open.map((a) => a.repairResultId)).toEqual(["r5"]);
  });

  it("drops verdicts with unparseable completion times instead of stamping now", async () => {
    const verdicts = await failedRetestVerdictsForUser("u");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ targetKind: "evidence", demonstrated: false });
  });
});
