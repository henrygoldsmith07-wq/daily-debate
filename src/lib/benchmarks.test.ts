import { describe, it, expect } from "vitest";
import type { ArgGraph } from "./argGraph";
import { groundedEvidenceRatio, claimCoverageWithGroundedEvidence, validateGraph } from "./argGraph";
import { TRANSCRIPTS } from "./benchmark.fixtures";

// Lightweight, no-network benchmarks that exercise the *contracts* the
// user flagged: source-grounded evidence and judge invariance.
//
// The live judge tests (with an API key) belong in a separate `*.e2e.ts`
// suite; these run on every CI turn and catch regressions in graph
// validation and grounding math without needing credentials.

// --- Helpers: a deterministic mock judge for invariance testing --------

type Verdict = { winner: "a" | "b" | "tie"; playerAScore: number; playerBScore: number; rationale: string };

/**
 * Mock judge that scores by counting grounded evidence markers (citations)
 * and rebuttals in the transcript text. Deterministic, no LLM.
 * Used to model the *invariance contract*: reformatting the judge prompt
 * (e.g. swapping "Player A/B" labels) should not flip the winner.
 */
function mockJudge(transcript: string): Verdict {
  const lines = transcript.split("\n");
  let aEvidence = 0, bEvidence = 0, aRebuttals = 0, bRebuttals = 0;
  for (const line of lines) {
    const owner = line.includes("Player A") ? "a" : line.includes("Player B") ? "b" : null;
    if (!owner) continue;
    // "Grounded" evidence markers: explicit source names or LCOE/NREL/Pew etc.
    const grounded = /Lazard|NREL|IEA|Pew|Brattle|Bruegel|Brookings|Stanford HAI|NIST|HDB|OECD/i.test(line) ? 1 : 0;
    if (grounded) { if (owner === "a") aEvidence++; else bEvidence++; }
    const rebuttal = /covers|rebuttal|covers 90%|unverifiable|offshore|fails|anecdotal/i.test(line) ? 1 : 0;
    if (rebuttal) { if (owner === "a") aRebuttals++; else bRebuttals++; }
  }
  const score = (ev: number, reb: number) => 55 + ev * 10 + reb * 5;
  const aScore = Math.min(100, score(aEvidence, aRebuttals));
  const bScore = Math.min(100, score(bEvidence, bRebuttals));
  const winner: Verdict["winner"] = aScore > bScore + 3 ? "a" : bScore > aScore + 3 ? "b" : "tie";
  return { winner, playerAScore: aScore, playerBScore: bScore, rationale: `mock: A ev=${aEvidence} reb=${aRebuttals} vs B ev=${bEvidence} reb=${bRebuttals}` };
}

function swapPlayerLabels(transcript: string): string {
  // Swap "Player A" ↔ "Player B" without double-rewriting.
  return transcript
    .replaceAll("Player A", "__TMP__")
    .replaceAll("Player B", "Player A")
    .replaceAll("__TMP__", "Player B");
}

function normalizeTranscript(transcript: string): string {
  // Extra whitespace / bullet formatting — should not change winner.
  return transcript.replaceAll("  ", " ").trim();
}

// --- Sample grounded graph builder ------------------------------------

function sampleGrounded(): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "Renewables are cheapest new build.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "Lazard 2024 LCOE solar $24/MWh.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: "2024 LCOE utility solar cheapest." }] },
      { id: "e2", kind: "evidence", owner: "a", text: "NREL storage futures covers 90%.", round: 2, evidenceStrength: "strong", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
      { id: "c2", kind: "claim", owner: "b", text: "Storage erases price advantage.", round: 1 },
      { id: "e3", kind: "evidence", owner: "b", text: "My uncle saw blackouts.", round: 2, evidenceStrength: "anecdotal" },
      { id: "k1", kind: "counterclaim", owner: "b", text: "Intermittency needs baseload.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Storage covers intermittency.", round: 3, targets: ["k1"] },
      { id: "i1", kind: "impact", owner: "a", text: "Cheaper bills win.", round: 3 },
    ],
    edges: [
      { from: "e1", to: "c1", relation: "supports" },
      { from: "e2", to: "c1", relation: "supports" },
      { from: "k1", to: "c1", relation: "counters" },
      { from: "r1", to: "k1", relation: "rebuts" },
      { from: "c1", to: "i1", relation: "impacts" },
    ],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: { total: 3, byOwner: { a: 2, b: 1, ai: 0 }, byStrength: { anecdotal: 1, general: 0, cited: 1, strong: 1 }, unsupportedClaimIds: ["c2"] },
    impactComparison: { a: 62, b: 38, rationale: "Cost impact grounded; reliability asserted." },
  };
}

// -----------------------------------------------------------------------

describe("benchmark: source-grounded evidence", () => {
  it("fixtures: sample grounded graph has citations on cited/strong evidence", () => {
    const g = sampleGrounded();
    const errors = validateGraph(g);
    expect(errors.filter((e) => e.includes("citation"))).toHaveLength(0);
    expect(groundedEvidenceRatio(g)).toBeGreaterThanOrEqual(0.66);
    expect(claimCoverageWithGroundedEvidence(g)).toBe(0.5); // c1 grounded, c2 not
  });

  it("uncited cited/strong evidence is flagged by validateGraph", () => {
    const g = sampleGrounded();
    g.nodes.push({ id: "e4", kind: "evidence", owner: "b", text: "Study shows risk.", round: 3, evidenceStrength: "cited" });
    const citationErrors = validateGraph(g).filter((e) => e.includes("citation") || e.includes("citations"));
    expect(citationErrors.length).toBeGreaterThan(0);
  });
});

describe("benchmark: judge invariance", () => {
  for (const fx of TRANSCRIPTS) {
    it(`${fx.id}: mock judge agrees with expected winner`, () => {
      const v = mockJudge(fx.transcript);
      expect(v.winner).toBe(fx.expectedWinner);
    });

    it(`${fx.id}: swapping Player A/B labels inverts the winner`, () => {
      const v0 = mockJudge(fx.transcript);
      const swapped = swapPlayerLabels(fx.transcript);
      const v1 = mockJudge(swapped);
      // Swapped labels should invert a/b; tie stays tie.
      const expectedSwapped = v0.winner === "a" ? "b" : v0.winner === "b" ? "a" : "tie";
      expect(v1.winner).toBe(expectedSwapped);
    });

    it(`${fx.id}: whitespace normalization does not flip the winner`, () => {
      const v0 = mockJudge(fx.transcript);
      const v1 = mockJudge(normalizeTranscript(fx.transcript));
      expect(v1.winner).toBe(v0.winner);
      // Scores should be identical — no variance from formatting alone.
      expect(Math.abs(v1.playerAScore - v0.playerAScore)).toBeLessThanOrEqual(0);
      expect(Math.abs(v1.playerBScore - v0.playerBScore)).toBeLessThanOrEqual(0);
    });
  }

  it("tie is stable under label swap (no spurious flip)", () => {
    const tieTx = [
      "Player A (round 1): I think balance matters.",
      "Player B (round 1): I also think balance matters, similarly.",
      "Player A (round 2): Both sides have points.",
      "Player B (round 2): Indeed, both sides have points.",
    ].join("\n");
    const v0 = mockJudge(tieTx);
    expect(v0.winner).toBe("tie");
    const v1 = mockJudge(swapPlayerLabels(tieTx));
    expect(v1.winner).toBe("tie");
  });
});
