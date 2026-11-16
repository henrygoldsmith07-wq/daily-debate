import "server-only";
import { createServiceClient } from "@/lib/backend/server";
import { prefsFromEvents, type ReminderOutcomeEvent, type ReminderPrefs } from "@/lib/reminderDelivery";

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

/** M18: reminder_sent / reminder_acted events for /analytics, per user, best-effort. */
export async function loadReminderOutcomeEvents(): Promise<{ userId: string; event: ReminderOutcomeEvent }[] | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("product_events")
      .select("user_id, name, created_at")
      .in("name", ["reminder_sent", "reminder_acted"])
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) return null;
    return (data ?? []).map((r) => ({
      userId: r.user_id as string,
      event:
        r.name === "reminder_sent"
          ? { type: "reminder_sent" as const, sentAt: new Date(r.created_at as string).toISOString() }
          : { type: "reminder_acted" as const, actedAt: new Date(r.created_at as string).toISOString() },
    }));
  } catch {
    return null;
  }
}

/** M20: weekly_recap_viewed rows for /analytics, best-effort. */
export async function loadRecapViewRows(): Promise<{ userId: string }[] | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("product_events")
      .select("user_id")
      .eq("name", "weekly_recap_viewed")
      .not("user_id", "is", null)
      .limit(5000);
    if (error) return null;
    return (data ?? []).map((r) => ({ userId: r.user_id as string }));
  } catch {
    return null;
  }
}
