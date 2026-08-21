import { describe, it, expect } from "vitest";
import { pearsonCorrelation } from "./humanCorpus";
import {
  EVAL_DIMENSIONS,
  extractSides,
  countWords,
  styleFeatures,
  iccTwoWay,
  measureReliability,
  calibrateDimension,
  loocvMae,
  partialCorrelation,
  detectVerbosityBias,
  detectStyleBias,
  dailyDebateEvaluation,
  sideScores,
} from "./debateEvaluation";
import type { EvalDebate, SystemVerdict, SideScores, DebateEvalDimension } from "./debateEvaluation";

const DIMS = EVAL_DIMENSIONS;

function scores(v: number, over: Partial<Record<DebateEvalDimension, number>> = {}): SideScores {
  const s = {} as SideScores;
  for (const d of DIMS) s[d] = v;
  return { ...s, ...over };
}

const QA = [4, 3, 5, 2, 3, 5];
const QB = [2, 4, 3, 3, 4, 2];

const argA = "Solar LCOE beats gas on cost per Lazard.";
const argAlong = "Solar LCOE beats gas on cost per Lazard, and NREL storage data confirms total cost stays lower through 2035 even with grid upgrades included.";
const argB = "Intermittency requires expensive backup capacity.";

function transcript(i: number): string {
  const aText = i % 2 === 0 ? argAlong : argA;
  const bText = i % 2 === 0 ? argB : argB + " Backup costs are falling and grids cope without subsidy.";
  return [
    `Player A (round 1): ${aText}`,
    `Player B (round 1): ${bText}`,
    `Player A (round 2): ${aText} OECD polling supports the transition.`,
    `Player B (round 2): ${bText}`,
  ].join("\n");
}

function cleanCorpus(): EvalDebate[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `ev-${String(i + 1).padStart(2, "0")}`,
    transcript: transcript(i),
    topic: "energy",
    provenance: "synthetic" as const,
    raters: [0, 1, 2].map((r) => ({
      raterId: `r${r + 1}`,
      a: scores(QA[i] + (r === 2 && i % 2 === 1 ? -1 : 0)),
      b: scores(QB[i] + (r === 1 ? 1 : 0)),
    })),
  }));
}

function systemTrackingHumans(corpus: EvalDebate[], tilt = true): SystemVerdict[] {
  return corpus.map((d) => {
    const texts = extractSides(d.transcript);
    const mean = (side: "a" | "b") =>
      sideScores(
        Object.fromEntries(DIMS.map((dim) => {
          const vals = d.raters.map((r) => r[side][dim]);
          return [dim, vals.reduce((x, y) => x + y, 0) / vals.length];
        })) as Partial<SideScores>,
      );
    const ma = mean("a");
    const mb = mean("b");
    const aLonger = countWords(texts.a) > countWords(texts.b);
    if (tilt) {
      const bump = (s: SideScores, delta: number) =>
        sideScores(Object.fromEntries(DIMS.map((d2) => [d2, s[d2] + delta])) as Partial<SideScores>);
      return { id: d.id, a: bump(ma, aLonger ? 0.6 : 0), b: bump(mb, aLonger ? 0 : 0.6) };
    }
    return { id: d.id, a: ma, b: mb };
  });
}

describe("transcript helpers", () => {
  it("extractSides splits and strips player labels", () => {
    const t = transcript(0);
    const { a, b } = extractSides(t);
    expect(a.toLowerCase()).not.toContain("player a");
    expect(b.toLowerCase()).not.toContain("player b");
    expect(countWords(a)).toBeGreaterThan(countWords(b));
  });

  it("styleFeatures computes densities", () => {
    const f = styleFeatures("However, consequently this demonstrates substantial economic advantages.");
    expect(f.formalConnectorsPer100).toBeGreaterThan(0);
    expect(f.longWordRatio).toBeGreaterThan(0);
    expect(styleFeatures("Big cheap wins show needs.").formalConnectorsPer100).toBe(0);
  });
});

describe("inter-rater reliability", () => {
  it("perfect agreement yields ICC 1", () => {
    const icc = iccTwoWay([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(icc.single).toBeCloseTo(1);
    expect(icc.average).toBeCloseTo(1);
  });

  it("disagreement lowers ICC", () => {
    const clean = iccTwoWay([
      [4, 4, 4],
      [2, 2, 2],
      [5, 5, 5],
    ]);
    const noisy = iccTwoWay([
      [4, 1, 5],
      [2, 5, 1],
      [5, 2, 4],
    ]);
    expect(noisy.single).toBeLessThan(clean.single);
    expect(clean.single).toBeGreaterThan(0.99);
  });

  it("gate passes on agreeing corpus and fails on noisy dimensions", () => {
    const ok = measureReliability(cleanCorpus());
    expect(ok.gatePassed).toBe(true);
    expect(ok.failingDimensions).toHaveLength(0);

    const noisy = cleanCorpus().map((d, i) => ({
      ...d,
      raters: d.raters.map((r, ri) => ({ ...r, a: scores(r.a.evidenceQuality, { relevance: (ri + i) % 2 ? 1 : 5 }) })),
    }));
    const bad = measureReliability(noisy);
    expect(bad.gatePassed).toBe(false);
    expect(bad.failingDimensions).toEqual(["relevance"]);
  });
});

describe("calibration", () => {
  it("recovers a linear scale mismatch and reduces MAE", () => {
    const human = [2, 2.5, 3, 3.5, 4, 4.5, 5];
    const system = human.map((h) => h * 2 - 3);
    const c = calibrateDimension(human, system, "reasoning");
    expect(c.slope).toBeCloseTo(0.5);
    expect(c.intercept).toBeCloseTo(1.5);
    expect(c.maeAfter).toBeLessThan(c.maeBefore);
    const cv = loocvMae(system, human);
    expect(Number.isFinite(cv)).toBe(true);
    expect(cv).toBeGreaterThanOrEqual(0);
  });

  it("already-aligned scores leave MAE roughly unchanged", () => {
    const human = [1, 2, 3, 4, 5];
    const c = calibrateDimension(human, [...human], "relevance");
    expect(c.maeAfter).toBeCloseTo(c.maeBefore, 5);
  });
});

describe("system vs human comparison via orchestrator", () => {
  it("tracking system correlates highly per dimension", () => {
    const corpus = cleanCorpus();
    const report = dailyDebateEvaluation(corpus, systemTrackingHumans(corpus));
    for (const row of report.comparison) {
      expect(row.pearson).toBeGreaterThan(0.85);
      expect(row.spearman).toBeGreaterThan(0.8);
      expect(row.mae).toBeGreaterThanOrEqual(0);
    }
  });

  it("throws when system verdicts are misaligned", () => {
    const corpus = cleanCorpus();
    const sys = systemTrackingHumans(corpus).slice(1);
    expect(() => dailyDebateEvaluation(corpus, sys)).toThrow(/no system verdict/);
  });
});

describe("bias detection", () => {
  it("verbosity tilt is detected; neutral system is not flagged", () => {
    const corpus = cleanCorpus();
    expect(detectVerbosityBias(corpus, systemTrackingHumans(corpus, true)).detected).toBe(true);
    const neutral = detectVerbosityBias(corpus, systemTrackingHumans(corpus, false));
    expect(neutral.detected).toBe(false);
    expect(Math.abs(neutral.pooledPartialR)).toBeLessThan(0.3);
  });

  it("style reward is detected when humans do not differentiate", () => {
    const plain = "Big costs need fixes now.";
    const graded = [
      "Costs need fixes now.",
      "However, costs need fixes now.",
      "However, consequently, costs need fixes now.",
      "However, consequently, furthermore, costs need fixes now.",
    ];
    const corpus: EvalDebate[] = graded.map((aText, i) => ({
      id: `st-${i + 1}`,
      transcript: [`Player A: ${aText}`, `Player B: ${plain}`].join("\n"),
      raters: [0, 1, 2].map((r) => ({ raterId: `r${r + 1}`, a: scores(3), b: scores(3) })),
    }));
    const formalSys: SystemVerdict[] = corpus.map((_, i) => ({
      id: `st-${i + 1}`,
      a: scores(3 + 0.25 * i),
      b: scores(3),
    }));
    const rep = detectStyleBias(corpus, formalSys);
    expect(rep.detected).toBe(true);
    const fc = rep.features.find((f) => f.feature === "formalConnectorsPer100");
    expect(fc?.partialR).toBeGreaterThan(0.3);

    const neutral = detectStyleBias(cleanCorpus(), systemTrackingHumans(cleanCorpus(), false));
    expect(neutral.detected).toBe(false);
  });

  it("partialCorrelation removes the controlled variable", () => {
    const z = [1, 2, 3, 4, 5];
    const u = [1, -1, 1, -1, 1];
    const x = z.map((v, i) => v + u[i]);
    const y = z.map((v, i) => v - u[i]);
    expect(partialCorrelation(x, y, z)).toBeCloseTo(-1, 5);
    expect(partialCorrelation(x, y, z)).toBeLessThan(pearsonCorrelation(x, y));
    expect(partialCorrelation(z, x, z)).toBe(0);
  });
});

describe("orchestrator", () => {
  it("runs reliability first and reports usable pipeline", () => {
    const corpus = cleanCorpus();
    const report = dailyDebateEvaluation(corpus, systemTrackingHumans(corpus, true));
    expect(report.order[0]).toBe("reliability");
    expect(report.usable).toBe(true);
    expect(report.sides).toBe(corpus.length * 2);
    expect(report.calibration.every((c) => Number.isFinite(c.loocvMae))).toBe(true);
    expect(report.notes.some((n) => n.includes("Verbosity"))).toBe(true);
  });

  it("flags unusable when reliability gate fails", () => {
    const corpus = cleanCorpus().map((d, i) => ({
      ...d,
      raters: d.raters.map((r, ri) => ({ ...r, b: scores(r.b.reasoning, { logicalValidity: (ri + i) % 2 ? 1 : 5 }) })),
    }));
    const report = dailyDebateEvaluation(corpus, systemTrackingHumans(corpus, false));
    expect(report.reliability.measuredFirst).toBe(true);
    expect(report.usable).toBe(false);
    expect(report.notes.join("\n")).toMatch(/Inter-rater reliability below threshold/);
    expect(report.reliability.failingDimensions).toContain("logicalValidity");
  });
});
