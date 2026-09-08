import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { loadFunnelData } from "@/lib/productFunnelServer";
import { buildFunnelReport } from "@/lib/productFunnel";
import { buildRepairEffectiveness } from "@/lib/repairEffectiveness";

export const dynamic = "force-dynamic";

export const metadata = { title: "Product funnel (admin)" };

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function RateRow({ label, numerator, denominator, rate, note }: { label: string; numerator: number; denominator: number; rate: number | null; note?: string | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-[var(--rule)] py-2 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {(note ?? (rate === null)) && <p className="text-xs text-ink3">{note ?? "not yet measurable"}</p>}
      </div>
      <p className="tabular text-sm font-semibold" title={note ?? undefined}>
        {rate === null ? <span className="text-ink3">{numerator}/{denominator}</span> : `${pct(rate)}`}
      </p>
    </div>
  );
}

export default async function AnalyticsPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Internal"
          title="Product funnel"
          description="This report is restricted to administrators. It is computed from the app's own privacy-conscious event tables."
        />
      </AppShell>
    );
  }

  const { events, repairs, debateWeaknesses } = await loadFunnelData();
  const funnel = buildFunnelReport(events, {});
  const effectiveness = buildRepairEffectiveness(repairs, debateWeaknesses, {});

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Internal · computed from product_events"
        title="Product funnel"
        description={`User-level rates over the last ${funnel.windowDays} days — ${funnel.eventsAnalysed} events from ${funnel.usersAnalysed} users. Rates are shown only at ≥5-user samples; below that they say "not yet measurable" rather than reporting noise.`}
      />

      <section className="surface-card p-5" aria-labelledby="funnel-heading">
        <h2 id="funnel-heading" className="text-sm font-semibold">Training funnel</h2>
        <p className="mt-1 text-xs text-ink3">
          User conversion counts each user once; session conversion counts each debate separately (migration 005 events).
        </p>
        <div className="mt-2">
          <RateRow label="Today → debate started (user)" {...funnel.startRate} />
          <RateRow label="Sprint completion (user)" {...funnel.sprintCompletion} />
          <RateRow label="Full debate completion (user)" {...funnel.fullCompletion} />
          <RateRow label="Repair started (completed debate → CTA, user)" {...funnel.repairStart} />
          <RateRow label="Repair completed (CTA → submitted, user)" {...funnel.repairCompletion} />
          <RateRow label="Full analysis opened (user)" {...funnel.fullAnalysisOpen} />
          <RateRow label="Challenge me usage (of debate starts, user)" {...funnel.challengeMe} />
          <RateRow label="Friend challenge acceptance" {...funnel.friendChallenges.acceptRate} />
        </div>

        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink3">Session conversion (per debate)</h3>
        <div className="mt-2">
          <RateRow label="Sprint completion (per session)" {...funnel.sessions.sprintCompletion} />
          <RateRow label="Full debate completion (per session)" {...funnel.sessions.fullCompletion} />
          <RateRow label="Repair started (per session)" {...funnel.sessions.repairStart} />
          <RateRow label="Repair completed (per session)" {...funnel.sessions.repairCompletion} />
          <RateRow label="Full analysis opened (per session)" {...funnel.sessions.fullAnalysisOpen} />
        </div>
        {funnel.sessions.note && <p className="mt-2 text-xs text-ink3">{funnel.sessions.note}</p>}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink3">
          <span>Daily viewed users: {funnel.dailyViewed}</span>
          <span>Debate sessions seen: {funnel.sessions.debates}</span>
          <span>Friend challenges: {funnel.friendChallenges.createdEvents} created · {funnel.friendChallenges.acceptedEvents} accepted</span>
          <span>D1 return: {funnel.d1Return.returnedUsers}/{funnel.d1Return.eligibleUsers} eligible ({funnel.d1Return.pendingUsers} pending)</span>
          <span>D7 return: {funnel.d7Return.returnedUsers}/{funnel.d7Return.eligibleUsers} eligible ({funnel.d7Return.pendingUsers} pending)</span>
        </div>
        {funnel.challengeMeReasons.length > 0 && (
          <p className="mt-2 text-xs text-ink3">
            Challenge-me rules used: {funnel.challengeMeReasons.map((r) => `${r.reason} ×${r.count}`).join(" · ")}
          </p>
        )}
      </section>

      <section className="surface-card p-5" aria-labelledby="repair-heading">
        <h2 id="repair-heading" className="text-sm font-semibold">Does repair work?</h2>
        <p className="mt-1 text-xs text-ink3">{effectiveness.honestyNote}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink3">
                <th className="py-1 pr-3 font-medium">Weakness kind</th>
                <th className="py-1 pr-3 font-semibold">Repairs</th>
                <th className="py-1 pr-3 font-semibold">Measurable</th>
                <th className="py-1 pr-3 font-semibold">Improved</th>
                <th className="py-1 pr-3 font-semibold">Unchanged</th>
                <th className="py-1 pr-3 font-semibold">Worse</th>
                <th className="py-1 font-semibold">Improved rate</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {effectiveness.perKind.map((row) => (
                <tr key={row.target_kind} className="border-t border-[var(--rule)]">
                  <td className="py-1.5 pr-3 font-medium">{row.target_kind}</td>
                  <td className="py-1.5 pr-3">{row.repairs}</td>
                  <td className="py-1.5 pr-3">{row.measurable}</td>
                  <td className="py-1.5 pr-3">{row.improved}</td>
                  <td className="py-1.5 pr-3">{row.unchanged}</td>
                  <td className="py-1.5 pr-3">{row.worse}</td>
                  <td className="py-1.5">{row.improvedRate ?? "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--rule)] font-semibold">
                <td className="py-1.5 pr-3">All kinds</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.repairs}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.measurable}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.improved}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.unchanged}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.worse}</td>
                <td className="py-1.5">{effectiveness.overall.improvedRate ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Dashes mean the kind summary needs at least 5 repairs with 3 measurable inside the window — the data exists
          but no claim is made yet.
        </p>
      </section>

      <p className="text-xs text-ink3">
        JSON endpoint: <span className="font-mono">/api/analytics/funnel</span> · Events reference:{" "}
        <Link href="/metrics" className="underline underline-offset-2 hover:text-ink2">
          /metrics
        </Link>
      </p>
    </AppShell>
  );
}
