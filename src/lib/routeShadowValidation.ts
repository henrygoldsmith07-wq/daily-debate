// Structural-route SHADOW VALIDATION lifecycle.
//
// The structural classifier may shape responses, but it must NOT decide a PvP
// winner until its route has demonstrably agreed with the established ensemble
// on real debates. This module owns three things:
//
//   1. the lifecycle state of every judge-avoidance route (all start `shadow`);
//   2. the PREREGISTERED adoption gates (thresholds fixed BEFORE results are
//      looked at, then hash-sealed so they cannot be tuned to the data);
//   3. the shadow-vs-ensemble record for each debate, plus the gate check.
//
// Confidence honesty: `classifierConfidence` is the classifier's confidence
// that it labelled rhetorical roles correctly. It is NOT confidence that the
// deterministic graph is a correct reading of the debate, and NOT confidence
// that a side should win. Those are separate fields and must never be
// presented as interchangeable.

import { createHash } from "node:crypto";

import type {
  ArgumentRoleCounts,
  ArgumentRoute,
  ArgumentRoutingSummary,
} from "./argumentTaxonomy";

export type RouteLifecycleState = "shadow" | "eligible" | "adopted" | "suspended";

/**
 * Every judge-avoidance route defaults to `shadow`. Nothing here may be
 * promoted without stored evidence passing its gate below.
 *
 * `ensemble` is the established authoritative path itself, not a candidate to
 * replace it, so it is permanently `adopted` and is never gated.
 */
export const DEFAULT_ROUTE_LIFECYCLE: Record<ArgumentRoute, RouteLifecycleState> = Object.freeze({
  deterministic: "shadow",
  "rebuttal-compare": "shadow",
  "evidence-verification": "shadow",
  lightweight: "shadow",
  "response-generation": "shadow",
  ensemble: "adopted",
});

/** Routes that, if adopted, would bypass the established ensemble judge. */
export const JUDGE_AVOIDANCE_ROUTES: ArgumentRoute[] = [
  "deterministic",
  "rebuttal-compare",
  "evidence-verification",
  "lightweight",
];

export interface RouteAdoptionGate {
  /** Minimum shadow debates before a route may be judged at all. */
  minN: number;
  /** Minimum share of debates where shadow and ensemble pick the same winner. */
  minWinnerAgreement: number;
  /** Minimum share of debates where the shadow result is side-swap stable. */
  minSideSwapStability: number;
  /** Maximum share of debates the shadow path calls decisively but the ensemble does not. */
  maxFalseDecisiveRate: number;
  /** Maximum mean absolute score-gap error (points). */
  maxScoreGapMae: number;
  /** Maximum share of debates where the shadow path reports insufficient evidence but the ensemble scores. */
  maxInsufficientEvidenceRate: number;
  /** Once available: minimum agreement with human consensus (null = not yet required). */
  minHumanAgreement: number | null;
}

/**
 * PREREGISTERED thresholds — fixed before any shadow results were observed.
 * Rationale: agreement must be high because a mis-called winner directly
 * changes competitive outcomes; the decisive-rate and MAE caps prevent a route
 * from being adopted on the strength of easy debates alone.
 */
export const PREREGISTERED_ROUTE_GATES: Record<ArgumentRoute, RouteAdoptionGate> = Object.freeze({
  deterministic: Object.freeze({
    minN: 200, minWinnerAgreement: 0.95, minSideSwapStability: 0.95,
    maxFalseDecisiveRate: 0.02, maxScoreGapMae: 4, maxInsufficientEvidenceRate: 0.02,
    minHumanAgreement: 0.7,
  }),
  "rebuttal-compare": Object.freeze({
    minN: 200, minWinnerAgreement: 0.92, minSideSwapStability: 0.92,
    maxFalseDecisiveRate: 0.03, maxScoreGapMae: 6, maxInsufficientEvidenceRate: 0.03,
    minHumanAgreement: 0.65,
  }),
  "evidence-verification": Object.freeze({
    minN: 200, minWinnerAgreement: 0.92, minSideSwapStability: 0.92,
    maxFalseDecisiveRate: 0.03, maxScoreGapMae: 6, maxInsufficientEvidenceRate: 0.03,
    minHumanAgreement: 0.65,
  }),
  lightweight: Object.freeze({
    minN: 300, minWinnerAgreement: 0.97, minSideSwapStability: 0.97,
    maxFalseDecisiveRate: 0.01, maxScoreGapMae: 3, maxInsufficientEvidenceRate: 0.01,
    minHumanAgreement: 0.75,
  }),
  // Response shaping never decides a winner, so it is not gated for adoption.
  "response-generation": Object.freeze({
    minN: 0, minWinnerAgreement: 0, minSideSwapStability: 0,
    maxFalseDecisiveRate: 1, maxScoreGapMae: Number.POSITIVE_INFINITY, maxInsufficientEvidenceRate: 1,
    minHumanAgreement: null,
  }),
  // The established path itself: authoritative by definition, never adopted
  // away from, so its gate is vacuous rather than a promotion target.
  ensemble: Object.freeze({
    minN: 0, minWinnerAgreement: 0, minSideSwapStability: 0,
    maxFalseDecisiveRate: 1, maxScoreGapMae: Number.POSITIVE_INFINITY, maxInsufficientEvidenceRate: 1,
    minHumanAgreement: null,
  }),
});

/** Version of the preregistered gates. Bump only with a new registration. */
export const ROUTE_GATE_VERSION = "route-adoption-gates-v1";

/**
 * Minimum human-consensus items behind a human-grounded agreement claim.
 * Below this, human data is insufficient and the route stays in shadow (or
 * at most internally eligible-awaiting-human, never production-adopted).
 */
export const HUMAN_GATE_MIN_ITEMS = 30;

/**
 * Canonical payload for a gate seal and for the immutable registration
 * artifacts in docs/route-registrations. Order-independent by construction.
 */
export function canonicalGateJson(version: string, route: ArgumentRoute, gate: RouteAdoptionGate): string {
  return JSON.stringify([
    version,
    route,
    gate.minN,
    gate.minWinnerAgreement,
    gate.minSideSwapStability,
    gate.maxFalseDecisiveRate,
    gate.maxScoreGapMae === Number.POSITIVE_INFINITY ? "inf" : gate.maxScoreGapMae,
    gate.maxInsufficientEvidenceRate,
    gate.minHumanAgreement,
  ]);
}

/**
 * Stable seal of a gate so the thresholds are tamper-evident. Registration
 * is immutable: changing a threshold changes the hash. SHA-256 (replacing
 * the previous 32-bit FNV) so the seal matches the registration artifacts.
 */
export function hashRouteGate(route: ArgumentRoute, gate: RouteAdoptionGate): string {
  return createHash("sha256").update(canonicalGateJson(ROUTE_GATE_VERSION, route, gate), "utf8").digest("hex");
}

/** The full preregistration, suitable for storing immutably alongside results. */
export function routeGateRegistration(): {
  version: string;
  gates: Record<string, { gate: RouteAdoptionGate; hash: string }>;
} {
  const gates: Record<string, { gate: RouteAdoptionGate; hash: string }> = {};
  for (const [route, gate] of Object.entries(PREREGISTERED_ROUTE_GATES)) {
    gates[route] = { gate, hash: hashRouteGate(route as ArgumentRoute, gate) };
  }
  return { version: ROUTE_GATE_VERSION, gates };
}

export type ShadowWinner = "a" | "b" | "tie";

/**
 * Explicit shadow-attempt states. Only candidate judge-avoidance routes enter
 * route adoption denominators:
 * - "scored" — deterministic scoring produced a result;
 * - "insufficient-evidence" — attempted, but the graph was not scoreable;
 * - "routing-not-eligible" — normal ensemble routing, not a shadow attempt;
 * - "classifier-failure" — the classifier itself contributed nothing usable
 *   (all-fallback rows), so scoring never had a real input.
 */
export type ShadowAttemptStatus =
  | "scored"
  | "insufficient-evidence"
  | "routing-not-eligible"
  | "classifier-failure";

export function classifyShadowAttemptStatus(
  plan: { route: ArgumentRoute; argumentCount: number; fallbackCount: number },
  scored: boolean,
): ShadowAttemptStatus {
  if (plan.route === "ensemble") return "routing-not-eligible";
  if (scored) return "scored";
  if (plan.argumentCount > 0 && plan.fallbackCount >= plan.argumentCount) return "classifier-failure";
  return "insufficient-evidence";
}

/** Transcript-size bucket: bounded metadata for segmentation, never the text. */
export type SizeBucket = "<1k" | "1k-4k" | "4k-16k" | ">=16k";

export function bucketTranscriptChars(chars: number): SizeBucket {
  if (chars < 1000) return "<1k";
  if (chars < 4000) return "1k-4k";
  if (chars < 16000) return "4k-16k";
  return ">=16k";
}

export interface ShadowSideResult {
  winner: ShadowWinner;
  playerAScore: number;
  playerBScore: number;
  scoreGap: number;
  scoreStatus: string;
}

/**
 * One shadow debate. Carries NO raw debate text: routing analytics must not
 * become a transcript store.
 */
export interface RouteShadowRecord {
  route: ArgumentRoute;
  taxonomyVersion: string;
  classifierSource: ArgumentRoutingSummary["classifierSource"];
  /** Classification confidence in the ROLE LABELS only (see header note). */
  confidence: {
    highConfidenceCount: number;
    ambiguousCount: number;
    unknownCount: number;
    fallbackCount: number;
    argumentCount: number;
    /** Share of arguments the classifier labelled with high confidence. */
    highConfidenceShare: number;
  };
  roleCounts: ArgumentRoleCounts;
  mixedRoleCount: number;
  ensembleWinner: ShadowWinner;
  shadowWinner: ShadowWinner;
  ensembleScores: { a: number; b: number; gap: number };
  shadowScores: { a: number; b: number; gap: number };
  ensembleScoreStatus: string;
  shadowScoreStatus: string;
  winnerAgreement: boolean;
  absoluteScoreDifference: number;
  scoreGapDifference: number;
  /** Shadow path produced no scoreable result while the ensemble did. */
  insufficientEvidence: boolean;
  /** Explicit attempt state — only non-"routing-not-eligible" rows count. */
  shadowAttemptStatus: ShadowAttemptStatus;
  /** Bounded segmentation metadata (no raw text is ever stored). */
  sizeBucket: SizeBucket | null;
  roundCount: number | null;
  /**
   * Expensive judge legs this shadow attempt WOULD have avoided had its
   * route been adopted (copied from the routing summary). Shadow-only
   * evidence for judge-call savings; never a live saving while routes are
   * in shadow. Absent on rows recorded before this field existed.
   */
  avoidedJudgeLegs?: number;
}

/** Build the shadow record from the routing summary plus both verdicts. */
export function buildShadowRecord(params: {
  routing: ArgumentRoutingSummary;
  ensemble: ShadowSideResult;
  shadow: ShadowSideResult | null;
  status?: ShadowAttemptStatus;
  sizeBucket?: SizeBucket | null;
  roundCount?: number | null;
}): RouteShadowRecord {
  const { routing, ensemble, shadow } = params;
  const argumentCount = routing.argumentCount;
  return {
    route: routing.route,
    taxonomyVersion: routing.taxonomyVersion,
    classifierSource: routing.classifierSource,
    confidence: {
      highConfidenceCount: routing.highConfidenceCount,
      ambiguousCount: routing.ambiguousCount,
      unknownCount: routing.unknownCount,
      fallbackCount: routing.fallbackCount,
      argumentCount,
      highConfidenceShare: argumentCount > 0 ? routing.highConfidenceCount / argumentCount : 0,
    },
    roleCounts: routing.roleCounts,
    mixedRoleCount: routing.mixedRoleCount,
    ensembleWinner: ensemble.winner,
    shadowWinner: shadow?.winner ?? "tie",
    ensembleScores: { a: ensemble.playerAScore, b: ensemble.playerBScore, gap: ensemble.scoreGap },
    shadowScores: shadow
      ? { a: shadow.playerAScore, b: shadow.playerBScore, gap: shadow.scoreGap }
      : { a: 0, b: 0, gap: 0 },
    ensembleScoreStatus: ensemble.scoreStatus,
    shadowScoreStatus: shadow?.scoreStatus ?? "insufficient",
    winnerAgreement: shadow !== null && shadow.winner === ensemble.winner,
    // Absolute score difference on each side's A-score, averaged — a coarse
    // magnitude signal that does not depend on which side won.
    absoluteScoreDifference: shadow
      ? (Math.abs(shadow.playerAScore - ensemble.playerAScore) +
          Math.abs(shadow.playerBScore - ensemble.playerBScore)) / 2
      : 0,
    scoreGapDifference: shadow ? Math.abs(shadow.scoreGap - ensemble.scoreGap) : 0,
    insufficientEvidence: shadow === null,
    shadowAttemptStatus: params.status
      ?? (shadow !== null ? "scored" : routing.route === "ensemble" ? "routing-not-eligible" : "insufficient-evidence"),
    sizeBucket: params.sizeBucket ?? null,
    roundCount: typeof params.roundCount === "number" ? params.roundCount : null,
    avoidedJudgeLegs: routing.expensiveJudgeCallsAvoided ?? 0,
  };
}

export interface RouteGateVerdict {
  route: ArgumentRoute;
  state: RouteLifecycleState;
  n: number;
  metrics: {
    winnerAgreement: number | null;
    tieDisagreement: number | null;
    scoreMae: number | null;
    scoreGapMae: number | null;
    insufficientEvidenceRate: number | null;
    falseDecisiveRate: number | null;
    sideSwapStability: number | null;
  };
  passed: boolean;
  failures: string[];
}

/**
 * Evaluate one route against its preregistered gate.
 *
 * `sideSwapStability`, when supplied, is the share of paired runs (transcript
 * and its side-swapped twin) where the shadow route keeps the same winner
 * relative to the sides. It is null when no pairs have been observed, which
 * fails the gate rather than passing by default.
 */
export function evaluateRouteGate(params: {
  route: ArgumentRoute;
  records: RouteShadowRecord[];
  sideSwapStability?: number | null;
  humanAgreement?: number | null;
  humanItems?: number | null;
}): RouteGateVerdict {
  const { route } = params;
  const gate = PREREGISTERED_ROUTE_GATES[route];
  // N = all ELIGIBLE shadow attempts: failed scoring still counts (as
  // insufficient evidence), but normal ensemble routing is not an attempt
  // and must never enter the denominator. Legacy rows without an explicit
  // status keep their historical reading (insufficient flag decides).
  const records = params.records.filter(
    (r) => (r.shadowAttemptStatus ?? (r.insufficientEvidence ? "insufficient-evidence" : "scored")) !== "routing-not-eligible",
  );
  const n = records.length;
  const failures: string[] = [];

  if (n < gate.minN) {
    failures.push(`insufficient shadow debates: ${n} < ${gate.minN}`);
  }

  const scored = records.filter((r) => !r.insufficientEvidence);
  const winnerAgreement = scored.length ? scored.filter((r) => r.winnerAgreement).length / scored.length : null;
  // Tie disagreement is strictly "exactly one side called it a tie".
  // tie/tie is agreement, and A/B is winner (not tie) disagreement.
  const tieDisagreement = scored.length
    ? scored.filter((r) => (r.ensembleWinner === "tie") !== (r.shadowWinner === "tie")).length / scored.length
    : null;
  const scoreMae = scored.length
    ? scored.reduce((s, r) => s + r.absoluteScoreDifference, 0) / scored.length
    : null;
  const scoreGapMae = scored.length
    ? scored.reduce((s, r) => s + r.scoreGapDifference, 0) / scored.length
    : null;
  const insufficientEvidenceRate = n ? records.filter((r) => r.insufficientEvidence).length / n : null;
  // "False decisive": the shadow path picks a side the ensemble calls a tie.
  const falseDecisiveRate = scored.length
    ? scored.filter((r) => r.shadowWinner !== "tie" && r.ensembleWinner === "tie").length / scored.length
    : null;
  const sideSwapStability = params.sideSwapStability ?? null;
  const humanAgreement = params.humanAgreement ?? null;

  const checkMin = (label: string, value: number | null, min: number) => {
    if (value === null) failures.push(`${label} not measured`);
    else if (value < min) failures.push(`${label} ${value.toFixed(3)} < ${min}`);
  };
  const checkMax = (label: string, value: number | null, max: number) => {
    if (value === null) failures.push(`${label} not measured`);
    else if (value > max) failures.push(`${label} ${value.toFixed(3)} > ${max}`);
  };

  checkMin("winner agreement", winnerAgreement, gate.minWinnerAgreement);
  checkMin("side-swap stability", sideSwapStability, gate.minSideSwapStability);
  checkMax("false-decisive rate", falseDecisiveRate, gate.maxFalseDecisiveRate);
  checkMax("score-gap MAE", scoreGapMae, gate.maxScoreGapMae);
  checkMax("insufficient-evidence rate", insufficientEvidenceRate, gate.maxInsufficientEvidenceRate);
  if (gate.minHumanAgreement !== null) {
    checkMin("human-grounded agreement", humanAgreement, gate.minHumanAgreement);
    const humanItems = params.humanItems ?? null;
    if (humanItems === null || humanItems < HUMAN_GATE_MIN_ITEMS) {
      failures.push(`human-grounded items ${humanItems ?? "unmeasured"} < ${HUMAN_GATE_MIN_ITEMS}`);
    }
  }

  // A route is only ever `eligible` here. Promotion to `adopted` is a separate,
  // deliberate act that consumes this verdict — never an automatic side effect.
  const state: RouteLifecycleState = n < gate.minN ? "shadow" : failures.length ? "shadow" : "eligible";
  return {
    route,
    state,
    n,
    metrics: {
      winnerAgreement, tieDisagreement, scoreMae, scoreGapMae,
      insufficientEvidenceRate, falseDecisiveRate, sideSwapStability,
    },
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Monitoring: an ADOPTED route that later violates its gate must be returned
 * to the ensemble immediately.
 */
export function monitorAdoptedRoute(verdict: RouteGateVerdict): RouteLifecycleState {
  if (verdict.state === "adopted") return verdict.passed ? "adopted" : "suspended";
  return verdict.passed ? "eligible" : "shadow";
}

/** Role/category breakdown for route-level dashboards (no raw text). */
export interface RouteSegment {
  route: ArgumentRoute;
  n: number;
  scoredCount: number;
  insufficientCount: number;
  winnerAgreement: number | null;
  tieDisagreement: number | null;
  scoreMae: number | null;
  scoreGapMae: number | null;
  insufficientEvidenceRate: number | null;
  falseDecisiveRate: number | null;
  /** Sum of would-be-avoided judge legs across eligible attempts. */
  avoidedJudgeLegs: number;
}

/** Eligible shadow attempts: everything except normal ensemble routing. */
function isEligibleShadowAttempt(r: RouteShadowRecord): boolean {
  return (r.shadowAttemptStatus ?? (r.insufficientEvidence ? "insufficient-evidence" : "scored")) !== "routing-not-eligible";
}

/**
 * False-route rate: share of SCORED shadow attempts where the classifier
 * route disagrees with the authoritative ensemble (any winner mismatch, not
 * just false-decisive calls). Null when nothing scored. This is the
 * complement of winner agreement — the headline "how often would the route
 * have been wrong" tracker. It is NOT a gate criterion: adoption thresholds
 * are fixed in PREREGISTERED_ROUTE_GATES and evaluated only there.
 */
export function falseRouteRate(records: RouteShadowRecord[]): number | null {
  const scored = records.filter((r) => isEligibleShadowAttempt(r) && !r.insufficientEvidence);
  if (!scored.length) return null;
  return scored.filter((r) => !r.winnerAgreement).length / scored.length;
}

export function segmentByRoute(records: RouteShadowRecord[]): RouteSegment[] {
  const eligible = records.filter(
    (r) => (r.shadowAttemptStatus ?? (r.insufficientEvidence ? "insufficient-evidence" : "scored")) !== "routing-not-eligible",
  );
  const byRoute = new Map<ArgumentRoute, RouteShadowRecord[]>();
  for (const r of eligible) {
    const list = byRoute.get(r.route) ?? [];
    list.push(r);
    byRoute.set(r.route, list);
  }
  return [...byRoute.entries()].map(([route, rs]) => {
    const scored = rs.filter((r) => !r.insufficientEvidence);
    return {
      route,
      n: rs.length,
      scoredCount: scored.length,
      insufficientCount: rs.length - scored.length,
      winnerAgreement: scored.length ? scored.filter((r) => r.winnerAgreement).length / scored.length : null,
      tieDisagreement: scored.length
        ? scored.filter((r) => (r.ensembleWinner === "tie") !== (r.shadowWinner === "tie")).length / scored.length
        : null,
      scoreMae: scored.length ? scored.reduce((s, r) => s + r.absoluteScoreDifference, 0) / scored.length : null,
      scoreGapMae: scored.length ? scored.reduce((s, r) => s + r.scoreGapDifference, 0) / scored.length : null,
      insufficientEvidenceRate: rs.length ? rs.filter((r) => r.insufficientEvidence).length / rs.length : null,
      falseDecisiveRate: scored.length
        ? scored.filter((r) => r.shadowWinner !== "tie" && r.ensembleWinner === "tie").length / scored.length
        : null,
      avoidedJudgeLegs: rs.reduce((sum, r) => sum + (r.avoidedJudgeLegs ?? 0), 0),
    };
  });
}

/** Confidence bands for segmentation, so low-confidence cases stay visible. */
export function confidenceBand(share: number): "low" | "medium" | "high" {
  if (share < 0.6) return "low";
  if (share < 0.85) return "medium";
  return "high";
}

export function mixedRoleBucket(count: number | null): string {
  if (count === null || count === undefined) return "unknown";
  if (count === 0) return "0";
  if (count <= 2) return "1-2";
  return ">2";
}

export function roundCountBucket(rounds: number | null): string {
  if (rounds === null || rounds === undefined) return "unknown";
  if (rounds <= 2) return "<=2";
  if (rounds <= 5) return "3-5";
  return ">5";
}

/** Segment label extractors over stored records (bounded metadata only). */
export function segmentKeyFns(): Record<string, (r: RouteShadowRecord) => string> {
  return {
    confidence: (r) => confidenceBand(r.confidence.highConfidenceShare),
    "score-gap": (r) => scoreGapBand(r.ensembleScores.gap),
    "mixed-role": (r) => mixedRoleBucket(r.mixedRoleCount),
    size: (r) => r.sizeBucket ?? "unknown",
    rounds: (r) => roundCountBucket(r.roundCount),
  };
}

export interface ShadowSegmentSlice {
  segment: string;
  label: string;
  n: number;
  winnerAgreement: number | null;
  tieDisagreement: number | null;
  scoreGapMae: number | null;
  insufficientEvidenceRate: number | null;
}

/**
 * Segment eligible records by a bounded label. Slices with tiny samples are
 * still reported WITH their denominators — never percentages alone.
 */
export function segmentShadowRecords(
  records: RouteShadowRecord[],
  keyFn: (r: RouteShadowRecord) => string,
  segment: string,
): ShadowSegmentSlice[] {
  const eligible = records.filter(
    (r) => (r.shadowAttemptStatus ?? (r.insufficientEvidence ? "insufficient-evidence" : "scored")) !== "routing-not-eligible",
  );
  const byLabel = new Map<string, RouteShadowRecord[]>();
  for (const r of eligible) {
    const label = keyFn(r);
    const list = byLabel.get(label) ?? [];
    list.push(r);
    byLabel.set(label, list);
  }
  return [...byLabel.entries()]
    .map(([label, rs]) => {
      const scored = rs.filter((r) => !r.insufficientEvidence);
      return {
        segment,
        label,
        n: rs.length,
        winnerAgreement: scored.length ? scored.filter((r) => r.winnerAgreement).length / scored.length : null,
        tieDisagreement: scored.length
          ? scored.filter((r) => (r.ensembleWinner === "tie") !== (r.shadowWinner === "tie")).length / scored.length
          : null,
        scoreGapMae: scored.length ? scored.reduce((s, r) => s + r.scoreGapDifference, 0) / scored.length : null,
        insufficientEvidenceRate: rs.length ? rs.filter((r) => r.insufficientEvidence).length / rs.length : null,
      };
    })
    .sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
}

/** Score-gap bands for segmentation. */
export function scoreGapBand(gapPoints: number): "tie" | "narrow" | "clear" | "decisive" {
  if (gapPoints < 5) return "tie";
  if (gapPoints < 15) return "narrow";
  if (gapPoints < 30) return "clear";
  return "decisive";
}
