import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { loadOpsHealth } from "@/lib/opsHealthServer";
import type { EvidenceSection, HealthState } from "@/lib/opsHealth";

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

export default async function OpsHealthPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
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
      {report.training && <EvidenceSectionCard id="training-heading" title="Training effectiveness" section={report.training} />}
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
