import Link from "next/link";
import { streakCopy, type LoopStreak } from "@/lib/loopStreak";

/** M16: consecutive-day loop completion. Counts only; unvalidated. */
export default function LoopStreakPanel({ streak }: { streak: LoopStreak }) {
  if (streak.activeDays === 0) return null;
  return (
    <section className="surface-card p-5" aria-labelledby="loop-streak-heading" data-testid="loop-streak" data-status={streak.status}>
      <h2 id="loop-streak-heading" className="text-sm font-semibold">Loop consistency</h2>
      <p className="mt-1 text-xs text-ink3">Days you finished a repair or a retest. Observational and unvalidated.</p>
      <p className="mt-2 text-sm" data-testid="loop-streak-copy">{streakCopy(streak)}</p>
      {streak.atRisk && (
        <p className="mt-2 text-xs text-ink3" data-testid="loop-streak-risk">
          Nothing counted yet today. Finish a repair or retest from <Link className="underline" href="/">Today</Link> to keep it going.
        </p>
      )}
    </section>
  );
}
