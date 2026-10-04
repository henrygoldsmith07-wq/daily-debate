import { describe, expect, it } from "vitest";
import {
  formativeCheck,
  formativeStateFor,
  LONGITUDINAL_MIN_OBSERVATIONS,
  pickPendingRetest,
  repairSuccessTransition,
  retestNarrative,
  retestOutcomeFor,
  retestTopicIsEligible,
  weaknessPresentIn,
  type RepairRecord,
} from "./retest";
import type { ArgEdge, ArgGraph, ArgNode } from "./argGraph";
import type { DebateWeaknessRow } from "./repairEffectiveness";

function graphOf(nodes: ArgNode[], edges: ArgEdge[] = [], unsupportedClaimIds: string[] = []): ArgGraph {
  return {
    nodes,
    edges,
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: nodes.filter((n) => n.kind === "evidence").length,
      byOwner: { a: 0, b: 0, ai: 0 },
      byStrength: { cited: 0, strong: 0, general: 0, anecdotal: 0 },
      unsupportedClaimIds,
    },
    impactComparison: null,
  };
}

const claim = (id: string, owner: "a" | "ai", round = 1): ArgNode => ({ id, kind: "claim", owner, round, text: "claim", targets: [] });
const evidence = (id: string, owner: "a" | "ai"): ArgNode => ({
  id,
  kind: "evidence",
  owner,
  round: 1,
  text: "study",
  evidenceStrength: "cited",
  citations: [{ sourceName: "Pew Research Center" }],
});

describe("formativeStateFor", () => {
  it("maps score bands to the three formative states", () => {
    expect(formativeStateFor(85, true)).toBe("repair_demonstrated");
    expect(formativeStateFor(50, false)).toBe("partially_repaired");
    expect(formativeStateFor(10, false)).toBe("needs_another_pass");
  });
});

describe("formativeCheck", () => {
  it("names exactly one still-missing component", () => {
    const check = formativeCheck(50, false, ["names evidence or a source"]);
    expect(check.state).toBe("partially_repaired");
    expect(check.missing).toBe("names evidence or a source");
  });

  it("reports no missing component once the repair is demonstrated", () => {
    const check = formativeCheck(85, true, []);
    expect(check.state).toBe("repair_demonstrated");
    expect(check.missing).toBeNull();
  });
});

describe("retestOutcomeFor", () => {
  const row = (kinds: Record<string, number>, opps?: { majorClaims: number; opponentMoves: number }): DebateWeaknessRow => ({
    debateId: "retest-1",
    userId: "u1",
    completedAt: "2026-06-15T12:00:00Z",
    kinds,
    opps,
  });

  it("returns no-valid-opportunity when the debate could not express the weakness", () => {
    const g = graphOf([claim("a1", "a")], [], ["a1"]);
    expect(retestOutcomeFor({ target_kind: "rebuttal" }, row({ rebuttal: 0 }, { majorClaims: 1, opponentMoves: 0 }), g, "a")).toBe(
      "no-valid-opportunity",
    );
  });

  it("returns not-enough-evidence for sprint retests with an opportunity", () => {
    const g = graphOf([claim("a1", "a"), claim("ai1", "ai")], [], ["a1", "ai1"]);
    const outcome = retestOutcomeFor(
      { target_kind: "rebuttal" },
      row({ rebuttal: 1, dropped: 1 }, { majorClaims: 1, opponentMoves: 1 }),
      g,
      "a",
      { format: "sprint" },
    );
    expect(outcome).toBe("not-enough-evidence");
  });

  it("distinguishes observed vs not-observed on full retests", () => {
    // An unanswered opponent claim = rebuttal weakness present → not observed.
    // a2 (round 2) gives the round-1 opponent move a genuine chance to be
    // answered, so it is an eligible opportunity under the canonical rules.
    const gMissed = graphOf([claim("a1", "a", 1), claim("ai1", "ai", 1), claim("a2", "a", 2)], [], ["a1", "a2", "ai1"]);
    expect(
      retestOutcomeFor({ target_kind: "rebuttal" }, row({ rebuttal: 1, dropped: 1 }, { majorClaims: 1, opponentMoves: 1 }), gMissed, "a"),
    ).toBe("skill-not-observed");

    // Every claim supported by cited evidence → evidence weakness absent → observed.
    const gSolid = graphOf(
      [claim("a1", "a"), evidence("e1", "a")],
      [{ from: "e1", to: "a1", relation: "supports" }],
      [],
    );
    expect(retestOutcomeFor({ target_kind: "evidence" }, row({ evidence: 0 }, { majorClaims: 1, opponentMoves: 0 }), gSolid, "a")).toBe(
      "skill-observed",
    );
  });
});

describe("weaknessPresentIn", () => {
  it("is side-scoped: opponent failures never count against the user", () => {
    const g = graphOf(
      [claim("a1", "a"), evidence("e1", "a"), claim("ai1", "ai")],
      [{ from: "e1", to: "a1", relation: "supports" }],
      ["ai1"],
    );
    expect(weaknessPresentIn(g, "a", "evidence")).toBe(false);
    expect(weaknessPresentIn(g, "ai", "evidence")).toBe(true);
  });
});

describe("retestNarrative", () => {
  const obs = (flags: boolean[]) => flags.map((observed, i) => ({ eligible: true, observed, at: `2026-06-0${i + 1}` }));

  it("withholds consistency language below the longitudinal minimum", () => {
    const narrative = retestNarrative("skill-observed", obs([true, true]));
    expect(narrative.longitudinal).toBe(false);
    expect(narrative.consistencyLine).toBeNull();
    expect(narrative.label).toBe("Skill observed in this retest");
  });

  it("never claims mastery from one success", () => {
    const narrative = retestNarrative("skill-observed", obs([true]));
    expect(narrative.detail).toMatch(/One observation/);
    expect(narrative.consistencyLine).toBeNull();
  });

  it("offers cautious longitudinal language at the minimum sample", () => {
    const narrative = retestNarrative("skill-not-observed", obs([true, true, false]));
    expect(narrative.longitudinal).toBe(true);
    expect(narrative.consistencyLine).toContain("2 of 3");
    expect(narrative.consistencyLine).toMatch(/not yet proof/);
  });

  it("counts only eligible observations", () => {
    const narrative = retestNarrative("skill-observed", [
      ...obs([true, true, false]),
      { eligible: false, observed: false, at: "2026-06-04" },
    ]);
    expect(narrative.eligibleObservations).toBe(3);
    expect(narrative.eligibleObservations).toBe(LONGITUDINAL_MIN_OBSERVATIONS);
  });
});

describe("retestTopicIsEligible", () => {
  it("requires a different topic from the repaired debate", () => {
    expect(retestTopicIsEligible("topic-2", "topic-1")).toBe(true);
    expect(retestTopicIsEligible("topic-1", "topic-1")).toBe(false);
  });
});

describe("repairSuccessTransition", () => {
  it("promises a later, different-topic test without writing the argument", () => {
    const t = repairSuccessTransition("rebuttal", "Rebuttal");
    expect(t.headline).toBe("Repair demonstrated. Now prove you can use it without prompting.");
    expect(t.body).toMatch(/different-topic debate/);
  });
});

describe("pickPendingRetest", () => {
  const rec = (over: Partial<RepairRecord>): RepairRecord => ({
    id: "r1",
    user_id: "u1",
    debate_id: "d1",
    target_kind: "rebuttal",
    source_text: "s",
    rewrite_text: "w",
    score: 80,
    succeeded: true,
    created_at: "2026-06-01T00:00:00Z",
    retest_debate_id: null,
    ...over,
  });

  it("picks the oldest successful repair without a retest", () => {
    const pending = pickPendingRetest([
      rec({ id: "r2", created_at: "2026-06-05T00:00:00Z" }),
      rec({ id: "r1", created_at: "2026-06-01T00:00:00Z" }),
      rec({ id: "r3", created_at: "2026-06-02T00:00:00Z", retest_debate_id: "d9" }),
      rec({ id: "r4", created_at: "2026-06-01T00:00:00Z", succeeded: false }),
    ]);
    expect(pending?.id).toBe("r1");
  });

  it("returns null when everything is retested or unsuccessful", () => {
    expect(pickPendingRetest([rec({ succeeded: false }), rec({ retest_debate_id: "d9" })])).toBeNull();
  });
});
