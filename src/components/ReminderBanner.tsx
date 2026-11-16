import ReminderActLink from "@/components/ReminderActLink";
import type { ReminderMessage } from "@/lib/reminderDelivery";

/** M18: shown once per 24h to opted-in learners with a due step. Unvalidated. */
export default function ReminderBanner({ message }: { message: ReminderMessage }) {
  return (
    <section className="surface-card p-4" role="status" data-testid="reminder-banner">
      <p className="text-sm font-semibold">{message.subject}</p>
      <p className="mt-1 text-xs text-ink3">{message.body}</p>
      <ReminderActLink href="/history">See what is due</ReminderActLink>
    </section>
  );
}
