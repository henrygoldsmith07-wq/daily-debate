import Link from "next/link";
import type { WeeklyLoop } from "@/lib/weeklyLoop";
import { MIN_RETESTS_FOR_RATE } from "@/lib/weeklyLoop";

export default function WeeklyLoopPanel({ loop }: { loop: WeeklyLoop }) {
  const cells: Array<[string, string]> = [
    ["Debates", String(loop.debates)],
    ["Active days", `${loop.activeDays} of 7`],
    ["Repairs tried", String(loop.repairAttempts)],
    ["Repairs landed", String(loop.repairsSucceeded)],
    ["Retests done", String(loop.retestsCompleted)],
  ];
  return (
    <section className="surface-card p-5" aria-labelledby="weekly-loop-heading" data-testid="weekly-loop">
      <h2 id="weekly-loop-heading" className="text-sm font-semibold">This week in your loop</h2>
      <p className="mt-1 text-xs text-ink3">The last 7 days of what you actually did.</p>
      <p className="mt-1 text-xs text-ink3" data-testid="weekly-compare">
        {`Previous 7 days: ${loop.previousDebates} ${loop.previousDebates === 1 ? "debate" : "debates"}. Counts only, not a measure of improvement.`}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink3">{k}</dt>
            <dd className="text-xl font-semibold" data-testid={`weekly-${k.toLowerCase().replace(/\s+/g, "-")}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-5 text-ink3" data-testid="weekly-rate">
        {loop.rateState === "ok" && loop.demonstratedRate !== null
          ? `Skill showed up unprompted in ${Math.round(loop.demonstratedRate * 100)}% of ${loop.observableTotal} measured retests. Unvalidated; observational.`
          : `Not enough measured retests for a rate yet (${loop.observableTotal} of ${MIN_RETESTS_FOR_RATE}).`}
      </p>
      <Link href={loop.next.href} className="mt-3 inline-block text-sm text-[var(--accent)]" data-testid="weekly-next">
        {loop.next.label} →
      </Link>
    </section>
  );
}
