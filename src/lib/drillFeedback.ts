import { COACH_DIMENSIONS, scoreAttempt, type CoachDimension } from "./adaptiveCoach";

export const DRILL_FEEDBACK_COPY = {
  heading: "Practice checked",
  observationLabel: "Observed in this draft:",
  note: "This is formative practice feedback, not an ability score. Skill movement is measured only in later debates.",
  savedNote: "Practice checked. This drill is saved; improvement is measured against later debates, not this attempt alone.",
  submitIdle: "Check practice move",
  submitBusy: "Checking…",
  errorFallback: "Failed to check your practice.",
} as const;

/**
 * The coach API is intentionally small, but keep the UI boundary defensive:
 * only short, non-empty string labels become learner-facing observations.
 */
export function normaliseDrillSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const signal = item.trim();
    if (!signal || signal.length > 120 || seen.has(signal)) continue;
    seen.add(signal);
    out.push(signal);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Recompute a stored drill attempt's observable signals.
 *
 * The attempt route stores the attempt text and the internal rubric value, not
 * the learner-facing signals. The rubric is deterministic, so the server can
 * reproduce exactly the same signals from the stored text — which is what lets
 * the dashboard render the feedback AFTER a page refresh instead of losing it
 * the moment the component that received it unmounts.
 */
export function drillSignalsFromAttempt(dimension: unknown, text: unknown): string[] {
  if (typeof text !== "string" || !text.trim()) return [];
  if (typeof dimension !== "string") return [];
  if (!(COACH_DIMENSIONS as readonly string[]).includes(dimension)) return [];
  return normaliseDrillSignals(scoreAttempt(dimension as CoachDimension, text).signals);
}
