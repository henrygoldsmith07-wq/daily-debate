import { describe, it, expect } from "vitest";
import {
  extractQuotes,
  normalizeText,
  quoteMatchScore,
  verifyQuote,
  verifyEvidenceQuotes,
  evidenceQualityScore,
  claimMatchScore,
  claimSourceMatch,
} from "./quoteVerification";
import { sourceDateCheck } from "./citationVerifier";
import { graphEvidenceReport } from "./evidenceVerification";
import type { ArgGraph } from "./argGraph";

const LAZARD_TEXT = "Lazard's 2024 Levelized Cost of Energy report finds solar is the cheapest new-build electricity source at $24 per megawatt-hour.";

describe("quote extraction", () => {
  it("pulls double-quoted and guillemet spans", () => {
    expect(extractQuotes('She claimed solar is "the cheapest new-build source" and cited «Lazard 2024».')).toEqual([
      "the cheapest new-build source",
      "Lazard 2024",
    ]);
  });

  it("ignores apostrophes and short spans", () => {
    expect(extractQuotes("It's not 'cheap' — \"ok\"").length).toBe(0);
  });

  it("normalizeText strips punctuation and case", () => {
    expect(normalizeText('Solar, "the" CHEAPEST — new-build!')).toBe("solar the cheapest new-build");
  });
});

describe("verifyQuote", () => {
  it("verified: verbatim quote modulo case/punctuation", () => {
    const r = verifyQuote("solar is the cheapest new-build electricity source", LAZARD_TEXT);
    expect(r.status).toBe("verified");
    expect(r.score).toBe(1);
  });

  it("paraphrase: close but not verbatim", () => {
    const r = verifyQuote("Solar remains the cheapest new-build electricity source according to the report", LAZARD_TEXT);
    expect(r.status).toBe("paraphrase");
    expect(r.score).toBeGreaterThanOrEqual(0.75);
  });

  it("misquoted: deviates substantially", () => {
    const r = verifyQuote("Solar may be the cheapest source in some regions", LAZARD_TEXT);
    expect(r.status).toBe("misquoted");
    expect(r.score).toBeGreaterThanOrEqual(0.4);
    expect(r.score).toBeLessThan(0.75);
  });

  it("fabricated: not in the source at all", () => {
    const r = verifyQuote("Coal dominates every grid and nuclear is unviable", LAZARD_TEXT);
    expect(r.status).toBe("fabricated");
    expect(r.score).toBeLessThan(0.4);
  });

  it("unverifiable without source text", () => {
    const r = verifyQuote("any quote at all", null);
    expect(r.status).toBe("unverifiable");
    expect(r.sourceTextPresent).toBe(false);
  });

  it("quoteMatchScore measures token overlap", () => {
    expect(quoteMatchScore("solar cheapest source", "solar is the cheapest source")).toBeCloseTo(1);
    expect(quoteMatchScore("nuclear baseload mandatory", LAZARD_TEXT)).toBe(0);
  });
});

describe("verifyEvidenceQuotes", () => {
  const citations = [
    { sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: LAZARD_TEXT },
  ];

  it("verified quote against a cited excerpt", () => {
    const rep = verifyEvidenceQuotes('Lazard finds solar is "the cheapest new-build electricity source".', citations);
    expect(rep.total).toBe(1);
    expect(rep.verifiedCount).toBe(1);
    expect(rep.issues).toHaveLength(0);
    expect(rep.fidelity).toBe(1);
  });

  it("flags fabricated quotes, best source wins", () => {
    const rep = verifyEvidenceQuotes('The judge said "coal dominates every grid and nuclear is unviable" but the source says otherwise.', citations);
    expect(rep.fabricated).toHaveLength(1);
    expect(rep.worstStatus).toBe("fabricated");
    expect(rep.fidelity).toBeLessThan(0.4);
  });

  it("no quotes in evidence text is not an issue", () => {
    const rep = verifyEvidenceQuotes("Solar is cheapest with storage.", citations);
    expect(rep.total).toBe(0);
    expect(rep.worstStatus).toBe("verified");
    expect(rep.fidelity).toBe(1);
  });

  it("unverifiable when citation carries no excerpt", () => {
    const rep = verifyEvidenceQuotes('"Cheapest new build" per Lazard.', [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }]);
    expect(rep.quotes[0].status).toBe("unverifiable");
    expect(rep.fidelity).toBeLessThan(1);
  });
});

describe("claim-to-source matching", () => {
  const sources = [{ sourceName: "Lazard", excerpt: LAZARD_TEXT }];

  it("claimMatchScore measures content-token overlap", () => {
    expect(claimMatchScore("Solar is the cheapest new-build electricity source", LAZARD_TEXT)).toBeCloseTo(1);
    expect(claimMatchScore("Coal dominates every grid and nuclear is unviable", LAZARD_TEXT)).toBe(0);
  });

  it("supported: claim content appears in the cited excerpt", () => {
    const m = claimSourceMatch("Solar is the cheapest new-build electricity source", sources);
    expect(m.status).toBe("supported");
    expect(m.bestSource).toBe("Lazard");
  });

  it("weak: only partial overlap — a source-name mention alone is not support", () => {
    const m = claimSourceMatch("Lazard is wrong about everything", sources);
    expect(m.status).toBe("weak");
  });

  it("mismatched: claim content absent from the cited source", () => {
    const m = claimSourceMatch("Coal dominates every grid and nuclear is unviable", sources);
    expect(m.status).toBe("mismatched");
    expect(m.score).toBeLessThan(0.25);
    expect(m.reason).toContain("does not appear");
  });

  it("unverifiable without excerpts — a flag, not a violation", () => {
    const m = claimSourceMatch("Any claim at all", [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }]);
    expect(m.status).toBe("unverifiable");
    expect(m.bestSource).toBeNull();
  });

  it("best source wins when multiple citations carry excerpts", () => {
    const m = claimSourceMatch("Solar is the cheapest new-build electricity source", [
      { sourceName: "A blog", excerpt: "Nuclear is expensive." },
      { sourceName: "Lazard", excerpt: LAZARD_TEXT },
    ]);
    expect(m.status).toBe("supported");
    expect(m.bestSource).toBe("Lazard");
  });
});

describe("evidenceQualityScore — quote + date dimensions", () => {
  it("tier-1 source, verified quote, fresh date => high score", () => {
    const q = evidenceQualityScore({
      sourceName: "Lazard",
      evidenceText: 'Lazard finds solar is "the cheapest new-build electricity source".',
      excerpt: LAZARD_TEXT,
      dateCheck: sourceDateCheck("The 2024 Lazard report shows…", { nowYear: 2026, maxAgeYears: 5 }),
    });
    expect(q.source).toBeGreaterThan(0.9);
    expect(q.quote).toBe(1);
    expect(q.date).toBe(1);
    expect(q.score).toBeGreaterThan(0.9);
    expect(q.flags).toHaveLength(0);
  });

  it("fabricated quote craters the score and adds a flag", () => {
    const q = evidenceQualityScore({
      sourceName: "Lazard",
      evidenceText: 'As Lazard proves, "coal dominates every grid and nuclear is unviable".',
      excerpt: LAZARD_TEXT,
    });
    expect(q.quote).toBeLessThan(0.4);
    expect(q.flags.some((f) => f.includes("fabricated quote"))).toBe(true);
    expect(q.score).toBeLessThan(0.65);
  });

  it("stale date docks the date dimension and flags", () => {
    const q = evidenceQualityScore({
      sourceName: "Lazard",
      evidenceText: 'Lazard finds solar is "the cheapest new-build electricity source".',
      excerpt: LAZARD_TEXT,
      dateCheck: sourceDateCheck("Published in 2010, this study shows…", { nowYear: 2026, maxAgeYears: 5 }),
    });
    expect(q.date).toBe(0.3);
    expect(q.flags).toContain("outdated source");
  });
});

describe("graph evidence report surfaces quote issues", () => {
  function graphWithQuote(evidenceText: string, excerpt: string): ArgGraph {
    return {
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Solar wins on cost.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: evidenceText, round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt }] },
      ],
      edges: [{ from: "e1", to: "c1", relation: "supports" }],
      dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
      impactComparison: null,
    };
  }

  it("fabricated quote counts as an issue and docks the score", () => {
    const rep = graphEvidenceReport(graphWithQuote('Lazard proves "coal dominates every grid and nuclear is unviable".', LAZARD_TEXT));
    expect(rep.fabricatedQuoteCount).toBe(1);
    expect(rep.quoteIssueCount).toBe(1);
    expect(rep.links.some((l) => l.flags.some((f) => f.includes("fabricated quote")))).toBe(true);
  });

  it("clean quoted evidence adds no issues", () => {
    const rep = graphEvidenceReport(graphWithQuote('Lazard finds solar is "the cheapest new-build electricity source".', LAZARD_TEXT));
    expect(rep.fabricatedQuoteCount).toBe(0);
    expect(rep.quoteIssueCount).toBe(0);
  });
});
