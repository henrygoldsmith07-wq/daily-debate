import { describe, it, expect } from "vitest";
import { RATER_GUIDANCE, consensusLabel, adjudicationNeeded, adjudicateDebate, corpusConsensus } from "./corpusAdjudication";
import type { LabeledDebate } from "./humanCorpus";
import { isPrimarySource, isSecondarySource, originalSourceGap, sourceDateCheck } from "./citationVerifier";
import { runBiasAudit, measureIdeologicalAsymmetry, applyPoliticalTopic, swapPrestige, addIdeologicalFraming } from "./judgeInvariance";
import { TRANSCRIPTS } from "./benchmark.fixtures";
import { createTeam, validateTeam, assignMotion, proposeTeamDebate, transitionTeamDebate, classroomDashboard } from "./classroom";
import type { TeacherMotion } from "./classroom";
import { verifyQuote, extractQuotes, evidenceQualityScore, claimSourceMatch } from "./quoteVerification";
import { graphEvidenceReport } from "./evidenceVerification";

describe("corpus adjudication — guidance, consensus, adjudicated disagreements", () => {
  it("ships rater guidance", () => {
    expect(RATER_GUIDANCE.length).toBeGreaterThan(100);
    expect(RATER_GUIDANCE).toMatch(/Rate the debate, not your position/);
    expect(RATER_GUIDANCE).toMatch(/tie/);
  });

  it("consensusLabel: majority, split-to-tie, unanimous", () => {
    expect(consensusLabel([{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "a" }, { raterId: "r3", winner: "b" }]).winner).toBe("a");
    const split = consensusLabel([{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "b" }]);
    expect(split.winner).toBe("tie");
    expect(split.margin).toBe(0);
    expect(consensusLabel([{ raterId: "r1", winner: "b" }, { raterId: "r2", winner: "b" }, { raterId: "r3", winner: "b" }]).unanimous).toBe(true);
  });

  it("adjudicationNeeded only when raters disagree", () => {
    const agreed: LabeledDebate = { id: "d1", transcript: "x", humanWinner: "a", raterIds: ["r1", "r2"], humanRationale: "r", raterVerdicts: [{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "a" }] };
    const split: LabeledDebate = { id: "d2", transcript: "x", humanWinner: "a", raterIds: ["r1", "r2"], humanRationale: "r", raterVerdicts: [{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "b" }] };
    expect(adjudicationNeeded(agreed)).toBe(false);
    expect(adjudicationNeeded(split)).toBe(true);
  });

  it("adjudicateDebate records resolution; corpusConsensus aggregates", () => {
    const split: LabeledDebate = { id: "d2", transcript: "x", humanWinner: "a", raterIds: ["r1", "r2", "r3"], humanRationale: "r", raterVerdicts: [{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "b" }, { raterId: "r3", winner: "a" }] };
    const resolved = adjudicateDebate(split, "mod-1", "b", "Rater r3 missed B's rebuttal of the cost claim in round 2.");
    expect(resolved.adjudicated).toBe(true);
    expect(resolved.adjudicatedBy).toBe("mod-1");
    expect(resolved.humanWinner).toBe("b");
    expect(() => adjudicateDebate(split, "mod-1", "b", "")).toThrow();
    const agreed: LabeledDebate = { id: "d1", transcript: "x", humanWinner: "a", raterIds: ["r1", "r2", "r3"], humanRationale: "r", raterVerdicts: [{ raterId: "r1", winner: "a" }, { raterId: "r2", winner: "a" }, { raterId: "r3", winner: "a" }] };
    const stats = corpusConsensus([agreed, resolved]);
    expect(stats.n).toBe(2);
    expect(stats.adjudicatedCount).toBe(1);
    expect(stats.unanimousCount).toBe(1);
    expect(stats.pending).toHaveLength(0);
  });
});

describe("citation — source-date checking & original-source detection", () => {
  it("primary vs secondary source classification", () => {
    expect(isPrimarySource("Nature")).toBe(true);
    expect(isPrimarySource("NREL")).toBe(true);
    expect(isSecondarySource("Reuters")).toBe(true);
    expect(isSecondarySource("Nature")).toBe(false);
  });

  it("originalSourceGap flags secondary-only citations", () => {
    expect(originalSourceGap([{ sourceName: "Nature" }]).hasPrimary).toBe(true);
    const sec = originalSourceGap([{ sourceName: "Reuters" }, { sourceName: "AP" }]);
    expect(sec.onlySecondary).toBe(true);
    expect(sec.note).toMatch(/prefer the original/);
  });

  it("sourceDateCheck flags stale and undated sources", () => {
    expect(sourceDateCheck("Published in 2018, this study shows…", { nowYear: 2026, maxAgeYears: 5 }).isOutdated).toBe(true);
    expect(sourceDateCheck("The 2024 report finds…", { nowYear: 2026, maxAgeYears: 5 }).isOutdated).toBe(false);
    expect(sourceDateCheck("This source makes a claim.").hasYear).toBe(false);
  });
});

describe("bias audit — political topic, ideology, prestige, writing complexity", () => {
  const transcripts = TRANSCRIPTS.map((t) => t.transcript);

  it("offline mock is bias-free: zero flips on all four measurements", () => {
    const audit = runBiasAudit(transcripts);
    expect(audit.n).toBe(TRANSCRIPTS.length);
    expect(audit.politicalTopicFlips).toBe(0);
    expect(audit.sourcePrestigeFlips).toBe(0);
    expect(audit.writingComplexityFlips).toBe(0);
    expect(audit.ideologicalAsymmetry.leftFlips).toBe(0);
    expect(audit.ideologicalAsymmetry.rightFlips).toBe(0);
    expect(audit.ideologicalAsymmetry.asymmetric).toBe(false);
  });

  it("transforms are present and measurable", () => {
    expect(applyPoliticalTopic("Player A (round 1): hi")).toContain("politically contested");
    expect(addIdeologicalFraming("Player A (round 1): hi", "left")).toContain("Equity framing");
    expect(swapPrestige("Lazard shows X.")).toContain("MyBlog");
    const m = measureIdeologicalAsymmetry(transcripts);
    expect(m.n).toBe(TRANSCRIPTS.length);
  });
});

describe("quote verification & evidence-quality scoring (§4 second pass)", () => {
  const LAZARD = "Lazard's 2024 Levelized Cost of Energy report finds solar is the cheapest new-build electricity source at $24 per megawatt-hour.";

  it("verifyQuote distinguishes verified / paraphrase / fabricated", () => {
    expect(verifyQuote("solar is the cheapest new-build electricity source", LAZARD).status).toBe("verified");
    expect(verifyQuote("Solar remains the cheapest new-build electricity source according to the report", LAZARD).status).toBe("paraphrase");
    expect(verifyQuote("Coal dominates every grid and nuclear is unviable", LAZARD).status).toBe("fabricated");
    expect(verifyQuote("anything", null).status).toBe("unverifiable");
  });

  it("extractQuotes finds quoted spans in evidence text", () => {
    expect(extractQuotes('Lazard says solar is "the cheapest new-build electricity source".')).toHaveLength(1);
  });

  it("evidenceQualityScore adds quote + date dimensions to the source tier", () => {
    const clean = evidenceQualityScore({
      sourceName: "Lazard",
      evidenceText: 'Lazard finds solar is "the cheapest new-build electricity source".',
      excerpt: LAZARD,
    });
    expect(clean.score).toBeGreaterThan(0.9);
    const fabricated = evidenceQualityScore({
      sourceName: "Lazard",
      evidenceText: 'Lazard proves "coal dominates every grid and nuclear is unviable".',
      excerpt: LAZARD,
    });
    expect(fabricated.score).toBeLessThan(clean.score);
    expect(fabricated.flags.some((f) => f.includes("fabricated quote"))).toBe(true);
  });

  it("graph evidence report counts fabricated quotes", () => {
    const g: import("./argGraph").ArgGraph = {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Solar wins on cost.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: 'Lazard proves "coal dominates every grid and nuclear is unviable".', round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: LAZARD }] },
      ],
      edges: [{ from: "e1", to: "c1", relation: "supports" }],
      dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
      impactComparison: null,
    };
    const rep = graphEvidenceReport(g);
    expect(rep.fabricatedQuoteCount).toBeGreaterThan(0);
  });
});

describe("claim-to-source matching (§4 third pass)", () => {
  const LAZARD = "Lazard's 2024 Levelized Cost of Energy report finds solar is the cheapest new-build electricity source at $24 per megawatt-hour.";

  it("claimSourceMatch grades supported / weak / mismatched against the cited excerpt", () => {
    const supported = claimSourceMatch("Solar is the cheapest new-build electricity source", [{ sourceName: "Lazard", excerpt: LAZARD }]);
    expect(supported.status).toBe("supported");
    const mismatched = claimSourceMatch("Coal dominates every grid and nuclear is unviable", [{ sourceName: "Lazard", excerpt: LAZARD }]);
    expect(mismatched.status).toBe("mismatched");
  });

  it("graph evidence report counts claims the citation doesn't support and docks the score", () => {
    const g: import("./argGraph").ArgGraph = {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Coal dominates every grid and nuclear is unviable.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "Lazard 2024 LCOE solar $24/MWh.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: LAZARD }] },
      ],
      edges: [{ from: "e1", to: "c1", relation: "supports" }],
      dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
      impactComparison: null,
    };
    const rep = graphEvidenceReport(g);
    expect(rep.claimMismatchCount).toBe(1);
    expect(rep.links[0].support).toBe("tangential");
    expect(rep.links[0].flags.some((f) => f.includes("claim not supported by source"))).toBe(true);
  });

  it("clean claim-to-source overlap adds no mismatch flags", () => {
    const g: import("./argGraph").ArgGraph = {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Solar is the cheapest new-build electricity source.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "Lazard 2024 LCOE solar $24/MWh.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: LAZARD }] },
      ],
      edges: [{ from: "e1", to: "c1", relation: "supports" }],
      dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
      impactComparison: null,
    };
    const rep = graphEvidenceReport(g);
    expect(rep.claimMismatchCount).toBe(0);
    expect(rep.links[0].support).toBe("supports");
  });
});

describe("classroom — team debates, teacher-assigned motions, dashboard", () => {
  const motion: TeacherMotion = { id: "m1", title: "Should schools ban phones?", prompt: "P", createdBy: "t1", createdAt: "2026-01-01T00:00:00Z" };
  const classroom = { id: "c1", name: "5A", teacherId: "t1", studentIds: ["s1", "s2", "s3", "s4"] };
  const teamA = createTeam("ta", "Team A", ["s1", "s2"]);
  const teamB = createTeam("tb", "Team B", ["s3", "s4"]);

  it("team validation", () => {
    expect(validateTeam(teamA)).toHaveLength(0);
    expect(validateTeam(createTeam("x", "Solo", ["s1"])).some((e) => e.includes("2 members"))).toBe(true);
  });

  it("teacher assigns a motion to a team and class", () => {
    const assigned = assignMotion(motion, "ta", "c1");
    expect(assigned.assignedToTeamId).toBe("ta");
    expect(assigned.assignedToClassId).toBe("c1");
  });

  it("team debate lifecycle: proposed → accepted → active → judged", () => {
    const d = proposeTeamDebate("m1", "ta", "tb");
    expect(d.status).toBe("proposed");
    const accepted = transitionTeamDebate(d, "accepted");
    const active = transitionTeamDebate(accepted, "active");
    const judged = transitionTeamDebate(active, "judged", "ta");
    expect(judged.winnerTeamId).toBe("ta");
    expect(() => transitionTeamDebate(d, "judged")).toThrow(/Cannot move team debate/);
    expect(() => transitionTeamDebate(active, "judged")).toThrow(/winnerTeamId/);
  });

  it("dashboard aggregates per-student wins/losses/participation", () => {
    const d = transitionTeamDebate(transitionTeamDebate(transitionTeamDebate(proposeTeamDebate("m1", "ta", "tb"), "accepted"), "active"), "judged", "ta");
    const dash = classroomDashboard({ classroom, teams: [teamA, teamB], debates: [d], results: [{ debateId: d.id, winnerTeamId: "ta" }] });
    expect(dash.byStudent["s1"].wins).toBe(1);
    expect(dash.byStudent["s3"].losses).toBe(1);
    expect(dash.byStudent["s9"]).toBeUndefined(); // off-roster ignored
    expect(dash.participationRate).toBe(1);
  });
});
