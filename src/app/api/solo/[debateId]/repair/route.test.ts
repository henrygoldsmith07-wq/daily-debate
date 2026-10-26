import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    timezone: "America/Los_Angeles" as string | null,
    drillFilters: null as Map<string, unknown> | null,
    drillUpdate: null as Record<string, unknown> | null,
    duplicateRow: null as { id: string } | null,
    inserts: 0,
  };

  /** Chainable query stub: every builder method returns itself; terminals resolve. */
  function chain(result: { data: unknown; error: unknown }, onEq?: (column: string, value: unknown) => void) {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        if (method === "eq") onEq?.(args[0] as string, args[1]);
        return builder;
      };
    }
    builder.single = async () => result;
    builder.maybeSingle = async () => result;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }

  const userDb = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from(table: string) {
      if (table === "solo_debates") return chain({ data: { id: "debate-1", status: "completed" }, error: null });
      if (table === "solo_debate_turns") return chain({ data: [{ assessment: { graph: { nodes: [] } } }], error: null });
      if (table === "repair_results") {
        const builder = chain({ data: state.duplicateRow, error: null });
        builder.insert = async () => {
          state.inserts += 1;
          return { error: null };
        };
        return builder;
      }
      throw new Error(`Unexpected user-db table: ${table}`);
    },
  };

  const serviceDb = {
    from(table: string) {
      if (table === "profiles") return chain({ data: state.timezone ? { timezone: state.timezone } : null, error: null });
      if (table === "drill_assignments") {
        return {
          update(value: Record<string, unknown>) {
            state.drillUpdate = value;
            state.drillFilters = new Map();
            return chain({ data: null, error: null }, (column, v) => state.drillFilters!.set(column, v));
          },
        };
      }
      throw new Error(`Unexpected service table: ${table}`);
    },
  };

  return { state, userDb, serviceDb };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/backend/server", () => ({
  createClient: vi.fn(async () => h.userDb),
  createServiceClient: vi.fn(() => h.serviceDb),
}));
vi.mock("@/lib/observableAssessment", () => ({
  assessArgumentGraph: vi.fn(() => ({ graph: { nodes: [] } })),
  mergeAssessmentGraphs: vi.fn(() => ({ nodes: [] })),
}));
vi.mock("@/lib/argumentRepair", () => ({
  pickRepairTarget: vi.fn(() => ({ kind: "evidence", sourceText: "An unsupported claim." })),
  scoreRepair: vi.fn(() => ({ score: 75, state: "repaired", signals: [] })),
}));
const recordEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/productEvents", () => ({ recordProductEventForUser: recordEvent }));
vi.mock("@/lib/repairRetest", () => ({ REPAIR_KIND_TO_DIMENSION: { evidence: "evidence" } }));

import { POST } from "./route";

function post() {
  return POST(
    new Request("http://x/api/solo/debate-1/repair", {
      method: "POST",
      body: JSON.stringify({ rewrite: "Pew Research found 62% support, which shows the claim holds." }),
    }),
    { params: Promise.resolve({ debateId: "debate-1" }) },
  );
}

describe("POST /api/solo/[debateId]/repair — drill linkage", () => {
  beforeEach(() => {
    // 03:00 UTC on the 19th is still the evening of the 18th in Los Angeles.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T03:00:00Z"));
    h.state.drillFilters = null;
    h.state.drillUpdate = null;
    h.state.duplicateRow = null;
    h.state.inserts = 0;
    recordEvent.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("links the repair to the drill for the learner's LOCAL day, not the UTC day", async () => {
    h.state.timezone = "America/Los_Angeles";
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.state.drillUpdate).toMatchObject({ status: "attempted" });
    // coach/today keys assignments by dateKeyInTimeZone; the UTC date (2026-10-19) matched no row.
    expect(h.state.drillFilters?.get("assigned_date")).toBe("2026-10-18");
    expect(h.state.drillFilters?.get("dimension")).toBe("evidence");
    expect(h.state.drillFilters?.get("user_id")).toBe("user-1");
  });

  it("falls back to UTC when the profile has no usable time zone", async () => {
    h.state.timezone = null;
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.state.drillFilters?.get("assigned_date")).toBe("2026-10-19");
  });
});

describe("POST /api/solo/[debateId]/repair — duplicate submissions", () => {
  beforeEach(() => {
    h.state.duplicateRow = null;
    h.state.inserts = 0;
    recordEvent.mockClear();
  });

  it("stores a first submission once and emits its events", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.state.inserts).toBe(1);
    expect(recordEvent).toHaveBeenCalled();
  });

  it("does not store or re-emit an identical rewrite that is already saved", async () => {
    h.state.duplicateRow = { id: "existing" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.state.inserts).toBe(0);
    expect(recordEvent).not.toHaveBeenCalled();
    expect((await res.json()).succeeded).toBe(true);
  });
});
