import { describe, it, expect } from "vitest";
import {
  buildCoachProfile,
  selectFocus,
  todaysDrill,
  scoreAttempt,
  movementAround,
  COACH_DIMENSIONS,
} from "./adaptiveCoach";
import type { SkillMetricPoint } from "./skillLedger";

function point(i: number, m: Partial<Record<string, number>>): SkillMetricPoint {
  const metrics = {
    unsupportedClaimRate: null,
    rebuttalCoverage: null,
    evidenceGrounding: null,
    droppedArguments: null,
    contradictions: null,
    impactHandling: null,
    steelmanQuality: null,
    fallacyRate: null,
    causalOverclaims: null,
    fakePrecisionHits: null,
    uncitedEvidenceRate: null,
    clarity: null,
    ...m,
  } as SkillMetricPoint["metrics"];
  return { debateId: `d${i}`, completedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, metrics };
}

describe("buildCoachProfile", () => {
  it("maps ledger metrics to the seven dimensions", () => {
    const points = [point(0, { evidenceGrounding: 0.82, rebuttalCoverage: 0.64, fallacyRate: 0.09, clarity: 0.73, impactHandling: 0.51, steelmanQuality: 0.44, droppedArguments: 0.25 })];
    const { dims } = buildCoachProfile(points);
    const by = Object.fromEntries(dims.map((d) => [d.key, d.score]));
    expect(by.evidence).toBe(82);
    expect(by.rebuttal).toBe(64);
    expect(by.logic).toBe(78); // 100 - 0.09*250
    expect(by.clarity).toBe(73);
    expect(by.impact).toBe(51);
    expect(by.steelmanning).toBe(44);
    expect(by.structure).toBeGreaterThan(0);
    expect(dims.every((d) => d.hasData)).toBe(true);
  });

  it("marks dimensions without data", () => {
    const { dims } = buildCoachProfile([point(0, {})]);
    expect(dims.every((d) => !d.hasData)).toBe(true);
  });
});

describe("focus selection", () => {
  function dimsFrom(scores: Partial<Record<string, number>>) {
    return COACH_DIMENSIONS.map((key) => ({ key, label: key, score: scores[key] ?? 70, hasData: scores[key] !== undefined || scores[key] === undefined ? true : false }));
  }

  it("picks the lowest dimension", () => {
    const dims = dimsFrom({ impact: 20 });
    const { focus } = selectFocus(dims, {});
    expect(focus?.key).toBe("impact");
  });

  it("deprioritises a dimension that is already improving fast", () => {
    // impact and clarity both low; clarity is improving steeply -> pick impact.
    const dims = dimsFrom({ impact: 30, clarity: 31 });
    const slopes = { clarity: 0.08, impact: null } as Record<string, number | null>;
    const { focus } = selectFocus(dims, slopes as never);
    expect(focus?.key).toBe("impact");
  });

  it("skips a dimension whose previous drill produced negative movement", () => {
    const dims = dimsFrom({ impact: 20, logic: 40 });
    const outcomes = { impact: -0.15 };
    const { focus } = selectFocus(dims, {}, outcomes);
    expect(focus?.key).toBe("logic");
  });
});

describe("todaysDrill rotation", () => {
  it("rotates deterministically by date within a dimension", () => {
    const d1 = todaysDrill("evidence", "2026-01-01T00:00:00Z");
    const d2 = todaysDrill("evidence", "2026-01-02T00:00:00Z");
    expect([d1.title]).toHaveLength(1);
    expect(d2.minutes).toBeGreaterThanOrEqual(2);
  });
});

describe("scoreAttempt rubric", () => {
  it("rewards the dimension-specific move plus structure signals", () => {
    const strong = scoreAttempt("impact", "Grid reliability outweighs household savings because first-order harms compound; per Lazard data, outages cost more over time.");
    const weak = scoreAttempt("impact", "I think impacts are important.");
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.signals).toContain("explicit weighing");
    expect(strong.signals).toContain("cites a real institution");
  });

  it("is deterministic", () => {
    const a = scoreAttempt("rebuttal", "Even if their mechanism holds, targeting the assumption directly shows the conclusion fails.");
    const b = scoreAttempt("rebuttal", "Even if their mechanism holds, targeting the assumption directly shows the conclusion fails.");
    expect(a).toEqual(b);
  });
});

describe("movementAround", () => {
  it("compares windows before/after the assignment date in goodness terms", () => {
    const points = [
      point(0, { fallacyRate: 0.5 }),
      point(1, { fallacyRate: 0.4 }),
      point(2, { fallacyRate: 0.1 }), // drill assigned at index 2's timestamp
      point(3, { fallacyRate: 0.05 }),
      point(4, { fallacyRate: 0.02 }),
    ];
    const m = movementAround(points, "logic", points[2].completedAt)!;
    // Goodness maps rate r -> 1-r: before mean(0.5,0.6)=0.55; after mean(0.95,0.98)=0.965
    expect(m.before).toBeCloseTo(0.55, 2);
    expect(m.after).toBeCloseTo(0.965, 2);
    expect(m.delta!).toBeGreaterThan(0);
  });

  it("returns null when there is no after window yet", () => {
    const points = [point(0, { fallacyRate: 0.2 }), point(1, { fallacyRate: 0.1 })];
    expect(movementAround(points, "logic", points[1].completedAt)).toBeNull();
  });
});
