import { describe, expect, it } from "vitest";
import {
  buildRepairEffectiveness,
  classifyRepair,
  countWeaknessesForSide,
  NOT_CURRENTLY_MEASURABLE_KINDS,
  REPAIR_MIN_MEASURABLE,
  REPAIR_MIN_SAMPLE,
  weaknessKindsFor,
  type DebateWeaknessRow,
  type RepairRow,
} from "./repairEffectiveness";
import type { ArgGraph } from "./argGraph";

const NOW = "2026-06-15T12:00:00Z";
const DAY = 86_400_000;

function repair(user: string, kind: string, at: string, debateId = "d-repair"): RepairRow {
  return { user_id: user, debate_id: debateId, target_kind: kind, score: 80, succeeded: true, created_at: at };
}

function debate(
  user: string,
  at: string,
  kinds: Record<string, number>,
  debateId?: string,
  opps: { majorClaims: number; opponentMoves: number } = { majorClaims: 2, opponentMoves: 2 },
): DebateWeaknessRow {
  return { debateId: debateId ?? `d-${user}-${at}`, userId: user, completedAt: at, kinds, opps };
}

function daysBefore(iso: string, n: number): string {
  return new Date(Date.parse(iso) - n * DAY).toISOString();
}

function daysAfter(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * DAY).toISOString();
}

describe("weaknessKindsFor", () => {
  it("maps repair kinds onto observable weakness kinds", () => {
    expect(weaknessKindsFor("evidence")).toEqual(["evidence"]);
    expect(weaknessKindsFor("rebuttal")).toEqual(["rebuttal", "dropped"]);
    expect(weaknessKindsFor("structure")).toEqual(["dropped", "contradiction"]);
  });
});

describe("countWeaknessesForSide (side-scoped validity)", () => {
  const graph = (overrides?: Partial<ArgGraph>): ArgGraph => ({
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
      { id: "c2", kind: "claim", owner: "ai", text: "AI claim.", round: 1 },
      { id: "i1", kind: "impact", owner: "a", text: "User impact.", round: 2 },
    ],
    edges: [],
    dropped: [{ nodeId: "c1", text: "User claim dropped.", owner: "a", round: 2 }],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: 0,
      byOwner: { a: 0, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 },
      unsupportedClaimIds: ["c1"],
    },
    impactComparison: null,
    ...overrides,
  });

  it("never attributes opponent weaknesses to the user", () => {
    // The AI dropped its own claim — that says nothing about the user.
    const g = graph({
      dropped: [{ nodeId: "c2", text: "AI claim dropped.", owner: "ai", round: 2 }],
    });
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBe(0);
    expect(counts.rebuttal).toBe(0);
  });

  it("counts only the user's own structural failures", () => {
    const counts = countWeaknessesForSide(graph(), "a");
    expect(counts.dropped).toBe(1);
    expect(counts.rebuttal).toBe(1);
    expect(counts.evidence).toBe(1); // unsupported user claim c1
  });

  it("marks the impact weakness from the user's own impact nodes", () => {
    expect(countWeaknessesForSide(graph(), "a").impact).toBe(0); // user made an impact move
    const noImpact = graph({
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "c2", kind: "claim", owner: "ai", text: "AI claim.", round: 1 },
      ],
    });
    expect(countWeaknessesForSide(noImpact, "a").impact).toBe(1); // user made none
  });

  it("keeps clarity at 0 — no deterministic detector exists", () => {
    expect(countWeaknessesForSide(graph(), "a").clarity).toBe(0);
    expect(NOT_CURRENTLY_MEASURABLE_KINDS.has("clarity")).toBe(true);
  });

  it("does not count unsupported claims belonging to the opponent", () => {
    const g = graph({
      evidenceStats: {
        total: 0,
        byOwner: { a: 0, b: 0, ai: 0 },
        byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 },
        unsupportedClaimIds: ["c1", "c2"], // c2 is the AI's claim
      },
    });
    expect(countWeaknessesForSide(g, "a").evidence).toBe(1);
    expect(countWeaknessesForSide(g, "ai").evidence).toBe(1);
  });
});

describe("clarity repairs are not currently measurable", () => {
  it("hard-classifies clarity repairs regardless of surrounding debates", () => {
    const r = repair("u1", "clarity", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { clarity: 1 }), // even fake data cannot make it measurable
      debate("u1", daysAfter(r.created_at, 2), { clarity: 1 }),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("not-currently-measurable");
    expect(detail.beforeRate).toBeNull();
    expect(detail.afterRate).toBeNull();
  });

  it("excludes clarity repairs from the measurable comparison", () => {
    const repairs = [repair("u1", "clarity", "2026-06-10T12:00:00Z", "d-c")];
    const debates = [
      debate("u1", daysBefore("2026-06-10T12:00:00Z", 2), {}),
      debate("u1", daysAfter("2026-06-10T12:00:00Z", 2), {}),
    ];
    const report = buildRepairEffectiveness(repairs, debates, { now: NOW });
    expect(report.overall.repairs).toBe(1);
    expect(report.overall.measurable).toBe(0);
    expect(report.overall.improvedRate).toBeNull();
    const clarity = report.perKind.find((k) => k.target_kind === "clarity");
    expect(clarity?.note).toMatch(/not currently measurable/);
  });
});

describe("classifyRepair", () => {
  it("reports improved when the weakness disappears afterwards", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 3), { evidence: 2 }),
      debate("u1", daysBefore(r.created_at, 1), { evidence: 1 }),
      debate("u1", daysAfter(r.created_at, 2), {}), // clean debate after repair
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("improved");
    expect(detail.beforeRate).toBe(1);
    expect(detail.afterRate).toBe(0);
  });

  it("reports worse when the weakness appears afterwards", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 3), {}), // clean before
      debate("u1", daysAfter(r.created_at, 2), { evidence: 1 }),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("worse");
  });

  it("excludes the repaired debate itself from the measurement", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z", "the-repaired-debate");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 1 }),
      // The repaired debate carries the weakness but must not count as "after".
      debate("u1", r.created_at, { evidence: 3 }, "the-repaired-debate"),
      debate("u1", daysAfter(r.created_at, 2), {}),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("improved");
    expect(detail.afterDebates).toBe(1);
  });

  it("says not-yet-measurable when no later debate exists", () => {
    const r = repair("u1", "evidence", "2026-06-14T12:00:00Z");
    const debates = [debate("u1", daysBefore(r.created_at, 2), { evidence: 1 })];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("not-yet-measurable");
  });

  it("says insufficient-baseline when no earlier debate exists", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z");
    const debates = [debate("u1", daysAfter(r.created_at, 2), {})];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("insufficient-baseline");
  });

  it("respects the measurement window", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 40), { evidence: 1 }), // outside 30d
      debate("u1", daysAfter(r.created_at, 40), {}), // outside 30d
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("not-yet-measurable");
    expect(detail.beforeDebates).toBe(0);
    expect(detail.afterDebates).toBe(0);
  });

  it("matches any of the mapped kinds (rebuttal covers dropped)", () => {
    const r = repair("u1", "rebuttal", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { dropped: 2 }), // dropped counts for rebuttal repairs
      debate("u1", daysAfter(r.created_at, 2), {}),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("improved");
  });
});

describe("retest linkage (weakness → repair → first retest)", () => {
  it("identifies the first later debate and whether the weakness recurred", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 1 }),
      debate("u1", daysAfter(r.created_at, 1), { evidence: 1 }, "d-retest-clean-no"), // retest WITH weakness
      debate("u1", daysAfter(r.created_at, 3), {}), // later debate, not the first retest
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.firstRetest).not.toBeNull();
    expect(detail.firstRetest!.debateId).toBe("d-retest-clean-no");
    expect(detail.firstRetest!.weaknessPresent).toBe(true);
  });

  it("reports a clean first retest when the weakness is gone", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 2 }),
      debate("u1", daysAfter(r.created_at, 1), {}, "d-retest"),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.firstRetest!.weaknessPresent).toBe(false);
  });

  it("aggregates retest rates once the measurable threshold is met", () => {
    const repairs: RepairRow[] = [];
    const debates: DebateWeaknessRow[] = [];
    for (let i = 0; i < 5; i++) {
      const user = `u${i}`;
      const at = "2026-06-08T12:00:00Z";
      repairs.push(repair(user, "evidence", at, `d-r-${i}`));
      debates.push(debate(user, daysBefore(at, 2), { evidence: 1 }));
      // 3 of 5 first retests still carry the weakness.
      debates.push(debate(user, daysAfter(at, 1), i < 3 ? { evidence: 1 } : {}, `d-retest-${i}`));
    }
    const report = buildRepairEffectiveness(repairs, debates, { now: NOW });
    expect(report.overall.retest.repairsWithRetest).toBe(5);
    expect(report.overall.retest.firstRetestWeaknessRate).toBeCloseTo(0.6);
    expect(report.overall.retest.note).toBeNull();
  });

  it("picks the chronologically earliest eligible debate as the first retest", () => {
    const r = repair("u9", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const earlier = debate("u9", daysBefore(r.created_at, 2), { evidence: 1 });
    const first = debate("u9", daysAfter(r.created_at, 1), { evidence: 1 }, "d-first");
    const second = debate("u9", daysAfter(r.created_at, 5), {}, "d-second");
    // Deliberately pass newest-first (the loader's query order) to prove the
    // measurement does not depend on input ordering.
    const detail = classifyRepair(r, [second, first, earlier]);
    expect(detail.firstRetest?.debateId).toBe("d-first");
    expect(detail.firstRetest?.weaknessPresent).toBe(true);
  });

  it("reports a clean earliest retest even when a later debate has the weakness", () => {
    const r = repair("u9", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const earlier = debate("u9", daysBefore(r.created_at, 2), { evidence: 1 });
    const first = debate("u9", daysAfter(r.created_at, 1), {}, "d-first");
    const second = debate("u9", daysAfter(r.created_at, 5), { evidence: 3 }, "d-second");
    const detail = classifyRepair(r, [second, first, earlier]);
    expect(detail.firstRetest?.debateId).toBe("d-first");
    expect(detail.firstRetest?.weaknessPresent).toBe(false);
    // Window rates still consider every in-window debate.
    expect(detail.afterRate).toBe(0.5);
  });

  it("keeps the retest rate pending below the threshold", () => {
    const r = repair("u1", "evidence", "2026-06-08T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore("2026-06-08T12:00:00Z", 2), { evidence: 1 }),
      debate("u1", daysAfter("2026-06-08T12:00:00Z", 1), {}, "d-retest"),
    ];
    const report = buildRepairEffectiveness([r], debates, { now: NOW });
    expect(report.overall.retest.repairsWithRetest).toBe(1);
    expect(report.overall.retest.firstRetestWeaknessRate).toBeNull();
    expect(report.overall.retest.note).toMatch(/pending/);
  });
});

describe("buildRepairEffectiveness", () => {
  it("declines to claim a rate below the minimum thresholds", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 1 }),
      debate("u1", daysAfter(r.created_at, 2), {}),
    ];
    const report = buildRepairEffectiveness([r], debates, { now: NOW });
    expect(report.overall.repairs).toBe(1);
    expect(report.overall.improvedRate).toBeNull();
    expect(report.overall.note).toMatch(/not yet claimable/);
    expect(REPAIR_MIN_SAMPLE).toBeGreaterThanOrEqual(5);
    expect(REPAIR_MIN_MEASURABLE).toBeGreaterThanOrEqual(3);
  });

  it("aggregates per-kind outcomes once thresholds are met", () => {
    const repairs: RepairRow[] = [];
    const debates: DebateWeaknessRow[] = [];
    // 6 evidence repairs, all measurably improved.
    for (let i = 0; i < 6; i++) {
      const user = `u${i}`;
      const at = "2026-06-08T12:00:00Z";
      repairs.push(repair(user, "evidence", at, `d-r-${i}`));
      debates.push(debate(user, daysBefore(at, 2), { evidence: 1 }));
      debates.push(debate(user, daysAfter(at, 2), {}));
    }
    const report = buildRepairEffectiveness(repairs, debates, { now: NOW });
    const evidence = report.perKind.find((k) => k.target_kind === "evidence");
    expect(evidence?.repairs).toBe(6);
    expect(evidence?.measurable).toBe(6);
    expect(evidence?.improvedRate).toBe(1);
    expect(report.overall.note).toBeNull();
  });

  it("counts users covered and includes the honesty label", () => {
    const repairs = [
      repair("u1", "evidence", "2026-06-10T12:00:00Z", "d1"),
      repair("u2", "logic", "2026-06-10T12:00:00Z", "d2"),
    ];
    const report = buildRepairEffectiveness(repairs, [], { now: NOW });
    expect(report.usersCovered).toBe(2);
    expect(report.honestyNote).toMatch(/Observational only/);
    expect(report.honestyNote).toMatch(/not proof/);
  });

  it("reports clarity repairs as not measurable rather than guessing", () => {
    const r = repair("u1", "clarity", "2026-06-10T12:00:00Z");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { clarity: 0 }),
      debate("u1", daysAfter(r.created_at, 2), { clarity: 0 }),
    ];
    const report = buildRepairEffectiveness([r], debates, { now: NOW });
    // No deterministic clarity detector → the repair can never be "measured"
    // into unchanged; it is explicitly not measurable.
    expect(report.overall.measurable).toBe(0);
    expect(report.overall.repairs).toBe(1);
  });
});

describe("opportunity filter (no-opportunity debates are invisible)", () => {
  it("ignores after-debates the user made no claims in (evidence repair)", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 1 }, "d-before"),
      // Clean debate WITH claims: genuine evidence of improvement.
      debate("u1", daysAfter(r.created_at, 1), {}, "d-clean", { majorClaims: 3, opponentMoves: 2 }),
      // Claim-free debate: cannot express the weakness, must not count.
      debate("u1", daysAfter(r.created_at, 3), {}, "d-empty", { majorClaims: 0, opponentMoves: 5 }),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("improved");
    expect(detail.afterDebates).toBe(1);
  });

  it("reports not-yet-measurable when no later debate had opportunity", () => {
    const r = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { evidence: 1 }, "d-before"),
      debate("u1", daysAfter(r.created_at, 1), {}, "d-empty", { majorClaims: 0, opponentMoves: 5 }),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("not-yet-measurable");
    expect(detail.afterDebates).toBe(0);
  });

  it("requires opponent moves for rebuttal repairs", () => {
    const r = repair("u1", "rebuttal", "2026-06-10T12:00:00Z", "d-r");
    const debates = [
      debate("u1", daysBefore(r.created_at, 2), { dropped: 1 }, "d-before"),
      // No opponent moves: cannot test rebuttal behaviour.
      debate("u1", daysAfter(r.created_at, 1), {}, "d-quiet", { majorClaims: 2, opponentMoves: 0 }),
    ];
    const detail = classifyRepair(r, debates);
    expect(detail.outcome).toBe("not-yet-measurable");
  });
});

describe("no double-counting across repeated repairs", () => {
  it("partitions after-windows at the next same-kind repair", () => {
    const r1 = repair("u1", "evidence", "2026-06-01T12:00:00Z", "d-r1");
    const r2 = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r2");
    // Shared debate AFTER r2's repair: must count for r2 only, not r1.
    const shared = debate("u1", daysAfter(r2.created_at, 2), { evidence: 2 }, "d-shared");
    const mid = debate("u1", daysAfter(r1.created_at, 2), {}, "d-mid");
    const before = debate("u1", daysBefore(r1.created_at, 2), { evidence: 1 }, "d-before");
    const debates = [shared, mid, before];

    const d1 = classifyRepair(r1, debates, { afterCutoff: daysAfter(r2.created_at, 0) });
    expect(d1.afterDebates).toBe(1); // d-mid only; d-shared belongs to r2
    expect(d1.outcome).toBe("improved");

    const d2 = classifyRepair(r2, debates);
    expect(d2.afterDebates).toBe(1); // d-shared only
    expect(d2.outcome).toBe("worse");
  });

  it("buildRepairEffectiveness partitions automatically per user and kind", () => {
    const r1 = repair("u1", "evidence", "2026-06-01T12:00:00Z", "d-r1");
    const r2 = repair("u1", "evidence", "2026-06-10T12:00:00Z", "d-r2");
    // Different kind: does NOT clip the evidence window.
    const r3 = repair("u1", "logic", "2026-06-05T12:00:00Z", "d-r3");
    const debates = [
      debate("u1", daysBefore(r1.created_at, 2), { evidence: 1 }, "d-before"),
      debate("u1", daysAfter(r1.created_at, 2), {}, "d-mid"),
      debate("u1", daysAfter(r2.created_at, 2), { evidence: 2 }, "d-shared"),
    ];
    const report = buildRepairEffectiveness([r1, r2, r3], debates, { now: NOW });
    const evidence = report.perKind.find((k) => k.target_kind === "evidence")!;
    // r1 measured on d-mid only (improved); r2 on d-shared only (worse).
    expect(evidence.measurable).toBe(2);
    expect(evidence.improved).toBe(1);
    expect(evidence.worse).toBe(1);
  });
});
