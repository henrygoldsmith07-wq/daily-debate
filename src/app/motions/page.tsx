import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import PastMotionStart from "@/components/PastMotionStart";
import { loadPastMotions } from "@/lib/pastMotionsServer";
import { PAST_MOTION_DAYS } from "@/lib/pastMotions";

export const metadata = { title: "Past motions · Daily Debate" };

/**
 * The last 30 daily motions (Kialo Edu's topic library, Practice Debate's
 * resolution library). Today's motion stays on Today; this is for the days
 * a learner missed or wants to argue again.
 */
export default async function PastMotionsPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return (
      <AppShell width="narrow">
        <SignedOut title="Sign in to debate past motions" description="Any of the last 30 daily motions, against the AI opponent." />
      </AppShell>
    );
  }

  const motions = await loadPastMotions(user.id);

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Practice"
        title="Past motions"
        description={`The last ${PAST_MOTION_DAYS} daily motions. Today's is on Today.`}
      />
      {motions === null ? (
        <div className="surface-card p-5" role="alert">
          <p className="text-sm font-semibold text-[var(--bad)]">Past motions could not be loaded</p>
          <p className="mt-1 text-sm text-ink3">This is a temporary read problem. Reload to try again.</p>
        </div>
      ) : motions.length === 0 ? (
        <div className="surface-card p-5">
          <p className="text-sm text-ink3">
            No past motions yet. <Link href="/" className="underline">Debate today&apos;s</Link>.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="past-motions">
          {motions.map((motion) => (
            <li key={motion.id} className="surface-card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="past-motion">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink3 tabular">
                  {motion.day}
                  {motion.category ? ` · ${motion.category}` : ""}
                  {motion.debated ? " · Debated" : ""}
                </p>
                <p className="mt-0.5 text-sm font-semibold">{motion.title}</p>
              </div>
              <PastMotionStart topicId={motion.id} activeDebateId={motion.activeDebateId} />
            </li>
          ))}
        </ol>
      )}
    </AppShell>
  );
}
