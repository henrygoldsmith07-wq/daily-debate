import { describe, it, expect } from "vitest";
import {
  detectCausalOverclaim,
  detectFakePrecision,
  scoreRebuttalQuality,
  scoreSteelmanQuality,
  engineReport,
  compareRebuttalAgainstEarlierArgument,
  buildDeterministicArgumentGraph,
} from "./argumentEvaluation";
import type { ArgGraph } from "./argGraph";
import { emptyGraph } from "./argGraph";
import type { ClassifiedArgument } from "./argumentTaxonomy";

describe("causal overclaim detection", () => {
  it("flags an unhedged causal claim with no evidence as high severity", () => {
    const r = detectCausalOverclaim("This policy will definitely eliminate unemployment.", []);
    expect(r.detected).toBe(true);
    expect(r.severity).toBe("high");
  });

  it("flags certainty language over associational evidence", () => {
    const r = detectCausalOverclaim("Remote work causes higher productivity.", [
      "The study suggests remote work is associated with small productivity gains.",
    ]);
    expect(r.detected).toBe(true);
    expect(r.severity).toBe("high");
    expect(r.reason).toMatch(/association/i);
  });

  it("passes hedged claims through untouched", () => {
    const r = detectCausalOverclaim("This policy may reduce congestion in some cases.", [
      "Pilot data indicates a reduction of about 4%.",
    ]);
    expect(r.detected).toBe(false);
  });

  it("gives moderate severity when the evidence itself makes a causal finding", () => {
    const r = detectCausalOverclaim("The tax causes slower growth.", [
      "Our regression finds the tax leads to measurably lower investment.",
    ]);
    expect(r.detected).toBe(true);
    expect(r.severity).toBe("moderate");
  });
});

describe("fake-precision detection", () => {
  it("flags unsourced decimal-exact figures", () => {
    const hits = detectFakePrecision("Unemployment fell to exactly 3.42% last quarter.");
    expect(hits).toHaveLength(1);
    expect(hits[0].sourced).toBe(false);
    expect(hits[0].match).toContain("3.42%");
  });

  it("spares figures near source cues and whole numbers", () => {
    const sourced = detectFakePrecision("According to BLS data, unemployment was 3.42%.");
    expect(sourced.every((h) => h.sourced)).toBe(true);
    expect(detectFakePrecision("Roughly one in five workers agrees.")).toHaveLength(0);
  });
});

describe("rebuttal quality scoring", () => {
  function graphWith(rebuttal: Record<string, unknown>, targetKind: "claim" | "counterclaim" = "counterclaim"): ArgGraph {
    return {
      ...emptyGraph(),
      nodes: [
        { id: "opp-c1", kind: targetKind, owner: "b", text: "Opponent's strongest point.", round: 1 },
        { id: "my-e1", kind: "evidence", owner: "a", text: "Lazard 2024 LCOE analysis.", round: 2 },
        {
          id: "r1",
          kind: "rebuttal",
          owner: "a",
          text: "Even granting that cost point, according to NREL storage data the trend reverses by 2035, which addresses the counterclaim directly.",
          round: 2,
          targets: ["opp-c1"],
          ...rebuttal,
        } as never,
      ],
      edges: [{ from: "my-e1", to: "r1", relation: "supports" }],
    };
  }

  it("rewards targeted, evidence-backed rebuttals over bare restatements", () => {
    const strong = scoreRebuttalQuality(graphWith({}), "a")!;
    const weak = scoreRebuttalQuality(
      graphWith({ targets: [], text: "No." }),
      "a",
    )!;
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.coverage).toBe(1);
    expect(weak.coverage).toBe(0);
  });

  it("reserves strong-material credit for valid counterclaim targets", () => {
    const counterclaim = scoreRebuttalQuality(graphWith({}, "counterclaim"), "a")!;
    const claim = scoreRebuttalQuality(graphWith({}, "claim"), "a")!;
    expect(counterclaim.coverage).toBe(1);
    expect(counterclaim.engagesStrongMaterial).toBe(1);
    expect(claim.coverage).toBe(1);
    expect(claim.engagesStrongMaterial).toBe(0);
  });
});

describe("steelman quality scoring", () => {
  it("credits steelman markers and concessions, penalises strawmen", () => {
    const base = {
      ...emptyGraph(),
      nodes: [
        { id: "o1", kind: "counterclaim" as const, owner: "b" as const, text: "Grid costs rise faster than storage can offset.", round: 1 },
        { id: "c1", kind: "claim" as const, owner: "a" as const, text: "Even if grid costs rise, the strongest version of their argument fails on storage trends.", round: 2 },
      ],
      concessions: [{ nodeId: "c1", by: "a" as const, note: "grants the cost premise" }],
      fallacies: [],
    };
    const good = scoreSteelmanQuality(base, "a");
    expect(good.score).toBeGreaterThan(0.5);

    const strawman = {
      ...base,
      fallacies: [{ nodeId: "c1", fallacy: "strawman" as const, note: "" }],
    };
    expect(scoreSteelmanQuality(strawman, "a").score).toBeLessThan(good.score);
  });

  it("does not credit generic steelman phrases with no opponent engagement", () => {
    const gamed = {
      ...emptyGraph(),
      nodes: [
        { id: "o1", kind: "counterclaim" as const, owner: "b" as const, text: "Zoning reform increases housing supply near transit.", round: 1 },
        { id: "c1", kind: "claim" as const, owner: "a" as const, text: "To be fair, this is complex.", round: 2 },
        { id: "c2", kind: "claim" as const, owner: "a" as const, text: "Admittedly, there are trade-offs.", round: 2 },
        { id: "c3", kind: "claim" as const, owner: "a" as const, text: "The strongest version deserves consideration.", round: 3 },
      ],
      concessions: [],
      fallacies: [],
    };
    const gamedScore = scoreSteelmanQuality(gamed, "a");
    expect(gamedScore.markers).toBe(0);
    expect(gamedScore.score).toBe(0);
  });
});

describe("engineReport aggregate", () => {
  it("attributes findings to sides across a full debate graph", () => {
    const g: ArgGraph = {
      ...emptyGraph(),
      nodes: [
        { id: "ca1", kind: "claim", owner: "a", text: "This plan guarantees savings of exactly 12.34% per household.", round: 1 },
        { id: "cb1", kind: "claim", owner: "b", text: "Costs may shift between regions.", round: 1 },
        { id: "rb1", kind: "rebuttal", owner: "b", text: "That guarantee ignores regional variation.", round: 2, targets: ["ca1"] },
      ],
      edges: [],
    };
    const report = engineReport(g, { a: "a", b: "b" });
    expect(report.a.causalOverclaims).toBeGreaterThanOrEqual(1);
    expect(report.a.unsourcedPrecisionHits).toBeGreaterThanOrEqual(1);
    expect(report.b.rebuttalQuality).not.toBeNull();
    expect(report.b.rebuttalQuality!.coverage).toBe(1);
    expect(report.a.rebuttalQuality).toBeNull();
  });
});

describe("structural specialist checks", () => {
  it("compares a rebuttal with earlier opposing vocabulary, not viewpoint correctness", () => {
    const comparison = compareRebuttalAgainstEarlierArgument(
      { id: "a2", owner: "a", round: 2, text: "However, the grid-upgrade cost remains material." },
      [{ id: "b1", owner: "b", round: 1, text: "Grid upgrades are the main cost risk." }],
    );
    expect(comparison.targetArgumentId).toBe("b1");
    expect(comparison.addressed).toBe(true);
  });

  it("builds evidence and rebuttal structure conservatively from mixed labels", () => {
    const item = (id: string, owner: "a" | "b", round: number, text: string, labels: ClassifiedArgument["classification"]["labels"]): ClassifiedArgument => ({
      id,
      owner,
      round,
      text,
      classification: {
        index: round,
        text,
        labels,
        scores: Object.fromEntries(labels.map((label) => [label, 0.9])),
        primaryRole: labels[0],
        confidence: 0.9,
        status: "high_confidence",
        source: "classifier.dev",
      },
    });
    const graph = buildDeterministicArgumentGraph([
      item("a1", "a", 1, "The plan lowers cost according to NREL data https://www.nrel.gov.", ["claim", "evidence", "reasoning"]),
      item("b1", "b", 1, "The plan creates a reliability risk.", ["claim"]),
      item("a2", "a", 2, "However, that reliability objection ignores the measured trend.", ["rebuttal"]),
    ]);
    expect(graph.nodes.some((node) => node.kind === "evidence" && node.citations?.[0]?.sourceName === "NREL")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "rebuttal" && node.targets?.length === 1)).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "rebuts")).toBe(true);
    expect(graph.evidenceStats.total).toBe(1);
  });
});
