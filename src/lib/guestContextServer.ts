import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/backend/server";
import { parseGuestLoopSummary, type GuestLoopSummary } from "./guestLoop";

/**
 * Read the guest practice loop a user completed before signing up.
 *
 * The write path has stored this on `profiles.guest_context` since migration
 * 036, but nothing ever read it back — so the signup copy promised the account
 * "keeps the weakness, repair and later retest connected" while the first
 * signed-in experience actually started from zero. This is the read side.
 *
 * Deliberately NOT fed into the skill ledger or any score. A guest rep is a
 * local, unauthenticated, single-sample practice run; counting it as an
 * observed debate would let an unvalidated instrument claim measurement it
 * never made. It is context for the first rep, labelled as such.
 *
 * Tolerates a schema-lagging database exactly like the write path: a missing
 * column (migration 036 not applied) degrades to null rather than failing the
 * page.
 */
export const getGuestContext = cache(async (userId: string): Promise<GuestLoopSummary | null> => {
  const db = await createClient();
  const { data, error } = await db
    .from("profiles")
    .select("guest_context")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  // Re-validate on read for the same reason the write path does: the column is
  // jsonb and a hand-edited or legacy row must not reach a surface unvalidated.
  return parseGuestLoopSummary((data as { guest_context?: unknown }).guest_context);
});
