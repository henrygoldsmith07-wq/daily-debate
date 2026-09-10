import { describe, expect, it } from "vitest";
import {
  eligibleOpponentMoves,
  isValidRebuttalTarget,
  rebuttalCoverageFor,
  userAnsweredIds,
} from "./opportunity";
import { scoreRebuttalQuality } from "./argumentEvaluation";
import { extractSkillPoint } from "./skillLedger";
import { measureDimension, REWARDED_OWNER } from "./coachRewards";
import { countWeaknessesForSide } from "./repairEffectiveness";
import { assessArgumentGraph } from "./observableAssessment";
import { emptyGraph, type ArgGraph, type ArgNode, type Owner } from "./argGraph";

/**
 * ADVERSARIAL REBUTTAL-TARGET SEMANTICS.
 *
 * One canonical rule (isValidRebuttalTarget) decides what counts as a
 * legitimate answer: the target must exist, belong to the opponent, be a
 * rebuttable kind, and predate the response. Every fixture below proves a
 * malformed graph cannot inflate rebuttal metrics, rewards, targeting
 * quality, weakness counts or the result story — across solo ("ai") and
 * PvP ("b") opponent shapes, and truncated debates.
 */

const AT = "2026-06-15T12:00:00Z";

interface FixtureSpec {
  opponentOwner?: Owner;
  /** Extra nodes appended after the base cast. */
  nodes?: ArgNode[];
  /** Extra edges appended after the base cast. */
  edges?: ArgGraph["edges"];
  /** Override the default rebuttal node (omit to add none). */
  rebuttal?: Partial<ArgNode> | null;
  /** Extra manual dropped entries. */
  dropped?: ArgGraph["dropped"];
}

/**
 * Base cast: a two-sided debate where the user has one claim and the
 * opponent has one round-1 claim — a genuine answerable opportunity.
 */
function graph(spec: FixtureSpec = {}): ArgGraph {
  const opponent: Owner = spec.opponentOwner ?? "ai";
  const g: ArgGraph = { ...emptyGraph(), nodes: [], edges: [] };
  g.nodes.push({ id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 });
  g.nodes.push({ id: "o1", kind: "claim", owner: opponent, text: "Opponent claim.", round: 1 });
  g.nodes.push({ id: "c2", kind: "claim", owner: "a", text: "Later user claim.", round: 3 });
  if (spec.rebuttal !== null) {
    g.nodes.push({
      id: "r1",
      kind: "rebuttal",
      owner: "a",
      text: "User response to the opponent claim.",
      round: 2,
      targets: ["o1"],
      ...(spec.rebuttal ?? {}),
    });
  }
  if (spec.nodes) g.nodes.push(...spec.nodes);
  if (spec.edges) g.edges.push(...spec.edges);
  if (spec.dropped) g.dropped.push(...spec.dropped);
  return g;
}

function assess(g: ArgGraph, opponent: Owner = "ai") {
  return assessArgumentGraph(g, {
    sideA: "a",
    sideB: opponent,
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "Opponent",
  });
}

describe("isValidRebuttalTarget: the one canonical rule", () => {
  it("accepts a correct opponent target", () => {
    const g = graph();
    expect(isValidRebuttalTarget(g, "o1", "a", 2)).toBe(true);
  });

  it("rejects a self-target", () => {
    const g = graph();
    expect(isValidRebuttalTarget(g, "c1", "a", 2)).toBe(false);
  });

  it("rejects a future target (response round before target round)", () => {
    const g = graph();
    g.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Later target.", round: 3 });
    expect(isValidRebuttalTarget(g, "o2", "a", 2)).toBe(false);
  });

  it("rejects a same-round target", () => {
    const g = graph();
    g.nodes.push({ id: "o3", kind: "claim", owner: "ai", text: "Same round.", round: 2 });
    expect(isValidRebuttalTarget(g, "o3", "a", 2)).toBe(false);
  });

  it("rejects an unknown/dangling id", () => {
    const g = graph();
    expect(isValidRebuttalTarget(g, "ghost", "a", 2)).toBe(false);
  });

  it("rejects non-rebuttable kinds (evidence)", () => {
    const g = graph();
    g.nodes.push({ id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 1 });
    expect(isValidRebuttalTarget(g, "oe1", "a", 2)).toBe(false);
  });

  it("rejects a rebuttal node as a target", () => {
    const g = graph();
    g.nodes.push({ id: "or1", kind: "rebuttal", owner: "ai", text: "Opponent rebuttal.", round: 1 });
    expect(isValidRebuttalTarget(g, "or1", "a", 2)).toBe(false);
  });

  it("accepts impact and counterclaim as rebuttable kinds", () => {
    const g = graph();
    g.nodes.push({ id: "oi1", kind: "impact", owner: "ai", text: "Opponent impact.", round: 1 });
    g.nodes.push({ id: "ok1", kind: "counterclaim", owner: "ai", text: "Opponent counterclaim.", round: 1 });
    expect(isValidRebuttalTarget(g, "oi1", "a", 2)).toBe(true);
    expect(isValidRebuttalTarget(g, "ok1", "a", 2)).toBe(true);
  });

  it("treats every non-responder owner as the opponent (PvP b and solo ai)", () => {
    const g = graph({ opponentOwner: "b" });
    expect(isValidRebuttalTarget(g, "o1", "a", 2)).toBe(true);
    // And mirrored: the b side answering the a side's claim.
    expect(isValidRebuttalTarget(g, "c1", "b", 3)).toBe(true);
  });
});

describe("userAnsweredIds: chronology enforced on every answer channel", () => {
  it("counts a correct target answer", () => {
    expect(userAnsweredIds(graph(), "a").has("o1")).toBe(true);
  });

  it("counts a correct rebuts edge answer", () => {
    const g = graph({ rebuttal: null, edges: [{ from: "c2", to: "o1", relation: "rebuts" }] });
    expect(userAnsweredIds(g, "a").has("o1")).toBe(true);
  });

  it("counts a correct counters edge answer", () => {
    const g = graph({ rebuttal: null, edges: [{ from: "c2", to: "o1", relation: "counters" }] });
    expect(userAnsweredIds(g, "a").has("o1")).toBe(true);
  });

  it("ignores a self-target", () => {
    const g = graph({ rebuttal: { targets: ["c1"] } });
    expect(userAnsweredIds(g, "a").has("c1")).toBe(false);
    expect(userAnsweredIds(g, "a").has("o1")).toBe(false);
  });

  it("ignores a future target: round-1 response cannot answer a round-2 target", () => {
    const malformed = graph({ rebuttal: { round: 1, targets: ["o2"] } });
    malformed.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Future target.", round: 2 });
    malformed.nodes.push({ id: "c3", kind: "claim", owner: "a", text: "Still later user move.", round: 3 });
    // o2 IS answerable in principle (user has a later node)…
    expect(eligibleOpponentMoves(malformed, "a").map((n) => n.id)).toContain("o2");
    // …but a round-1 response does not answer it.
    expect(userAnsweredIds(malformed, "a").has("o2")).toBe(false);
  });

  it("ignores an edge from a round BEFORE the target's round", () => {
    const g = graph();
    g.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Future target.", round: 3 });
    // c1 is a round-1 node; an edge from it cannot answer a round-3 node.
    g.edges.push({ from: "c1", to: "o2", relation: "rebuts" });
    expect(userAnsweredIds(g, "a").has("o2")).toBe(false);
  });

  it("ignores unknown/dangling target ids", () => {
    const g = graph({ rebuttal: { targets: ["ghost"] } });
    expect(userAnsweredIds(g, "a").has("ghost")).toBe(false);
  });

  it("ignores evidence targets and opponent rebuttal targets", () => {
    const g = graph();
    g.nodes.push({ id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 1 });
    g.nodes.push({ id: "or1", kind: "rebuttal", owner: "ai", text: "Opponent rebuttal.", round: 1 });
    const bad = graph({ rebuttal: { targets: ["oe1"] } });
    const bad2 = graph({ rebuttal: { targets: ["or1"] } });
    expect(userAnsweredIds(bad, "a").has("oe1")).toBe(false);
    expect(userAnsweredIds(bad2, "a").has("or1")).toBe(false);
    void g;
  });

  it("never credits the opponent's own answer to the user side", () => {
    const g = graph();
    g.nodes.push({ id: "or1", kind: "rebuttal", owner: "ai", text: "Opponent answers user.", round: 2, targets: ["c1"] });
    expect(userAnsweredIds(g, "a").has("c1")).toBe(false);
    expect(userAnsweredIds(g, "ai").has("c1")).toBe(true);
  });

  it("duplicate targets and duplicate edges count once (no double coverage)", () => {
    const g = graph();
    g.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Duplicate answer.", round: 2, targets: ["o1"] });
    g.edges.push({ from: "r1", to: "o1", relation: "rebuts" });
    const answered = userAnsweredIds(g, "a");
    expect(answered.has("o1")).toBe(true);
    expect(rebuttalCoverageFor(g, "a").value).toBe(1);
  });

  it("target plus a malformed edge of the same answer still counts once", () => {
    const g = graph();
    // Valid target on r1 plus a bogus edge (dangling 'to') — the bogus edge
    // must not crash anything and must not change the count.
    g.edges.push({ from: "r1", to: "ghost", relation: "rebuts" });
    expect(rebuttalCoverageFor(g, "a").value).toBe(1);
  });
});

describe("coverage: opportunities stay honest", () => {
  it("last-round opponent argument is not an opportunity", () => {
    const g = graph();
    g.nodes.push({ id: "o9", kind: "claim", owner: "ai", text: "Final word.", round: 5 });
    const ids = eligibleOpponentMoves(g, "a").map((n) => n.id);
    expect(ids).toContain("o1");
    expect(ids).not.toContain("o9");
    expect(rebuttalCoverageFor(g, "a").value).toBe(1);
  });

  it("unanswered eligible opportunity reads below 1", () => {
    const g = graph({ rebuttal: null });
    const reading = rebuttalCoverageFor(g, "a");
    expect(reading.value).toBe(0);
    expect(reading.unmatchedIds).toEqual(["o1"]);
  });

  it("truncated debate (no later user node) has no opportunities and reads null", () => {
    const g: ArgGraph = {
      ...emptyGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "o1", kind: "claim", owner: "ai", text: "Only opponent move.", round: 1 },
      ],
    };
    const reading = rebuttalCoverageFor(g, "a");
    expect(reading.value).toBeNull();
    expect(reading.opportunities).toBe(0);
  });

  it("trails are exact: eligible, answered and unmatched partition the opportunities", () => {
    const g = graph();
    g.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Second opponent claim.", round: 2 });
    g.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Answer to the second claim.", round: 3, targets: ["o2"] });
    const reading = rebuttalCoverageFor(g, "a");
    expect(reading.eligibleIds).toEqual(["o1", "o2"]);
    expect(reading.answeredIds).toEqual(["o1", "o2"]);
    expect(reading.unmatchedIds).toEqual([]);
    // Remove r2: o2 becomes unmatched but stays eligible.
    const missed = graph();
    missed.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Second opponent claim.", round: 2 });
    const missedReading = rebuttalCoverageFor(missed, "a");
    expect(missedReading.eligibleIds).toEqual(["o1", "o2"]);
    expect(missedReading.answeredIds).toEqual(["o1"]);
    expect(missedReading.unmatchedIds).toEqual(["o2"]);
    expect(missedReading.value).toBe(0.5);
    void g;
  });
});

describe("malformed graphs cannot inflate metrics or rewards", () => {
  it("future target earns no coverage, no reward, no ledger credit", () => {
    // o2 arrives round 2; the only response is a round-1 rebuttal targeting it.
    const g2 = graph({ rebuttal: null });
    g2.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Later move.", round: 2 });
    g2.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Premature answer.", round: 1, targets: ["o2"] });
    const reading = rebuttalCoverageFor(g2, "a");
    expect(reading.eligibleIds).toEqual(["o1", "o2"]);
    expect(reading.answeredIds).toEqual([]);
    expect(reading.value).toBe(0);
    // Reward measurement and the ledger read the same zero.
    expect(measureDimension(g2, "rebuttal").value).toBe(0);
    const metrics = extractSkillPoint("d", AT, assess(g2), "a").metrics;
    expect(metrics.rebuttalCoverage).toBe(0);
    // Targeting quality: the malformed rebuttal earns no targeting credit.
    const rbq = scoreRebuttalQuality(g2, "a");
    expect(rbq?.coverage).toBe(0);
  });

  it("self-targeting rebuttals earn nothing anywhere", () => {
    const g = graph({ rebuttal: { targets: ["c1"] } });
    expect(rebuttalCoverageFor(g, "a").value).toBe(0);
    expect(measureDimension(g, "rebuttal").value).toBe(0);
    const rbq = scoreRebuttalQuality(g, "a");
    expect(rbq?.coverage).toBe(0);
    // Engaging own strong material is not credit either.
    const gImpact = graph({ rebuttal: { targets: ["c1"] } });
    gImpact.nodes.push({ id: "i1", kind: "impact", owner: "a", text: "Own impact.", round: 1 });
    const rbqImpact = scoreRebuttalQuality(gImpact, "a");
    expect(rbqImpact?.engagesStrongMaterial).toBe(0);
  });

  it("evidence nodes as targets earn no targeting or strong-material credit", () => {
    const g = graph();
    g.nodes.push({ id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 1 });
    const bad = graph({ rebuttal: { targets: ["oe1"] } });
    const rbq = scoreRebuttalQuality(bad, "a");
    expect(rbq?.coverage).toBe(0);
    expect(rbq?.engagesStrongMaterial).toBe(0);
    void g;
  });

  it("valid counterclaim target earns strong-material credit only when valid", () => {
    const g = graph();
    g.nodes.push({ id: "ok1", kind: "counterclaim", owner: "ai", text: "Opponent counterclaim.", round: 1 });
    g.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Answer the counterclaim.", round: 2, targets: ["ok1"] });
    const rbq = scoreRebuttalQuality(g, "a");
    expect(rbq?.engagesStrongMaterial).toBeGreaterThan(0);
    // Future counterclaim target: no credit.
    const bad = graph({ rebuttal: null });
    bad.nodes.push({ id: "ok1", kind: "counterclaim", owner: "ai", text: "Later counterclaim.", round: 3 });
    bad.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Premature answer.", round: 1, targets: ["ok1"] });
    const rbqBad = scoreRebuttalQuality(bad, "a");
    expect(rbqBad?.engagesStrongMaterial).toBe(0);
    expect(rbqBad?.coverage).toBe(0);
  });

  it("dangling target ids earn no targeting credit", () => {
    const g = graph({ rebuttal: { targets: ["ghost"] } });
    const rbq = scoreRebuttalQuality(g, "a");
    expect(rbq?.coverage).toBe(0);
  });

  it("answer-every-rebuttal reward is not granted from malformed answers", () => {
    const g = graph({ rebuttal: { targets: ["c1"] } });
    // User has an eligible opportunity (o1) answered by nothing valid.
    expect(measureDimension(g, "rebuttal").value).toBe(0);
    // hasFullRebuttalCoverage path:
    expect(rebuttalCoverageFor(g, "a").value === 1).toBe(false);
  });
});

describe("weakness detection stays honest under malformed graphs", () => {
  it("a self-target does not rescue the opponent's claim from 'unanswered'", () => {
    const raw = graph({ rebuttal: { targets: ["c1"] } });
    // Production callers enrich the graph (detectDropped) before counting
    // weaknesses; the enriched graph must still register o1 as the user's
    // unanswered burden — the self-target cannot hide it.
    const g = assess(raw).graph;
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBe(1);
    expect(counts.rebuttal).toBe(1);
  });

  it("a future-target rebuttal does not rescue the opponent's claim either", () => {
    const raw = graph({ rebuttal: null });
    raw.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Later move.", round: 2 });
    raw.nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Premature.", round: 1, targets: ["o2"] });
    const g = assess(raw).graph;
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBeGreaterThan(0);
    expect(counts.rebuttal).toBe(1);
  });

  it("a correct answer does rescue it (no false weakness)", () => {
    const raw = graph();
    const g = assess(raw).graph;
    const counts = countWeaknessesForSide(g, "a");
    expect(counts.dropped).toBe(0);
    expect(counts.rebuttal).toBe(0);
  });
});

describe("PvP shapes read identically to solo shapes", () => {
  const solo = () => graph();
  const pvp = () => graph({ opponentOwner: "b" });

  it("coverage agrees between ai and b opponents", () => {
    expect(rebuttalCoverageFor(pvp(), "a").value).toBe(rebuttalCoverageFor(solo(), "a").value);
    expect(userAnsweredIds(pvp(), "a")).toEqual(userAnsweredIds(solo(), "a"));
  });

  it("answer-every-rebuttal semantics agree", () => {
    expect(measureDimension(pvp(), "rebuttal").value).toBe(1);
    expect(measureDimension(solo(), "rebuttal").value).toBe(1);
    const missedSolo = solo();
    const missedPvp = pvp();
    for (const g of [missedSolo, missedPvp] as ArgGraph[]) {
      g.nodes.push({ id: "o2", kind: "claim", owner: g.nodes.find((n) => n.id === "o1")!.owner, text: "Extra move.", round: 2 });
    }
    expect(measureDimension(missedPvp, "rebuttal").value).toBe(measureDimension(missedSolo, "rebuttal").value);
  });

  it("the ledger agrees across shapes", () => {
    const m = (g: ArgGraph, opp: Owner) => extractSkillPoint("d", AT, assess(g, opp), "a").metrics;
    expect(m(pvp(), "b").rebuttalCoverage).toBe(m(solo(), "ai").rebuttalCoverage);
    expect(m(pvp(), "b").rebuttalTargeting).toBe(m(solo(), "ai").rebuttalTargeting);
  });
});

describe("observable assessment honours the same rules", () => {
  it("rebuttalCoverage feature is 0 when the only target is malformed", () => {
    const bad = assess(graph({ rebuttal: { targets: ["c1"] } }));
    expect(bad.features.a.rebuttalCoverage.value).toBe(0);
    const good = assess(graph());
    expect(good.features.a.rebuttalCoverage.value).toBe(1);
  });

  it("directRebuttals trail excludes invalid targets", () => {
    const bad = assess(graph({ rebuttal: { targets: ["c1", "ghost"] } }));
    expect(bad.features.a.directRebuttals.value).toBe(0);
    const good = assess(graph());
    expect(good.features.a.directRebuttals.value).toBe(1);
  });

  it("evidence refs for coverage name answered vs unanswered opportunities only", () => {
    const g = graph();
    g.nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Second claim.", round: 2 });
    const assessment = assess(g);
    const texts = assessment.features.a.rebuttalCoverage.evidence.map((r) => r.note ?? "");
    expect(texts.some((t) => /Answered/.test(t))).toBe(true);
    expect(texts.some((t) => /No direct response recorded/.test(t))).toBe(true);
    // Last-round and invalid nodes never appear as opportunities.
    expect(texts.every((t) => !/Final word/.test(t))).toBe(true);
  });
});

describe("reward owner is always the measured user", () => {
  it("REWARDED_OWNER is the human side and measures only that side", () => {
    expect(REWARDED_OWNER).toBe("a");
    const g = graph();
    // Opponent's failure to answer the user's claim is not the user's reading.
    const reading = measureDimension(g, "rebuttal");
    expect(reading.opportunities).toBe(1);
    expect(reading.value).toBe(1);
  });
});
