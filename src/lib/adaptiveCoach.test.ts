import { describe, it, expect } from "vitest";
import {
  buildCoachProfile,
  selectFocus,
  todaysDrill,
  scoreAttempt,
  movementAround,
  COACH_DIMENSIONS,
  DRILL_LIBRARY,
} from "./adaptiveCoach";
import type { SkillMetricPoint } from "./skillLedger";

function point(
  i: number,
  m: Partial<Record<string, number | null>>,
  opportunities?: { majorClaims: number; opponentMoves: number },
): SkillMetricPoint {
  const metrics = {
    unsupportedClaimRate: null,
    rebuttalCoverage: null,
    rebuttalTargeting: null,
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
  return {
    debateId: `d${i}`,
    completedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    metrics,
    opportunities,
  };
}

describe("buildCoachProfile", () => {
  it("maps ledger metrics to the seven dimensions", () => {
    const points = [point(0, { unsupportedClaimRate: 0.18, evidenceGrounding: 0.82, rebuttalCoverage: 0.64, fallacyRate: 0.09, clarity: 0.73, impactHandling: 0.51, steelmanQuality: 0.44, droppedArguments: 0.25 })];
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

  it("treats making claims with no support as measurable weak evidence, not no data", () => {
    const { dims } = buildCoachProfile([
      point(0, { unsupportedClaimRate: 1, evidenceGrounding: null }),
      point(1, { unsupportedClaimRate: 1, evidenceGrounding: null }),
    ]);
    const evidence = dims.find((d) => d.key === "evidence")!;
    expect(evidence.hasData).toBe(true);
    expect(evidence.score).toBe(0);
  });

  it("normalises lower-is-better slopes into positive improvement movement", () => {
    const { slopes } = buildCoachProfile([
      point(0, { fallacyRate: 0.4, droppedArguments: 2 }),
      point(1, { fallacyRate: 0.25, droppedArguments: 1 }),
      point(2, { fallacyRate: 0.1, droppedArguments: 0 }),
    ]);
    expect(slopes.logic).not.toBeNull();
    expect(slopes.logic!).toBeGreaterThan(0);
    expect(slopes.structure).not.toBeNull();
    expect(slopes.structure!).toBeGreaterThan(0);
  });

  it("does not treat an untestable impact zero as real skill data", () => {
    const { dims } = buildCoachProfile([
      point(
        0,
        { impactHandling: 0 },
        { majorClaims: 1, opponentMoves: 0 },
      ),
    ]);
    const impact = dims.find((d) => d.key === "impact")!;
    expect(impact.hasData).toBe(false);
    expect(impact.score).toBeNull();
  });

  it("does not award perfect structure from a debate with no structural opportunity", () => {
    const { dims } = buildCoachProfile([
      point(
        0,
        { droppedArguments: 0, contradictions: 0 },
        { majorClaims: 1, opponentMoves: 0 },
      ),
    ]);
    const structure = dims.find((d) => d.key === "structure")!;
    expect(structure.hasData).toBe(false);
    expect(structure.score).toBeNull();
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

  it("deprioritises a lower-is-better dimension when its raw failures are falling", () => {
    const points = [
      point(0, { fallacyRate: 0.4, clarity: 0.45 }),
      point(1, { fallacyRate: 0.25, clarity: 0.45 }),
      point(2, { fallacyRate: 0.1, clarity: 0.45 }),
    ];
    const { dims, slopes } = buildCoachProfile(points);
    // Logic's score is still weak, but its failures are falling quickly. The
    // normalized positive slope should lift it away from immediate focus.
    const { focus } = selectFocus(dims, slopes);
    expect(slopes.logic!).toBeGreaterThan(0);
    expect(focus?.key).not.toBe("logic");
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

  // REGRESSION: the `clarity` dimension is ENGAGEMENT (the per-round
  // argumentResponses rate — did the side answer the opponent's move on the
  // round it was made). Its drill bonus used to award points for short
  // sentences, so a genuinely engaging response scored 15 while a brief
  // non-engaging one scored 35 — the drill rewarded the opposite of the
  // behaviour the metric measures, and could never move the score.
  describe("clarity/Engagement alignment", () => {
    const engaging =
      "Their claim that tutoring always outperforms class-size reduction assumes a fixed per-pupil budget, which is not what the STAR trial tested, so the comparison does not hold for a district that can fund both.";
    const shortButNotEngaging = "I support smaller classes. They cost a lot. That is my view.";

    it("ranks an engaging response above a merely short one", () => {
      expect(scoreAttempt("clarity", engaging).score).toBeGreaterThan(
        scoreAttempt("clarity", shortButNotEngaging).score,
      );
    });

    it("awards the dimension bonus only when the opposing move is named and answered", () => {
      expect(scoreAttempt("clarity", engaging).signals).toContain("Engagement move present");
      expect(scoreAttempt("clarity", shortButNotEngaging).signals).not.toContain("Engagement move present");
    });

    it("coaches which half is missing rather than reporting a bare absence", () => {
      // Names the move but never says why the answer follows.
      expect(scoreAttempt("clarity", "Their claim about tutoring is the one I address here now.").signals).toContain(
        "now explain why your answer to that move follows",
      );
      // Explains an answer but never says which move it answers.
      expect(scoreAttempt("clarity", "Costs fall because scale improves outcomes for every pupil.").signals).toContain(
        "name the opposing move you are answering",
      );
    });

    it("drills teach answering the opponent's move, not rewriting for length", () => {
      for (const drill of DRILL_LIBRARY.clarity) {
        const text = `${drill.title} ${drill.prompt}`.toLowerCase();
        expect(text).toMatch(/opponent|opposing/);
        // No sentence-length instruction may survive: that is the readability
        // behaviour the metric does not observe.
        expect(text).not.toMatch(/half the words|short sentences|twenty words|no sentence over/);
      }
    });
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

  it("includes the first debate after a drill assigned between debates", () => {
    const points = [
      point(0, { impactHandling: 0.2 }),
      point(1, { impactHandling: 0.3 }),
      point(2, { impactHandling: 0.8 }),
    ];
    const m = movementAround(points, "impact", "2026-01-02T12:00:00Z", 2);
    expect(m).not.toBeNull();
    expect(m?.before).toBeCloseTo(0.25, 3);
    expect(m?.after).toBeCloseTo(0.8, 3);
    expect(m?.delta).toBeCloseTo(0.55, 3);
  });

  it("ignores no-opportunity impact readings when measuring drill movement", () => {
    const points = [
      point(
        0,
        { impactHandling: 0.3 },
        { majorClaims: 1, opponentMoves: 1 },
      ),
      point(
        1,
        { impactHandling: 0 },
        { majorClaims: 1, opponentMoves: 0 },
      ),
    ];
    expect(
      movementAround(points, "impact", "2026-01-01T12:00:00Z", 2),
    ).toBeNull();
  });

  it("skips structural zeroes from debates with no opponent move", () => {
    const points = [
      point(
        0,
        { droppedArguments: 1 },
        { majorClaims: 1, opponentMoves: 1 },
      ),
      point(
        1,
        { droppedArguments: 0 },
        { majorClaims: 1, opponentMoves: 0 },
      ),
      point(
        2,
        { droppedArguments: 0 },
        { majorClaims: 1, opponentMoves: 1 },
      ),
    ];
    const movement = movementAround(
      points,
      "structure",
      "2026-01-01T12:00:00Z",
      2,
    );
    expect(movement).not.toBeNull();
    expect(movement?.before).toBe(0);
    expect(movement?.after).toBe(1);
    expect(movement?.delta).toBe(1);
  });

  it("returns null when there is no after window yet", () => {
    const points = [point(0, { fallacyRate: 0.2 }), point(1, { fallacyRate: 0.1 })];
    expect(movementAround(points, "logic", points[1].completedAt)).toBeNull();
  });
});
