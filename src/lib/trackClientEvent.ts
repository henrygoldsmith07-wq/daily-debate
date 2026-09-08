"use client";

// Client-side product analytics helper. Fire-and-forget: never awaits, never
// blocks a user action, and silently ignores failures. Sends only allowlisted
// event names with bounded context — no free text leaves the component.

export type ClientEventName =
  | "daily_viewed"
  | "full_analysis_opened"
  | "progress_viewed"
  | "pvp_started"
  | "repair_started"
  | "debate_completed";

export function trackEvent(
  name: ClientEventName,
  context: { format?: "sprint" | "full"; side?: string; reason?: string } = {},
): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...context }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never break a user flow.
  }
}
