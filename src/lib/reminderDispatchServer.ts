import "server-only";
import { createServiceClient } from "@/lib/backend/server";
import { recordProductEventForUser } from "@/lib/productEvents";
import { loadReminderPrefs } from "@/lib/reminderPrefsServer";
import { decideDispatch, reminderMessage, type ReminderMessage } from "@/lib/reminderDelivery";
import type { ReminderInput } from "@/lib/retestReminder";

/**
 * M18 slice 3: in-app delivery. Called when an opted-in learner loads Today.
 * Records one reminder_sent event (24h cap read from product_events) and
 * returns the message to show. Best-effort: any failure returns null.
 */
export async function deliverInAppReminder(
  userId: string,
  items: readonly ReminderInput[],
  now: Date,
): Promise<ReminderMessage | null> {
  try {
    if (items.length === 0) return null;
    const prefs = await loadReminderPrefs(userId);
    if (!prefs.optedIn) return null;
    const db = createServiceClient();
    const { data } = await db
      .from("product_events")
      .select("created_at")
      .eq("user_id", userId)
      .eq("name", "reminder_sent")
      .order("created_at", { ascending: false })
      .limit(1);
    const last = (data?.[0]?.created_at as string | undefined) ?? null;
    const decision = decideDispatch(items, prefs, last, now);
    if (!decision.send) return null;
    await recordProductEventForUser(userId, "reminder_sent");
    return reminderMessage(decision);
  } catch {
    return null;
  }
}
