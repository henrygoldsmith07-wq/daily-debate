import { describe, expect, it } from "vitest";
import type { ArgGraph, EvidenceCitation } from "./argGraph";
import { claimCitationMap, fetchedSourceFromRetrieved, graphEvidenceReport } from "./evidenceVerification";
import { stubRetrievedSource } from "./sourceRetrieval";

function graphWithCitation(claim: string, citation: EvidenceCitation): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", round: 1, text: claim },
      {
        id: "e1",
        kind: "evidence",
        owner: "a",
        round: 1,
        text: "Supporting evidence",
        evidenceStrength: "cited",
        citations: [citation],
      },
    ],
    edges: [{ from: "e1", to: "c1", relation: "supports" }],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: 1,
      byOwner: { a: 1, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 },
      unsupportedClaimIds: [],
    },
    impactComparison: null,
  };
}

describe("claimCitationMap support honesty", () => {
  it("does not turn a citation with no source text into positive support", () => {
    const graph = graphWithCitation(
      "Solar power reduces household electricity costs because generation has become cheaper.",
      { sourceName: "NREL", homepage: "https://www.nrel.gov" },
    );

    const [link] = claimCitationMap(graph);
    expect(link.support).toBe("unverified");
    expect(link.flags).toContain("claim-source support unverified — no source excerpt attached");
    expect(graphEvidenceReport(graph).coverage).toBe(0);
  });

  it("treats weak overlap as tangential rather than supported", () => {
    const graph = graphWithCitation(
      "Solar power reduces household electricity costs because generation has become cheaper.",
      {
        sourceName: "NREL",
        homepage: "https://www.nrel.gov",
        excerpt: "Solar generation costs declined.",
      },
    );

    const [link] = claimCitationMap(graph);
    expect(link.support).toBe("tangential");
    expect(link.flags.some((flag) => flag.startsWith("weak claim-source overlap"))).toBe(true);
    expect(graphEvidenceReport(graph).coverage).toBe(0);
  });

  it("does not let a matching excerpt override a mismatched source domain", () => {
    const graph = graphWithCitation(
      "Solar generation costs have become cheaper.",
      {
        sourceName: "NREL",
        homepage: "https://example.com",
        excerpt: "NREL reports that solar generation costs have become cheaper over time.",
      },
    );

    const [link] = claimCitationMap(graph);
    expect(link.support).toBe("unverified");
    expect(link.flags.some((flag) => flag.startsWith("source identity unverified"))).toBe(true);
    const report = graphEvidenceReport(graph);
    expect(report.coverage).toBe(0);
    expect(report.hallucinationCount).toBeGreaterThan(0);
  });

  it("reserves positive support for a substantively matching excerpt", () => {
    const graph = graphWithCitation(
      "Solar generation costs have become cheaper.",
      {
        sourceName: "NREL",
        homepage: "https://www.nrel.gov",
        excerpt: "NREL reports that solar generation costs have become cheaper over time.",
      },
    );

    const [link] = claimCitationMap(graph);
    expect(link.support).toBe("supports");
    expect(graphEvidenceReport(graph).coverage).toBe(1);
  });
});

describe("evidence verification retrieval adapter", () => {
  it("preserves retrieved metadata without inventing support", () => {
    const fetched = fetchedSourceFromRetrieved(stubRetrievedSource({
      url: "https://www.nrel.gov/research/example",
      title: "Example report",
      publisher: "NREL",
      publicationDate: "2025-04-01",
      excerpt: "NREL reports a measured decline in generation costs over the study period.",
      retrievalDate: "2026-09-26T08:00:00.000Z",
    }));

    expect(fetched.ok).toBe(true);
    expect(fetched.title).toBe("Example report");
    expect(fetched.snippet).toContain("measured decline");
    expect(fetched.fetchedAt).toBe("2026-09-26T08:00:00.000Z");
  });

  it("maps blocked/failed retrieval to a failed verification fetch", () => {
    const fetched = fetchedSourceFromRetrieved({
      url: "https://example.com/file.pdf",
      retrievalDate: "2026-09-26T08:00:00.000Z",
      sourceStatus: "blocked",
      failureStatus: "unsupported_content_type",
      failureDetails: "Content-Type: application/pdf",
      httpStatus: 200,
    });

    expect(fetched.ok).toBe(false);
    expect(fetched.error).toMatch(/unsupported_content_type/);
  });
});
