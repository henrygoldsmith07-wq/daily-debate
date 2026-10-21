import { describe, expect, it } from "vitest";

// THE DISCLOSURE POLICY, TESTED.
//
// A deliberate retest is a measurement, and a measurement the subject can see
// is not a measurement. These tests are the executable form of the rule
// stated in retestDisclosure.ts:
//
//   While a deliberate retest is pending, no PRE-DEBATE surface may
//   (1) name the skill under test,
//   (2) give that skill's instruction or observable as the day's coaching,
//   (3) state or imply that a retest is scheduled for today.
//
// They run every producer that feeds a pre-debate surface, with a pending
// retest on Evidence, and assert that none of them leaks it.

import { buildCoachingGoal } from "./coachingGoal";
import { selectNextPractice, type SkillReading, type SkillRepairState } from "./learnerModel";
import { buildLoopThread } from "./loopThread";
import { pickPriority } from "./dailyFocus";
import { pickRetestMotion } from "./topicPersonalisation";
import { liveCoachingForTurn, LIVE_HINT_SKILLS } from "./liveCoaching";
import { isUnderTest, retestDisclosureFor } from "./retestDisclosure";
import type { SkillMetricPoint } from "./skillLedger";
import type { CoachDimension } from "./adaptiveCoach";

const UNDER_TEST: CoachDimension = "evidence";

function metricPoint(i: number, metrics: Partial<Record<string, number | null>>): SkillMetricPoint {
  return {
    debateId: `d${i}`,
    completedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    metrics: metrics as SkillMetricPoint["metrics"],
  };
}

// Evidence is the weakest skill; Rebuttal is second. With Evidence under
// silent test, the visible coaching must land on Rebuttal.
const POINTS: SkillMetricPoint[] = [
  metricPoint(0, { unsupportedClaimRate: 1, evidenceGrounding: 0, uncitedEvidenceRate: 1, rebuttalCoverage: 0.7 }),
  metricPoint(1, { unsupportedClaimRate: 1, evidenceGrounding: 0, uncitedEvidenceRate: 1, rebuttalCoverage: 0.7 }),
  metricPoint(2, { unsupportedClaimRate: 1, evidenceGrounding: 0, uncitedEvidenceRate: 1, rebuttalCoverage: 0.7 }),
];

function reading(key: string, label: string, level: number): SkillReading {
  return {
    key,
    label,
    description: "",
    level,
    score: Math.round(level * 100),
    sampleSize: 3,
    instrument: "counted",
    claim: "observation",
    confidence: "moderate",
    trend: "flat",
    note: "",
    isStrength: level > 0.7,
    isWeakness: level <= 0.5,
  } as unknown as SkillReading;
}

const SKILLS: SkillReading[] = [reading("evidence", "Evidence", 0.2), reading("rebuttal", "Rebuttal", 0.6)];

const AWAITING: SkillRepairState = {
  skill: "evidence",
  label: "Evidence",
  successfulEpisodes: 1,
  failedOnlyEpisodes: 0,
  totalAttempts: 1,
  lastRepairedAt: "2026-01-03T10:00:00Z",
  awaitingRetest: true,
  demonstratedLater: false,
  retestedNotDemonstrated: false,
  status: "repaired-awaiting-retest",
};

describe("retest disclosure policy", () => {
  it("knows which skill is under silent test", () => {
    const disclosure = retestDisclosureFor(UNDER_TEST);
    expect(isUnderTest("evidence", disclosure)).toBe(true);
    expect(isUnderTest("rebuttal", disclosure)).toBe(false);
    expect(isUnderTest(null, disclosure)).toBe(false);
    expect(isUnderTest("evidence", retestDisclosureFor(null))).toBe(false);
    expect(isUnderTest("evidence", null)).toBe(false);
  });

  it("keeps the skill under test out of the visible coaching goal", () => {
    const goal = buildCoachingGoal(POINTS, null, {}, UNDER_TEST);
    expect(goal?.dimension).not.toBe(UNDER_TEST);
    expect(goal?.goalLine ?? "").not.toMatch(/source|evidence|cite|citation/i);
  });

  it("keeps the skill under test out of today's practice target", () => {
    const target = selectNextPractice(SKILLS, [AWAITING]);
    expect(target?.skill).not.toBe(UNDER_TEST);
    expect(target?.label ?? "").not.toMatch(/evidence/i);
    expect(target?.reason ?? "").not.toMatch(/evidence|repaired|test/i);
    expect(target?.observable ?? "").not.toMatch(/evidence|source|cite/i);
  });

  it("keeps the skill under test out of the loop thread and says nothing about today", () => {
    const model = {
      debatesObserved: 4,
      skills: SKILLS,
      repairs: [AWAITING],
      currentFocus: null,
      nextPractice: null,
      questions: {},
      loop: { openLoops: 1 },
    } as never;
    const thread = buildLoopThread(model);
    expect(thread.headline).not.toMatch(/evidence/i);
    expect(thread.detail).not.toMatch(/evidence/i);
    // It must not announce that the debate it is about to run IS the test.
    expect(thread.detail).not.toMatch(/today/i);
    // …but the loop must stay visible: the learner still knows a repair is open.
    expect(thread.headline).toMatch(/waiting to be tested/i);
    expect(thread.detail).toMatch(/practice, not proof/i);
  });

  it("keeps the skill under test out of the priority card and out of today's announcement", () => {
    const action = pickPriority({
      unfinishedRepair: null,
      dueRetest: { label: "Evidence" },
      openDrill: null,
      debateAvailable: true,
    });
    expect(action?.kind).toBe("retest");
    expect(action?.title ?? "").not.toMatch(/evidence/i);
    expect(action?.detail ?? "").not.toMatch(/evidence/i);
    expect(action?.detail ?? "").not.toMatch(/today/i);
  });

  it("does not announce a transfer test in the motion reason", () => {
    const choice = pickRetestMotion(
      [
        { id: "t1", title: "A", prompt: "a", category: "Tech" },
        { id: "t2", title: "B", prompt: "b", category: "Policy" },
      ],
      "t1",
      "Tech",
    );
    expect(choice?.reason ?? "").not.toMatch(/transfer|test|repair/i);
  });

  it("suppresses the live hints that cue the skill under test", () => {
    // The mapping is the contract: every detector cues a known skill.
    expect(LIVE_HINT_SKILLS["no-evidence"]).toContain("evidence");
    expect(LIVE_HINT_SKILLS["unanswered-opponent"]).toContain("rebuttal");
    expect(LIVE_HINT_SKILLS["unanswered-opponent"]).toContain("clarity");
    expect(LIVE_HINT_SKILLS.contradiction).toContain("structure");
    expect(LIVE_HINT_SKILLS["absolute-language"]).toContain("logic");
  });

  it("drops a suppressed hint BEFORE the one-warning/one-tip cap, so another warning can take the slot", () => {
    // A turn that contradicts itself AND leaves the opponent unanswered.
    const assessment = {
      features: {
        a: {
          contradictions: { value: 1 },
          argumentResponses: { value: { responded: 0, opportunities: 2 } },
          claimsMade: { value: 2 },
          evidenceActuallyCited: { value: 0 },
        },
      },
      graph: { nodes: [] },
    } as never;

    const unsuppressed = liveCoachingForTurn({
      assessment,
      round: 2,
      userMessage: "Everyone knows this is true, so it is always the case.",
    });
    // Both a contradiction and an unanswered-opponent are detected, but only
    // one warning is returned.
    expect(unsuppressed.filter((h) => h.severity === "warning")).toHaveLength(1);

    const suppressed = liveCoachingForTurn({
      assessment,
      round: 2,
      userMessage: "Everyone knows this is true, so it is always the case.",
      suppressDimension: "rebuttal",
    });
    // The unanswered-opponent hint is gone (it cues rebuttal) and the
    // contradiction hint has taken the warning slot — the round is not
    // silenced.
    expect(suppressed.map((h) => h.id)).toContain("contradiction");
    expect(suppressed.map((h) => h.id)).not.toContain("unanswered-opponent");
  });
});
