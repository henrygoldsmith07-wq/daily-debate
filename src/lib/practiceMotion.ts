// Practice motion resolution — one motion per user per session, chosen under
// rules that protect the measurement.
//
// The shared daily motion stays the product's identity and the default; this
// module only swaps it when the swap clearly serves the user:
//
//   - a due deliberate retest needs a genuinely different topic from the
//     repaired debate — if today's shared motion collides with that topic, a
//     different motion is served so the retest can actually happen (the
//     different-topic rule is the measurement, never decoration);
//   - a repair made today never becomes a same-day "retest": the retest stays
//     queued for a later session, and the shared motion stands;
//   - with no retest due, repeated exposure to the same category is softened
//     by a personalised pick, and the reason is always one honest sentence.
//
// Server module (DB access); the pure selection rules live in
// topicPersonalisation.ts and are covered by its own tests.

import { createServiceClient } from "./backend/server";
import {
  pickPracticeMotion,
  pickRetestMotion,
  motionReasonLine,
  type MotionCandidate,
  type MotionChoice,
} from "./topicPersonalisation";
import type { CoachDimension } from "./adaptiveCoach";
import { isDifferentRetestContext } from "./repairRetest";
import type { DailyTopic } from "./types";

export interface ResolvedMotion {
  topic: DailyTopic;
  /** One-sentence "why this motion", or null when it is simply today's shared motion. */
  reasonLine: string | null;
  /** True when the shared daily motion is being served unchanged. */
  isShared: boolean;
  /** The retest this motion is meant to serve, if any. */
  servesRetest: boolean;
}

export interface DueRetest {
  /** Topic of the REPAIRED debate — the retest must differ from it. */
  topicId: string | null;
  /** When the repair happened (ISO). A repair made today never retests today. */
  attemptedAt: string;
  dimension: CoachDimension;
}

/** How many historical motions form the personalisation pool. */
const POOL_LIMIT = 30;
/** How many recent debates drive the exposure-avoidance read. */
const HISTORY_LIMIT = 10;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Resolve the motion for this user's next practice session. `dueRetest` is the
 * oldest unresolved repair retest (the caller already holds coaching context);
 * when it is due, the different-topic rule decides everything else.
 */
export async function resolvePracticeMotion(input: {
  userId: string;
  shared: DailyTopic;
  dueRetest: DueRetest | null;
  focus?: CoachDimension | null;
}): Promise<ResolvedMotion> {
  const { userId, shared, dueRetest, focus = null } = input;
  const db = createServiceClient();

  const [{ data: poolRows }, { data: recentDebates }] = await Promise.all([
    db
      .from("daily_topics")
      .select("id, title, prompt, category")
      .order("created_at", { ascending: false })
      .limit(POOL_LIMIT),
    db
      .from("solo_debates")
      .select("topic_id")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  const pool: MotionCandidate[] = (poolRows ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    prompt: row.prompt as string,
    category: (row.category as string | null) ?? null,
  }));
  const alternatives = pool.filter((m) => m.id !== shared.id);
  const daily: MotionCandidate = {
    id: shared.id,
    title: shared.title,
    prompt: shared.prompt,
    category: shared.category,
  };

  // Exposure read: categories of the debates this user actually did recently.
  const debatedIds = (recentDebates ?? []).map((row) => row.topic_id as string);
  const recentCategories = debatedIds.length
    ? (pool.filter((m) => debatedIds.includes(m.id)).map((m) => m.category ?? "").filter(Boolean))
    : [];

  // ── A retest is due: the different-topic rule decides the motion ─────────
  if (dueRetest) {
    // Canonical eligibility (repairRetest.ts): the retest only counts on a
    // genuinely different topic, and a repair made today never retests today —
    // a same-day replay of the repaired motion is practice, not transfer.
    const eligibleNow = isDifferentRetestContext(dueRetest.topicId, shared.id);
    if (eligibleNow) {
      return { topic: shared, reasonLine: null, isShared: true, servesRetest: true };
    }

    const repairedToday = dayOf(dueRetest.attemptedAt) === todayIso();
    const collides = dueRetest.topicId === shared.id;
    if (collides && !repairedToday && dueRetest.topicId) {
      // The retest is due but today's motion would reuse the repaired topic.
      // Serve a different motion so the retest can actually happen.
      const repairedCategory = pool.find((m) => m.id === dueRetest.topicId)?.category ?? null;
      const choice = pickRetestMotion([shared, ...alternatives], dueRetest.topicId, repairedCategory);
      if (choice && isDifferentRetestContext(dueRetest.topicId, choice.motion.id)) {
        return {
          topic: await fullTopicFor(db, choice.motion.id, shared),
          reasonLine: motionReasonLine(choice, {
            daily,
            alternatives,
            recentCategories,
            retestAvoid: { topicId: dueRetest.topicId, category: repairedCategory },
            focus: dueRetest.dimension,
          }),
          isShared: false,
          servesRetest: true,
        };
      }
    }
    // Same-topic collision (or an unverifiable repaired topic): keep the
    // shared motion and let the retest stay queued rather than break the
    // measurement.
    return { topic: shared, reasonLine: null, isShared: true, servesRetest: false };
  }

  // ── No retest due: shared motion by default, personalised when stale ─────
  const choice: MotionChoice = pickPracticeMotion({
    daily,
    alternatives,
    recentCategories,
    focus,
    experience: Math.min(1, debatedIds.length / HISTORY_LIMIT),
  });
  return {
    topic: choice.isDaily ? shared : await fullTopicFor(db, choice.motion.id, shared),
    reasonLine: choice.isDaily ? null : motionReasonLine(choice, { daily, alternatives, recentCategories, focus }),
    isShared: choice.isDaily,
    servesRetest: false,
  };
}

/** Full topic row for a pool id; the shared daily row is the fallback. */
async function fullTopicFor(
  db: ReturnType<typeof createServiceClient>,
  id: string,
  shared: DailyTopic,
): Promise<DailyTopic> {
  if (id === shared.id) return shared;
  const { data } = await db.from("daily_topics").select("*").eq("id", id).maybeSingle();
  return (data as unknown as DailyTopic) ?? shared;
}
