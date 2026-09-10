import { describe, expect, it } from "vitest";
import {
  eligibleOpponentMoves,
  isValidRebuttalResponse,
  rebuttalCoverageFor,
  unansweredOpportunitiesBy,
} from "./opportunity";
import { detectDropped } from "./graphEnrichers";
import { assessArgumentGraph, type ObservableAssessment } from "./observableAssessment";
import { extractSkillPoint } from "./skillLedger";
import { measureDimension } from "./coachRewards";
import { countWeaknessesForSide } from "./repairEffectiveness";
import { snapshotFromAssessment } from "./coachingGoal";
import { buildResultSnapshot } from "./resultSnapshot";
import { emptyGraph, type ArgGraph, type ArgNode, type Owner } from "./argGraph";

/**
 * CROSS-SYSTEM REBUTTAL INVARIANCE.
 *
 * One literal rebuttal semantics implementation (opportunity.ts) must drive
 * every product layer. For the same graph, all of these MUST agree:
 *
 *   canonical helper      → rebuttalCoverageFor
 *   core scoring          → observableAssessment.features.*.rebuttalCoverage
 *   rewards               → measureDimension("rebuttal")
 *   skill ledger          → extractSkillPoint().metrics.rebuttalCoverage
 *   Progress              → the ledger IS the Progress data source
 *   dropped detection     → detectDropped / unansweredOpportunitiesBy
 *   repair measurement    → countWeaknessesForSide
 *   result explanation    → buildResultSnapshot
 *
 * Every fixture below is run through ALL systems; no malformed graph may
 * inflate coverage anywhere or hide a weakness anywhere.
 */

const AT = "2026-06-15T12:00:00Z";

function assess(g: ArgGraph, opponent: Owner = "ai"): ObservableAssessment {
  return assessArgumentGraph(g, {
    sideA: "a",
    sideB: opponent,
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "Opponent",
  });
}

interface Scenario {
  name: string;
  opponentOwner?: Owner;
  build: () => ArgGraph;
  /** Expected canonical coverage value (number) or null (unmeasurable). */
  expectedCoverage: number | null;
  /** Expected count of the user's unanswered eligible opportunities. */
  expectedUnanswered: number;
}

/**
 * Core cast: user claim + rebuttal at round 2, opponent claim at round 1,
 * and a later round-3 user node so the opponent claim is ELIGIBLE. Claims
 * carry grounded evidence so the result story's evidence branch stays quiet
 * and the rebuttal weakness (when present) is the top-priority miss.
 */
function baseCast(opponent: Owner = "ai"): ArgNode[] {
  return [
    { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
    { id: "e1", kind: "evidence", owner: "a", text: "NREL grounded support.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
    { id: "o1", kind: "claim", owner: opponent, text: "Opponent claim.", round: 1 },
    { id: "r1", kind: "rebuttal", owner: "a", text: "User answer to the opponent claim.", round: 2, targets: ["o1"] },
    { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
    { id: "e3", kind: "evidence", owner: "a", text: "Pew grounded support.", round: 3, evidenceStrength: "cited", citations: [{ sourceName: "Pew", homepage: "https://www.pewresearch.org" }] },
  ];
}

function graphFrom(nodes: ArgNode[], edges: ArgGraph["edges"] = []): ArgGraph {
  // Default support edges keep every user claim grounded, so the evidence
  // weakness never pre-empts the rebuttal assertions below.
  const support = [
    { from: "e1", to: "c1", relation: "supports" as const },
    { from: "e3", to: "c3", relation: "supports" as const },
  ].filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  return { ...emptyGraph(), nodes, edges: [...support, ...edges] };
}

const SCENARIOS: Scenario[] = [
  {
    name: "correct rebuttal of an opponent claim (full coverage)",
    expectedCoverage: 1,
    expectedUnanswered: 0,
    build: () => graphFrom(baseCast()),
  },
  {
    name: "correct rebuttal of an opponent counterclaim (full coverage)",
    expectedCoverage: 1,
    expectedUnanswered: 0,
    build: () => {
      const nodes = baseCast();
      nodes[1] = { ...nodes[1], kind: "counterclaim" };
      return graphFrom(nodes);
    },
  },
  {
    name: "opponent impact is NOT a rebuttal opportunity (weighing move)",
    expectedCoverage: null,
    expectedUnanswered: 0,
    build: () =>
      graphFrom([
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "oi1", kind: "impact", owner: "ai", text: "Opponent impact.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Answers the impact.", round: 2, targets: ["oi1"] },
        { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
      ]),
  },
  {
    name: "opponent evidence is NOT a rebuttal opportunity",
    expectedCoverage: null,
    expectedUnanswered: 0,
    build: () =>
      graphFrom([
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Answers the evidence.", round: 2, targets: ["oe1"] },
        { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
      ]),
  },
  {
    name: "self-target scores nothing",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () => {
      const nodes = baseCast();
      // r1 is index 3 in the cast; retarget it at the user's own claim.
      nodes[3] = { ...nodes[3], targets: ["c1"] };
      return graphFrom(nodes);
    },
  },
  {
    name: "future target (response before target) cannot answer it, but earlier genuine answers still count",
    // o1 (round 1) is genuinely answered by r1 (round 2); the premature
    // round-1 rebuttal of o2 (round 2) earns nothing, so o2 stays unmatched.
    expectedCoverage: 0.5,
    expectedUnanswered: 1,
    build: () => {
      const nodes = baseCast();
      nodes.push({ id: "o2", kind: "claim", owner: "ai", text: "Later opponent claim.", round: 2 });
      nodes.push({ id: "r0", kind: "rebuttal", owner: "a", text: "Premature answer.", round: 1, targets: ["o2"] });
      return graphFrom(nodes);
    },
  },
  {
    name: "unknown/dangling target scores nothing",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () => {
      const nodes = baseCast();
      nodes[3] = { ...nodes[3], targets: ["ghost"] };
      return graphFrom(nodes);
    },
  },
  {
    name: "evidence → counters edge is not a valid response",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () =>
      graphFrom(
        baseCast().map((n) => (n.kind === "rebuttal" ? { ...n, kind: "evidence" as const, targets: undefined } : n)),
        [{ from: "r1", to: "o1", relation: "counters" }],
      ),
  },
  {
    name: "unsupported relation (supports) is not an answer",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () =>
      graphFrom(
        baseCast().map((n) => (n.kind === "rebuttal" ? { ...n, targets: undefined } : n)),
        [{ from: "r1", to: "o1", relation: "supports" }],
      ),
  },
  {
    name: "malformed edge (dangling from) is ignored",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () =>
      graphFrom(
        baseCast().map((n) => (n.kind === "rebuttal" ? { ...n, targets: undefined } : n)),
        [{ from: "ghost", to: "o1", relation: "rebuts" }],
      ),
  },
  {
    name: "valid rebuts edge answer (claim as responder)",
    expectedCoverage: 1,
    expectedUnanswered: 0,
    build: () =>
      graphFrom(
        baseCast().map((n) => (n.kind === "rebuttal" ? { ...n, kind: "claim" as const, targets: undefined } : n)),
        [{ from: "r1", to: "o1", relation: "rebuts" }],
      ),
  },
  {
    name: "last-round opponent argument is not an opportunity",
    expectedCoverage: 1,
    expectedUnanswered: 0,
    build: () => {
      const nodes = baseCast();
      nodes.push({ id: "o9", kind: "claim", owner: "ai", text: "Final opponent word.", round: 5 });
      return graphFrom(nodes);
    },
  },
  {
    name: "truncated debate (no later user node) has no opportunities",
    expectedCoverage: null,
    expectedUnanswered: 0,
    build: () =>
      graphFrom([
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "o1", kind: "claim", owner: "ai", text: "Only opponent move.", round: 1 },
      ]),
  },
  {
    name: "unanswered eligible opportunity (zero coverage, one weakness)",
    expectedCoverage: 0,
    expectedUnanswered: 1,
    build: () => {
      // Base cast without the user's rebuttal: o1 stays eligible (later user
      // node exists) and unanswered.
      const nodes = baseCast().filter((n) => !(n.kind === "rebuttal"));
      return graphFrom(nodes);
    },
  },
  {
    name: "PvP opponent (owner b) reads identically to solo ai",
    opponentOwner: "b",
    expectedCoverage: 1,
    expectedUnanswered: 0,
    build: () => graphFrom(baseCast("b")),
  },
];

describe("cross-system rebuttal invariance", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: every layer reads the same coverage (${s.expectedCoverage ?? "null"})`, () => {
      const g = s.build();
      const opponent = s.opponentOwner ?? "ai";

      // ── The canonical helper ────────────────────────────────────────────
      const canonical = rebuttalCoverageFor(g, "a");
      expect(canonical.value).toBe(s.expectedCoverage);
      expect(canonical.opportunities).toBe(canonical.eligibleIds.length);
      expect(canonical.answeredIds.length + canonical.unmatchedIds.length).toBe(canonical.eligibleIds.length);
      expect(unansweredOpportunitiesBy(g, "a")).toHaveLength(s.expectedUnanswered);

      // ── Core scoring ────────────────────────────────────────────────────
      // The score-path value is the canonical value (null → 0 with the
      // insufficient_evidence status marker).
      const assessment = assess(g, opponent);
      const expectedScoreValue = s.expectedCoverage ?? 0;
      expect(assessment.features.a.rebuttalCoverage.value).toBeCloseTo(expectedScoreValue, 5);

      // ── Rewards (weakest-skill measurement) ─────────────────────────────
      const reward = measureDimension(g, "rebuttal");
      expect(reward.value).toBe(s.expectedCoverage);
      expect(reward.opportunities).toBe(canonical.opportunities);

      // ── Skill ledger (Progress's data source) ──────────────────────────
      const metrics = extractSkillPoint("d1", AT, assessment, "a").metrics;
      expect(metrics.rebuttalCoverage).toBe(
        s.expectedCoverage === null ? null : Math.round((s.expectedCoverage as number) * 1000) / 1000,
      );
      // droppedArguments IS the canonical unanswered count.
      expect(metrics.droppedArguments).toBe(s.expectedUnanswered);

      // ── Dropped detection ──────────────────────────────────────────────
      // The user's unanswered opportunities must appear as dropped entries
      // owned by the opponent (the user failed to answer them).
      const droppedForUser = detectDropped(g).filter((d) => d.owner !== "a");
      expect(droppedForUser).toHaveLength(s.expectedUnanswered);
      expect(droppedForUser.map((d) => d.nodeId).sort()).toEqual(
        canonical.unmatchedIds.slice().sort(),
      );

      // ── Repair measurement (weakness counts) ──────────────────────────
      const weaknesses = countWeaknessesForSide(g, "a");
      expect(weaknesses.dropped).toBe(s.expectedUnanswered);
      expect(weaknesses.rebuttal).toBe(s.expectedUnanswered > 0 ? 1 : 0);

      // ── Coaching snapshot (goal assessment input) ─────────────────────
      const snapshot = snapshotFromAssessment(assessment);
      expect(snapshot?.droppedOwn).toBe(s.expectedUnanswered);

      // ── Result explanation ────────────────────────────────────────────
      const story = buildResultSnapshot(assessment, { format: "full" });
      if (s.expectedUnanswered > 0) {
        // With grounded claims the rebuttal weakness is top priority.
        expect(story.weakness?.kind).toBe("rebuttal");
        expect(story.weakness?.headline).toContain("unanswered");
      } else {
        // No canonical unanswered opportunities: the result story must never
        // blame the user for leaving an opposing argument unanswered.
        expect(story.weakness?.kind).not.toBe("rebuttal");
      }
    });
  }

  it("canonical unanswered set equals the rebuttal weakness set for every scenario", () => {
    for (const s of SCENARIOS) {
      const g = s.build();
      const canonicalUnmatched = rebuttalCoverageFor(g, "a").unmatchedIds;
      const weaknessNodes = unansweredOpportunitiesBy(g, "a").map((n) => n.id);
      const droppedForUser = detectDropped(g).filter((d) => d.owner !== "a").map((d) => d.nodeId);
      // THE invariant: one set, three readers, identical contents.
      expect(weaknessNodes.sort()).toEqual(canonicalUnmatched.sort());
      expect(droppedForUser.sort()).toEqual(canonicalUnmatched.sort());
      expect(countWeaknessesForSide(g, "a").dropped).toBe(canonicalUnmatched.length);
    }
  });

  it("canonical response validation rejects every malformed answer shape", () => {
    const g = graphFrom(baseCast());
    // Correct shape passes.
    expect(isValidRebuttalResponse(g, "r1", "o1", "rebuts", "a")).toBe(true);
    expect(isValidRebuttalResponse(g, "r1", "o1", "counters", "a")).toBe(true);
    // Wrong relation.
    expect(isValidRebuttalResponse(g, "r1", "o1", "supports", "a")).toBe(false);
    expect(isValidRebuttalResponse(g, "r1", "o1", "impacts", "a")).toBe(false);
    // Dangling response node.
    expect(isValidRebuttalResponse(g, "ghost", "o1", "rebuts", "a")).toBe(false);
    // Dangling target.
    expect(isValidRebuttalResponse(g, "r1", "ghost", "rebuts", "a")).toBe(false);
    // Response owned by the opponent.
    expect(isValidRebuttalResponse(g, "o1", "o1", "rebuts", "a")).toBe(false);
    // Self-target.
    expect(isValidRebuttalResponse(g, "r1", "c1", "rebuts", "a")).toBe(false);
    // Evidence can never respond.
    const withEvidence = graphFrom([
      { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
      { id: "o1", kind: "claim", owner: "ai", text: "Opponent claim.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "Evidence.", round: 1 },
      { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
    ]);
    expect(isValidRebuttalResponse(withEvidence, "e1", "o1", "counters", "a")).toBe(false);
    // Future target: response round before target round.
    const withFuture = graphFrom([
      { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
      { id: "o1", kind: "claim", owner: "ai", text: "Opponent claim.", round: 1 },
      { id: "o2", kind: "claim", owner: "ai", text: "Later opponent claim.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Premature.", round: 1, targets: ["o2"] },
      { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
    ]);
    expect(isValidRebuttalResponse(withFuture, "r1", "o2", "rebuts", "a")).toBe(false);
  });

  it("evidence trails are exact: only eligible opportunities and valid answers appear", () => {
    for (const s of SCENARIOS) {
      const g = s.build();
      const assessment = assess(g, s.opponentOwner ?? "ai");
      const canonical = rebuttalCoverageFor(g, "a");
      const trailIds = assessment.features.a.rebuttalCoverage.evidence.map((r) => r.id.split(":")[0]);
      // Every eligible opportunity appears in the trail; nothing else does.
      for (const id of canonical.eligibleIds) expect(trailIds).toContain(id);
      for (const id of canonical.unmatchedIds) {
        const ref = assessment.features.a.rebuttalCoverage.evidence.find((r) => r.id.split(":")[0] === id);
        expect(ref?.note).toBe("No direct response recorded");
      }
      for (const id of canonical.answeredIds) {
        const ref = assessment.features.a.rebuttalCoverage.evidence.find((r) => r.id.split(":")[0] === id);
        expect(ref?.note).toBe("Answered");
      }
    }
  });

  it("no malformed graph can inflate coverage in ANY system", () => {
    // All the inflation attempts in one graph: self-target, future target,
    // dangling ids, evidence responses, impact targets, unsupported
    // relations, same-round targets. The user's own claims stay grounded so
    // the rebuttal weakness is what surfaces.
    const g: ArgGraph = {
      ...emptyGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "NREL grounded support.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
        { id: "o1", kind: "claim", owner: "ai", text: "Real opponent opportunity.", round: 1 },
        // The genuine later user turn: o1 becomes eligible and unanswered.
        { id: "c3", kind: "claim", owner: "a", text: "Later user claim.", round: 3 },
        { id: "e3", kind: "evidence", owner: "a", text: "Pew grounded support.", round: 3, evidenceStrength: "cited", citations: [{ sourceName: "Pew", homepage: "https://www.pewresearch.org" }] },
        // Inflation attempt 1: self-target.
        { id: "x1", kind: "rebuttal", owner: "a", text: "Self-target.", round: 2, targets: ["c1"] },
        // Inflation attempt 2: future target.
        { id: "o2", kind: "claim", owner: "ai", text: "Future claim.", round: 3 },
        { id: "x2", kind: "rebuttal", owner: "a", text: "Answers the future.", round: 2, targets: ["o2"] },
        // Inflation attempt 3: dangling id.
        { id: "x3", kind: "rebuttal", owner: "a", text: "Dangling.", round: 2, targets: ["ghost"] },
        // Inflation attempt 4: evidence response.
        { id: "xe", kind: "evidence", owner: "a", text: "Evidence response.", round: 2 },
        // Inflation attempt 5: impact target.
        { id: "oi", kind: "impact", owner: "ai", text: "Opponent impact.", round: 1 },
        { id: "x4", kind: "rebuttal", owner: "a", text: "Answers the impact.", round: 2, targets: ["oi"] },
        // Inflation attempt 6: opponent-owned "answer".
        { id: "xo", kind: "rebuttal", owner: "ai", text: "Opponent answers itself.", round: 2, targets: ["o1"] },
      ],
      edges: [
        { from: "e1", to: "c1", relation: "supports" },
        { from: "e3", to: "c3", relation: "supports" },
        // Inflation attempt 7: malformed edge (evidence → counters).
        { from: "xe", to: "o1", relation: "counters" },
        // Inflation attempt 8: unsupported relation.
        { from: "x1", to: "o1", relation: "supports" },
        // Inflation attempt 9: dangling edge endpoints.
        { from: "ghost", to: "o1", relation: "rebuts" },
        // Inflation attempt 10: same-round response edge.
        { from: "c1", to: "o1", relation: "rebuts" },
      ],
    };
    const assessment = assess(g);
    // o1 (round 1) is the only eligible opportunity: answered by nothing
    // valid, so coverage is exactly 0 everywhere and the weakness count is 1.
    expect(rebuttalCoverageFor(g, "a").value).toBe(0);
    expect(assessment.features.a.rebuttalCoverage.value).toBe(0);
    expect(measureDimension(g, "rebuttal").value).toBe(0);
    expect(extractSkillPoint("d", AT, assessment, "a").metrics.rebuttalCoverage).toBe(0);
    expect(countWeaknessesForSide(g, "a").rebuttal).toBe(1);
    expect(countWeaknessesForSide(g, "a").dropped).toBe(1);
    expect(snapshotFromAssessment(assessment)?.droppedOwn).toBe(1);
    const story = buildResultSnapshot(assessment, { format: "full" });
    expect(story.weakness?.kind).toBe("rebuttal");
    expect(story.weakness?.headline).toMatch(/1 opposing argument went unanswered/);
  });
});

describe("eligibility counts agree everywhere", () => {
  it("eligibleOpponentMoves is the single denominator in rewards, ledger and repair gating", () => {
    for (const s of SCENARIOS) {
      const g = s.build();
      const expected = eligibleOpponentMoves(g, "a").length;
      expect(rebuttalCoverageFor(g, "a").opportunities).toBe(expected);
      expect(measureDimension(g, "rebuttal").opportunities).toBe(expected);
    }
  });
});
