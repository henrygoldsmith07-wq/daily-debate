"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/trackClientEvent";

/** M18: opt-in in-app reminders for due retests. Off by default; unvalidated. */
export default function ReminderOptInPanel({ initialOptedIn }: { initialOptedIn: boolean }) {
  const [optedIn, setOptedIn] = useState(initialOptedIn);
  function toggle() {
    const next = !optedIn;
    setOptedIn(next);
    trackEvent(next ? "reminder_opted_in" : "reminder_opted_out");
  }
  return (
    <section className="surface-card p-5" aria-labelledby="reminder-heading" data-testid="reminder-optin" data-opted-in={optedIn}>
      <h2 id="reminder-heading" className="text-sm font-semibold">Retest reminders</h2>
      <p className="mt-1 text-xs text-ink3">
        Off unless you turn it on. One nudge per step at most once a day, never between 21:00 and 08:00. We do not claim reminders improve results.
      </p>
      <button type="button" className="btn-secondary mt-3" onClick={toggle} aria-pressed={optedIn} data-testid="reminder-toggle">
        {optedIn ? "Turn reminders off" : "Remind me when a retest is due"}
      </button>
    </section>
  );
}
