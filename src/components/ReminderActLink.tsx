"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/trackClientEvent";

/** M18: records reminder_acted when the learner follows the reminder to their due step. */
export default function ReminderActLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-2 inline-block text-xs font-semibold underline" data-testid="reminder-act" onClick={() => trackEvent("reminder_acted")}>
      {children}
    </Link>
  );
}
