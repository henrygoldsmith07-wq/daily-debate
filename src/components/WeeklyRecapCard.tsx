import Link from "next/link";
import PageViewEvent from "@/components/PageViewEvent";
import type { WeeklyLoop } from "@/lib/weeklyLoop";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";

// Compact Today version of the weekly recap. Same gated sentences as Progress.
export default function WeeklyRecapCard({ loop }: { loop: WeeklyLoop }) {
  const recap = buildWeeklyRecap(loop);
  if (recap.state === "empty") return null;
  return (
    <section className="surface-card p-4" aria-label="Your week in the loop" data-testid="today-weekly-recap">
      <PageViewEvent name="weekly_recap_viewed" />
      <h2 className="text-sm font-semibold">Your week in the loop</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {recap.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <Link href="/progress" className="mt-2 inline-block text-xs underline">See the full week</Link>
    </section>
  );
}
