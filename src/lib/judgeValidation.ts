// Judge validation status: what each product surface is allowed to claim.
//
// The repository already holds the evidence (docs/latest-judge-benchmark.json,
// written by scripts/judge-benchmark.mjs) and already writes the rules
// (config/judge-gates.json). What was missing is the step between them and the
// person using the product: the gates are enforced for RANKED PLAY, the
// least valuable gated surface, while the training loop — weakness detection,
// repair targeting, the seven skill dimensions — runs on the same unvalidated
// judge and is not gated anywhere. A user (or a support answer) cannot tell
// that from the product.
//
// This module is the pure reduction: benchmark artifact + clock -> one
// validation state per surface, carrying the measured numbers behind the
// label. It never reads I/O (see judgeValidationServer.ts) and it never
// re-derives the gates — thresholds come from the artifact's own `gates` block,
// which is the sealed gate configuration the benchmark ran against.
//
// The honesty rules it follows are this project's existing ones:
//   - a source that cannot be read is `unavailable`, never a pass;
//   - `unknown` is a first-class outcome, distinct from a measured pass;
//   - nothing here can loosen a threshold or manufacture a validated claim.

/** The product surfaces whose outputs a judge/model influences. */
export type SurfaceId = "solo-training" | "repair" | "pvp-verdict" | "guest";

export const SURFACE_IDS: SurfaceId[] = ["solo-training", "repair", "pvp-verdict", "guest"];

/**
 * What a surface's outputs may be described as.
 *
 * `validated` is reserved for a model that cleared EVERY gate on the full
 * pack — the same bar docs/roadmap.md sets for competitive claims. Nothing
 * else reaches it, and in particular not a benchmark nobody re-ran.
 */
export type ValidationStatus = "validated" | "provisional" | "gated-off" | "unknown";

/** Whether the underlying evidence could actually be read. */
export type SourceState = "ok" | "partial" | "unavailable";

/** The measured facts behind a label. Never inferred, never rounded up. */
export interface ValidationEvidence {
  modelsBenchmarked: number;
  modelsPassingAllGates: number;
  /** Best fixture-label agreement across benchmarked models, or null. */
  bestAgreement: number | null;
  /** Sample size behind bestAgreement — agreement without n is not a claim. */
  bestAgreementN: number | null;
  /** Best (lowest) expected-calibration-error across benchmarked models. */
  bestEce: number | null;
  /** Gate thresholds in force for this run, echoed for display. */
  thresholds: { humanAgreementMin: number | null; eceMax: number | null; providerReliabilityMin: number | null };
}

export interface SurfaceValidation {
  surface: SurfaceId;
  status: ValidationStatus;
  /** One sentence stating exactly what this surface's numbers may be called. */
  claim: string;
  /** The one-sentence reason the status is what it is. */
  reason: string;
  evidence: ValidationEvidence | null;
  /** ISO timestamp of the benchmark this state was derived from. */
  runAt: string | null;
  /** True when the artifact is older than the staleness horizon. */
  stale: boolean;
  source: SourceState;
}

export interface JudgeValidationReport {
  /** Latest benchmark's own verdict, when one is readable. */
  benchmarkAllPass: boolean | null;
  runAt: string | null;
  stale: boolean;
  source: SourceState;
  evidence: ValidationEvidence | null;
  surfaces: Record<SurfaceId, SurfaceValidation>;
  note: string;
}

/**
 * Staleness horizon. The judge benchmark is a weekly workflow, so two missed
 * cycles is the point at which "latest" stops meaning current. A benchmark
 * nobody re-ran must never read as a fresh verdict — it degrades to `unknown`
 * rather than sitting there looking authoritative.
 */
export const STALENESS_DAYS = 14;

/** One benchmark row, narrowed to the fields this module reads. */
export interface BenchmarkRow {
  model: string;
  humanAgreement?: number | null;
  agreementN?: number | null;
  ece?: number | null;
  reliability?: { successRatio?: number | null } | null;
  gates?: Array<{ name: string; pass: boolean; kind?: string | null; state?: string | null }> | null;
}

export interface BenchmarkArtifact {
  at?: string | null;
  allPass?: boolean | null;
  gates?: Record<string, number> | null;
  results?: BenchmarkRow[] | null;
}

export interface JudgeValidationInput {
  artifact: BenchmarkArtifact | null | undefined;
  nowIso: string;
  stalenessDays?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A row passes only when every gate in it passed. Absent gates are not passes. */
function rowPassesAllGates(row: BenchmarkRow): boolean {
  const gates = Array.isArray(row.gates) ? row.gates : [];
  // A row with no gate detail proves nothing, so it cannot certify a model.
  return gates.length > 0 && gates.every((g) => g?.pass === true);
}

function summarise(rows: BenchmarkRow[], thresholds: Record<string, number> | null | undefined): ValidationEvidence {
  const eces = rows.map((r) => num(r.ece)).filter((v): v is number => v !== null);

  // Agreement and its sample size must travel together: the highest agreement
  // measured on four usable calls is not the pack's agreement.
  let bestAgreement: number | null = null;
  let bestAgreementN: number | null = null;
  for (const r of rows) {
    const a = num(r.humanAgreement);
    const n = num(r.agreementN);
    if (a === null) continue;
    if (bestAgreement === null || a > bestAgreement) {
      bestAgreement = a;
      bestAgreementN = n;
    }
  }

  return {
    modelsBenchmarked: rows.length,
    modelsPassingAllGates: rows.filter(rowPassesAllGates).length,
    bestAgreement,
    bestAgreementN,
    bestEce: eces.length ? Math.min(...eces) : null,
    thresholds: {
      humanAgreementMin: num(thresholds?.humanAgreementMin),
      eceMax: num(thresholds?.eceMax),
      providerReliabilityMin: num(thresholds?.providerReliabilityMin),
    },
  };
}

function fmt(n: number | null, digits = 3): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

/** Shared phrasing for the two training-path surfaces, which differ only in name. */
function trainingSurface(
  surface: SurfaceId,
  evidence: ValidationEvidence | null,
  stale: boolean,
  source: SourceState,
  runAt: string | null,
  subject: string,
): SurfaceValidation {
  if (!evidence || source === "unavailable") {
    return {
      surface,
      status: "unknown",
      claim: `No validated claim is available for ${subject}.`,
      reason: "The judge benchmark artifact could not be read, so this surface has no measured evidence either way.",
      evidence: null,
      runAt,
      stale,
      source,
    };
  }
  const measured =
    evidence.bestAgreement === null
      ? "no agreement figure"
      : `${fmt(evidence.bestAgreement)} agreement at n=${evidence.bestAgreementN ?? "?"}`;
  return {
    surface,
    status: "provisional",
    claim: `${subject} outputs are practice feedback measured against an unvalidated benchmark — not a validated ability score.`,
    reason: stale
      ? `Benchmark is stale, so even the measured figures (${measured}) no longer describe the current judge.`
      : `Measured: ${measured} against a ${fmt(evidence.thresholds.humanAgreementMin)} floor; ${evidence.modelsPassingAllGates}/${evidence.modelsBenchmarked} models cleared every gate. No surface here has external human validation yet.`,
    evidence,
    runAt,
    stale,
    source,
  };
}

export function assessJudgeValidation(input: JudgeValidationInput): JudgeValidationReport {
  const stalenessDays = input.stalenessDays ?? STALENESS_DAYS;
  const artifact = input.artifact ?? null;
  const rows = Array.isArray(artifact?.results) ? artifact!.results! : [];
  const runAt = typeof artifact?.at === "string" && artifact.at ? artifact.at : null;

  const readable = artifact !== null && rows.length > 0;
  const source: SourceState = !artifact
    ? "unavailable"
    : rows.length === 0
      ? "partial"
      : "ok";

  const evidence = rows.length ? summarise(rows, artifact?.gates) : null;

  // Staleness is computed from the artifact's own timestamp, never from "when
  // this page was rendered" — a fresh deploy must not make a three-week-old
  // benchmark look current.
  let stale = false;
  if (runAt) {
    const ageMs = Date.parse(input.nowIso) - Date.parse(runAt);
    stale = Number.isFinite(ageMs) && ageMs > stalenessDays * 86_400_000;
  }

  const competitiveOk = readable && !stale && evidence !== null && evidence.modelsPassingAllGates > 0;

  const pvp: SurfaceValidation = !readable
    ? {
        surface: "pvp-verdict",
        status: "unknown",
        claim: "No competitive verdict can be published — judge validation state is unknown.",
        reason: "The judge benchmark artifact could not be read.",
        evidence: null,
        runAt,
        stale,
        source: "unavailable",
      }
    : competitiveOk
      ? {
          surface: "pvp-verdict",
          status: "validated",
          claim: "Judge verdicts cleared the validation gates on the full benchmark pack.",
          reason: `${evidence!.modelsPassingAllGates}/${evidence!.modelsBenchmarked} benchmarked models passed every gate; measured agreement ${fmt(evidence!.bestAgreement)} at n=${evidence!.bestAgreementN ?? "?"}.`,
          evidence: evidence!,
          runAt,
          stale,
          source,
        }
      : {
          surface: "pvp-verdict",
          status: "gated-off",
          claim: "Verdicts are practice feedback, not results — presented with the judge's measured agreement, never as a win.",
          reason: stale
            ? `No model cleared every gate, and the benchmark itself is stale (run ${runAt}), so it cannot certify anything. Best measured agreement was ${fmt(evidence!.bestAgreement)} at n=${evidence!.bestAgreementN ?? "?"}.`
            : `${evidence!.modelsPassingAllGates}/${evidence!.modelsBenchmarked} models cleared every gate. Best measured agreement ${fmt(evidence!.bestAgreement)} at n=${evidence!.bestAgreementN ?? "?"} against a ${fmt(evidence!.thresholds.humanAgreementMin)} floor; best ECE ${fmt(evidence!.bestEce)} against a ${fmt(evidence!.thresholds.eceMax)} ceiling.`,
          evidence: evidence!,
          runAt,
          stale,
          source,
        };

  const note = !readable
    ? source === "unavailable"
      ? "No judge benchmark artifact is readable. No surface may make a validated claim."
      : "Judge benchmark artifact has no results. No surface may make a validated claim."
    : stale
      ? `Judge benchmark is stale: run ${runAt} is older than ${stalenessDays} days. It is retained as evidence but cannot certify the current judge.`
      : evidence && evidence.modelsPassingAllGates === 0
        ? `${evidence.modelsBenchmarked} models benchmarked, none cleared every gate. Training surfaces are provisional; competitive claims stay gated.`
        : "Judge benchmark gates passed for at least one model.";

  return {
    benchmarkAllPass: typeof artifact?.allPass === "boolean" ? artifact.allPass : null,
    runAt,
    stale,
    source,
    evidence,
    surfaces: {
      "solo-training": trainingSurface("solo-training", evidence, stale, source, runAt, "Solo training"),
      repair: trainingSurface("repair", evidence, stale, source, runAt, "Weak-link repair"),
      "guest": trainingSurface("guest", evidence, stale, source, runAt, "Guest practice"),
      "pvp-verdict": pvp,
    },
    note,
  };
}

/**
 * Whether a surface may present competitive/result framing.
 *
 * Only `validated` qualifies. Every other status — including `unknown` — is
 * false, so an unreadable artifact can never open a competitive claim by
 * accident. This is the single gate the UI reads.
 */
export function allowsCompetitiveClaims(surface: SurfaceValidation): boolean {
  return surface.status === "validated";
}