import { describe, expect, it } from "vitest";
import {
  buildRepairEffectiveness,
  classifyRepair,
  REPAIR_MIN_MEASURABLE,
  REPAIR_MIN_SAMPLE,
  weaknessKindsFor,
  type DebateWeaknessRow,
  type RepairRow,
} from "./repairEffectiveness";

const NOW = "2026-06-15T12:00:00Z";
const DAY = 86_400_000;

function repair(user: string, kind: string, at: string, debateId = "d-repair"): RepairRow {
  return { user_id: user, debate_id: debateId, target_kind: kind, score: 80, succeeded: true, created_at: at };
}

function debate(user: string, at: string, kinds: Record<string, number>, debateId?: string): DebateWeaknessRow {
  return { debateId: debateId ?? `d-${user}-${at}`, userId: user, completedAt: at, kinds };
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
    // No evidence-node weakness exists for clarity → unchanged (absent both windows).
    expect(report.overall.measurable).toBe(1);
    expect(report.overall.unchanged).toBe(1);
  });
});
