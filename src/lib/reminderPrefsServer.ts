import "server-only";
import { createServiceClient } from "@/lib/backend/server";
import { prefsFromEvents, type ReminderPrefs } from "@/lib/reminderDelivery";

/** M18: opt-in state read from product_events (no migration). Best-effort. */
export async function loadReminderPrefs(userId: string): Promise<ReminderPrefs> {
  const db = createServiceClient();
  const { data } = await db
    .from("product_events")
    .select("name, created_at")
    .eq("user_id", userId)
    .in("name", ["reminder_opted_in", "reminder_opted_out"])
    .order("created_at", { ascending: false })
    .limit(10);
  return prefsFromEvents((data ?? []).map((r) => ({ name: r.name, createdAt: r.created_at })));
}
