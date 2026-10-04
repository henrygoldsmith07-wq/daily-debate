// Practice motion resolution — one motion per user per session, chosen under
// rules that protect the measurement.
//
// The shared daily motion stays the product's identity; personalisation only
// decides which motion best serves ONE user's practice today, and only within
// hard constraints:
//   - a deliberate retest MUST use a different topic from the repaired debate;
//   - repeated exposure to the same category is avoided;
//   - the motion is always explainable in one sentence.
//
// Server module (DB access); the selection rules live in topicPersonalisation.ts.

import { createServiceClient } from "./backend/server";
import { getTodayTopic } from "./dailyTopic";
import {
  pickPracticeMotion,
  pickRetestMotion,
  motionReasonLine,
  type MotionCandidate,
  type MotionChoice,
} from "./topicPersonalisation";
import type { CoachDimension } from "./adaptiveCoach";
import type { DailyTopic } from "./types";

export interface PracticeMotion {
  topic: DailyTopic;
  choice: MotionChoice;
  reasonLine: string;
  /** Set when this motion is a deliberate retest of a specific repair. */
  retest: {
    repairId: string;
    kind: string;
    repairedTopicId: string | null;
    repairedTopicTitle: string | null;
    repairedAt: string;
    focus: CoachDimension | null;
  } | null;
}

interface RepairRow {
  id: string;
  debate_id: string;
  target_kind: string;
  created_at: string;
  retest_debate_id: string | null;
}

/**
 * Resolve the motion for this user's next practice session.
 * `dueRetest` is passed by the caller (Today already knows the priority
 * order); when present the different-topic rule decides everything.
 */
export async function resolvePracticeMotion(opts: {
  dueRetest: {
    repair: RepairRow;
    repairedTopicId: string | null;
    repairedTopicTitle: string | null;
    focus: CoachDimension | null;
  } | null;
  focus?: CoachDimension | null;
}): Promise<PracticeMotion> {
  const db = createServiceClient();
  const daily = await getTodayTopic();

  // Candidate pool: the shared daily motion + recent stored motions the user
  // has not debated. Real rows only — every candidate id is a valid topic_id.
  const [{ data: recentTopics }, { data: recentDebates }] = await Promise.all([
    db
      .from("daily_topics")
      .select("id, title, prompt, category")
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("solo_debates")
      .select("topic_id, completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(10),
  ]);

  const debatedTopicIds = new Set((recentDebates ?? []).map((d) => d.topic_id as string));
  const candidates: MotionCandidate[] = (recentTopics ?? [])
    .map((t) => ({
      id: t.id as string,
      title: t.title as string,
      prompt: t.prompt as string,
      category: (t.category as string | null) ?? null,
      debateCount: debatedTopicIds.has(t.id as string) ? 1 : 0,
    }))
    .filter((t) => t.id === daily.id || !debatedTopicIds.has(t.id));

  const pool = candidates.length ? candidates : [
    { id: daily.id, title: daily.title, prompt: daily.prompt, category: daily.category },
  ];

  // ── Deliberate retest: the different-topic rule decides the motion ──────
  if (opts.dueRetest) {
    const { repair, repairedTopicId, repairedTopicTitle, focus } = opts.dueRetest;
    const repairedTopic = repairedTopicId
      ? (recentTopics ?? []).find((t) => t.id === repairedTopicId)
      : null;
    const repairedCategory =
      (repairedTopic?.category as string | null) ??
      // The repaired debate's topic may be older than the pool window; its
      // category is only a preference, the id is the hard rule.
      null;
    const choice =
      pickRetestMotion(pool, repairedTopicId ?? repair.debate_id, repairedCategory) ??
      // Nothing else available: any motion with a different id satisfies the
      // measurement rule; if even that is impossible, fall back to the daily
      // motion and say so honestly.
      ({ motion: pool[0], reason: "The only motion available today — note that it reuses your repaired topic.", isDaily: pool[0].id === daily.id });

    return {
      topic: await topicRowFor(db, choice.motion.id, daily),
      choice,
      reasonLine: motionReasonLine(choice, {
        daily: { id: daily.id, title: daily.title, prompt: daily.prompt, category: daily.category },
        alternatives: pool,
        recentCategories: [],
        retestAvoid: { topicId: repairedTopicId ?? repair.debate_id, category: repairedCategory },
        focus,
      }),
      retest: {
        repairId: repair.id,
        kind: repair.target_kind,
        repairedTopicId,
        repairedTopicTitle,
        repairedAt: repair.created_at,
        focus,
      },
    };
  }

  // ── Ordinary practice: shared motion by default, personalised when it     ─
  //    clearly beats repetition.
  const recentCategories = (recentDebates ?? [])
    .map((d) => (recentTopics ?? []).find((t) => t.id === d.topic_id)?.category as string | null)
    .filter((c): c is string => !!c);
  const choice = pickPracticeMotion({
    daily: { id: daily.id, title: daily.title, prompt: daily.prompt, category: daily.category },
    alternatives: pool,
    recentCategories,
    focus: opts.focus ?? null,
    experience: Math.min(1, (recentDebates?.length ?? 0) / 10),
  });
  return {
    topic: await topicRowFor(db, choice.motion.id, daily),
    choice,
    reasonLine: motionReasonLine(choice, {
      daily: { id: daily.id, title: daily.title, prompt: daily.prompt, category: daily.category },
      alternatives: pool,
      recentCategories,
      focus: opts.focus ?? null,
    }),
    retest: null,
  };
}

/** Full topic row for a candidate id; the shared daily row is the fallback. */
async function topicRowFor(
  db: ReturnType<typeof createServiceClient>,
  id: string,
  daily: DailyTopic,
): Promise<DailyTopic> {
  if (id === daily.id) return daily;
  const { data } = await db.from("daily_topics").select("*").eq("id", id).maybeSingle();
  return (data as unknown as DailyTopic) ?? daily;
}
