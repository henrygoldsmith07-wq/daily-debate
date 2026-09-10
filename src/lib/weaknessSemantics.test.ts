import { describe, expect, it } from "vitest";
import { assessArgumentGraph } from "./observableAssessment";
import { countWeaknessesForSide } from "./repairEffectiveness";
import { extractSkillPoint } from "./skillLedger";
import { snapshotFromAssessment } from "./coachingGoal";
import { buildResultSnapshot } from "./resultSnapshot";
import type { ArgGraph, Owner } from "./argGraph";

/**
 * ADVERSARIAL WEAKNESS SEMANTICS.
 *
 * DroppedArgument.owner is the side whose argument went unanswered — i.e. the
 * side that INTRODUCED it. The failure belongs to the OTHER side (the one
 * that never answered). Every fixture below exists as an owner-swapped pair:
 * a genuine user failure must count, and the mirrored opponent behaviour must
 * never count as the user's failure.
 */

const NOW = "2026-06-15T12:00:00Z";

function baseGraph(): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "User claim one.", round: 1 },
      { id: "c2", kind: "claim", owner: "a", text: "User claim two.", round: 2 },
      { id: "o1", kind: "claim", owner: "ai", text: "Opponent claim one.", round: 1 },
      { id: "o2", kind: "claim", owner: "ai", text: "Opponent claim two.", round: 2 },
      { id: "i1", kind: "impact", owner: "a", text: "User impact.", round: 2 },
    ],
    edges: [],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: 0,
      byOwner: { a: 0, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 },
      unsupportedClaimIds: [],
    },
    impactComparison: null,
  };
}

function assess(graph: ArgGraph) {
  return assessArgumentGraph(graph, {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

describe("evidence: unsupported own claims count; opponent's never do", () => {
  it("counts the user's own unsupported claims", () => {
    const g = baseGraph();
    g.evidenceStats.unsupportedClaimIds = ["c1"];
    expect(countWeaknessesForSide(g, "a").evidence).toBe(1);
  });

  it("ignores the opponent's unsupported claims", () => {
    const g = baseGraph();
    g.evidenceStats.unsupportedClaimIds = ["o1", "o2"];
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.evidence).toBe(0);
    // Mirrored: they are the opponent's weakness when the sides swap.
    expect(countWeaknessesForSide(g, "ai").evidence).toBe(2);
  });
});

describe("rebuttal: only opponent arguments the user ignored count", () => {
  const drop = (owner: Owner, nodeId = "o1") => ({
    nodeId,
    text: "ignored",
    owner,
    round: 1,
  });

  // A fully-answered graph: every AI claim has a user rebuttal targeting it,
  // every user claim has an AI rebuttal targeting it — so deterministic
  // enrichment adds no extra drops and only the manual entries remain.
  // User claims carry grounded evidence so the evidence branch stays out.
  const answeredGraph = (): ArgGraph => {
    const g = baseGraph();
    g.nodes.push(
      { id: "r1", kind: "rebuttal", owner: "a", text: "User rebuttal one.", round: 2, targets: ["o1"] },
      { id: "r2", kind: "rebuttal", owner: "a", text: "User rebuttal two.", round: 2, targets: ["o2"] },
      { id: "ar1", kind: "rebuttal", owner: "ai", text: "AI rebuttal one.", round: 2, targets: ["c1"] },
      { id: "ar2", kind: "rebuttal", owner: "ai", text: "AI rebuttal two.", round: 2, targets: ["c2"] },
      { id: "e1", kind: "evidence", owner: "a", text: "NREL data supports claim one.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
      { id: "e2", kind: "evidence", owner: "a", text: "Pew data supports claim two.", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "Pew", homepage: "https://www.pewresearch.org" }] },
    );
    g.edges.push(
      { from: "e1", to: "c1", relation: "supports" },
      { from: "e2", to: "c2", relation: "supports" },
    );
    return g;
  };

  it("counts opponent claims the user never answered", () => {
    const g = answeredGraph();
    // Structural reality: remove the user's rebuttals. o1 (round 1) becomes
    // an unanswered eligible opportunity; o2 (round 2) has no LATER user
    // node (the last user move is round 2), so it is not answerable and must
    // not count — the canonical eligibility rule protects the user here.
    g.nodes = g.nodes.filter((n) => !(n.kind === "rebuttal" && n.owner === "a"));
    g.dropped = [drop("ai", "o1"), drop("ai", "o2")];
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBe(1);
    expect(counts.rebuttal).toBe(1);
  });

  it("never counts the user's own ignored claims as a user failure", () => {
    const g = answeredGraph();
    g.dropped = [drop("a", "c1")];
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBe(0);
    expect(counts.rebuttal).toBe(0);
    // Mirrored: they are the opponent's rebuttal failure. The answeredGraph
    // has ai rebuttals (ar1/ar2, round 2) answering c1/c2 (round 1), so the
    // canonical set is empty for "ai" too — a judge-supplied row for the
    // user's ignored claim cannot invent the opponent's failure either.
    expect(countWeaknessesForSide(g, "ai").dropped).toBe(0);
    // Remove the ai answers and the mirrored failure appears structurally —
    // but only c1 (round 1) is eligible for "ai" (later ai node at round 2);
    // c2 (round 2) has no later ai node and cannot count.
    const unansweredForAi = answeredGraph();
    unansweredForAi.nodes = unansweredForAi.nodes.filter((n) => !(n.kind === "rebuttal" && n.owner === "ai"));
    expect(countWeaknessesForSide(unansweredForAi, "ai").dropped).toBe(1);
    expect(countWeaknessesForSide(unansweredForAi, "ai").rebuttal).toBe(1);
  });

  it("skill ledger droppedArguments follow the same direction", () => {
    // Unanswered eligible opportunity for the user (structural) → ledger 1.
    const ignored = answeredGraph();
    ignored.nodes = ignored.nodes.filter((n) => !(n.kind === "rebuttal" && n.owner === "a"));
    expect(extractSkillPoint("d1", NOW, assess(ignored), "a").metrics.droppedArguments).toBe(1);

    // The user's own ignored claims never register for the user.
    const ignoredByOpponent = answeredGraph();
    ignoredByOpponent.dropped = [drop("a", "c1")];
    expect(extractSkillPoint("d2", NOW, assess(ignoredByOpponent), "a").metrics.droppedArguments).toBe(0);
  });

  it("coaching snapshot droppedOwn follows the same direction", () => {
    const ignored = answeredGraph();
    ignored.nodes = ignored.nodes.filter((n) => !(n.kind === "rebuttal" && n.owner === "a"));
    expect(snapshotFromAssessment(assess(ignored))?.droppedOwn).toBe(1);

    const ignoredByOpponent = answeredGraph();
    ignoredByOpponent.dropped = [drop("a", "c1")];
    expect(snapshotFromAssessment(assess(ignoredByOpponent))?.droppedOwn).toBe(0);
  });

  it("result screen blames the right side", () => {
    const ignored = answeredGraph();
    ignored.nodes = ignored.nodes.filter((n) => !(n.kind === "rebuttal" && n.owner === "a"));
    ignored.dropped = [drop("ai", "o1"), drop("ai", "o2")];
    const story = buildResultSnapshot(assess(ignored), { format: "full" });
    expect(story.weakness?.kind).toBe("rebuttal");
    // o1 is the one answerable miss (o2 has no later user turn).
    expect(story.weakness?.headline).toMatch(/1 opposing argument went unanswered/);

    const ignoredByOpponent = answeredGraph();
    ignoredByOpponent.dropped = [drop("a", "c1")];
    const quiet = buildResultSnapshot(assess(ignoredByOpponent), { format: "full" });
    // No unanswered opponent moves and no other miss: rebuttal must not appear.
    expect(quiet.weakness?.kind).not.toBe("rebuttal");
    expect(quiet.weakness?.headline ?? "").not.toMatch(/went unanswered/);
  });
});

describe("logic: only the user's own fallacies count", () => {
  const tag = (nodeId: string) => ({ nodeId, fallacy: "strawman" as const, note: "x" });

  it("counts fallacies on the user's own nodes", () => {
    const g = baseGraph();
    g.fallacies = [tag("c1")];
    expect(countWeaknessesForSide(g, "a").logic).toBe(1);
  });

  it("ignores fallacies on opponent nodes", () => {
    const g = baseGraph();
    g.fallacies = [tag("o1")];
    expect(countWeaknessesForSide(g, "a").logic).toBe(0);
    expect(countWeaknessesForSide(g, "ai").logic).toBe(1);
  });
});

describe("impact: missing own impact move counts; opponent's never does", () => {
  it("flags a debate where the user made no impact move", () => {
    const g = baseGraph();
    g.nodes = g.nodes.filter((n) => !(n.kind === "impact" && n.owner === "a"));
    expect(countWeaknessesForSide(g, "a").impact).toBe(1);
  });

  it("stays quiet when the user made one, even if the opponent made none", () => {
    expect(countWeaknessesForSide(baseGraph(), "a").impact).toBe(0);
    // Mirrored: the opponent's empty impact record is their weakness.
    expect(countWeaknessesForSide(baseGraph(), "ai").impact).toBe(1);
  });
});

describe("structure: only the user's own contradictions count", () => {
  it("counts the user's self-contradictions", () => {
    const g = baseGraph();
    g.contradictions = [{ a: "c1", b: "c2", explanation: "x", owner: "a" }];
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.contradiction).toBe(1);
  });

  it("ignores the opponent's contradictions", () => {
    const g = baseGraph();
    g.contradictions = [{ a: "o1", b: "o2", explanation: "x", owner: "ai" }];
    expect(countWeaknessesForSide(g, "a").contradiction).toBe(0);
  });
});

describe("clarity: unmeasurable in every direction", () => {
  it("stays zero regardless of graph content", () => {
    expect(countWeaknessesForSide(baseGraph(), "a").clarity).toBe(0);
    expect(countWeaknessesForSide(baseGraph(), "ai").clarity).toBe(0);
  });
});
