// Real-time coaching — deterministic weakness detection DURING the debate.
//
// After each submitted turn the server already computes the turn's observable
// assessment (observableAssessment.ts). This module turns that same evidence
// into at most two coaching hints for the NEXT round — no extra model calls,
// no new scoring, and the same observable-only discipline as the result
// screen. Hints are advisory: they never alter scores and are never persisted
// as ground truth. Pure.

import type { ObservableAssessment } from "./observableAssessment";

export interface LiveCoachingHint {
  /** Stable detector id — the client uses it as a React key and to dedupe. */
  id: string;
  severity: "warning" | "tip";
  message: string;
}

const ABSOLUTE_LANGUAGE_RE = /\b(?:always|never|everyone knows|obviously|definitely|no one)\b/i;

/**
 * Detect at most two coaching hints for the round that is about to be played,
 * from the evidence of the turn just submitted. Priority: structural misses
 * first (contradictions, unanswered opposition), craft nudges second.
 *
 * Suppression rules keep this sparse enough to stay coach-like:
 * - the evidence hint does not fire on round 1 (let the user settle in);
 * - at most one warning and one tip are returned;
 * - a clean turn returns an empty array — no noise for its own sake.
 */
export function liveCoachingForTurn(input: {
  assessment: ObservableAssessment | null | undefined;
  round: number;
  userMessage: string;
}): LiveCoachingHint[] {
  const assessment = input.assessment;
  if (!assessment?.features?.a) return [];

  const hints: LiveCoachingHint[] = [];
  const features = assessment.features.a;

  // 1. Contradiction: the user argued against their own earlier claim.
  if (features.contradictions.value > 0) {
    hints.push({
      id: "contradiction",
      severity: "warning",
      message:
        "This round contradicts one of your earlier claims. Resolve it explicitly next turn — concede and pivot, or the gap stays open.",
    });
  }

  // 2. Unanswered opposition: the opponent's last move went unengaged.
  const responses = features.argumentResponses.value;
  if (responses.opportunities > responses.responded) {
    hints.push({
      id: "unanswered-opponent",
      severity: "warning",
      message:
        "You didn't engage the opponent's last point. Open your next response by answering it directly, then advance your own case.",
    });
  }

  // 3. Ungrounded claims: substantive claims with no cited evidence.
  if (input.round >= 2 && features.claimsMade.value > 0 && features.evidenceActuallyCited.value === 0) {
    hints.push({
      id: "no-evidence",
      severity: "tip",
      message:
        "No source cited this round. Ground your main claim with one real institution — unsupported claims are the easiest to dismiss.",
    });
  }

  // 4. Absolute-language crutch: overclaims invite cheap rebuttals.
  if (ABSOLUTE_LANGUAGE_RE.test(input.userMessage)) {
    hints.push({
      id: "absolute-language",
      severity: "tip",
      message:
        "You leaned on absolute language (always / never / everyone). Qualify the claim — a qualified case is far harder to rebut.",
    });
  }

  const warnings = hints.filter((h) => h.severity === "warning").slice(0, 1);
  const tips = hints.filter((h) => h.severity === "tip").slice(0, 1);
  return [...warnings, ...tips];
}
