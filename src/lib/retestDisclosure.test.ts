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
import { isUnderTest, retestDisclosureFor, skillsUnderTest, RETEST_PENDING_DETAIL } from "./retestDisclosure";
import { repairSuccessTransition } from "./retest";
import type { SkillMetricPoint } from "./skillLedger";
import type { CoachDimension } from "./adaptiveCoach";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readSource = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, "src", ...parts), "utf8");

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

  it("takes EVERY pending retest's skill, not just the topic-eligible one", () => {
    // The leak this closes: today's motion can be the very topic the learner
    // repaired, so the topic-eligible retest is empty while the app
    // retargets the motion and the debate becomes the test. Excluding only
    // the eligible one would name the skill on exactly that day. And with two
    // open loops, BOTH skills are under test — the learner cannot know which
    // one the next debate will carry.
    const pending = [{ dimension: "evidence" as CoachDimension }, { dimension: "rebuttal" as CoachDimension }];
    expect(skillsUnderTest(pending)).toEqual(["evidence", "rebuttal"]);
    // A duplicate skill is one skill, not two.
    expect(skillsUnderTest([...pending, { dimension: "evidence" as CoachDimension }])).toEqual([
      "evidence",
      "rebuttal",
    ]);
    expect(skillsUnderTest([])).toEqual([]);
    expect(skillsUnderTest(null)).toEqual([]);
    expect(skillsUnderTest(undefined)).toEqual([]);
  });

  it("the pre-debate surfaces exclude the pending retest's skill, not the eligible one", () => {
    // The three surfaces that read the coaching context (dashboard,
    // progress, drill coach) must use the pending queue.
    const dashboard = readSource("app", "page.tsx");
    const progress = readSource("app", "progress", "page.tsx");
    const drillCoach = readSource("app", "api", "coach", "today", "route.ts");
    for (const source of [dashboard, progress, drillCoach]) {
      expect(source).toContain("skillsUnderTest(");
      // The topic-eligible retest is NOT the exclusion source.
      expect(source).not.toMatch(/buildCoachingGoal\([^)]*selectedRetest/);
    }
  });

  it("the dashboard's motion personalisation excludes the same skill", () => {
    // The dashboard's focus feeds the per-skill topic bonus, so steering
    // today's motion toward the skill under silent test leaks it — the one
    // place that used to differ from every other surface.
    const dashboard = readSource("app", "page.tsx");
    expect(dashboard).not.toMatch(/pickFocusDimension\([\s\S]{0,200}selectedRetest\?\.dimension/);
    expect(dashboard).toMatch(
      /pickFocusDimension\([\s\S]{0,200}skillsUnderTest\(coachingContext\.pendingRetests\)/,
    );
  });

  it("the debate's own coaching goal excludes the same skill", () => {
    // startDebate coaches the debate BEFORE it starts, so the exclusion has
    // to hold there too — and it must be the whole PENDING queue, not the
    // topic-eligible one.
    const startDebate = readSource("lib", "solo", "startDebate.ts");
    expect(startDebate).toMatch(/pickFocus(?:Dimension)?\([\s\S]{0,220}skillsUnderTest\(context\.pendingRetests\)/);
    expect(startDebate).not.toMatch(/pickFocus(?:Dimension)?\([\s\S]{0,220}pendingRetest\?\.dimension/);
  });

  it("the Argument DNA page excludes the skill under test too", () => {
    // /dna names the learner's "current focus". Leaving the exclusion out made
    // it the one surface that could name the skill under silent test.
    const dna = readSource("app", "dna", "page.tsx");
    expect(dna).toContain("skillsUnderTest(");
    expect(dna).toContain("pendingRetests");
  });

  it("no pre-debate surface ties the test to a day or a specific debate", () => {
    // The product guarantees it does not signpost the skill or the day. It
    // must not overstate that into "the test is not signposted" either — a
    // loop the learner cannot see is a loop the learner cannot value.
    expect(RETEST_PENDING_DETAIL).toMatch(/never signposted/i);
    expect(RETEST_PENDING_DETAIL).not.toMatch(/it isn.t signposted/i);
    expect(RETEST_PENDING_DETAIL).not.toMatch(/\btoday\b/i);
    expect(RETEST_PENDING_DETAIL).not.toMatch(/your next debate/i);

    // The post-repair transition names the skill (the learner just repaired
    // it) but must not tie the test to a debate.
    const transition = repairSuccessTransition("rebuttal", "Rebuttal");
    expect(transition.body).not.toMatch(/\btoday\b/i);
    expect(transition.body).not.toMatch(/your next debate/i);

    // The result card's post-repair line must not tie the test to the very
    // next debate either.
    const resultCard = readSource("components", "debate", "DebateResultCard.tsx");
    expect(resultCard).not.toMatch(/triggered by your next debate/i);

    // The loop thread's stage captions describe the method, never "now".
    const loopThread = readSource("lib", "loopThread.ts");
    expect(loopThread).not.toMatch(/no cues this time/i);
    expect(loopThread).not.toMatch(/unprompted is the only thing/i);
  });

  it("keeps the skill under test out of the visible coaching goal", () => {
    const goal = buildCoachingGoal(POINTS, null, {}, [UNDER_TEST]);
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

  it("keeps BOTH open loops out of the practice target, not just the first one", () => {
    // The leak this closes: the practice target derived its own exclusion
    // from the repair list, which orders skills by taxonomy key. The pending
    // queue orders them by age — the one the next debate will carry. With two
    // open loops the two orders disagree, and the target could name the
    // oldest pending skill — the exact skill the next debate will test.
    const twoLoops: SkillRepairState[] = [
      { ...AWAITING, skill: "impact", label: "Impact" },
      { ...AWAITING, skill: "rebuttal", label: "Rebuttal" },
    ];
    const skills: SkillReading[] = [
      reading("impact", "Impact", 0.2),
      reading("rebuttal", "Rebuttal", 0.3),
      reading("evidence", "Evidence", 0.9),
    ];
    // The pending queue, oldest first: impact is the next debate's retest.
    const pending = skillsUnderTest([
      { dimension: "impact" as CoachDimension },
      { dimension: "rebuttal" as CoachDimension },
    ]);
    const target = selectNextPractice(skills, twoLoops, pending);
    expect(pending).toEqual(["impact", "rebuttal"]);
    expect(target?.skill).not.toBe("impact");
    expect(target?.skill).not.toBe("rebuttal");
    expect(target?.label ?? "").not.toMatch(/impact|rebuttal/i);
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
      dueRetest: {},
      openDrill: null,
      debateAvailable: true,
    });
    expect(action?.kind).toBe("retest");
    expect(action?.title ?? "").not.toMatch(/evidence/i);
    expect(action?.detail ?? "").not.toMatch(/evidence/i);
    expect(action?.detail ?? "").not.toMatch(/today/i);
  });

  it("the retest priority input cannot carry a skill name at all", () => {
    // The dashboard used to build a label for the pending retest from the
    // VISIBLE goal's dimension — which is by definition a different skill, so
    // the label was wrong as well as unnecessary. The field is removed, and
    // the input type no longer has a place to put one.
    const dailyFocus = readSource("lib", "dailyFocus.ts");
    expect(dailyFocus).not.toMatch(/dueRetest:\s*\{[^}]*label:/);
    const dashboard = readSource("app", "page.tsx");
    expect(dashboard).not.toMatch(/pendingRetestLabel/);
    expect(dashboard).not.toMatch(/RETEST_SKILL_LABEL/);
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
