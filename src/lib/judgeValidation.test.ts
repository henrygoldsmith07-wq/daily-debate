import { describe, it, expect } from "vitest";
import {
  assessJudgeValidation,
  allowsCompetitiveClaims,
  STALENESS_DAYS,
  type BenchmarkArtifact,
  type BenchmarkRow,
} from "./judgeValidation";

const NOW = "2026-10-04T12:00:00Z";

const GATES = { humanAgreementMin: 0.75, eceMax: 0.08, providerReliabilityMin: 0.75 };

const row = (over: Partial<BenchmarkRow> = {}): BenchmarkRow => ({
  model: "kiraai:qwen",
  humanAgreement: 0.583,
  agreementN: 24,
  ece: 0.189,
  reliability: { successRatio: 0.974 },
  gates: [
    { name: "provider reliability", pass: true, kind: "provider" },
    { name: "fixture-label agreement", pass: false, kind: "model-quality" },
    { name: "ECE", pass: false, kind: "model-quality" },
  ],
  ...over,
});

const artifact = (results: BenchmarkRow[], at = "2026-10-01T00:00:00Z"): BenchmarkArtifact => ({
  at,
  allPass: results.every((r) => (r.gates ?? []).every((g) => g.pass)),
  gates: GATES,
  results,
});

const allPassingRow: BenchmarkRow = {
  model: "some:model",
  humanAgreement: 0.81,
  agreementN: 48,
  ece: 0.05,
  reliability: { successRatio: 0.95 },
  gates: [
    { name: "provider reliability", pass: true },
    { name: "fixture-label agreement", pass: true },
    { name: "ECE", pass: true },
  ],
};

describe("assessJudgeValidation", () => {
  it("reports the real production state: no model clears the gates", () => {
    const r = assessJudgeValidation({ artifact: artifact([row()]), nowIso: NOW });
    expect(r.source).toBe("ok");
    expect(r.stale).toBe(false);
    expect(r.evidence?.modelsBenchmarked).toBe(1);
    expect(r.evidence?.modelsPassingAllGates).toBe(0);
    expect(r.surfaces["pvp-verdict"].status).toBe("gated-off");
    expect(allowsCompetitiveClaims(r.surfaces["pvp-verdict"])).toBe(false);
    // Training surfaces stay provisional, never validated.
    expect(r.surfaces["solo-training"].status).toBe("provisional");
    expect(r.surfaces.repair.status).toBe("provisional");
  });

  it("carries the measured numbers and the threshold they miss", () => {
    const r = assessJudgeValidation({ artifact: artifact([row()]), nowIso: NOW });
    const pvp = r.surfaces["pvp-verdict"];
    expect(pvp.evidence?.bestAgreement).toBe(0.583);
    expect(pvp.evidence?.bestAgreementN).toBe(24);
    expect(pvp.evidence?.bestEce).toBe(0.189);
    expect(pvp.reason).toContain("0.583");
    expect(pvp.reason).toContain("n=24");
    expect(pvp.reason).toContain("0.750"); // the 0.75 floor, named
  });

  it("keeps agreement tied to its sample size", () => {
    // Agreement without n is not a claim: the best agreement must never be
    // reported without the n it was measured on.
    const r = assessJudgeValidation({
      artifact: artifact([row({ agreementN: 4 })]),
      nowIso: NOW,
    });
    expect(r.evidence?.bestAgreementN).toBe(4);
    expect(r.surfaces["pvp-verdict"].reason).toContain("n=4");
  });

  it("unavailable artifact is unknown everywhere and opens no competitive claim", () => {
    const r = assessJudgeValidation({ artifact: null, nowIso: NOW });
    expect(r.source).toBe("unavailable");
    expect(r.benchmarkAllPass).toBeNull();
    for (const s of ["solo-training", "repair", "guest", "pvp-verdict"] as const) {
      expect(r.surfaces[s].status).toBe("unknown");
      expect(allowsCompetitiveClaims(r.surfaces[s])).toBe(false);
    }
  });

  it("an artifact with no results is partial, not a pass", () => {
    const r = assessJudgeValidation({ artifact: { at: NOW, results: [], gates: GATES }, nowIso: NOW });
    expect(r.source).toBe("partial");
    expect(r.evidence).toBeNull();
    expect(r.surfaces["pvp-verdict"].status).toBe("unknown");
    expect(allowsCompetitiveClaims(r.surfaces["pvp-verdict"])).toBe(false);
  });

  it("a stale benchmark cannot certify anything, even when it once passed", () => {
    const staleAt = new Date(Date.parse(NOW) - (STALENESS_DAYS + 1) * 86_400_000).toISOString();
    const r = assessJudgeValidation({ artifact: artifact([allPassingRow], staleAt), nowIso: NOW });
    expect(r.stale).toBe(true);
    // The decisive case: every gate passed, but the run is 15 days old.
    expect(r.surfaces["pvp-verdict"].status).toBe("gated-off");
    expect(allowsCompetitiveClaims(r.surfaces["pvp-verdict"])).toBe(false);
    expect(r.note).toContain("stale");
    expect(r.surfaces["solo-training"].reason).toContain("stale");
  });

  it("a fresh benchmark where every gate passes validates competitive claims", () => {
    const r = assessJudgeValidation({ artifact: artifact([allPassingRow]), nowIso: NOW });
    expect(r.stale).toBe(false);
    expect(r.surfaces["pvp-verdict"].status).toBe("validated");
    expect(allowsCompetitiveClaims(r.surfaces["pvp-verdict"])).toBe(true);
    // Validating the judge does not retroactively validate training claims.
    expect(r.surfaces["solo-training"].status).toBe("provisional");
  });

  it("one passing model among failures is enough to certify", () => {
    const r = assessJudgeValidation({ artifact: artifact([row(), allPassingRow]), nowIso: NOW });
    expect(r.evidence?.modelsBenchmarked).toBe(2);
    expect(r.evidence?.modelsPassingAllGates).toBe(1);
    expect(r.surfaces["pvp-verdict"].status).toBe("validated");
  });

  it("a row with no gate detail never counts as a pass", () => {
    // Missing evidence is not passing evidence.
    const r = assessJudgeValidation({
      artifact: artifact([row({ gates: null, humanAgreement: 0.99, ece: 0.01 })]),
      nowIso: NOW,
    });
    expect(r.evidence?.modelsPassingAllGates).toBe(0);
    expect(r.surfaces["pvp-verdict"].status).toBe("gated-off");
  });

  it("an empty gate list never counts as a pass", () => {
    const r = assessJudgeValidation({ artifact: artifact([row({ gates: [] })]), nowIso: NOW });
    expect(r.evidence?.modelsPassingAllGates).toBe(0);
  });

  it("reports null metrics as null rather than zero", () => {
    const r = assessJudgeValidation({
      artifact: artifact([row({ humanAgreement: null, ece: null, agreementN: null })]),
      nowIso: NOW,
    });
    expect(r.evidence?.bestAgreement).toBeNull();
    expect(r.evidence?.bestEce).toBeNull();
    expect(r.surfaces["pvp-verdict"].reason).toContain("n/a");
  });

  it("surfaces the thresholds the run was judged against", () => {
    const r = assessJudgeValidation({ artifact: artifact([row()]), nowIso: NOW });
    expect(r.evidence?.thresholds).toEqual({
      humanAgreementMin: 0.75,
      eceMax: 0.08,
      providerReliabilityMin: 0.75,
    });
  });

  it("a missing timestamp is not treated as fresh", () => {
    const r = assessJudgeValidation({ artifact: { ...artifact([row()]), at: null }, nowIso: NOW });
    expect(r.runAt).toBeNull();
    expect(r.stale).toBe(false);
    // With no run timestamp there is nothing to certify a current judge with.
    expect(allowsCompetitiveClaims(r.surfaces["pvp-verdict"])).toBe(false);
  });
});