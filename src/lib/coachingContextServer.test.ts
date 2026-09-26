import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ledgerFails: false,
  repairsFail: false,
  drillsFail: false,
}));

const emptyLedger = {
  debates: 0,
  improvements: [],
  regressions: [],
  metrics: {},
  points: [],
};

vi.mock("./skillLedgerServer", () => ({
  buildLedgerForUser: async () => {
    if (h.ledgerFails) throw new Error("ledger down");
    return emptyLedger;
  },
}));

vi.mock("./repairRetestServer", () => ({
  unresolvedRepairRetestAnchors: async () => {
    if (h.repairsFail) throw new Error("repair store down");
    return [
      {
        repairResultId: "oldest",
        debateId: "repair-oldest",
        targetKind: "evidence",
        attemptedAt: "2026-06-01T10:00:00Z",
        topicId: "topic-today",
      },
      {
        repairResultId: "eligible",
        debateId: "repair-eligible",
        targetKind: "rebuttal",
        attemptedAt: "2026-06-02T10:00:00Z",
        topicId: "topic-old",
      },
    ];
  },
  completeRepairRetestAssignment: async () => ({ ok: true as const }),
}));

vi.mock("./adaptiveCoachServer", () => ({
  latestDrillOutcomes: async () => {
    if (h.drillsFail) throw new Error("drills down");
    return { evidence: 0.1 };
  },
}));

import { loadCoachingContext } from "./coachingContextServer";

describe("loadCoachingContext", () => {
  beforeEach(() => {
    h.ledgerFails = false;
    h.repairsFail = false;
    h.drillsFail = false;
  });

  it("selects the oldest repair that is eligible on the current topic", async () => {
    const result = await loadCoachingContext("u1", { currentTopicId: "topic-today" });
    expect(result.status).toBe("ok");
    expect(result.pendingRetests.map((r) => r.repairResultId)).toEqual(["oldest", "eligible"]);
    expect(result.selectedRetest?.repairResultId).toBe("eligible");
  });

  it("reports repair-store failure as partial without inventing a pending retest", async () => {
    h.repairsFail = true;
    const result = await loadCoachingContext("u1", { currentTopicId: "topic-new" });
    expect(result.status).toBe("partial");
    expect(result.degradationReasons).toContain("repair-retest-unavailable");
    expect(result.selectedRetest).toBeNull();
  });

  it("reports drill-outcome failure as partial", async () => {
    h.drillsFail = true;
    const result = await loadCoachingContext("u1");
    expect(result.status).toBe("partial");
    expect(result.degradationReasons).toContain("drill-outcomes-unavailable");
    expect(result.drillOutcomes).toEqual({});
  });

  it("reports ledger failure as unavailable instead of an empty ledger", async () => {
    h.ledgerFails = true;
    const result = await loadCoachingContext("u1");
    expect(result.status).toBe("unavailable");
    expect(result.ledger).toBeNull();
    expect(result.degradationReasons).toContain("skill-ledger-unavailable");
  });
});
