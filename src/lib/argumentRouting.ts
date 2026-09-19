// classifier.dev structural-routing client and policy.
//
// This module classifies rhetorical function only. It must never be used to
// decide which political, factual, or controversial viewpoint is correct.
// The output is a routing hint; deterministic downstream evaluation and the
// existing ensemble remain authoritative.

import { classifyAiError, recordAiCall } from "./aiTelemetry";
import {
  ARGUMENT_ROLE_DESCRIPTIONS,
  ARGUMENT_ROLE_LABELS,
  ARGUMENT_TAXONOMY_VERSION,
  type ArgumentClassification,
  type ArgumentOwner,
  type ArgumentRole,
  type ArgumentRoute,
  type ArgumentRoleCounts,
  type ArgumentRoutingSummary,
  type ClassifiedArgument,
  type SubmittedArgument,
  countArgumentRoles,
  emptyArgumentRoleCounts,
  normaliseArgumentRole,
} from "./argumentTaxonomy";

export const CLASSIFIER_DEV_ENDPOINT = "https://classifier.dev/v1/classify";
export const CLASSIFIER_DEV_MAX_INPUTS = 1_000;
export const CLASSIFIER_DEV_MAX_LABELS = 100;

/**
 * classifier.dev returns every multi-label score at or above 0.7. We keep
 * that service threshold, but require a stronger calibrated top answer before
 * taking a judge-avoidance path.
 */
export const CLASSIFIER_CONFIDENCE_POLICY = Object.freeze({
  multiLabelScoreMin: 0.7,
  primaryConfidenceMin: 0.78,
  singleLabelMarginMin: 0.08,
  // classifier.dev's current multi-label endpoint caps returned tags at two.
  // Two roles cover the common mixed moves while keeping the request within
  // the documented service contract; unknown/other remains explicit.
  maxLabels: 2,
  timeoutMs: 2_000,
});

export interface ClassifierDevOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tier?: "fast" | "smart";
  /** Optional motion context used only to identify off-topic moves. */
  topicTitle?: string;
  topicPrompt?: string;
  /** Test/degraded-mode switch; fallback never takes a judge-avoidance path. */
  disableRemote?: boolean;
}

export interface ArgumentClassificationBatch {
  classifications: ArgumentClassification[];
  batchCount: number;
  remoteBatches: number;
  fallbackCount: number;
  model?: string;
  remoteUsed: boolean;
}

export interface ArgumentRoutingPlan {
  taxonomyVersion: typeof ARGUMENT_TAXONOMY_VERSION;
  arguments: SubmittedArgument[];
  classifiedArguments: ClassifiedArgument[];
  classifications: ArgumentClassification[];
  route: ArgumentRoute;
  specializedPath: ArgumentRoute;
  batchCount: number;
  classifierSource: ArgumentRoutingSummary["classifierSource"];
  roleCounts: ArgumentRoleCounts;
  roleCountsByOwner: Record<ArgumentOwner, ArgumentRoleCounts>;
  highConfidenceCount: number;
  ambiguousCount: number;
  unknownCount: number;
  fallbackCount: number;
  mixedRoleCount: number;
  requiresExpensiveJudge: boolean;
  reason: string;
  model?: string;
}

interface RawClassifierResult {
  label?: unknown;
  labels?: unknown;
  confidence?: unknown;
  scores?: unknown;
  escalated?: unknown;
}

interface RawClassifierResponse {
  results?: unknown;
  model?: unknown;
  modelsUsed?: unknown;
  usage?: { escalated?: unknown };
}

class ClassifierDevError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number | null, message: string) {
    super(message);
    this.name = "ClassifierDevError";
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : null;
}

function roleScores(value: unknown): Partial<Record<ArgumentRole, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<ArgumentRole, number>> = {};
  for (const [rawLabel, rawScore] of Object.entries(value as Record<string, unknown>)) {
    const score = finiteNumber(rawScore);
    if (score === null) continue;
    const label = normaliseArgumentRole(rawLabel);
    out[label] = Math.max(out[label] ?? 0, score);
  }
  return out;
}

function labelsFromRaw(raw: RawClassifierResult, scores: Partial<Record<ArgumentRole, number>>): ArgumentRole[] {
  const listed = [
    ...(Array.isArray(raw.labels) ? raw.labels : []),
    ...(typeof raw.label === "string" ? [raw.label] : []),
  ].map(normaliseArgumentRole);
  for (const [label, score] of Object.entries(scores) as Array<[ArgumentRole, number]>) {
    if (score >= CLASSIFIER_CONFIDENCE_POLICY.multiLabelScoreMin) listed.push(label);
  }
  const labels = [...new Set(listed)].slice(0, CLASSIFIER_CONFIDENCE_POLICY.maxLabels);
  return labels.length ? labels : ["other"];
}

function fallbackClassification(text: string, index: number, errorCode?: string, disabled = false): ArgumentClassification {
  const labels: ArgumentRole[] = [];
  if (/[?？]\s*$/.test(text.trim()) || /^(?:who|what|why|how|when|where|can|could|should|does|is|are)\b/i.test(text.trim())) {
    labels.push("question");
  }
  if (/\b(?:according to|study|studies|data|report|survey|research|analysis|\d{2,}(?:\.\d+)?%|https?:\/\/)/i.test(text)) labels.push("evidence");
  if (/\b(?:but|however|although|yet|that ignores|you argue|you say|in response|instead)\b/i.test(text)) labels.push("rebuttal");
  if (/\b(?:admittedly|i agree|fair point|concede|even if)\b/i.test(text)) labels.push("concession");
  if (/\b(?:because|therefore|thus|so|means|leads? to|results? in)\b/i.test(text)) labels.push("reasoning");
  if (/\b(?:may|might|could|depends|unless|in some cases|generally)\b/i.test(text)) labels.push("qualification");
  const unique = [...new Set(labels)];
  if (!unique.length) unique.push("other");
  const primaryRole = unique[0] ?? "other";
  const source = disabled ? "disabled" : "fallback";
  return {
    index,
    text,
    labels: unique,
    scores: {},
    primaryRole,
    confidence: unique[0] === "other" ? 0 : 0.55,
    status: "fallback",
    source,
    errorCode: errorCode ?? (disabled ? "remote_disabled" : "classifier_unavailable"),
  };
}

function classificationFromRaw(
  text: string,
  index: number,
  raw: RawClassifierResult,
  model?: string,
  escalated?: boolean,
): ArgumentClassification {
  const scores = roleScores(raw.scores);
  const labels = labelsFromRaw(raw, scores);
  const ranked = [...new Set([...labels, ...Object.keys(scores).map(normaliseArgumentRole)])]
    .filter((label) => label !== "other")
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const listedPrimary = typeof raw.label === "string" ? normaliseArgumentRole(raw.label) : "other";
  const primaryRole = listedPrimary !== "other" ? listedPrimary : ranked[0] ?? "other";
  const rawConfidence = finiteNumber(raw.confidence);
  const confidence = rawConfidence ?? scores[primaryRole] ?? 0;
  const runnerUp = ranked.find((label) => label !== primaryRole);
  const margin = confidence - (runnerUp ? scores[runnerUp] ?? 0 : 0);
  const multiRole = labels.filter((label) => label !== "other").length > 1;
  const hasUnknown = (labels as ArgumentRole[]).some((label) => label === "other") || (primaryRole as ArgumentRole) === "other";
  const highConfidence = !hasUnknown && confidence >= CLASSIFIER_CONFIDENCE_POLICY.primaryConfidenceMin && (multiRole || !runnerUp || margin >= CLASSIFIER_CONFIDENCE_POLICY.singleLabelMarginMin);
  return {
    index,
    text,
    labels: labels.length ? labels : ["other"],
    scores,
    primaryRole,
    confidence,
    status: (primaryRole as ArgumentRole) === "other" ? "unknown" : highConfidence ? "high_confidence" : "ambiguous",
    source: "classifier.dev",
    model,
    escalated: escalated || Boolean(raw.escalated),
  };
}

function classifierInstructions(options: ClassifierDevOptions): string {
  const descriptions = ARGUMENT_ROLE_LABELS.map((label) => `${label}: ${ARGUMENT_ROLE_DESCRIPTIONS[label]}`).join("; ");
  const topic = options.topicTitle || options.topicPrompt
    ? ` Motion context for the off-topic label only: ${[options.topicTitle, options.topicPrompt].filter(Boolean).join(" — ")}.`
    : "";
  return `Classify rhetorical structure under taxonomy ${ARGUMENT_TAXONOMY_VERSION}. Return every applicable role, not a winner. ${descriptions}.${topic} Ignore truth, factual correctness, ideology, political preference, controversy, persuasiveness, and which side should win. Use other when the move does not fit or is unclear.`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchClassifierBatch(inputs: string[], options: ClassifierDevOptions): Promise<{ response: RawClassifierResponse; model?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof fetchImpl !== "function") throw new ClassifierDevError("fetch_unavailable", null, "fetch is unavailable");
  const endpoint = options.endpoint ?? process.env.CLASSIFIER_DEV_ENDPOINT ?? CLASSIFIER_DEV_ENDPOINT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? CLASSIFIER_CONFIDENCE_POLICY.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "daily-debate/argument-router",
      },
      body: JSON.stringify({
        inputs,
        labels: [...ARGUMENT_ROLE_LABELS],
        tier: options.tier ?? "fast",
        instructions: classifierInstructions(options),
        multi: true,
        max_labels: CLASSIFIER_CONFIDENCE_POLICY.maxLabels,
      }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as RawClassifierResponse | null;
    if (!response.ok) {
      const code = typeof (body as { code?: unknown } | null)?.code === "string" ? String((body as { code: string }).code) : `http_${response.status}`;
      throw new ClassifierDevError(code, response.status, `classifier.dev returned ${response.status}`);
    }
    if (!body || !Array.isArray(body.results)) throw new ClassifierDevError("invalid_response", response.status, "classifier.dev returned no results");
    if (body.results.length !== inputs.length) throw new ClassifierDevError("result_length_mismatch", response.status, "classifier.dev result count did not match input count");
    const model = typeof body.model === "string" ? body.model : Array.isArray(body.modelsUsed) ? (body.modelsUsed.find((value): value is string => typeof value === "string") ?? "classifier.dev") : "classifier.dev";
    return { response: body, model };
  } catch (error) {
    if (error instanceof ClassifierDevError) throw error;
    const classified = classifyAiError(error, null);
    throw new ClassifierDevError(classified.code, classified.httpStatus, classified.sanitized ?? "classifier.dev request failed");
  } finally {
    clearTimeout(timeout);
  }
}

/** Classify a batch, chunking at classifier.dev's documented 1,000-input limit. */
export async function classifyArgumentBatchDetailed(
  inputs: string[],
  options: ClassifierDevOptions = {},
): Promise<ArgumentClassificationBatch> {
  if (!inputs.length) return { classifications: [], batchCount: 0, remoteBatches: 0, fallbackCount: 0, remoteUsed: false };
  const disabled = options.disableRemote === true || process.env.E2E_MOCK_AI === "1";
  if (disabled) {
    return {
      classifications: inputs.map((text, index) => fallbackClassification(text, index, "remote_disabled", true)),
      batchCount: Math.ceil(inputs.length / CLASSIFIER_DEV_MAX_INPUTS),
      remoteBatches: 0,
      fallbackCount: inputs.length,
      remoteUsed: false,
    };
  }

  const classifications: ArgumentClassification[] = [];
  const batches = chunk(inputs, CLASSIFIER_DEV_MAX_INPUTS);
  let remoteBatches = 0;
  let fallbackCount = 0;
  let model: string | undefined;
  for (const batch of batches) {
    const startedAt = Date.now();
    try {
      const result = await fetchClassifierBatch(batch.map((text) => text.slice(0, 32_000)), options);
      model = result.model ?? model;
      remoteBatches += 1;
      const usageEscalated = result.response.usage?.escalated;
      const escalated = typeof usageEscalated === "number" && usageEscalated > 0;
      const rows = result.response.results as unknown[];
      rows.forEach((row, index) => {
        classifications.push(classificationFromRaw(batch[index], classifications.length, (row ?? {}) as RawClassifierResult, result.model, escalated));
      });
      recordAiCall({
        at: new Date().toISOString(),
        operation: "classify_argument_structure",
        provider: "classifier",
        model: result.model ?? "classifier.dev",
        latencyMs: Date.now() - startedAt,
        outcome: "ok",
        inputCount: batch.length,
        batchCount: 1,
        taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
      });
    } catch (error) {
      const failure = error instanceof ClassifierDevError ? error : new ClassifierDevError("unknown", null, String(error));
      const classified = classifyAiError(failure.message, failure.httpStatus);
      const fallbackRows = batch.map((text, index) => fallbackClassification(text, classifications.length + index, failure.code));
      classifications.push(...fallbackRows);
      fallbackCount += batch.length;
      recordAiCall({
        at: new Date().toISOString(),
        operation: "classify_argument_structure",
        provider: "classifier",
        model: "classifier.dev",
        latencyMs: Date.now() - startedAt,
        outcome: "error",
        inputCount: batch.length,
        batchCount: 1,
        taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
        errorCategory: classified.category,
        errorCode: failure.code,
        httpStatus: classified.httpStatus,
        retryable: classified.retryable,
        error: classified.sanitized,
      });
    }
  }
  return { classifications, batchCount: batches.length, remoteBatches, fallbackCount, model, remoteUsed: remoteBatches > 0 };
}

export async function classifyArgumentBatch(inputs: string[], options: ClassifierDevOptions = {}): Promise<ArgumentClassification[]> {
  return (await classifyArgumentBatchDetailed(inputs, options)).classifications;
}

const SUBSTANTIVE_ROLES = new Set<ArgumentRole>(["claim", "evidence", "reasoning", "rebuttal", "counterexample", "concession", "qualification"]);

function ownerRoleCounts(args: SubmittedArgument[], classifications: ArgumentClassification[]): Record<ArgumentOwner, ArgumentRoleCounts> {
  const out: Record<ArgumentOwner, ArgumentRoleCounts> = { a: emptyArgumentRoleCounts(), b: emptyArgumentRoleCounts(), ai: emptyArgumentRoleCounts() };
  for (const [index, classification] of classifications.entries()) {
    const owner = args[index]?.owner;
    if (!owner) continue;
    const one = countArgumentRoles([classification]);
    for (const label of ARGUMENT_ROLE_LABELS) out[owner][label] += one[label];
  }
  return out;
}

function sourceFor(classifications: ArgumentClassification[]): ArgumentRoutingSummary["classifierSource"] {
  const sources = new Set(classifications.map((classification) => classification.source));
  if (sources.size === 0) return "disabled";
  if (sources.size === 1) return sources.has("classifier.dev") ? "classifier.dev" : sources.has("disabled") ? "disabled" : "fallback";
  return "mixed";
}

/** Apply the confidence policy. Low confidence, unknown, and fallback rows always keep the judge path open. */
export function routeClassifiedArguments(
  args: SubmittedArgument[],
  classifications: ArgumentClassification[],
  batchCount = 1,
): ArgumentRoutingPlan {
  const roleCounts = countArgumentRoles(classifications);
  const roleCountsByOwner = ownerRoleCounts(args, classifications);
  const highConfidenceCount = classifications.filter((classification) => classification.status === "high_confidence" && classification.source === "classifier.dev").length;
  const ambiguousCount = classifications.filter((classification) => classification.status === "ambiguous").length;
  const unknownCount = classifications.filter((classification) => classification.status === "unknown").length;
  const fallbackCount = classifications.filter((classification) => classification.status === "fallback" || classification.source !== "classifier.dev").length;
  const mixedRoleCount = classifications.filter((classification) => classification.labels.filter((label) => label !== "other").length > 1).length;
  const allHighConfidence = args.length > 0 && classifications.length === args.length && highConfidenceCount === args.length;
  const hasUnknown = classifications.some((classification) => classification.labels.includes("other") || classification.status === "unknown");
  const allNonSubstantive = classifications.length > 0 && classifications.every((classification) => !classification.labels.some((label) => SUBSTANTIVE_ROLES.has(label)));

  let route: ArgumentRoute = "ensemble";
  let reason = "Ambiguous or incomplete structural labels stay on the existing ensemble path.";
  if (allHighConfidence && !hasUnknown && allNonSubstantive && classifications.some((classification) => classification.labels.includes("question"))) {
    route = "response-generation";
    reason = "Question-only input is routed to response generation; it cannot decide a debate winner.";
  } else if (allHighConfidence && !hasUnknown && allNonSubstantive) {
    route = "lightweight";
    reason = "No substantive argument role was identified; lightweight handling avoids an expensive winner judge.";
  } else if (allHighConfidence && !hasUnknown) {
    if (classifications.some((classification) => classification.labels.includes("rebuttal") || classification.labels.includes("counterexample"))) {
      route = "rebuttal-compare";
      reason = "High-confidence rebuttal/counterexample moves can be compared with earlier arguments before judging.";
    } else if (classifications.some((classification) => classification.labels.includes("evidence"))) {
      route = "evidence-verification";
      reason = "High-confidence evidence moves take the evidence-verification path before any full judge.";
    } else {
      route = "deterministic";
      reason = "All submitted moves have high-confidence structural roles and can be checked deterministically first.";
    }
  }

  const classifiedArguments = args.map((argument, index) => ({
    ...argument,
    classification: classifications[index] ?? fallbackClassification(argument.text, index),
  }));
  return {
    taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
    arguments: args,
    classifiedArguments,
    classifications,
    route,
    specializedPath: route,
    batchCount,
    classifierSource: sourceFor(classifications),
    roleCounts,
    roleCountsByOwner,
    highConfidenceCount,
    ambiguousCount,
    unknownCount,
    fallbackCount,
    mixedRoleCount,
    requiresExpensiveJudge: route === "ensemble",
    reason,
    model: classifications.find((classification) => classification.model)?.model,
  };
}

const TRANSCRIPT_LINE_RE = /^\s*(?:\*\*)?\s*(Player\s+[AB]|Side\s+[AB])\b(?:\s*\(\s*round\s+(\d+)\s*\))?\s*:\s*(.*?)\s*$/i;

export function parseDebateTranscript(transcript: string): SubmittedArgument[] {
  const args: SubmittedArgument[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const match = line.match(TRANSCRIPT_LINE_RE);
    if (!match || !match[3]) continue;
    const owner = /[ab]$/i.test(match[1].replace(/\s+/g, "")) ? (match[1].replace(/\s+/g, "").toLowerCase().endsWith("a") ? "a" : "b") : "a";
    args.push({ id: `submitted-${args.length + 1}`, text: match[3], owner, round: Number(match[2] ?? Math.floor(args.length / 2) + 1) });
  }
  return args;
}

export async function classifyDebateTranscript(params: {
  transcript: string;
  topicTitle?: string;
  topicPrompt?: string;
  classifier?: ClassifierDevOptions;
}): Promise<ArgumentRoutingPlan> {
  const args = parseDebateTranscript(params.transcript);
  if (!args.length) return routeClassifiedArguments([], [], 0);
  const detail = await classifyArgumentBatchDetailed(args.map((argument) => argument.text), {
    ...params.classifier,
    topicTitle: params.topicTitle,
    topicPrompt: params.topicPrompt,
  });
  return routeClassifiedArguments(args, detail.classifications, detail.batchCount);
}

export function routingSummary(plan: ArgumentRoutingPlan, expensiveJudgeCallsAvoided = 0): ArgumentRoutingSummary {
  return {
    taxonomyVersion: ARGUMENT_TAXONOMY_VERSION,
    route: plan.route,
    specializedPath: plan.specializedPath,
    classifierSource: plan.classifierSource,
    argumentCount: plan.arguments.length,
    batchCount: plan.batchCount,
    roleCounts: plan.roleCounts,
    roleCountsByOwner: plan.roleCountsByOwner,
    highConfidenceCount: plan.highConfidenceCount,
    ambiguousCount: plan.ambiguousCount,
    unknownCount: plan.unknownCount,
    fallbackCount: plan.fallbackCount,
    mixedRoleCount: plan.mixedRoleCount,
    expensiveJudgeCallsAvoided,
    reason: plan.reason,
  };
}

/** Record route decisions without recording text, topic, or political content. */
export function recordRoutingTelemetry(
  summary: ArgumentRoutingSummary,
  model = "classifier.dev/router",
): void {
  recordAiCall({
    at: new Date().toISOString(),
    operation: "argument_routing",
    provider: "classifier",
    model,
    latencyMs: 0,
    outcome: "ok",
    eventType: "routing",
    inputCount: summary.argumentCount,
    batchCount: summary.batchCount,
    taxonomyVersion: summary.taxonomyVersion,
    routingDecision: summary.route,
    expensiveJudgeCallsAvoided: summary.expensiveJudgeCallsAvoided,
    classificationFallbacks: summary.fallbackCount,
    classificationAmbiguous: summary.ambiguousCount + summary.unknownCount,
  });
}
