import { describe, expect, it } from "vitest";
import { buildRecentlyImproved, buildSkillJourney, journeyObservationsFor } from "./skillJourney";
import type { RepairRecord } from "./retest";
import type { DebateWeaknessRow } from "./repairEffectiveness";

function repair(over: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: "r1",
    user_id: "u1",
    debate_id: "d1",
    target_kind: "rebuttal",
    source_text: "s",
    rewrite_text: "w",
    score: 85,
    succeeded: true,
    created_at: "2026-06-01T00:00:00Z",
    retest_debate_id: null,
    ...over,
  };
}

function debate(at: string, kinds: Record<string, number>, opponentMoves = 3, id = `d-${at}`): DebateWeaknessRow {
  return {
    debateId: id,
    userId: "u1",
    completedAt: at,
    kinds,
    opps: { majorClaims: 2, opponentMoves },
  };
}

describe("journeyObservationsFor", () => {
  it("includes only debates with a real opportunity for the behaviour", () => {
    const obs = journeyObservationsFor("rebuttal", [
      debate("2026-06-10T00:00:00Z", { dropped: 1 }, 3),
      debate("2026-06-11T00:00:00Z", { dropped: 0 }, 0),
    ]);
    expect(obs).toHaveLength(1);
    expect(obs[0].opportunities).toBe(3);
    expect(obs[0].met).toBe(2);
  });

  it("sorts newest first", () => {
    const obs = journeyObservationsFor("rebuttal", [
      debate("2026-06-01T00:00:00Z", { dropped: 0 }, 2),
      debate("2026-06-10T00:00:00Z", { dropped: 0 }, 2),
    ]);
    expect(obs[0].completedAt > obs[1].completedAt).toBe(true);
  });
});

describe("buildSkillJourney", () => {
  it("tells the full story for a repaired, retested skill", () => {
    const journey = buildSkillJourney(
      [
        repair({
          retest_debate_id: "d-retest",
          retest_outcome: "skill-observed",
          retest_completed_at: "2026-06-03T00:00:00Z",
        }),
      ],
      [
        debate("2026-06-03T00:00:00Z", { dropped: 0 }, 3, "d-retest"),
        debate("2026-06-06T00:00:00Z", { dropped: 1 }, 3),
        debate("2026-06-09T00:00:00Z", { dropped: 0 }, 3),
      ],
    );
    expect(journey).toHaveLength(1);
    const entry = journey[0];
    expect(entry.label).toBe("Rebuttal");
    expect(entry.trigger?.detail).toMatch(/unanswered/);
    expect(entry.repair?.state).toBe("repair-demonstrated");
    expect(entry.retest?.outcome).toBe("skill-observed");
    expect(entry.laterObservations.length).toBeGreaterThanOrEqual(2);
    expect(entry.currentState).toMatch(/rebuttal/i);
  });

  it("names a small sample instead of claiming improvement", () => {
    const journey = buildSkillJourney([repair()], [debate("2026-06-03T00:00:00Z", { dropped: 0 }, 3)]);
    const entry = journey[0];
    expect(entry.evidence.sufficient).toBe(false);
    expect(entry.evidence.note).toMatch(/still limited/i);
    expect(entry.story).toBeNull();
  });

  it("generates a quantified story only when evidence supports it", () => {
    const journey = buildSkillJourney(
      [repair({ retest_debate_id: "d-retest", retest_outcome: "skill-observed" })],
      [
        debate("2026-06-03T00:00:00Z", { dropped: 0 }, 3, "d-retest"),
        debate("2026-06-05T00:00:00Z", { dropped: 1 }, 3),
        debate("2026-06-07T00:00:00Z", { dropped: 0 }, 3),
      ],
    );
    const entry = journey[0];
    expect(entry.story).not.toBeNull();
    expect(entry.story).toMatch(/after the repair/i);
    // The story quotes real counts, never "mastered".
    expect(entry.story!.toLowerCase()).not.toMatch(/master|expert|perfect/);
    expect(entry.story).toMatch(/\d+ of (?:your last )?\d+/);
  });

  it("covers each trained skill once even with repeat repairs", () => {
    const journey = buildSkillJourney(
      [repair({ id: "r1" }), repair({ id: "r2", created_at: "2026-06-05T00:00:00Z" })],
      [debate("2026-06-07T00:00:00Z", { dropped: 0 }, 2)],
    );
    expect(journey).toHaveLength(1);
  });
});

describe("buildRecentlyImproved", () => {
  it("highlights at most three items and only real changes", () => {
    const journey = buildSkillJourney(
      [
        repair({
          retest_debate_id: "d-retest",
          retest_outcome: "skill-observed",
          retest_completed_at: "2026-06-03T00:00:00Z",
        }),
      ],
      [debate("2026-06-03T00:00:00Z", { dropped: 0 }, 3, "d-retest")],
    );
    const items = buildRecentlyImproved(journey);
    expect(items.length).toBeLessThanOrEqual(3);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].kind).toBe("observed");
    expect(items[0].line).toMatch(/skill observed|appeared|held/i);
  });

  it("is empty when nothing observable improved", () => {
    const journey = buildSkillJourney(
      [repair({ succeeded: false, score: 20 })],
      [debate("2026-06-03T00:00:00Z", { dropped: 2 }, 3)],
    );
    expect(buildRecentlyImproved(journey)).toHaveLength(0);
  });
});
