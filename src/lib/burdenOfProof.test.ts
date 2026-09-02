import { describe, it, expect } from "vitest";
import type { ArgGraph, ArgNode, ArgEdge } from "./argGraph";
import { emptyGraph } from "./argGraph";
import {
  assessClaim,
  burdenReport,
  classifyBurden,
  findImproperShifts,
} from "./burdenOfProof";

const node = (over: Partial<ArgNode> & Pick<ArgNode, "id" | "kind" | "owner" | "text">): ArgNode => ({
  round: 1,
  ...over,
});

function graphOf(nodes: ArgNode[], edges: ArgEdge[] = []): ArgGraph {
  return { ...emptyGraph(), nodes, edges };
}

describe("classifyBurden — the claim's own logical form", () => {
  it("reads an unhedged universal as the heaviest burden", () => {
    const b = classifyBurden("Social media always harms teenagers");
    expect(b.kind).toBe("universal");
    expect(b.level).toBe("heavy");
    expect(b.reasons[0]).toMatch(/single counterexample/);
  });

  it("does not treat a hedged claim as universal", () => {
    // "some ... never" is not a claim about every case.
    const b = classifyBurden("Some teenagers never check their phones at night");
    expect(b.kind).not.toBe("universal");
    expect(b.level).not.toBe("heavy");
  });

  it("reads a normative claim as heavy, and says why", () => {
    const b = classifyBurden("We should ban phones in schools");
    expect(b.kind).toBe("normative");
    expect(b.level).toBe("heavy");
    expect(b.reasons[0]).toMatch(/value premise/);
  });

  it("keeps normative above causal when a claim is both", () => {
    // Proving the causal half would not discharge the "should".
    const b = classifyBurden("We should ban phones because they cause anxiety");
    expect(b.kind).toBe("normative");
    expect(b.reasons.some((r) => /causal/.test(r))).toBe(true);
  });

  it("keeps universal above causal when a claim is both", () => {
    const b = classifyBurden("Screens always cause anxiety");
    expect(b.kind).toBe("universal");
    expect(b.reasons.some((r) => /causation/.test(r))).toBe(true);
  });

  it("reads an unhedged causal claim as heavy and a hedged one as moderate", () => {
    expect(classifyBurden("Remote work causes loneliness").level).toBe("heavy");
    const hedged = classifyBurden("Remote work can cause loneliness for some people");
    expect(hedged.kind).toBe("causal");
    expect(hedged.level).toBe("moderate");
  });

  it("separates an association from a cause", () => {
    const b = classifyBurden("Screen time is associated with poorer sleep");
    expect(b.kind).toBe("descriptive");
    expect(b.level).toBe("moderate");
    expect(b.reasons[0]).toMatch(/asserts an association .* rather than a cause/);
  });

  it("reads an existence claim as light", () => {
    const b = classifyBurden("There are cases where remote work improved output");
    expect(b.kind).toBe("existential");
    expect(b.level).toBe("light");
    expect(b.reasons[0]).toMatch(/one example discharges it/);
  });

  it("falls back to a moderate descriptive claim rather than guessing", () => {
    const b = classifyBurden("The policy was introduced in 2019");
    expect(b.kind).toBe("descriptive");
    expect(b.level).toBe("moderate");
  });

  it("handles empty and missing text", () => {
    expect(classifyBurden("").kind).toBe("descriptive");
    expect(classifyBurden(undefined as unknown as string).level).toBe("moderate");
  });
});

describe("assessClaim — was the burden discharged", () => {
  const claim = (text: string) => node({ id: "c1", kind: "claim", owner: "a", text });
  const evidence = (id: string, over: Partial<ArgNode> = {}) =>
    node({ id, kind: "evidence", owner: "a", text: `evidence ${id}`, ...over });

  it("calls an unsupported claim unmet", () => {
    const g = graphOf([claim("Remote work causes loneliness")]);
    const result = assessClaim(g, g.nodes[0]);
    expect(result.verdict).toBe("unmet");
    expect(result.supportIds).toEqual([]);
    expect(result.explanation).toMatch(/No evidence supports/);
  });

  it("counts support regardless of the edge's direction", () => {
    const g = graphOf(
      [claim("There are cases where output rose"), evidence("e1")],
      [{ from: "c1", to: "e1", relation: "supports" }],
    );
    expect(assessClaim(g, g.nodes[0]).supportIds).toEqual(["e1"]);
  });

  it("settles a light claim with one piece of evidence", () => {
    const g = graphOf(
      [claim("There are cases where output rose"), evidence("e1")],
      [{ from: "e1", to: "c1", relation: "supports" }],
    );
    expect(assessClaim(g, g.nodes[0]).verdict).toBe("met");
  });

  it("does not let one anecdote settle a universal claim", () => {
    // The same single piece of evidence that settles the light claim above.
    const g = graphOf(
      [claim("Remote work always improves output"), evidence("e1")],
      [{ from: "e1", to: "c1", relation: "supports" }],
    );
    const result = assessClaim(g, g.nodes[0]);
    expect(result.level).toBe("heavy");
    expect(result.verdict).toBe("partially-met");
    expect(result.explanation).toMatch(/1 of the 2/);
  });

  it("holds a heavy claim to cited evidence, not just to volume", () => {
    const g = graphOf(
      [claim("Remote work always improves output"), evidence("e1"), evidence("e2")],
      [
        { from: "e1", to: "c1", relation: "supports" },
        { from: "e2", to: "c1", relation: "supports" },
      ],
    );
    const result = assessClaim(g, g.nodes[0]);
    expect(result.verdict).toBe("partially-met");
    expect(result.explanation).toMatch(/none of the 2 pieces carries a citation/);
  });

  it("accepts a heavy claim once its support is cited", () => {
    const g = graphOf(
      [
        claim("Remote work always improves output"),
        evidence("e1", { citations: [{ sourceName: "Some Institute" }] }),
        evidence("e2", { evidenceStrength: "cited" }),
      ],
      [
        { from: "e1", to: "c1", relation: "supports" },
        { from: "e2", to: "c1", relation: "supports" },
      ],
    );
    const result = assessClaim(g, g.nodes[0]);
    expect(result.citedSupport).toBe(2);
    expect(result.verdict).toBe("met");
  });

  it("ignores non-supporting edges and non-evidence nodes", () => {
    const g = graphOf(
      [claim("Remote work causes loneliness"), node({ id: "r1", kind: "rebuttal", owner: "b", text: "no" })],
      [{ from: "r1", to: "c1", relation: "rebuts" }],
    );
    expect(assessClaim(g, g.nodes[0]).verdict).toBe("unmet");
  });
});

describe("findImproperShifts — the distinction a phrase match cannot draw", () => {
  const shiftNode = (round: number, owner: "a" | "b") =>
    node({ id: `s${round}${owner}`, kind: "rebuttal", owner, text: "You must prove that is false", round });

  it("flags a demand for proof made behind the speaker's own unsupported claim", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output", round: 1 }),
      shiftNode(2, "a"),
    ]);
    const report = burdenReport(g);
    expect(report.shifts).toHaveLength(1);
    expect(report.improperShifts).toHaveLength(1);
    expect(report.improperShifts[0].unsupportedClaimId).toBe("c1");
    expect(report.improperShifts[0].explanation).toMatch(/does not discharge their burden/);
  });

  it("leaves a legitimate demand alone when the speaker met their own burden", () => {
    const g = graphOf(
      [
        node({ id: "c1", kind: "claim", owner: "a", text: "There are cases where output rose", round: 1 }),
        node({ id: "e1", kind: "evidence", owner: "a", text: "a study", round: 1 }),
        shiftNode(2, "a"),
      ],
      [{ from: "e1", to: "c1", relation: "supports" }],
    );
    const report = burdenReport(g);
    // The words were said, but nothing improper happened.
    expect(report.shifts).toHaveLength(1);
    expect(report.improperShifts).toHaveLength(0);
  });

  it("does not blame a speaker for the other side's unsupported claim", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "b", text: "Remote work always improves output", round: 1 }),
      shiftNode(2, "a"),
    ]);
    expect(burdenReport(g).improperShifts).toHaveLength(0);
  });

  it("ignores a claim made after the demand was issued", () => {
    const g = graphOf([
      shiftNode(1, "a"),
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output", round: 3 }),
    ]);
    expect(burdenReport(g).improperShifts).toHaveLength(0);
  });

  it("attaches the most recent unsupported claim when there are several", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output", round: 1 }),
      node({ id: "c2", kind: "claim", owner: "a", text: "Offices never work for anyone", round: 2 }),
      shiftNode(3, "a"),
    ]);
    const [improper] = burdenReport(g).improperShifts;
    expect(improper.unsupportedClaimId).toBe("c2");
  });

  it("returns nothing when no demand was made", () => {
    const g = graphOf([node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output" })]);
    expect(findImproperShifts(g, burdenReport(g).claims)).toEqual([]);
  });
});

describe("burdenReport", () => {
  it("assesses counterclaims as well as claims", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work causes loneliness" }),
      node({ id: "cc1", kind: "counterclaim", owner: "b", text: "Offices always cause commuting stress" }),
    ]);
    const report = burdenReport(g);
    expect(report.claims.map((c) => c.nodeId).sort()).toEqual(["c1", "cc1"]);
    expect(report.byOwner.a.claims).toBe(1);
    expect(report.byOwner.b.heavy).toBe(1);
  });

  it("counts heavy, unmet and improper shifts per side", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output", round: 1 }),
      node({ id: "s1", kind: "rebuttal", owner: "a", text: "the burden is on you", round: 2 }),
    ]);
    const report = burdenReport(g);
    expect(report.byOwner.a).toEqual({ claims: 1, heavy: 1, unmet: 1, improperShifts: 1 });
  });

  it("summarises in one sentence naming the heavy failures", () => {
    const g = graphOf([
      node({ id: "c1", kind: "claim", owner: "a", text: "Remote work always improves output" }),
      node({ id: "c2", kind: "claim", owner: "b", text: "The policy started in 2019" }),
    ]);
    const report = burdenReport(g);
    expect(report.summary).toMatch(/2 claims assessed/);
    expect(report.summary).toMatch(/2 carried no support/);
    expect(report.summary).toMatch(/1 of those was a universal, causal or normative claim/);
  });

  it("says so plainly when every claim carried support", () => {
    const g = graphOf(
      [
        node({ id: "c1", kind: "claim", owner: "a", text: "There are cases where output rose" }),
        node({ id: "e1", kind: "evidence", owner: "a", text: "a study" }),
      ],
      [{ from: "e1", to: "c1", relation: "supports" }],
    );
    expect(burdenReport(g).summary).toMatch(/all carried some support/);
  });

  it("returns no summary for a graph with no claims", () => {
    expect(burdenReport(emptyGraph()).summary).toBeNull();
    expect(burdenReport(emptyGraph()).claims).toEqual([]);
  });

  it("is safe on a malformed graph", () => {
    const report = burdenReport({ nodes: [], edges: [] } as unknown as ArgGraph);
    expect(report.claims).toEqual([]);
    expect(report.summary).toBeNull();
  });
});
