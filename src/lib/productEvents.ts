// Product analytics — lightweight, privacy-conscious funnel events.
//
// Events carry no free text, no transcript content, and no identifiers beyond
// the session's own user id (server-side, when a user is signed in). They exist
// to answer product questions like "do people finish sprints?" and "does the
// repair loop get used?" — nothing else. Server routes await best-effort writes
// so serverless shutdown cannot silently drop them; failed telemetry still
// never breaks a user flow.

import { createClient, createServiceClient } from "@/lib/backend/server";
import type { ChallengeRule } from "./challengeMe";
import type { RepairState } from "./argumentRepair";

export type ProductEventReason =
  | ChallengeRule
  | RepairState
  | "evidence"
  | "rebuttal"
  | "logic"
  | "impact"
  | "structure"
  | "clarity";

export const PRODUCT_EVENT_REASONS: readonly ProductEventReason[] = [
  "random-cold-start",
  "side-balance",
  "performance-gap",
  "alternation-fallback",
  "needs_another_pass",
  "partially_repaired",
  "repair_demonstrated",
  "evidence",
  "rebuttal",
  "logic",
  "impact",
  "structure",
  "clarity",
] as const;

export type ProductEventName =
  | "daily_viewed"
  | "debate_started"
  | "sprint_started"
  | "full_debate_started"
  | "round_completed"
  | "debate_completed"
  | "repair_started"
  | "repair_attempted"
  | "repair_demonstrated"
  | "repair_episode_closed"
  | "repair_completed"
  | "retest_started"
  | "retest_completed"
  | "retest_skill_demonstrated"
  | "full_analysis_opened"
  | "progress_viewed"
  | "pvp_started"
  | "challenge_me_selected"
  | "challenge_link_created"
  | "challenge_link_accepted";

export interface ProductEventContext {
  format?: "sprint" | "full";
  side?: "for" | "against" | null;
  reason?: ProductEventReason | null;
  round?: number | null;
  repairScore?: number | null;
  /** Bounded flow identifier (the debate row's UUID) for session-level funnels. */
  debateId?: string | null;
}

export const PRODUCT_EVENT_NAMES: readonly ProductEventName[] = [
  "daily_viewed",
  "debate_started",
  "sprint_started",
  "full_debate_started",
  "round_completed",
  "debate_completed",
  "repair_started",
  "repair_attempted",
  "repair_demonstrated",
  "repair_episode_closed",
  "repair_completed",
  "retest_started",
  "retest_completed",
  "retest_skill_demonstrated",
  "full_analysis_opened",
  "progress_viewed",
  "pvp_started",
  "challenge_me_selected",
  "challenge_link_created",
  "challenge_link_accepted",
] as const;

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

export function isProductEventReason(value: unknown): value is ProductEventReason {
  return typeof value === "string" && (PRODUCT_EVENT_REASONS as readonly string[]).includes(value);
}

/**
 * Persist an event for an already-authenticated user. This avoids repeating a
 * session lookup inside API routes and, because callers await it, avoids
 * dropping writes when a serverless invocation is frozen after the response.
 */
export async function recordProductEventForUser(
  userId: string,
  name: ProductEventName,
  context: ProductEventContext = {},
): Promise<void> {
  try {
    if (!isProductEventName(name)) return;
    if (context.reason !== undefined && context.reason !== null && !isProductEventReason(context.reason)) return;
    const db = createServiceClient();
    await db.from("product_events").insert({
      user_id: userId,
      name,
      format: context.format ?? null,
      side: context.side ?? null,
      reason: context.reason ?? null,
      round: context.round ?? null,
      repair_score: context.repairScore ?? null,
      debate_id: context.debateId ?? null,
    });
  } catch {
    // Analytics must never break the training loop.
  }
}

/**
 * Record a product event for the signed-in user. Returns silently on any
 * failure — analytics must never break the training loop. Guests are skipped
 * (no session row to attach the event to).
 */
export async function recordProductEvent(
  name: ProductEventName,
  context: ProductEventContext = {},
): Promise<void> {
  try {
    if (!isProductEventName(name)) return;
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;
    await recordProductEventForUser(user.id, name, context);
  } catch {
    // Never let telemetry break a user flow.
  }
}
