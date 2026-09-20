import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import {
  DEFAULT_ROUTE_LIFECYCLE,
  JUDGE_AVOIDANCE_ROUTES,
  PREREGISTERED_ROUTE_GATES,
  ROUTE_GATE_VERSION,
  routeGateRegistration,
} from "@/lib/routeShadowValidation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Shadow judge validation (admin)" };

/**
 * Route-level validation dashboard: per-route lifecycle state (all routes
 * default to shadow), the preregistered adoption gates with their sealed
 * hashes, and the metric definitions the roll-ups report. Per-run shadow
 * records ride on the authoritative verdict (`verdict.routing` metadata +
 * `verdict.shadowRouting` telemetry) for route-vs-ensemble comparison — this
 * page is the standing dashboard; the numbers accumulate as PvP matches
 * complete with shadow telemetry attached. The ensemble stays authoritative
 * until a route clears every preregistered gate.
 */
export default async function ShadowValidationPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Internal"
          title="Shadow judge validation"
          description="This report is restricted to administrators."
        />
      </AppShell>
    );
  }

  const registration = routeGateRegistration();

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Internal"
        title="Shadow judge validation"
        description={`Classifier judge-avoidance routes run in shadow mode only (${ROUTE_GATE_VERSION}). The established ensemble stays authoritative until a route clears every preregistered gate.`}
      />

      <section className="surface-card p-5" aria-labelledby="routes-heading">
        <h2 id="routes-heading" className="text-sm font-semibold">Route lifecycle (all default to shadow)</h2>
        <div className="mt-2">
          {JUDGE_AVOIDANCE_ROUTES.map((route) => (
            <div key={route} className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] py-1.5 last:border-0">
              <p className="text-xs text-ink3">{route}</p>
              <p className="tabular text-right text-sm font-medium">{DEFAULT_ROUTE_LIFECYCLE[route]}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink3">
          Promotion requires every gate below on the registered rolling window; any later monitoring
          gate failure returns the route to the ensemble (suspended).
        </p>
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="gates-heading">
        <h2 id="gates-heading" className="text-sm font-semibold">Preregistered adoption gates (hash-sealed)</h2>
        <div className="mt-2">
          {JUDGE_AVOIDANCE_ROUTES.map((route) => {
            const gate = PREREGISTERED_ROUTE_GATES[route];
            const sealed = registration.gates[route];
            return (
              <div key={route} className="border-b border-[var(--rule)] py-2 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{route}</p>
                  <p className="tabular text-right text-xs text-ink3">seal {sealed?.hash.slice(0, 12) ?? "—"}</p>
                </div>
                <p className="mt-1 text-xs text-ink3">
                  N≥{gate.minN} · agreement≥{gate.minWinnerAgreement} · swap≥{gate.minSideSwapStability} ·
                  false-decisive≤{gate.maxFalseDecisiveRate} · gap-MAE≤{gate.maxScoreGapMae} ·
                  insuff-evidence≤{gate.maxInsufficientEvidenceRate} · human≥{gate.minHumanAgreement ?? "—"}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink3">
          Thresholds were fixed before analysing shadow results and are hash-sealed against the data.
          Changing any threshold starts a new registration — sealed values are never edited in place.
        </p>
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="text-sm font-semibold">Tracked metrics (per route × segment)</h2>
        <p className="mt-1 text-xs text-ink3">
          Segments: classifier confidence band, transcript length, round count, score-gap band,
          mixed-role count, debate subject/category where available. Metrics: winner agreement, tie
          disagreement, score MAE, score-gap MAE, insufficient-evidence disagreement, side-swap
          stability, false-decisive rate. Human-grounded validity (human consensus vs ensemble, human
          consensus vs shadow) gates promotion — ensemble agreement alone is migration-safety only.
          Shadow records carry no raw debate text.
        </p>
      </section>
    </AppShell>
  );
}
