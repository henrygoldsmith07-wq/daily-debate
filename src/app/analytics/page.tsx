import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { loadFunnelData } from "@/lib/productFunnelServer";
import { buildFunnelReport, buildRepairOutcomeFunnel, buildWeeklyLoop, FUNNEL_MIN_SAMPLE } from "@/lib/productFunnel";
import { buildRepairEffectiveness } from "@/lib/repairEffectiveness";
import { loadAiOpsData } from "@/lib/aiOpsServer";
import { assessLatencyBudgets } from "@/lib/latencyBudget";
import { getRequestAuthContext } from "@/lib/requestAuth";

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
  const auth = await getRequestAuthContext();
  if (!auth.isAdmin) {
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

  const funnelData = await loadFunnelData();
  if (funnelData.status === "unavailable") {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Internal · product analytics"
          title="Product funnel unavailable"
          description="The analytics backend could not be read. This is an availability failure, not evidence of zero activity."
        />
        <section className="surface-card p-5">
          <p className="text-sm font-medium">No funnel rates are being reported from incomplete data.</p>
          <p className="mt-1 text-xs text-ink3">
            Category: {funnelData.errorCategory ?? "unknown"}. Check Operations health and the database connection before interpreting product usage.
          </p>
        </section>
      </AppShell>
    );
  }
  const { events, repairs, retests, debateWeaknesses, completeness } = funnelData;
  const funnel = buildFunnelReport(events, {});
  const weeklyLoop = buildWeeklyLoop(events, funnel.generatedAt);
  const effectiveness = buildRepairEffectiveness(repairs, debateWeaknesses, { retests });
  const trainingLoop = buildRepairOutcomeFunnel(repairs, debateWeaknesses, events, { retests });

  const aiOpsData = await loadAiOpsData();
  const aiOps = aiOpsData.status === "unavailable" ? null : aiOpsData.report;

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
          Data: {completeness.events.loaded} events · {completeness.repairs.loaded} repair attempts · {completeness.retests.loaded} deliberate retest assignments · {completeness.debates.loaded} debate graphs.
        </p>
        {funnelData.status === "partial" && (
          <p className="mt-1 text-xs text-[var(--review)]" role="note">
            Partial analytics data{funnelData.errorCategory ? ` (${funnelData.errorCategory})` : ""}; outcome metrics may be incomplete.
          </p>
        )}
        {completeness.note && (
          <p className="mt-1 text-xs text-[var(--review)]" role="note">
            Data truncated: {completeness.note}
          </p>
        )}
        <div className="mt-2">
          <RateRow label="Today → debate started (user)" {...funnel.startRate} />
          <RateRow label="Debate completion, all formats (user)" {...funnel.debateCompletion} />
          <RateRow label="Sprint completion (user)" {...funnel.sprintCompletion} />
          <RateRow label="Full debate completion (user)" {...funnel.fullCompletion} />
          <RateRow label="Repair started (completed debate → CTA, user)" {...funnel.repairStart} />
          <RateRow label="Repair attempted (CTA → saved attempt, user)" {...funnel.repairAttempt} />
          <RateRow label="Repair demonstrated with prompt (attempt → structural pass, user)" {...funnel.repairDemonstration} />
          <RateRow label="Retest started (prompted repair → later debate, user)" {...funnel.retestStart} />
          <RateRow label="Retest completed (later debate produced target evidence, user)" {...funnel.retestCompletion} />
          <RateRow label="Skill demonstrated in retest (observable retest → pass, user)" {...funnel.retestSkillDemonstrated} />
          <RateRow label="Full analysis opened (user)" {...funnel.fullAnalysisOpen} />
          <RateRow label="Challenge me usage (of debate starts, user)" {...funnel.challengeMe} />
          <RateRow label="Friend challenge acceptance" {...funnel.friendChallenges.acceptRate} />
        </div>

        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink3">Session conversion (per debate)</h3>
        <div className="mt-2">
          <RateRow label="Debate completion, all formats (per session)" {...funnel.sessions.debateCompletion} />
          <RateRow label="Sprint completion (per session)" {...funnel.sessions.sprintCompletion} />
          <RateRow label="Full debate completion (per session)" {...funnel.sessions.fullCompletion} />
          <RateRow label="Repair started (per session)" {...funnel.sessions.repairStart} />
          <RateRow label="Repair attempted (per session)" {...funnel.sessions.repairAttempt} />
          <RateRow label="Repair demonstrated with prompt (per session)" {...funnel.sessions.repairDemonstration} />
          <RateRow label="Retest started (per session)" {...funnel.sessions.retestStart} />
          <RateRow label="Retest completed with observable target (per session)" {...funnel.sessions.retestCompletion} />
          <RateRow label="Skill demonstrated in retest (per session)" {...funnel.sessions.retestSkillDemonstrated} />
          <RateRow label="Full analysis opened (per session)" {...funnel.sessions.fullAnalysisOpen} />
        </div>
        {funnel.sessions.note && <p className="mt-2 text-xs text-ink3">{funnel.sessions.note}</p>}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink3">
          <span>Daily viewed users: {funnel.dailyViewed}</span>
          <span>Debate sessions seen: {funnel.sessions.debates}</span>
          <span>Friend challenges: {funnel.friendChallenges.createdEvents} created · {funnel.friendChallenges.acceptedEvents} accepted</span>
          <span>D1 return: {funnel.d1Return.returnedUsers}/{funnel.d1Return.eligibleUsers} eligible ({funnel.d1Return.pendingUsers} pending)</span>
          <span>D7 return: {funnel.d7Return.returnedUsers}/{funnel.d7Return.eligibleUsers} eligible ({funnel.d7Return.pendingUsers} pending)</span>
          <span>D30 return: {funnel.d30Return.returnedUsers}/{funnel.d30Return.eligibleUsers} eligible ({funnel.d30Return.pendingUsers} pending)</span>
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

      <section className="surface-card p-5" aria-labelledby="weekly-loop-heading">
        <h2 id="weekly-loop-heading" className="text-sm font-semibold">Weekly loop volumes</h2>
        <p className="mt-1 text-xs text-ink3">
          Raw weekly counts from product_events — the scorecard the roadmap’s “Prove the loop” section tracks (targets and
          definitions in docs/roadmap.md). The newest row is the current, unfinished week.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-ink3">
                <th className="py-1 pr-3 font-medium">Week</th>
                <th className="py-1 pr-3 font-semibold">Active</th>
                <th className="py-1 pr-3 font-semibold">Debating</th>
                <th className="py-1 pr-3 font-semibold">Starts</th>
                <th className="py-1 pr-3 font-semibold">Completed</th>
                <th className="py-1 pr-3 font-semibold">Completion</th>
                <th className="py-1 pr-3 font-semibold">Repairs</th>
                <th className="py-1 font-semibold">Returning</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {weeklyLoop.map((w) => (
                <tr key={w.weekStart} className="border-t border-[var(--rule)]">
                  <td className="py-1.5 pr-3 font-medium">{w.weekStart}</td>
                  <td className="py-1.5 pr-3">{w.activeUsers}</td>
                  <td className="py-1.5 pr-3">{w.debatingUsers}</td>
                  <td className="py-1.5 pr-3">{w.debateStarts}</td>
                  <td className="py-1.5 pr-3">{w.debatesCompleted}</td>
                  <td className="py-1.5 pr-3">{w.completionRate === null ? "—" : pct(w.completionRate)}</td>
                  <td className="py-1.5 pr-3">{w.repairsDemonstrated}</td>
                  <td className="py-1.5">{w.returningUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Active = distinct users with any tracked event that week · Debating = users who started ≥1 debate · Starts =
          debate-start sessions (a user starting twice counts twice) · Repairs = successful repair demonstrations ·
          Returning = active users whose first-ever activity was before that week. Completion is dashed below{" "}
          {FUNNEL_MIN_SAMPLE} starts — no rate is made from noise, and zeros are never inferred when data is missing.
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
          {aiOpsData.status === "partial" && (
            <p className="mt-1 text-xs text-[var(--review)]" role="note">
              AI reliability data is partial ({aiOpsData.errorCategory}); rates cover only the loaded window.
            </p>
          )}
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
          {aiOps.routing.events > 0 && (
            <p className="mt-2 text-xs text-ink3">
              Structural routing: {aiOps.routing.argumentsClassified} arguments in {aiOps.routing.batches} batch{aiOps.routing.batches === 1 ? "" : "es"} · avoided {aiOps.routing.expensiveJudgeCallsAvoided} expensive judge leg{aiOps.routing.expensiveJudgeCallsAvoided === 1 ? "" : "s"} · {aiOps.routing.fallbacks} fallback{aiOps.routing.fallbacks === 1 ? "" : "s"} · routes {Object.entries(aiOps.routing.byRoute).map(([route, count]) => `${route} ×${count}`).join(" · ")}
            </p>
          )}
          {aiOps.note && <p className="mt-2 text-xs text-ink3">{aiOps.note}</p>}
        </section>
      )}
      {!aiOps && aiOpsData.status === "unavailable" && (
        <section className="surface-card p-5" aria-labelledby="aiops-heading">
          <h2 id="aiops-heading" className="text-sm font-semibold">AI reliability unavailable</h2>
          <p className="mt-1 text-xs text-ink3">
            The model-call log could not be read ({aiOpsData.errorCategory ?? "unknown"}); zero calls are not being inferred.
          </p>
        </section>
      )}

      {/* Latency budgets at the loop-decision moment — the p95 the learner is
          timed against on a solo turn, and the p95 they wait on at finish.
          assessLatencyBudgets carries an explicit state per budget (ok /
          over-budget / insufficient-data / unmeasured) and names the degraded
          behaviour users experience, so a breach and a too-small sample never
          both render as "fine". */}
      {(() => {
        const budgets = assessLatencyBudgets({
          stats: aiOps?.byOperation.map((op) => ({
            operation: op.operation,
            calls: op.calls,
            errors: op.errors,
            errorRate: op.errorRate,
            avgLatencyMs: op.avgLatencyMs,
            p95LatencyMs: op.p95LatencyMs,
            byCategory: op.byCategory,
            note: op.note,
          })) ?? [],
          generatedAt: aiOps?.generatedAt ?? new Date().toISOString(),
        });
        return (
          <section className="surface-card p-5" aria-labelledby="latency-heading">
            <h2 id="latency-heading" className="text-sm font-semibold">Loop latency at the decision moment</h2>
            <p className="mt-1 text-xs text-ink3">{budgets.note}</p>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {budgets.assessments.map((a) => (
                <li key={a.operation} className="flex flex-col gap-0.5 border-b border-[var(--rule)] pb-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{a.label}</span>
                    <span
                      className={
                        a.state === "ok"
                          ? "text-[var(--success)]"
                          : a.state === "over-budget"
                            ? "text-[var(--danger)]"
                            : "text-ink3"
                      }
                    >
                      {a.state === "ok" && `✓ within budget — p95 ${a.measuredP95Ms}ms of ${a.budgetMs}ms`}
                      {a.state === "over-budget" && `⚠ over budget — p95 ${a.measuredP95Ms}ms vs ${a.budgetMs}ms`}
                      {a.state === "insufficient-data" && `— not yet measured`}
                      {a.state === "unmeasured" && `— no calls in window`}
                    </span>
                  </div>
                  <p className="text-ink3">{a.note}</p>
                  <p className="text-ink3">When this happens: {a.degradedBehaviour}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      <section className="surface-card p-5" aria-labelledby="repair-heading">
        <h2 id="repair-heading" className="text-sm font-semibold">Does repair work?</h2>
        <p className="mt-1 text-xs text-ink3">{effectiveness.honestyNote}</p>
        <p className="mt-1 text-xs text-ink3">
          {effectiveness.totalRepairs} successful repair episodes from {effectiveness.totalAttempts} stored attempt{effectiveness.totalAttempts === 1 ? "" : "s"}
          {effectiveness.failedOnlyEpisodes > 0 && ` · ${effectiveness.failedOnlyEpisodes} failed-only episode${effectiveness.failedOnlyEpisodes === 1 ? "" : "s"} excluded from effectiveness`}
          {effectiveness.retryAttemptsCollapsed > 0 && ` · ${effectiveness.retryAttemptsCollapsed} retry attempt${effectiveness.retryAttemptsCollapsed === 1 ? "" : "s"} collapsed`}.
        </p>
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
          but no claim is made yet. “Retest recurred” uses the first explicit durable repair-retest assignment with observable evidence (≥3 measured retests to report).
        </p>
      </section>

      <section className="surface-card p-5" aria-labelledby="training-loop-heading">
        <h2 id="training-loop-heading" className="text-sm font-semibold">Training loop: repair → retest → recurrence → return</h2>
        <p className="mt-1 text-xs text-ink3">{trainingLoop.note}</p>
        <div className="mt-2">
          <RateRow label="Repair acceptance (started → submitted)" {...trainingLoop.acceptance} />
          <RateRow label="First-retest recurrence (primary outcome)" {...trainingLoop.firstRetestRecurrence} />
          <RateRow label="Recurrence per eligible follow-up after the explicit retest" {...trainingLoop.recurrencePerEligibleRetest} />
          <RateRow label="Recurrence across explicit retest + first 2 eligible follow-ups" {...trainingLoop.firstThreeExposure} />
          <RateRow label="Return next day after first repair" numerator={trainingLoop.postRepairReturn.d1.returnedUsers} denominator={trainingLoop.postRepairReturn.d1.eligibleUsers} rate={trainingLoop.postRepairReturn.d1.rate} note={trainingLoop.postRepairReturn.d1.note} />
          <RateRow label="Return after 7 days" numerator={trainingLoop.postRepairReturn.d7.returnedUsers} denominator={trainingLoop.postRepairReturn.d7.eligibleUsers} rate={trainingLoop.postRepairReturn.d7.rate} note={trainingLoop.postRepairReturn.d7.note} />
          <RateRow label="Return after 30 days" numerator={trainingLoop.postRepairReturn.d30.returnedUsers} denominator={trainingLoop.postRepairReturn.d30.eligibleUsers} rate={trainingLoop.postRepairReturn.d30.rate} note={trainingLoop.postRepairReturn.d30.note} />
        </div>
        <p className="mt-2 text-xs text-ink3">
          {trainingLoop.repairs} successful repair episodes from {trainingLoop.attempts} attempt{trainingLoop.attempts === 1 ? "" : "s"}
          {trainingLoop.failedOnlyRepairs > 0 && ` · ${trainingLoop.failedOnlyRepairs} failed-only episode${trainingLoop.failedOnlyRepairs === 1 ? "" : "s"} excluded from retest outcomes`}
          {trainingLoop.retryAttemptsCollapsed > 0 && ` (${trainingLoop.retryAttemptsCollapsed} retries collapsed)`} · {trainingLoop.retestsObserved} with an explicit observable retest
          ({trainingLoop.retestsPending} pending, never counted as clean) · median {trainingLoop.medianDaysToRetest ?? "—"} days to retest
          {trainingLoop.unmatchedStarts > 0 && ` · ${trainingLoop.unmatchedStarts} start events without a debate id cannot be matched`}
          . Time to first recurrence: median {trainingLoop.timeToFirstRecurrence.medianDays ?? "—"} days across
          {trainingLoop.timeToFirstRecurrence.observedRepairs} repairs that recurred ({trainingLoop.timeToFirstRecurrence.censoredRepairs} observed
          retests recurred on none — censored, not clean); median{" "}
          {trainingLoop.opportunitiesBeforeRecurrence.median ?? "—"} measured opportunities before the first recurrence.
          The follow-up and fixed-exposure measures add to the denominator with exposure, so more later debates never imply a worse outcome.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink3">Retest timing: prompted vs incidental</h3>
        <p className="mt-1 text-xs text-ink3">{trainingLoop.retestTiming.note}</p>
        <p className="mt-2 text-xs text-ink3">
          Prompted arm: {trainingLoop.retestTiming.prompted.repairs} repair{trainingLoop.retestTiming.prompted.repairs === 1 ? "" : "s"} with an explicit
          retest assignment · {trainingLoop.retestTiming.prompted.measured} measured · {trainingLoop.retestTiming.prompted.recurred} recurred ·{" "}
          median {trainingLoop.retestTiming.prompted.medianDaysToRetest ?? "—"} day{trainingLoop.retestTiming.prompted.medianDaysToRetest === 1 ? "" : "s"} to retest ·
          recurrence {trainingLoop.retestTiming.prompted.rate === null ? "—" : pct(trainingLoop.retestTiming.prompted.rate)}.
          Incidental arm: {trainingLoop.retestTiming.incidental.repairs} repair{trainingLoop.retestTiming.incidental.repairs === 1 ? "" : "s"} measured only
          through ordinary follow-up debates · {trainingLoop.retestTiming.incidental.measured} measured ·{" "}
          {trainingLoop.retestTiming.incidental.recurred} recurred · recurrence{" "}
          {trainingLoop.retestTiming.incidental.rate === null ? "—" : pct(trainingLoop.retestTiming.incidental.rate)}.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink3">Does the prompt bring them back? D1/D7/D30 post-repair return by arm</h3>
        <p className="mt-1 text-xs text-ink3">{trainingLoop.postRepairReturnByArm.note}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded-lg border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-semibold text-ink">Prompted first repair</p>
            <p className="mt-1 text-ink3">
              D1 {trainingLoop.postRepairReturnByArm.prompted.d1.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.prompted.d1.rate)} ·
              D7 {trainingLoop.postRepairReturnByArm.prompted.d7.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.prompted.d7.rate)} ·
              D30 {trainingLoop.postRepairReturnByArm.prompted.d30.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.prompted.d30.rate)}
            </p>
            <p className="mt-1 text-[11px] text-ink3">
              {trainingLoop.postRepairReturnByArm.prompted.d7.eligibleUsers} eligible at day 7 · {trainingLoop.postRepairReturnByArm.prompted.d7.pendingUsers} still pending
            </p>
          </div>
          <div className="rounded-lg border border-[var(--rule)] bg-surface-2 p-3">
            <p className="font-semibold text-ink">Incidental first repair</p>
            <p className="mt-1 text-ink3">
              D1 {trainingLoop.postRepairReturnByArm.incidental.d1.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.incidental.d1.rate)} ·
              D7 {trainingLoop.postRepairReturnByArm.incidental.d7.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.incidental.d7.rate)} ·
              D30 {trainingLoop.postRepairReturnByArm.incidental.d30.rate === null ? "—" : pct(trainingLoop.postRepairReturnByArm.incidental.d30.rate)}
            </p>
            <p className="mt-1 text-[11px] text-ink3">
              {trainingLoop.postRepairReturnByArm.incidental.d7.eligibleUsers} eligible at day 7 · {trainingLoop.postRepairReturnByArm.incidental.d7.pendingUsers} still pending
            </p>
          </div>
        </div>
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
