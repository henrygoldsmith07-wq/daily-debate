import { createClient, createServiceClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import {
  DEFAULT_ROUTE_LIFECYCLE,
  evaluateRouteGate,
  falseRouteRate,
  JUDGE_AVOIDANCE_ROUTES,
  monitorAdoptedRoute,
  PREREGISTERED_ROUTE_GATES,
  ROUTE_GATE_VERSION,
  routeGateRegistration,
  segmentByRoute,
  segmentKeyFns,
  segmentShadowRecords,
  type RouteShadowRecord,
} from "@/lib/routeShadowValidation";
import { getRouteLifecycleStates } from "@/lib/routeLifecycle";
import type { ArgumentRoute } from "@/lib/argumentTaxonomy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Shadow judge validation (admin)" };

const SHADOW_RECORD_LIMIT = 500;

function pct(value: number | null, n: number, minN: number): string {
  if (value === null) return "—";
  const shown = `${(value * 100).toFixed(1)}%`;
  // Never a bare percentage on a tiny sample: the denominator travels along,
  // and sub-threshold samples are labelled as such.
  return n < minN ? `${shown} (n=${n}, below N)` : `${shown} (n=${n})`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] py-1.5 last:border-0">
      <p className="text-xs text-ink3">{label}</p>
      <p className="tabular text-right text-sm font-medium">{value}</p>
    </div>
  );
}

/**
 * Route-level validation dashboard over REAL accumulated evidence: stored
 * `pvp_matches.judge_verdict.shadowRouting` records, aggregated per route
 * with denominators always shown. Shadow results never control winners —
 * this page measures how closely each shadow route tracks the authoritative
 * ensemble. Side-swap stability and human agreement read "not measured"
 * until those harnesses report; unmeasured gates fail, never pass.
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
  const lifecycleStates = await getRouteLifecycleStates();

  // Stored verdicts only — bounded metadata, never raw transcripts.
  // dataState distinguishes "DB failed / no rows loaded" from "genuinely
  // zero eligible shadow attempts" — never show N=0 for an unavailable source.
  let records: RouteShadowRecord[] = [];
  let verdictsRead = 0;
  let dataState: "available" | "unavailable" = "unavailable";
  try {
    const service = createServiceClient();
    const matches = await service
      .from("pvp_matches")
      .select("judge_verdict")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(SHADOW_RECORD_LIMIT);
    if (matches.error) throw new Error(matches.error.message ?? "pvp_matches unreadable");
    const rows = (matches.data ?? []) as Array<{ judge_verdict: unknown }>;
    verdictsRead = rows.length;
    dataState = "available";
    for (const row of rows) {
      const verdict = row.judge_verdict as { shadowRouting?: unknown } | null;
      const record = verdict?.shadowRouting as RouteShadowRecord | null | undefined;
      if (record && typeof record === "object" && typeof record.route === "string") {
        records.push(record);
      }
    }
  } catch {
    records = [];
    verdictsRead = 0;
    dataState = "unavailable";
  }

  const eligible = records.filter(
    (r) => (r.shadowAttemptStatus ?? (r.insufficientEvidence ? "insufficient-evidence" : "scored")) !== "routing-not-eligible",
  );
  const segments = segmentByRoute(records);
  const byRoute = new Map(segments.map((s) => [s.route, s]));
  const keyFns = segmentKeyFns();

  return (
    <AppShell width="narrow">
      {dataState === "unavailable" ? (
        <section className="surface-card mt-4 p-5" aria-labelledby="shadow-unavailable">
          <h2 id="shadow-unavailable" className="text-sm font-semibold text-amber-900">
            Shadow-validation data unavailable
          </h2>
          <p className="mt-2 text-sm text-ink3">
            Shadow-validation data unavailable. Metrics cannot currently be evaluated.
          </p>
          <p className="mt-1 text-xs text-ink3">
            The stored verdict source could not be read. This is NOT the same as zero eligible
            attempts — no rates or denominators are shown while the source is down.
          </p>
        </section>
      ) : (
        <>
          <PageHeader
            eyebrow="Internal"
            title="Shadow judge validation"
            description={`Classifier judge-avoidance routes run in shadow mode only (${ROUTE_GATE_VERSION}). Evidence below aggregates ${eligible.length} eligible shadow attempts from ${verdictsRead} stored verdicts. The established ensemble stays authoritative until a route clears every preregistered gate.`}
          />

      {JUDGE_AVOIDANCE_ROUTES.map((route: ArgumentRoute) => {
        const gate = PREREGISTERED_ROUTE_GATES[route];
        const sealed = registration.gates[route];
        const seg = byRoute.get(route);
        const routeRecords = eligible.filter((r) => r.route === route);
        // Side-swap and human harnesses have not reported: unmeasured, so the
        // gate fails closed and the route stays in shadow.
        const verdict = evaluateRouteGate({ route, records: routeRecords });
        const stored = lifecycleStates[route] ?? DEFAULT_ROUTE_LIFECYCLE[route];
        const effective = stored === "adopted" ? monitorAdoptedRoute({ ...verdict, state: "adopted" }) : stored;
        return (
          <section key={route} className="surface-card mt-4 p-5" aria-labelledby={`route-${route}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 id={`route-${route}`} className="text-sm font-semibold">{route}</h2>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink3">
                {effective}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink3">
              seal {sealed?.hash.slice(0, 12) ?? "—"} · gate {verdict.passed ? "passing" : "failing"}
              {stored === "adopted" && effective === "suspended" ? " · monitoring tripped — production stays on the ensemble" : ""}
            </p>
            <div className="mt-2">
              <Fact label="N (eligible attempts)" value={String(seg?.n ?? 0)} />
              <Fact label="Scored / insufficient" value={`${seg?.scoredCount ?? 0} / ${seg?.insufficientCount ?? 0}`} />
              <Fact label="Winner agreement" value={pct(seg?.winnerAgreement ?? null, seg?.scoredCount ?? 0, gate.minN)} />
              <Fact label="False-route rate" value={pct(falseRouteRate(routeRecords), seg?.scoredCount ?? 0, gate.minN)} />
              <Fact label="Tie disagreement" value={pct(seg?.tieDisagreement ?? null, seg?.scoredCount ?? 0, gate.minN)} />
              <Fact label="Score MAE" value={num(seg?.scoreMae ?? null)} />
              <Fact label="Score-gap MAE" value={num(seg?.scoreGapMae ?? null)} />
              <Fact label="False-decisive rate" value={pct(seg?.falseDecisiveRate ?? null, seg?.scoredCount ?? 0, gate.minN)} />
              <Fact label="Insufficient-evidence rate" value={pct(seg?.insufficientEvidenceRate ?? null, seg?.n ?? 0, gate.minN)} />
              <Fact label="Would-be-avoided judge legs" value={String(seg?.avoidedJudgeLegs ?? 0)} />
              <Fact label="Side-swap stability" value="not measured" />
              <Fact label="Human agreement" value="not measured" />
            </div>
            {verdict.failures.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink3">
                {verdict.failures.map((failure, i) => (
                  <li key={i}>{failure}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className="surface-card mt-4 p-5" aria-labelledby="segments-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="segments-heading" className="text-sm font-semibold">Segments (all routes pooled)</h2>
        </div>
        <p className="mt-1 text-xs text-ink3">
          Slices report denominators with every rate; tiny samples are labelled, never hidden.
          Subject/category segmentation is unavailable — records carry no subject field.
        </p>
        {Object.entries(keyFns).map(([segment, keyFn]) => {
          const slices = segmentShadowRecords(eligible, keyFn, segment).slice(0, 8);
          if (!slices.length) return null;
          return (
            <div key={segment} className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink3">by {segment}</p>
              <div className="mt-1">
                {slices.map((slice) => (
                  <Fact
                    key={`${segment}:${slice.label}`}
                    label={`${slice.label} (n=${slice.n})`}
                    value={`agree ${slice.winnerAgreement === null ? "—" : `${(slice.winnerAgreement * 100).toFixed(1)}%`} · tie-dis ${slice.tieDisagreement === null ? "—" : `${(slice.tieDisagreement * 100).toFixed(1)}%`} · gap-MAE ${num(slice.scoreGapMae)}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="surface-card mt-4 p-5" aria-labelledby="gates-heading">
        <h2 id="gates-heading" className="text-sm font-semibold">Preregistered adoption gates (SHA-256 sealed)</h2>
        <div className="mt-2">
          {JUDGE_AVOIDANCE_ROUTES.map((route: ArgumentRoute) => {
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
                  insuff-evidence≤{gate.maxInsufficientEvidenceRate} · human≥{gate.minHumanAgreement ?? "—"} (≥30 items)
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink3">
          Thresholds were fixed before analysing shadow results; immutable artifacts live in
          docs/route-registrations/v1. Changing any threshold starts a new registration — sealed values are never edited in place.
        </p>
      </section>
      </>
      )}
    </AppShell>
  );
}
