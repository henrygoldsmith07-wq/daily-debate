import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { loadFunnelData } from "@/lib/productFunnelServer";
import { buildFunnelReport } from "@/lib/productFunnel";
import { buildRepairEffectiveness } from "@/lib/repairEffectiveness";
import { summariseAiOps, type AiOpsRow } from "@/lib/aiOps";

export const dynamic = "force-dynamic";

export const metadata = { title: "Product funnel (admin)" };

function aiOpsCutoffIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

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

  const { events, repairs, debateWeaknesses, completeness } = await loadFunnelData();
  const funnel = buildFunnelReport(events, {});
  const effectiveness = buildRepairEffectiveness(repairs, debateWeaknesses, {});

  // AI ops: last 7 days of model calls, aggregate only (no user ids, no content).
  let aiOps: ReturnType<typeof summariseAiOps> | null = null;
  try {
    const service = createServiceClient();
    const { data: aiRows } = await service
      .from("ai_call_log")
      .select("operation, provider, model, latency_ms, outcome, total_tokens, created_at")
      .gte("created_at", aiOpsCutoffIso())
      .order("created_at", { ascending: false })
      .limit(5000);
    const mapped: AiOpsRow[] = (aiRows ?? []).map((r) => ({
      operation: r.operation,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latency_ms,
      ok: r.outcome === "ok",
      totalTokens: r.total_tokens,
      errorCategory: r.error_category,
      createdAt: r.created_at,
    }));
    aiOps = summariseAiOps(mapped, {});
  } catch {
    aiOps = null;
  }

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
          Data: {completeness.events.loaded} events · {completeness.repairs.loaded} repairs · {completeness.debates.loaded} debate graphs.
        </p>
        {completeness.note && (
          <p className="mt-1 text-xs text-amber-600" role="note">
            Data truncated: {completeness.note}
          </p>
        )}
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
          <span>Time to first debate: {funnel.timeToFirstValue.medianHours ?? "—"}h median ({funnel.timeToFirstValue.users} users)</span>
          <span>Debate completion time: {funnel.completionTime.medianMinutes ?? "—"} min median ({funnel.completionTime.sessions} sessions)</span>
        </div>
        {funnel.challengeMeReasons.length > 0 && (
          <p className="mt-2 text-xs text-ink3">
            Challenge-me rules used: {funnel.challengeMeReasons.map((r) => `${r.reason} ×${r.count}`).join(" · ")}
          </p>
        )}
        <p className="mt-2 text-xs text-ink3">{funnel.repairRetention.note}</p>
        <p className="mt-1 text-xs text-ink3">
          Repair→return (observational): repairers {funnel.repairRetention.repairers.returned}/{funnel.repairRetention.repairers.users || "—"}
          {" · "}non-repairers {funnel.repairRetention.nonRepairers.returned}/{funnel.repairRetention.nonRepairers.users || "—"} (D1)
        </p>
      </section>

      <section className="surface-card p-5" aria-labelledby="cohorts-heading">
        <h2 id="cohorts-heading" className="text-sm font-semibold">Weekly cohorts (first activity)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink3">
                <th className="py-1 pr-3 font-medium">Week</th>
                <th className="py-1 pr-3 font-semibold">Users</th>
                <th className="py-1 pr-3 font-semibold">D1</th>
                <th className="py-1 pr-3 font-semibold">D7</th>
                <th className="py-1 font-semibold">D30</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {funnel.weeklyCohorts.map((c) => (
                <tr key={c.weekStart} className="border-t border-[var(--rule)]">
                  <td className="py-1.5 pr-3 font-medium">{c.weekStart}</td>
                  <td className="py-1.5 pr-3">{c.users}</td>
                  <td className="py-1.5 pr-3">{c.eligibleD1 ? `${c.returnedD1}/${c.eligibleD1}` : "—"}</td>
                  <td className="py-1.5 pr-3">{c.eligibleD7 ? `${c.returnedD7}/${c.eligibleD7}` : "—"}</td>
                  <td className="py-1.5">{c.eligibleD30 ? `${c.returnedD30}/${c.eligibleD30}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Dashes mean the cohort still has users inside that window — they are pending, not churned.
        </p>
      </section>

      {aiOps && (
        <section className="surface-card p-5" aria-labelledby="aiops-heading">
          <h2 id="aiops-heading" className="text-sm font-semibold">AI reliability (last 7 days)</h2>
          <p className="mt-1 text-xs text-ink3">
            Aggregate model-call health: {aiOps.totalCalls} calls · {aiOps.overall.errorRate === null ? `${aiOps.overall.errors} errors` : `${Math.round(aiOps.overall.errorRate * 100)}% errors`}
            {aiOps.overall.p95LatencyMs !== null && ` · p95 ${aiOps.overall.p95LatencyMs}ms`}. Rates appear at ≥5 calls per operation.
          </p>
          <div className="mt-3 flex flex-col gap-2 text-xs">
            {aiOps.byOperation.map((op) => (
              <div key={op.operation} className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] pb-2 last:border-0">
                <span className="font-medium">{op.operation}</span>
                <span className="tabular text-ink2">
                  {op.errorRate === null
                    ? `${op.calls} calls`
                    : `${Math.round(op.errorRate * 100)}% errors · avg ${op.avgLatencyMs}ms · p95 ${op.p95LatencyMs}ms`}
                </span>
              </div>
            ))}
          </div>
          {Object.keys(aiOps.overall.byCategory).length > 0 && (
            <p className="mt-2 text-xs text-ink3">
              Failure categories:{" "}
              {Object.entries(aiOps.overall.byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, n]) => `${cat} ×${n}`)
                .join(" · ")}
            </p>
          )}
          {aiOps.note && <p className="mt-2 text-xs text-ink3">{aiOps.note}</p>}
        </section>
      )}

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
                <th className="py-1 pr-3 font-semibold">Improved rate</th>
                <th className="py-1 font-semibold">Retest recurred</th>
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
                  <td className="py-1.5 pr-3">{row.improvedRate ?? "—"}</td>
                  <td className="py-1.5" title="Share of first retests where the same weakness recurred">
                    {row.retest.firstRetestWeaknessRate ?? "—"}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--rule)] font-semibold">
                <td className="py-1.5 pr-3">All kinds</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.repairs}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.measurable}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.improved}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.unchanged}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.worse}</td>
                <td className="py-1.5 pr-3">{effectiveness.overall.improvedRate ?? "—"}</td>
                <td className="py-1.5" title="Share of first retests where the same weakness recurred">
                  {effectiveness.overall.retest.firstRetestWeaknessRate ?? "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Dashes mean the kind summary needs at least 5 repairs with 3 measurable inside the window — the data exists
          but no claim is made yet. “Retest recurred” reads the first later debate after each repair (≥3 retests
          to report).
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
