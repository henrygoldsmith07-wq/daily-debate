// Motion personalisation for practice debates.
//
// The shared Daily Debate identity stays: one canonical motion per date.
// Personalisation only chooses, for ONE user's practice session, which motion
// serves them best — and only within rules that protect the measurement:
//
//   - a deliberate retest MUST use a genuinely different topic from the
//     repaired debate (retest measurement depends on it);
//   - repeated exposure to the same category is avoided;
//   - the skill being trained nudges topic difficulty, never topic content;
//   - the shared motion is the default; personalisation is an optional
//     improvement on top, and always explainable in one sentence.
//
// Pure selection over a candidate pool; routes supply the pool and persist.

import type { CoachDimension } from "./adaptiveCoach";

export interface MotionCandidate {
  id: string;
  title: string;
  prompt: string;
  category: string | null;
  /** What the user has already debated with this motion, for exposure checks. */
  debateCount?: number;
}

export interface MotionChoice {
  motion: MotionCandidate;
  /** Plain-language reason shown to the user ("Why this motion?"). */
  reason: string;
  /** True when the choice is the shared daily motion. */
  isDaily: boolean;
}

export interface MotionContext {
  /** The shared motion for today (always a valid choice). */
  daily: MotionCandidate;
  /** Other motions the user could practise on (history + curated pool). */
  alternatives: MotionCandidate[];
  /** Categories of the user's recent debates, newest first. */
  recentCategories: string[];
  /** Category of the debate a queued retest must avoid, if any. */
  retestAvoid?: { topicId: string; category: string | null } | null;
  /** The skill being trained today. */
  focus?: CoachDimension | null;
  /** Rough difficulty preference derived from experience (0 = new, 1 = veteran). */
  experience?: number;
  /** User-selected interest categories, when available. */
  interests?: string[];
}

/** Hard rule: a retest motion must differ from the repaired debate's motion. */
export function pickRetestMotion(
  pool: MotionCandidate[],
  avoidTopicId: string,
  avoidCategory: string | null,
): MotionChoice | null {
  const differentTopic = pool.filter((m) => m.id !== avoidTopicId);
  // Prefer a different category too: transfer is strongest across domains.
  const differentCategory = differentTopic.filter((m) => (m.category ?? "") !== (avoidCategory ?? ""));
  const chosen = differentCategory[0] ?? differentTopic[0] ?? null;
  if (!chosen) return null;
  return {
    motion: chosen,
    reason:
      (chosen.category ?? "") !== (avoidCategory ?? "")
        ? "A different topic from the debate you repaired — the point is to see the skill transfer, not recall."
        : "A different motion from the debate you repaired, so this tests transfer rather than recall.",
    isDaily: false,
  };
}

const CATEGORY_DIFFICULTY: Record<string, number> = {
  Technology: 0.5,
  Policy: 0.7,
  Economics: 0.8,
  Science: 0.6,
  Education: 0.4,
  Environment: 0.5,
  Medicine: 0.8,
  Ethics: 0.6,
  Transport: 0.4,
  Agriculture: 0.5,
  Infrastructure: 0.5,
  Privacy: 0.6,
  Security: 0.7,
};

/**
 * Pick today's practice motion. Default is the shared daily motion; a
 * personalised pick happens only when it clearly beats repetition. The
 * selection is deterministic given the same context, so the same user on the
 * same day always sees the same choice.
 */
export function pickPracticeMotion(ctx: MotionContext): MotionChoice {
  const { daily, alternatives, recentCategories, focus, experience = 0, interests = [] } = ctx;

  // Retest avoidance is a hard rule (measurement integrity) and is handled by
  // the caller before this function; nothing here may contradict it.
  const recent = new Set(recentCategories.filter(Boolean));
  const repeatsToday = alternatives.find((m) => m.id === daily.id);
  const exposure = repeatsToday?.debateCount ?? 0;

  // Score personalised candidates: variety (novel category), interest match,
  // difficulty proximity to the user's experience, and skill fit.
  const scored = alternatives
    .filter((m) => m.id !== daily.id)
    .map((m) => {
      const category = m.category ?? "";
      let score = 0;
      if (!recent.has(category)) score += 3;
      if (interests.includes(category)) score += 2;
      const difficulty = CATEGORY_DIFFICULTY[category] ?? 0.5;
      // Close to the user's experience band reads as "appropriate, not stale".
      score += 2 - Math.abs(difficulty - (0.3 + experience * 0.5)) * 3;
      if (focus === "evidence" && /data|study|research|evidence|survey/i.test(m.prompt)) score += 1;
      if (focus === "rebuttal" && /trade-?off|versus|versus|risk|harm/i.test(m.prompt)) score += 1;
      return { motion: m, score };
    })
    .sort((a, b) => b.score - a.score || a.motion.id.localeCompare(b.motion.id));

  const best = scored[0]?.motion ?? null;

  // Personalisation earns its place only when the daily motion is stale
  // (already debated) or clearly repetitive, and a meaningfully better
  // alternative exists.
  const dailyStale = exposure > 0 || recent.has(daily.category ?? "");
  if (!best || !dailyStale) {
    return {
      motion: daily,
      reason: exposure > 0 ? "Today's shared motion." : "Today's shared Daily Debate motion.",
      isDaily: true,
    };
  }

  const reasonParts: string[] = [];
  if (!recent.has(best.category ?? "")) reasonParts.push(`a ${best.category?.toLowerCase() ?? "new"} topic you haven't touched recently`);
  if (interests.includes(best.category ?? "")) reasonParts.push("one of your selected interests");
  return {
    motion: best,
    reason: `Picked for variety — ${reasonParts.join(" and ") || "a fresh topic"} — while today's shared motion stays available.`,
    isDaily: false,
  };
}

/**
 * The one-sentence "why this motion" line for the Today screen. Always
 * honest: no optimisation language, no personalisation claims without a basis.
 */
export function motionReasonLine(choice: MotionChoice, ctx: MotionContext): string {
  if (choice.isDaily) {
    return "Everyone debates this motion today — then your own loop picks what you train on it.";
  }
  if (ctx.retestAvoid && choice.motion.id !== ctx.retestAvoid.topicId) {
    return choice.reason;
  }
  return choice.reason;
}
