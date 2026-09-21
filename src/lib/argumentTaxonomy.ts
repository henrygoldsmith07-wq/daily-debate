// Versioned structural taxonomy for submitted debate arguments.
//
// These labels describe rhetorical function only. They intentionally say
// nothing about whether a political, factual, or controversial position is
// true, preferable, or likely to win a debate.

export const ARGUMENT_TAXONOMY_VERSION = "argument-roles-v1" as const;

export const ARGUMENT_ROLE_LABELS = [
  "claim",
  "evidence",
  "reasoning",
  "rebuttal",
  "counterexample",
  "concession",
  "qualification",
  "question",
  "off-topic",
  "other",
] as const;

export type ArgumentRole = (typeof ARGUMENT_ROLE_LABELS)[number];
export type ArgumentOwner = "a" | "b" | "ai";

export type ClassificationStatus = "high_confidence" | "ambiguous" | "unknown" | "fallback";
export type ClassificationSource = "classifier.dev" | "fallback" | "disabled";

export type ArgumentRoute =
  | "evidence-verification"
  | "rebuttal-compare"
  | "response-generation"
  | "lightweight"
  | "deterministic"
  | "ensemble";

export interface SubmittedArgument {
  id: string;
  text: string;
  owner: ArgumentOwner;
  round: number;
}

export interface ArgumentClassification {
  /** Index in the submitted batch; stable even when the input text repeats. */
  index: number;
  text: string;
  labels: ArgumentRole[];
  scores: Partial<Record<ArgumentRole, number>>;
  primaryRole: ArgumentRole;
  /** Calibrated classifier confidence, or 0 for unknown/fallback results. */
  confidence: number;
  status: ClassificationStatus;
  source: ClassificationSource;
  model?: string;
  /** Serving tier echo from classifier.dev ("fast" | "smart"), when reported. */
  tier?: string;
  escalated?: boolean;
  errorCode?: string;
}

export interface ClassifiedArgument extends SubmittedArgument {
  classification: ArgumentClassification;
}

export type ArgumentRoleCounts = Record<ArgumentRole, number>;

export interface ArgumentRoutingSummary {
  taxonomyVersion: typeof ARGUMENT_TAXONOMY_VERSION;
  route: ArgumentRoute;
  specializedPath: ArgumentRoute;
  classifierSource: "classifier.dev" | "fallback" | "mixed" | "disabled";
  argumentCount: number;
  batchCount: number;
  roleCounts: ArgumentRoleCounts;
  roleCountsByOwner: Record<ArgumentOwner, ArgumentRoleCounts>;
  highConfidenceCount: number;
  ambiguousCount: number;
  unknownCount: number;
  fallbackCount: number;
  mixedRoleCount: number;
  /** Number of expensive judge legs avoided by this routing decision. */
  expensiveJudgeCallsAvoided: number;
  reason: string;
  /**
   * Shadow-sampling outcome: true when the debate was selected for remote
   * classification, false when it took the local fallback path instead.
   * Absent for plans where sampling did not apply (legacy rows included).
   */
  shadowSampled?: boolean;
}

export const ARGUMENT_ROLE_DESCRIPTIONS: Record<ArgumentRole, string> = {
  claim: "A position or proposition the speaker advances.",
  evidence: "A source, observation, example, statistic, or data point offered as support.",
  reasoning: "A because/therefore bridge explaining why a premise supports a conclusion.",
  rebuttal: "A response that directly addresses an earlier opposing argument.",
  counterexample: "An exception or concrete case offered against an earlier generalisation.",
  concession: "An explicit admission that part of an opposing point is valid.",
  qualification: "A condition, boundary, uncertainty, or limitation on a claim.",
  question: "A request for information or a challenge phrased as a question.",
  "off-topic": "A move unrelated to the supplied debate motion or prior exchange.",
  other: "A move whose structural role is unknown or does not fit the taxonomy.",
};

export function emptyArgumentRoleCounts(): ArgumentRoleCounts {
  return Object.fromEntries(ARGUMENT_ROLE_LABELS.map((label) => [label, 0])) as ArgumentRoleCounts;
}

export function normaliseArgumentRole(value: unknown): ArgumentRole {
  if (typeof value !== "string") return "other";
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "counter-example") return "counterexample";
  if (normalized === "off topic" || normalized === "irrelevant") return "off-topic";
  if (normalized === "unknown" || normalized === "none" || normalized === "none-of-the-above") return "other";
  return (ARGUMENT_ROLE_LABELS as readonly string[]).includes(normalized)
    ? (normalized as ArgumentRole)
    : "other";
}

export function countArgumentRoles(
  classifications: ReadonlyArray<Pick<ArgumentClassification, "labels" | "status">>,
): ArgumentRoleCounts {
  const counts = emptyArgumentRoleCounts();
  for (const classification of classifications) {
    const labels = [...new Set(classification.labels.map(normaliseArgumentRole))].filter((label) => label !== "other");
    if (!labels.length || classification.status === "unknown") {
      counts.other += 1;
      continue;
    }
    for (const label of labels) counts[label] += 1;
    if (classification.labels.includes("other")) counts.other += 1;
  }
  return counts;
}

