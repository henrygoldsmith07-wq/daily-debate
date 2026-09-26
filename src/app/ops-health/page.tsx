import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { loadOpsHealth } from "@/lib/opsHealthServer";
import type { EvidenceSection, HealthState, MigrationReadiness, TrainingEvidence } from "@/lib/opsHealth";
import { getRequestAuthContext } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Operations health (admin)" };

const STATE_STYLES: Record<HealthState, string> = {
  healthy: "bg-emerald-100 text-emerald-900",
  degraded: "bg-amber-100 text-amber-900",
  stale: "bg-orange-100 text-orange-900",
  blocked: "bg-red-100 text-red-900",
  failed: "bg-red-100 text-red-900",
  unknown: "bg-surface-2 text-ink3",
};

function StateBadge({ state }: { state: HealthState }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATE_STYLES[state]}`}>
      {state}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] py-1.5 last:border-0">
      <p className="text-xs text-ink3">{label}</p>
      <p className="tabular text-right text-sm font-medium">{value}</p>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "—";
}

function fmtMigrationReadiness(r: MigrationReadiness): string {
  // null = unknown (probe could not read the schema), never silently ready.
  const bit = (v: boolean | null) => (v === null ? "unknown" : v ? "ready" : "PENDING");
  return (
    `016=${bit(r.migration016TelemetryReady)} · 017=${bit(r.migration017RouteLifecycleReady)} · ` +
    `018=${bit(r.migration018TopicFingerprintReady)} · 019=${bit(r.migration019GenerationReasonReady)}`
  );
}

export default async function OpsHealthPage() {
  const auth = await getRequestAuthContext();
  if (!auth.isAdmin) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Internal"
          title="Operations health"
          description="This report is restricted to administrators."
        />
      </AppShell>
    );
  }

  const report = await loadOpsHealth();

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Internal"
        title="Operations health"
        description={`Background-system status as of ${fmtDate(report.generatedAt)}. Missing or stale validation never reads as green.`}
      />

      <section className="surface-card p-5" aria-labelledby="overall-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="overall-heading" className="text-sm font-semibold">Overall</h2>
          <StateBadge state={report.overall} />
        </div>
        {report.unknowns.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            Unresolved (raises overall to at least &ldquo;unknown&rdquo;, never healthy): {report.unknowns.join(", ")}
          </p>
        )}
        {report.notes.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink3">
            {report.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="topic-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="topic-heading" className="text-sm font-semibold">Topic pipeline</h2>
          <StateBadge state={report.topic.status} />
        </div>
        <div className="mt-2">
          <Fact label="Latest stored topic" value={report.topic.lastTopicDate ?? "none"} />
          <Fact label="Tomorrow ready" value={report.topic.tomorrowReady ? "yes" : "no"} />
          <Fact label="Origin" value={report.topic.origin ?? "—"} />
          <Fact label="Evidence cards on latest" value={report.topic.evidenceCards === null ? "—" : String(report.topic.evidenceCards)} />
          <Fact label="Age (days)" value={report.topic.ageDays === null ? "—" : String(report.topic.ageDays)} />
        </div>
        {report.topic.note && <p className="mt-2 text-xs text-ink3">{report.topic.note}</p>}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="topic-slo-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="topic-slo-heading" className="text-sm font-semibold">Topic production SLO (scheduler + availability, not CI)</h2>
          <StateBadge state={report.topicSlo.status} />
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">
            Scheduler: <span className="uppercase">{report.topicSlo.scheduler.state}</span>
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">
            Availability: <span className="uppercase">{report.topicSlo.availability.state}</span>
          </span>
        </div>
        <div className="mt-2">
          <Fact label="Deadline (tomorrow&apos;s topic stored by)" value={`${report.topicSlo.availability.deadlineUtc} UTC daily`} />
          <Fact
            label="Last scheduled run"
            value={
              report.topicSlo.scheduler.lastScheduledRunAt
                ? `${fmtDate(report.topicSlo.scheduler.lastScheduledRunAt)} (${report.topicSlo.scheduler.lastScheduledRunConclusion ?? "?"})`
                : "never"
            }
          />
          <Fact
            label="Last successful run (any trigger)"
            value={
              report.topicSlo.lastSuccessfulRun
                ? `${fmtDate(report.topicSlo.lastSuccessfulRun.at)} (${report.topicSlo.lastSuccessfulRun.event})`
                : "none"
            }
          />
          <Fact label="Consecutive scheduled failures" value={String(report.topicSlo.scheduler.consecutiveScheduledFailures)} />
          <Fact
            label="Scheduler delay (latest / median / p95)"
            value={
              report.topicSlo.scheduling.latestDelayMs === null
                ? "no telemetry"
                : `${Math.round(report.topicSlo.scheduling.latestDelayMs / 60000)}m / ${
                    report.topicSlo.scheduling.medianDelayMs === null ? "—" : `${Math.round(report.topicSlo.scheduling.medianDelayMs / 60000)}m`
                  } / ${report.topicSlo.scheduling.p95DelayMs === null ? "—" : `${Math.round(report.topicSlo.scheduling.p95DelayMs / 60000)}m`} (late>${Math.round(report.topicSlo.scheduling.thresholdMs / 60000)}m: ${report.topicSlo.scheduling.missedStarts})`
            }
          />
          <Fact
            label="Production proofs (db / manual / scheduled / idempotent / on-time / AI)"
            value={`${report.topicSlo.proofs.databaseReachable ? "db ✓" : "db ✗"} · ${
              report.topicSlo.proofs.manualSuccess ? "manual ✓" : "manual ✗"
            } · ${report.topicSlo.proofs.scheduledSuccessAfterManual ? "scheduled ✓" : "scheduled ✗"} · ${
              report.topicSlo.proofs.sameDateContentIdempotence ? "idempotent ✓" : "idempotent ✗"
            } · ${report.topicSlo.proofs.onTimeBeforeDeadline ? "on-time ✓" : "on-time ✗"} · ${
              report.topicSlo.proofs.aiGeneratedProductionSuccess ? "AI ✓" : "AI ✗"
            }`}
          />
          <Fact
            label="Provider attempts (window runs / fallback-trigger rate)"
            value={
              report.topicSlo.providerSummary === null || report.topicSlo.providerSummary.windowRuns === 0
                ? "no attempt telemetry"
                : `${report.topicSlo.providerSummary.windowRuns} runs · fallback ${
                    report.topicSlo.providerSummary.fallbackTriggerRate === null
                      ? "—"
                      : `${Math.round(report.topicSlo.providerSummary.fallbackTriggerRate * 100)}%`
                  }${report.topicSlo.providerSummary.byModel.length ? ` · ${report.topicSlo.providerSummary.byModel.map((m) => `${m.provider ?? "?"}/${m.model} ×${m.attempts}${m.successRate === null ? "" : ` ${Math.round(m.successRate * 100)}%`}`).join(" · ")}` : ""}`
            }
          />
        </div>
        {report.topicSlo.note && <p className="mt-2 text-xs text-ink3">{report.topicSlo.note}</p>}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="judge-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="judge-heading" className="text-sm font-semibold">Judge validation</h2>
          <StateBadge state={report.judge.status} />
        </div>
        <div className="mt-2">
          <Fact label="Last live run" value={fmtDate(report.judge.lastRunAt)} />
          <Fact label="Fixtures" value={`${report.judge.fixtures ?? "—"}${report.judge.fullPack === false ? " (partial)" : ""}`} />
          <Fact label="Models" value={report.judge.models.length ? report.judge.models.join(", ") : "—"} />
          <Fact label="Gates" value={report.judge.allPass === null ? "—" : report.judge.allPass ? "PASS" : "FAIL"} />
          <Fact label="Age (days)" value={report.judge.ageDays === null ? "—" : String(report.judge.ageDays)} />
        </div>
        {report.judge.note && <p className="mt-2 text-xs text-ink3">{report.judge.note}</p>}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="db-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="db-heading" className="text-sm font-semibold">Database & migrations</h2>
          <StateBadge state={report.database.status} />
        </div>
        <div className="mt-2">
          <Fact label="Reachable" value={report.database.reachable ? "yes" : "no"} />
          <Fact label="Latency" value={report.database.latencyMs === null ? "—" : `${report.database.latencyMs}ms`} />
          <Fact label="Migrations applied" value={report.database.migrationsApplied === null ? "—" : String(report.database.migrationsApplied)} />
          <Fact label="Required tables" value={report.database.requiredTablesOk === null ? "—" : report.database.requiredTablesOk ? "all present" : `missing: ${report.database.missingTables.join(", ")}`} />
          <Fact label="topic_run_log fidelity (016)" value={report.database.topicRunLogFidelity} />
          <Fact label="migration readiness" value={fmtMigrationReadiness(report.database.migrationReadiness)} />
        </div>
        {report.database.note && <p className="mt-2 text-xs text-ink3">{report.database.note}</p>}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="app-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="app-heading" className="text-sm font-semibold">App CI & E2E</h2>
          <StateBadge state={report.app.status} />
        </div>
        <div className="mt-2">
          {report.app.workflows.length === 0 && <Fact label="Workflows" value="no data (no token at runtime)" />}
          {report.app.workflows.map((w) => (
            <Fact key={w.name} label={w.name} value={`${w.state} (${w.status ?? "?"}/${w.conclusion ?? "?"})`} />
          ))}
        </div>
        {report.app.note && <p className="mt-2 text-xs text-ink3">{report.app.note}</p>}
        <p className="mt-2 text-xs text-ink3">
          <Link className="underline" href={report.app.ciUrl}>Open GitHub Actions</Link>
        </p>
      </section>

      {report.human && <EvidenceSectionCard id="human-heading" title="Human validation" section={report.human} />}
      {report.training && <TrainingSectionCard section={report.training} />}
    </AppShell>
  );
}

function EvidenceSectionCard({ id, title, section }: { id: string; title: string; section: EvidenceSection }) {
  return (
    <section className="surface-card mt-4 p-5" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-semibold">{title}</h2>
        <StateBadge state={section.status} />
      </div>
      <p className="mt-1 text-xs font-medium">{section.headline}</p>
      {section.facts.length > 0 && (
        <div className="mt-2">
          {section.facts.map((fact) => (
            <Fact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}
      {section.note && <p className="mt-2 text-xs text-ink3">{section.note}</p>}
    </section>
  );
}

/**
 * Training evidence: the badge is MEASUREMENT READINESS (can we compute a
 * metric at all?) — never an outcome judgement. Observed outcomes are listed
 * separately with denominators and carry no good/bad colour.
 */
function TrainingSectionCard({ section }: { section: TrainingEvidence }) {
  return (
    <section className="surface-card mt-4 p-5" aria-labelledby="training-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="training-heading" className="text-sm font-semibold">Training effectiveness</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink3">
          Measurement: {section.measurement}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium">{section.headline}</p>
      {section.facts.length > 0 && (
        <div className="mt-2">
          {section.facts.map((fact) => (
            <Fact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}
      {section.outcomes.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-ink3">Observed outcomes (not rated good/bad)</p>
          {section.outcomes.map((o) => (
            <Fact key={o.label} label={o.label} value={o.value} />
          ))}
        </div>
      )}
      {section.note && <p className="mt-2 text-xs text-ink3">{section.note}</p>}
    </section>
  );
}
