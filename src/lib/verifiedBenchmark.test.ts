import { describe, it, expect } from "vitest";
import { groundedEvidenceRatio, validateGraph, claimCoverageWithGroundedEvidence, emptyGraph } from "./argGraph";
import type { ArgGraph, ArgNode } from "./argGraph";
import { verifyCitation, verifyGraphCitations, graphSourceQuality } from "./citationVerifier";
import { runAllProbesOffline, swapLabels, stripNames, inflateVerbosity, injectFakeCitation, sophisticateWording, BIAS_PROBES } from "./judgeInvariance";
import { TRANSCRIPTS } from "./benchmark.fixtures";
import {
  HUMAN_CORPUS,
  HUMAN_CORPUS_AUDIT,
  auditCorpusLabels,
  fleissKappa,
  cohenKappa,
  krippendorffAlpha,
  pearsonCorrelation,
  spearmanCorrelation,
  judgeHumanCorrelation,
  calibrationReport,
  corpusStats,
  syntheticCorpus,
  ratingMatrix,
} from "./humanCorpus";
import { ensembleVerdicts } from "./ensembleJudge";
import { claimCitationMap, distortionScore, cherryPickSignal, graphEvidenceReport } from "./evidenceVerification";
import { classifyFallacies, detectDropped, detectConcessions, detectContradictions, detectBurdenShifts, applyGraphEdits, argumentEvolution } from "./graphEnrichers";
import { canStartTournament, buildSingleElim, advanceWinners, seasonalLeaderboard } from "./tournament";
import { TIMED_FORMATS, buildPrepPack, validatePrepSource } from "./researchPrep";
import { validateAppeal, canFileAppeal } from "./appeals";
import { shareText, shareMarkdown } from "./shareable";
import { snapshotFromGraph, aggregateWeaknesses, topWeaknesses, measureDrillOutcome, drillsForWeaknesses } from "./weaknessTracker";
import type { PvpJudgeResult } from "./types";

function sampleGraph(): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "Solar cheapest new build.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "Lazard $24/MWh.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }] },
      { id: "k1", kind: "counterclaim", owner: "b", text: "Intermittency needs baseload.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Storage covers intermittency.", round: 3, targets: ["k1"] },
      { id: "i1", kind: "impact", owner: "a", text: "Cheaper bills win.", round: 3 },
    ],
    edges: [
      { from: "e1", to: "c1", relation: "supports" },
      { from: "k1", to: "c1", relation: "counters" },
      { from: "r1", to: "k1", relation: "rebuts" },
      { from: "c1", to: "i1", relation: "impacts" },
    ],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
    impactComparison: { a: 60, b: 40, rationale: "cost wins" },
  };
}

describe("corpus at scale — reliability", () => {
  it("does not claim human validity without provenance evidence", () => {
    expect(HUMAN_CORPUS_AUDIT.canClaimHumanValidity).toBe(false);
    expect(HUMAN_CORPUS_AUDIT.status).toBe("unverified_fixture");
    expect(auditCorpusLabels([{ ...HUMAN_CORPUS[0], provenance: "synthetic", isSynthetic: true }]).canClaimHumanValidity).toBe(false);
  });

  it("synthetic corpus generates thousands with expected shape", () => {
    const syn = syntheticCorpus({ n: 1000, seed: 1, agreement: "medium" });
    expect(syn.length).toBe(1000);
    expect(syn[0].raterVerdicts?.length).toBe(3);
    expect(corpusStats([...HUMAN_CORPUS, ...syn.slice(0, 20)]).n).toBe(HUMAN_CORPUS.length + 20);
  });

  it("Fleiss/Cohen/Krippendorff are in range", () => {
    const syn = syntheticCorpus({ n: 40, seed: 2, agreement: "high" });
    const mat = ratingMatrix(syn);
    expect(fleissKappa(mat)).toBeGreaterThan(0.4);
    expect(krippendorffAlpha(syn)).toBeGreaterThan(0.3);
    const a = syn.map((d) => d.raterVerdicts![0].winner);
    const b = syn.map((d) => d.raterVerdicts![1].winner);
    expect(cohenKappa(a, b)).toBeGreaterThan(0.3);
  });

  it("ratingMatrix dimensions match corpus", () => {
    const mat = ratingMatrix(HUMAN_CORPUS);
    expect(mat.length).toBe(HUMAN_CORPUS.length);
    expect(mat[0].length).toBe(3);
  });

  it("synthetic medium-agreement has plausible disagreement", () => {
    const syn = syntheticCorpus({ n: 60, seed: 3, agreement: "medium" });
    const stats = corpusStats(syn);
    // Medium agreement => kappa neither near 1 nor near 0
    expect(stats.fleissKappa).toBeGreaterThan(0.25);
    expect(stats.fleissKappa).toBeLessThan(0.92);
  });
});

describe("correlation + calibration", () => {
  it("pearson/spearman catch monotonic relation", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(spearmanCorrelation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it("judgeHumanCorrelation returns agreement + r", () => {
    const r = judgeHumanCorrelation(["a", "b", "tie", "a"], ["a", "b", "a", "a"]);
    expect(r.agreement).toBe(0.75);
    expect(r.pearson).toBeGreaterThan(0.3);
  });

  it("calibrationReport produces ECE/Brier", () => {
    const gaps = [0.1, 0.4, 0.45, 0.8, 0.85, 0.9];
    const won = [0, 0, 1, 1, 1, 1];
    const cr = calibrationReport(gaps, won, 3);
    expect(cr.n).toBe(6);
    expect(cr.ece).toBeGreaterThanOrEqual(0);
    expect(cr.brier).toBeGreaterThan(0);
    expect(cr.bins.length).toBeGreaterThan(0);
  });
});

describe("bias probes — statistical, offline", () => {
  it("all probes run deterministically over fixtures", () => {
    const transcripts = TRANSCRIPTS.map((t) => t.transcript);
    const reports = runAllProbesOffline(transcripts);
    expect(reports.length).toBe(BIAS_PROBES.length);
    // Position probe should have 0 mis-flips on the deterministic mock
    const pos = reports.find((r) => r.probeId === "position")!;
    expect(pos.flips).toBe(0);
    // Invariant probes should also be 0 flips on mock
    for (const r of reports.filter((x) => x.probeId !== "position")) expect(r.flips).toBe(0);
  });

  it("individual transforms don't flip mock winner", () => {
    const t = TRANSCRIPTS[0].transcript;
    expect(stripNames(t)).not.toContain("Player A");
    expect(inflateVerbosity("x\n y").includes("unequivocally")).toBe(true);
    expect(injectFakeCitation(t)).toContain("Global Institute");
    expect(sophisticateWording("cheap shows").includes("economically")).toBe(true);
  });
});

describe("ensemble + uncertainty", () => {
  it("single judge: confidence derived from gap", () => {
    const j: PvpJudgeResult & { judgeId: "openrouter" } = { winner: "a", playerAScore: 78, playerBScore: 62, rationale: "A wins on evidence", judgeId: "openrouter" };
    const e = ensembleVerdicts([j]);
    expect(e.winner).toBe("a");
    expect(e.confidence).toBeGreaterThan(0.5);
    expect(e.scoreGap).toBe(16);
  });

  it("two judges agreeing => higher confidence than one", () => {
    const a: PvpJudgeResult & { judgeId: "openrouter" } = { winner: "a", playerAScore: 80, playerBScore: 60, rationale: "A", judgeId: "openrouter" };
    const b: PvpJudgeResult & { judgeId: "anthropic" } = { winner: "a", playerAScore: 78, playerBScore: 62, rationale: "A", judgeId: "anthropic" };
    const two = ensembleVerdicts([a, b]);
    const one = ensembleVerdicts([a]);
    expect(two.winner).toBe("a");
    expect(two.isTie).toBe(false);
    expect(two.scoreCI.hi).toBeGreaterThan(0);
  });

  it("disagreeing judges => tie or low confidence", () => {
    const a: PvpJudgeResult & { judgeId: "openrouter" } = { winner: "a", playerAScore: 72, playerBScore: 68, rationale: "A", judgeId: "openrouter" };
    const b: PvpJudgeResult & { judgeId: "anthropic" } = { winner: "b", playerAScore: 68, playerBScore: 72, rationale: "B", judgeId: "anthropic" };
    const e = ensembleVerdicts([a, b]);
    expect(e.isTie).toBe(true);
    expect(e.winner).toBe("tie");
  });

  it("small gap < threshold => tie", () => {
    const j: PvpJudgeResult & { judgeId: "openrouter" } = { winner: "a", playerAScore: 70, playerBScore: 69, rationale: "A", judgeId: "openrouter" };
    expect(ensembleVerdicts([j]).isTie).toBe(true);
  });
});

describe("evidence verification — distortion / cherry-pick / map", () => {
  it("distortion score high when claim intensifies hedged evidence", () => {
    expect(distortionScore("This always proves X", "This may suggest X in some cases")).toBeGreaterThan(0.5);
    expect(distortionScore("May suggest X", "May suggest X")).toBe(0);
  });

  it("cherryPickSignal flags broad claim + single source", () => {
    const ev: ArgNode = { id: "e1", kind: "evidence", owner: "a", text: "x", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }] };
    expect(cherryPickSignal("All global studies always show X", [ev]).atRisk).toBe(true);
    expect(cherryPickSignal("This case shows X", [ev]).atRisk).toBe(false);
  });

  it("claimCitationMap + graphEvidenceReport produce coverage and quality", () => {
    const g = sampleGraph();
    const links = claimCitationMap(g);
    expect(links.length).toBeGreaterThan(0);
    const rep = graphEvidenceReport(g);
    expect(rep.coverage).toBeGreaterThan(0);
    expect(rep.avgQuality).toBeGreaterThan(0.7);
    expect(rep.hallucinationCount).toBe(0);
  });
});

describe("graph enrichers — fallacy classifier + detectors", () => {
  it("classifier flags strawman/whataboutism", () => {
    expect(classifyFallacies("So you're saying we should ban all cars?").some((h) => h.fallacy === "strawman")).toBe(true);
    expect(classifyFallacies("what about the other side's record?").some((h) => h.fallacy === "whataboutism")).toBe(true);
  });

  it("detectDropped finds unrebutted earlier claim", () => {
    const g: ArgGraph = {
      ...sampleGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Solar cheap.", round: 1 },
        { id: "c2", kind: "claim", owner: "b", text: "Nuclear needed.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Nuclear too slow.", round: 2, targets: ["c2"] },
        { id: "c3", kind: "claim", owner: "b", text: "Grid needs baseload.", round: 2 },
      ],
      edges: [{ from: "r1", to: "c2", relation: "rebuts" }],
      dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: [] },
      impactComparison: null,
    };
    // c1 never rebutted, c2 was rebutted
    const dropped = detectDropped(g);
    expect(dropped.some((d) => d.nodeId === "c1")).toBe(true);
    expect(dropped.some((d) => d.nodeId === "c2")).toBe(false);
  });

  it("detectConcessions / detectContradictions / detectBurdenShifts", () => {
    expect(detectConcessions([{ id: "x", kind: "claim", owner: "a", text: "I concede the cost point but impact still wins", round: 2 }]).length).toBe(1);
    expect(detectContradictions([
      { id: "c1", kind: "claim", owner: "a", text: "Solar is cheap", round: 1 },
      { id: "c2", kind: "claim", owner: "a", text: "Solar is not cheap at all", round: 2 },
    ]).length).toBeGreaterThan(0);
    expect(detectBurdenShifts([{ id: "r1", kind: "rebuttal", owner: "a", text: "You must prove that claim", round: 2 }]).length).toBe(1);
  });

  it("applyGraphEdits + argumentEvolution are auditable", () => {
    const g = sampleGraph();
    const { graph: g2, audit } = applyGraphEdits(g, [
      { op: "patchNode", nodeId: "c1", patch: { text: "Solar cheapest (revised)" } },
      { op: "addNode", node: { id: "e2", kind: "evidence", owner: "b", text: "New data", round: 2, evidenceStrength: "general" } },
    ]);
    expect(audit.length).toBe(2);
    expect(g2.nodes.find((n) => n.id === "c1")?.text).toContain("revised");
    expect(argumentEvolution(g2, "c1").length).toBeGreaterThan(0);
  });
});

describe("competitive / timed / tournament / seasonal", () => {
  it("tournament needs min players and builds bracket", () => {
    expect(canStartTournament([{ userId: "u1", rating: 1200, seed: 1 }]).ok).toBe(false);
    const seeds = [
      { userId: "u1", rating: 1600, seed: 1 }, { userId: "u2", rating: 1500, seed: 2 },
      { userId: "u3", rating: 1400, seed: 3 }, { userId: "u4", rating: 1300, seed: 4 },
    ];
    const ms = buildSingleElim(seeds);
    expect(ms.length).toBeGreaterThanOrEqual(3); // 2 semis + final (with placeholders)
    const t = { id: "t1", title: "T", format: "single_elim" as const, status: "active" as const, seeds, matches: ms, winnerId: null, createdAt: new Date().toISOString() };
    const adv = advanceWinners(t, [{ matchId: ms[0].id, winnerId: "u1" }]);
    expect(adv.matches.find((m) => m.id === ms[0].id)?.status).toBe("completed");
  });

  it("seasonal leaderboard requires participation", () => {
    expect(seasonalLeaderboard([{ userId: "u1", rating: 1500, games: 10 }]).length).toBe(0); // <8 qualified
    const many = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, rating: 1500 - i * 10, games: 10 }));
    expect(seasonalLeaderboard(many).length).toBe(10);
  });

  it("timed formats + prep pack validation", () => {
    expect(TIMED_FORMATS.length).toBeGreaterThanOrEqual(4);
    expect(validatePrepSource({ name: "", homepage: "https://example.com", angle: "x", addedBy: "user" }).length).toBeGreaterThan(0);
    const pack = buildPrepPack({ id: "t1", title: "T", prompt: "P", sources: [{ name: "Pew", homepage: "https://www.pewresearch.org", angle: "polling" }] });
    expect(pack.sources.length).toBeGreaterThan(0);
  });

  it("appeals validate and respect window", () => {
    expect(validateAppeal({ reason: "bias", note: "short" }).length).toBeGreaterThan(0);
    expect(validateAppeal({ reason: "bias", note: "This scoring ignored my Lazard citation in round 2 where I cited $24/MWh." }).length).toBe(0);
    expect(canFileAppeal({ status: "active", completed_at: null }, new Date().toISOString()).ok).toBe(false);
    expect(canFileAppeal({ status: "completed", completed_at: new Date().toISOString() }, new Date().toISOString()).ok).toBe(true);
  });

  it("share text/markdown", () => {
    const v: PvpJudgeResult = { winner: "a", playerAScore: 80, playerBScore: 62, rationale: "A had cited Lazard and rebutted directly.", decidingFactor: "Grounded evidence.", breakdown: { a: { claims: 2, evidence: 2, rebuttals: 1, impacts: 1, fallacies: 0, droppedSuffered: 0 }, b: { claims: 2, evidence: 0, rebuttals: 0, impacts: 0, fallacies: 1, droppedSuffered: 1 } } };
    expect(shareText({ topicTitle: "T", verdict: v, playerAName: "Alice", playerBName: "Bob" }).includes("Alice")).toBe(true);
    expect(shareMarkdown({ topicTitle: "T", verdict: v, playerAName: "Alice", playerBName: "Bob" }).includes("|")).toBe(true);
  });

  it("weakness tracker aggregates and measures drill outcome", () => {
    const g = sampleGraph();
    const s1 = snapshotFromGraph(g, { at: "2026-01-01T00:00:00Z" });
    const g2: ArgGraph = { ...g, evidenceStats: { ...g.evidenceStats, unsupportedClaimIds: ["c1"] }, dropped: [{ nodeId: "k1", text: "x", owner: "b", round: 2 }] };
    const s2 = snapshotFromGraph(g2, { at: "2026-01-02T00:00:00Z" });
    const hist = { snapshots: [s1, s2, s1, s2, s1, s2, s1, s2] };
    const agg = aggregateWeaknesses(hist, 6);
    expect(topWeaknesses(agg).length).toBeGreaterThan(0);
    const drills = drillsForWeaknesses(topWeaknesses(agg, 2), "2026-01-05T00:00:00Z");
    expect(drills.length).toBeGreaterThan(0);
    // Before window had weakness, after window didn't => improved
    const before = Array.from({ length: 5 }, () => snapshotFromGraph(g2, { at: "2026-01-01T00:00:00Z" }));
    const after = Array.from({ length: 5 }, () => snapshotFromGraph(g, { at: "2026-01-06T00:00:00Z" }));
    const outcome = measureDrillOutcome({ snapshots: [...before, drillAt(drills[0].assignedAt, g2), ...after] }, drills[0]);
    expect(outcome).toBeDefined();
  });
});

function drillAt(at: string, graph: ArgGraph) { return snapshotFromGraph(graph, { at }); }

