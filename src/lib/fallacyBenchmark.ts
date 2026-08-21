// Fallacy-detector benchmark: precision / recall / F1 over a labelled case set.
//
// The classifier (classifyFallacies in graphEnrichers.ts) is rule-based and
// auditable, but rules have false positives ("what about X" is a whataboutism
// only when it dodges the point) and false negatives (novel phrasings of a
// fallacy). This harness scores it the way you would score any detector:
// per-label precision/recall/F1 plus macro-F1 and a false-positive rate on
// clean text, so a rule change that "catches more" at the cost of crying wolf
// fails CI instead of reaching users.
//
// The default predictor follows the same threshold the app uses (topFallacy,
// score ≥ 0.6). A future model-backed classifier can be dropped into the same
// interface and compared on the identical set.
// ---------------------------------------------------------------------------

import { classifyFallacies } from "./graphEnrichers";

export interface FallacyCase {
  id: string;
  text: string;
  /** Fallacy labels present in the text; empty = clean, should produce no flags. */
  expected: string[];
}

/**
 * The labelled mini-corpus the detector is scored against. Expected labels are
 * derived from the classifier's own documented rules, so the numbers are
 * checkable, not asserted into existence. `clean-3` is an honest known false
 * positive: a genuine "what about X?" request for evidence is not a dodge, but
 * the rule flags it — it stays in the set so the FPR is real.
 */
export const FALLACY_BENCHMARK_CASES: FallacyCase[] = [
  { id: "strawman-1", text: "So you're saying we should ban all cars.", expected: ["strawman"] },
  { id: "whatabout-1", text: "But what about the other side's record?", expected: ["whataboutism"] },
  { id: "adhom-1", text: "You are a shill for the industry.", expected: ["ad_hominem"] },
  { id: "slope-1", text: "This inevitably leads to total government control.", expected: ["slippery_slope"] },
  { id: "emotion-1", text: "This policy is horrifying.", expected: ["appeal_to_emotion"] },
  { id: "dilemma-1", text: "You must choose between safety and freedom.", expected: ["false_dilemma"] },
  { id: "hasty-1", text: "All students are people who never study.", expected: ["hasty_generalization"] },
  { id: "authority-1", text: "According to a famous expert, vaccines are dangerous.", expected: ["appeal_to_authority"] },
  { id: "begging-1", text: "That argument assumes what it needs to prove.", expected: ["begging_the_question"] },
  { id: "equiv-1", text: "By free I mean no cost and also free in the moral sense.", expected: ["equivocation"] },
  { id: "multi-1", text: "So you're saying we should ban cars, and what about the jobs?", expected: ["strawman", "whataboutism"] },
  { id: "clean-1", text: "Lazard data shows solar at $24/MWh; NREL confirms storage covers the gap.", expected: [] },
  { id: "clean-2", text: "The OECD report says congestion costs exceed fare revenue, which Pew polling supports.", expected: [] },
  { id: "clean-3", text: "What about the evidence I already cited in round two?", expected: [] },
];

export type FallacyPredictor = (text: string) => string[];

/** The app's own decision rule: labels whose score clears the topFallacy threshold. */
export const defaultPredictor: FallacyPredictor = (text) =>
  classifyFallacies(text)
    .filter((hit) => hit.score >= 0.6)
    .map((hit) => hit.fallacy);

export interface LabelMetrics {
  label: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number; // tp / (tp + fp), 0 when no predictions
  recall: number; // tp / (tp + fn), 0 when no ground truth
  f1: number; // harmonic mean, 0 when either is 0
}

export interface FallacyBenchmarkReport {
  cases: number;
  perLabel: LabelMetrics[];
  macroF1: number;
  /** Fraction of cases where predicted labels exactly match expected labels. */
  accuracy: number;
  /** False positives on clean (expected-empty) cases. */
  falsePositiveRate: number;
}

function f1(precision: number, recall: number): number {
  if (precision === 0 || recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** All labels the classifier can emit, so metrics cover the whole taxonomy. */
export const ALL_FALLACY_LABELS = [
  "ad_hominem",
  "strawman",
  "false_dilemma",
  "slippery_slope",
  "appeal_to_emotion",
  "hasty_generalization",
  "appeal_to_authority",
  "whataboutism",
  "begging_the_question",
  "equivocation",
] as const;

export function evaluateFallacyDetection(cases: FallacyCase[], predict: FallacyPredictor = defaultPredictor): FallacyBenchmarkReport {
  const predictions = cases.map((c) => predict(c.text));
  const counts = new Map<string, { tp: number; fp: number; fn: number }>(ALL_FALLACY_LABELS.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));

  let exactMatches = 0;
  let cleanFalsePositives = 0;
  let cleanCases = 0;

  for (let i = 0; i < cases.length; i++) {
    const expected = cases[i].expected;
    const predicted = predictions[i];
    if (predicted.join(",") === [...expected].sort().join(",")) exactMatches++;
    if (expected.length === 0) {
      cleanCases++;
      if (predicted.length > 0) cleanFalsePositives++;
    }
    for (const label of ALL_FALLACY_LABELS) {
      const row = counts.get(label)!;
      if (expected.includes(label) && predicted.includes(label)) row.tp++;
      else if (!expected.includes(label) && predicted.includes(label)) row.fp++;
      else if (expected.includes(label) && !predicted.includes(label)) row.fn++;
    }
  }

  const perLabel: LabelMetrics[] = [...counts.entries()].map(([label, row]) => {
    const precision = row.tp + row.fp === 0 ? 0 : row.tp / (row.tp + row.fp);
    const recall = row.tp + row.fn === 0 ? 0 : row.tp / (row.tp + row.fn);
    return { label, ...row, precision, recall, f1: f1(precision, recall) };
  });

  const scored = perLabel.filter((m) => m.tp + m.fp + m.fn > 0);
  const macroF1 = scored.length === 0 ? 0 : scored.reduce((a, m) => a + m.f1, 0) / scored.length;

  return {
    cases: cases.length,
    perLabel,
    macroF1,
    accuracy: cases.length === 0 ? 0 : exactMatches / cases.length,
    falsePositiveRate: cleanCases === 0 ? 0 : cleanFalsePositives / cleanCases,
  };
}
