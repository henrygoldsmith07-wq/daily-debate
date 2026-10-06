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
