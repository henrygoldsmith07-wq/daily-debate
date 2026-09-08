// Product analytics — lightweight, privacy-conscious funnel events.
//
// Events carry no free text, no transcript content, and no identifiers beyond
// the session's own user id (server-side, when a user is signed in). They exist
// to answer product questions like "do people finish sprints?" and "does the
// repair loop get used?" — nothing else. Fire-and-forget: a failed write must
// never break a user flow.

import { createClient } from "@/lib/backend/server";

export type ProductEventName =
  | "daily_viewed"
  | "debate_started"
  | "sprint_started"
  | "full_debate_started"
  | "round_completed"
  | "debate_completed"
  | "repair_started"
  | "repair_completed"
  | "full_analysis_opened"
  | "progress_viewed"
  | "pvp_started"
  | "challenge_me_selected"
  | "challenge_link_created"
  | "challenge_link_accepted";

export interface ProductEventContext {
  format?: "sprint" | "full";
  side?: string | null;
  reason?: string | null;
  round?: number | null;
  repairScore?: number | null;
}

export const PRODUCT_EVENT_NAMES: readonly ProductEventName[] = [
  "daily_viewed",
  "debate_started",
  "sprint_started",
  "full_debate_started",
  "round_completed",
  "debate_completed",
  "repair_started",
  "repair_completed",
  "full_analysis_opened",
  "progress_viewed",
  "pvp_started",
  "challenge_me_selected",
  "challenge_link_created",
  "challenge_link_accepted",
] as const;

function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
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
    // Keep only bounded, non-free-text fields.
    await db.from("product_events").insert({
      user_id: user.id,
      name,
      format: context.format ?? null,
      side: context.side ?? null,
      reason: context.reason ?? null,
      round: context.round ?? null,
      repair_score: context.repairScore ?? null,
    });
  } catch {
    // Never let telemetry break a user flow.
  }
}
