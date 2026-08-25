import { describe, it, expect } from "vitest";
import {
  makeFingerprint,
  makeEnsembleFingerprint,
  fingerprintToString,
  PROMPT_VERSION,
  SCORING_ENGINE_VERSION,
} from "./judgeVersioning";
import {
  checkGates,
  detectDegradation,
  evaluateRetirement,
  healthBarChart,
  type JudgeHealthEntry,
} from "./judgeHealth";

// ── fingerprint ─────────────────────────────────────────────────────────────

describe("judge fingerprint", () => {
  it("captures all version dimensions", () => {
    const fp = makeFingerprint("nvidia", "nemotron-3-ultra", { temperature: 0.7 });
    expect(fp.provider).toBe("nvidia");
    expect(fp.model).toBe("nemotron-3-ultra");
    expect(fp.promptVersion).toBe(PROMPT_VERSION);
    expect(fp.scoringEngineVersion).toBe(SCORING_ENGINE_VERSION);
    expect(fp.temperature).toBe(0.7);
    expect(fp.ensemble).toEqual(["nvidia"]);
  });

  it("builds ensemble fingerprints from multiple judges", () => {
    const fps = [
      makeFingerprint("openrouter", "glm-5.2:free"),
      makeFingerprint("anthropic", "claude-sonnet-5"),
    ];
    const ens = makeEnsembleFingerprint(fps);
    expect(ens.ensemble).toHaveLength(2);
    expect(ens.ensemble[0]).toContain("glm");
    expect(ens.ensemble[1]).toContain("claude");
  });

  it("produces a readable string representation", () => {
    const fp = makeFingerprint("nvidia", "nemotron-3-ultra");
    const s = fingerprintToString(fp);
    expect(s).toContain("nvidia:nemotron-3-ultra");
    expect(s).toContain("@pv");
  });

  it("throws on empty ensemble list", () => {
    expect(() => makeEnsembleFingerprint([])).toThrow();
  });
});

// ── health gates ─────────────────────────────────────────────────────────────

function entry(overrides?: Partial<JudgeHealthEntry>): JudgeHealthEntry {
  return {
    date: "2026-08-22",
    judgeId: "test-model",
    positionMirrorStability: 1.0,
    verbosityStability: 1.0,
    humanAgreement: 0.85,
    ece: 0.05,
    falseCitationInfluence: 0,
    gatesPassed: true,
    ...overrides,
  };
}

describe("gate checks", () => {
  it("passes all gates for a healthy model", () => {
    const checks = checkGates(entry());
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("flags individual gate failures", () => {
    const checks = checkGates(entry({ verbosityStability: 0.5 }));
    const vs = checks.find((c) => c.gate === "verbosityStability");
    expect(vs?.passed).toBe(false);
    expect(vs?.value).toBe(0.5);
  });
});

describe("degradation detection", () => {
  it("detects a drop >5 percentage points between windows", () => {
    const entries = [
      entry({ date: "2026-08-01", humanAgreement: 0.81 }),
      entry({ date: "2026-08-08", humanAgreement: 0.81 }),
      entry({ date: "2026-08-15", humanAgreement: 0.79 }),
      entry({ date: "2026-08-22", humanAgreement: 0.73 }),
    ];
    const d = detectDegradation(entries, 2);
    expect(d.degraded).toBe(true);
    expect(d.recentMean!).toBeLessThan(d.priorMean!);
  });

  it("does not flag stable performance as degraded", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, humanAgreement: 0.81 })
    );
    expect(detectDegradation(entries, 3).degraded).toBe(false);
  });

  it("returns false when insufficient data", () => {
    expect(detectDegradation([entry()], 3).degraded).toBe(false);
    expect(detectDegradation([], 3).degraded).toBe(false);
  });
});

describe("auto-retirement", () => {
  it("immediately retires when all gates fail simultaneously", () => {
    const history = [entry({
      positionMirrorStability: 0,
      verbosityStability: 0,
      humanAgreement: 0,
      ece: 0.5,
      falseCitationInfluence: 1,
    })];
    const r = evaluateRetirement(history);
    expect(r.shouldRetire).toBe(true);
    expect(r.reason).toMatch(/all.*gates failed/i);
  });

  it("retires after 3 consecutive failures of the same gate", () => {
    const history = [
      entry({ date: "2026-08-01", verbosityStability: 0.4 }),
      entry({ date: "2026-08-08", verbosityStability: 0.5 }),
      entry({ date: "2026-08-15", verbosityStability: 0.3 }),
    ];
    const r = evaluateRetirement(history);
    expect(r.shouldRetire).toBe(true);
    expect(r.reason).toMatch(/verbosity/i);
  });

  it("retires on drift + latest gate failure", () => {
    const history = [
      entry({ date: "2026-07-25", humanAgreement: 0.81 }),
      entry({ date: "2026-08-01", humanAgreement: 0.81 }),
      entry({ date: "2026-08-08", humanAgreement: 0.81 }),
      entry({ date: "2026-08-15", humanAgreement: 0.71 }),
      entry({ date: "2026-08-22", humanAgreement: 0.70 }),
    ];
    // Make latest fail at least one gate
    history[4].ece = 0.12;
    const r = evaluateRetirement(history);
    expect(r.shouldRetire).toBe(true);
    expect(r.reason).toMatch(/drift/i);
  });

  it("does NOT retire a healthy model", () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      entry({ date: `2026-08-${String(i + 10).padStart(2, "0")}` })
    );
    expect(evaluateRetirement(history).shouldRetire).toBe(false);
  });

  it("does NOT retire when only one run exists with partial failure", () => {
    const r = evaluateRetirement([entry({ ece: 0.12 })]);
    // Single run with one failure is noise, not systematic — don't retire yet
    expect(r.shouldRetire).toBe(false);
  });
});

describe("health bar chart", () => {
  it("renders a bar chart string", () => {
    const entries = [
      entry({ date: "2026-08-01", humanAgreement: 0.81 }),
      entry({ date: "2026-08-08", humanAgreement: 0.73 }),
    ];
    const chart = healthBarChart(entries, "test-model");
    expect(chart).toContain("81%");
    expect(chart).toContain("73%");
  });

  it("returns message when no data", () => {
    expect(healthBarChart([], "test")).toContain("No benchmark");
  });
});
