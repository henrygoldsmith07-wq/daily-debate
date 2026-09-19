// Argument-evaluation engine — deterministic, offline detectors that sharpen
// what observableAssessment can see in a graph. Pure functions only: no model
// calls, no network, no DB. Every regex here is linear (no nested quantifiers)
// — see reliability.stress.test.ts for why.

import { emptyGraph, type ArgEdge, type ArgGraph, type ArgNode, type Owner } from "./argGraph";
import { inspectSubmittedEvidence, type SubmittedEvidenceInspection } from "./evidence";
import { isValidRebuttalTarget, STRONG_TARGET_KINDS } from "./opportunity";
import type { ArgumentRole, ClassifiedArgument, SubmittedArgument } from "./argumentTaxonomy";

// ---------------------------------------------------------------------------
// Lexicons (single alternations; linear scan)
// ---------------------------------------------------------------------------

const STRONG_CLAIM_RE = /\b(?:proves?|proven|guarantees?|ensures?|eliminates?|definitely|certainly|undoubtedly|always|never|impossible)\b/i;
const CAUSAL_RE = /\b(?:causes?|leads? to|results? in|drives?|will make)\b/i;
const HEDGE_RE = /\b(?:associat\w+|correlat\w+|suggests?|indicates?|may|might|could|linked to|tends? to|preliminary|on average|in some cases|estimate[ds]?|approximately|roughly)\b/i;

const FAKE_PRECISION_RE = /\b\d+\.\d{1,2}%|\$\d+(?:\.\d{1,2})?\s?(?:billion|million|trillion)\b/gi;
// Source cues must actually indicate attribution. Bare "per" is NOT a cue —
// "12.34% per household" would otherwise vouch for itself.
const SOURCE_CUE_RE = /\b(?:according to|study|studies|report(?:ed)?|survey|research|analysis|estimat\w+|source[ds]?|\(\d{4}\)|\b(?:19|20)\d{2}\))\b/i;

const CITATION_CUE_RE = /\b(?:according to|study|studies|research|report|survey|data shows?|\d{4}\)|\(\d{4})\b/i;
const STEELMAN_MARKER_RE = /\b(?:even if|granting|strongest version|best case|concede[sd]?|admittedly|to be fair|taking (?:that|this) seriously)\b/gi;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(clamp01(value) * 100) / 100;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// ---------------------------------------------------------------------------
// Causal overclaim detection
// ---------------------------------------------------------------------------

export interface CausalOverclaimResult {
  detected: boolean;
  severity: "none" | "moderate" | "high";
  reason: string;
}

/**
 * Flags claims that assert causation/certainty while their supporting
 * evidence is missing or merely associational ("X is linked to Y") — the
 * classic evidence-vs-claim strength mismatch.
 */
export function detectCausalOverclaim(claimText: string, evidenceTexts: string[]): CausalOverclaimResult {
  const text = claimText ?? "";
  const assertsStrong = STRONG_CLAIM_RE.test(text);
  const assertsCausal = CAUSAL_RE.test(text);
  if (!assertsStrong && !assertsCausal) {
    return { detected: false, severity: "none", reason: "" };
  }
  // A hedged claim has already done the epistemic work.
  if (HEDGE_RE.test(text)) {
    return { detected: false, severity: "none", reason: "" };
  }

  const evidenceJoined = evidenceTexts.join(" ");
  if (!evidenceTexts.length || !evidenceJoined.trim()) {
    return {
      detected: true,
      severity: "high",
      reason: assertKind(text) + " with no supporting evidence attached.",
    };
  }
  const evidenceHedged = HEDGE_RE.test(evidenceJoined);
  if (evidenceHedged && !CAUSAL_RE.test(evidenceJoined)) {
    return {
      detected: true,
      severity: "high",
      reason: assertKind(text) + " while the cited evidence only reports an association.",
    };
  }
  return {
    detected: true,
    severity: "moderate",
    reason: "Causal language stronger than the attached evidence warrants.",
  };
}

function assertKind(text: string): string {
  return CAUSAL_RE.test(text) ? "Causal claim" : "Certainty claim";
}

// ---------------------------------------------------------------------------
// Fake-precision detection
// ---------------------------------------------------------------------------

export interface FakePrecisionHit {
  match: string;
  sourced: boolean;
}

/** Decimal-exact stats ("exactly 73.42%") that no nearby source cue supports. */
export function detectFakePrecision(text: string): FakePrecisionHit[] {
  const hits: FakePrecisionHit[] = [];
  FAKE_PRECISION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FAKE_PRECISION_RE.exec(text)) !== null) {
    const start = Math.max(0, m.index - 60);
    const window = text.slice(start, Math.min(text.length, m.index + m[0].length + 60));
    hits.push({ match: m[0], sourced: SOURCE_CUE_RE.test(window) });
    if (hits.length >= 20) break; // pathological-input cap
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Structural routing checks
//
// classifier.dev supplies a cheap rhetorical-role hint. These checks are the
// downstream authority used to decide whether a specialist path is actually
// safe. They never score a political position or select a debate winner.
// ---------------------------------------------------------------------------

const DIRECT_REBUTTAL_RE = /\b(?:but|however|although|yet|that ignores|you argue|you say|in response|instead|on the other hand|even if)\b/i;
const IMPACT_CUE_RE = /\b(?:therefore|thus|so|means|leads? to|results? in|impact|benefit|cost|risk|harm|matters?)\b/i;

export interface RebuttalComparison {
  targetArgumentId: string | null;
  overlap: number;
  directCue: boolean;
  addressed: boolean;
  reason: string;
}

/** Compare a rebuttal/counterexample with earlier opposing text only. */
export function compareRebuttalAgainstEarlierArgument(
  argument: SubmittedArgument,
  earlier: SubmittedArgument[],
): RebuttalComparison {
  const current = substantiveTokens(argument.text);
  const candidates = earlier.filter((item) => item.owner !== argument.owner && item.round < argument.round);
  if (!current.size || !candidates.length) {
    return {
      targetArgumentId: null,
      overlap: 0,
      directCue: DIRECT_REBUTTAL_RE.test(argument.text),
      addressed: false,
      reason: "No earlier opposing argument is available to compare.",
    };
  }

  let best: { id: string; overlap: number } | null = null;
  for (const candidate of candidates) {
    const target = substantiveTokens(candidate.text);
    if (!target.size) continue;
    let shared = 0;
    for (const token of current) if (target.has(token)) shared += 1;
    const union = new Set([...current, ...target]).size || 1;
    const overlap = shared / union;
    if (!best || overlap > best.overlap) best = { id: candidate.id, overlap };
  }

  const directCue = DIRECT_REBUTTAL_RE.test(argument.text);
  const overlap = best?.overlap ?? 0;
  const addressed = !!best && (directCue || overlap >= 0.12);
  return {
    targetArgumentId: best?.id ?? null,
    overlap: round2(overlap),
    directCue,
    addressed,
    reason: addressed
      ? `Compared with ${best?.id}; shared substantive vocabulary ${Math.round(overlap * 100)}%.`
      : best
        ? `Closest earlier opposing argument was ${best.id}, but the response did not clearly engage it.`
        : "No earlier opposing argument had comparable substantive vocabulary.",
  };
}

export interface SpecialisedArgumentChecks {
  evidence: SubmittedEvidenceInspection | null;
  rebuttal: RebuttalComparison | null;
  question: boolean;
}

export function specialisedArgumentChecks(
  argument: SubmittedArgument,
  roles: ReadonlyArray<ArgumentRole>,
  earlier: SubmittedArgument[],
): SpecialisedArgumentChecks {
  const evidence = roles.includes("evidence") ? inspectSubmittedEvidence(argument.text) : null;
  const rebuttal = roles.includes("rebuttal") || roles.includes("counterexample")
    ? compareRebuttalAgainstEarlierArgument(argument, earlier)
    : null;
  return { evidence, rebuttal, question: roles.includes("question") };
}

// American spelling is the public name; keep the British spelling used by
// the original comments as a compatibility alias for tests/callers.
export const specializedArgumentChecks = specialisedArgumentChecks;

function hasRole(roles: ReadonlyArray<ArgumentRole>, role: ArgumentRole): boolean {
  return roles.includes(role);
}

function deterministicEvidenceStats(nodes: ArgNode[], edges: ArgEdge[]): ArgGraph["evidenceStats"] {
  const byOwner: Record<Owner, number> = { a: 0, b: 0, ai: 0 };
  const byStrength: ArgGraph["evidenceStats"]["byStrength"] = { anecdotal: 0, general: 0, cited: 0, strong: 0 };
  for (const node of nodes) {
    if (node.kind !== "evidence") continue;
    byOwner[node.owner] += 1;
    byStrength[node.evidenceStrength ?? "general"] += 1;
  }
  const supported = new Set<string>();
  for (const edge of edges) if (edge.relation === "supports") {
    supported.add(edge.from);
    supported.add(edge.to);
  }
  const unsupportedClaimIds = nodes
    .filter((node) => (node.kind === "claim" || node.kind === "counterclaim") && !supported.has(node.id))
    .map((node) => node.id);
  return {
    total: nodes.filter((node) => node.kind === "evidence").length,
    byOwner,
    byStrength,
    unsupportedClaimIds,
  };
}

/**
 * Build a conservative graph from high-confidence structural labels. This is
 * only a judge-avoidance candidate: `assessArgumentGraph` remains the score
 * and winner authority, and an insufficient result must fall through to the
 * existing ensemble.
 */
export function buildDeterministicArgumentGraph(args: ClassifiedArgument[]): ArgGraph {
  const graph = emptyGraph();
  const previous: SubmittedArgument[] = [];
  const argumentNodeIds = new Map<string, string>();

  for (const item of args) {
    const roles = item.classification.labels;
    const checks = specialisedArgumentChecks(item, roles, previous);
    const hasSubstantive = roles.some((role) => ["claim", "reasoning", "counterexample", "concession", "qualification"].includes(role));
    const ownPriorClaim = [...graph.nodes].reverse().find(
      (node) => node.owner === item.owner && (node.kind === "claim" || node.kind === "counterclaim") && node.round < item.round,
    );
    const comparisonTargetNode = checks.rebuttal?.targetArgumentId
      ? graph.nodes.find((node) => node.id === argumentNodeIds.get(checks.rebuttal!.targetArgumentId!))
      : undefined;

    let claimNode: ArgNode | undefined;
    if (hasSubstantive) {
      const kind = hasRole(roles, "counterexample") ? "counterclaim" : "claim";
      claimNode = { id: `${item.id}-claim`, kind, owner: item.owner, text: item.text.slice(0, 240), round: item.round };
      graph.nodes.push(claimNode);
      argumentNodeIds.set(item.id, claimNode.id);
    }

    if (hasRole(roles, "evidence")) {
      const inspection = checks.evidence ?? inspectSubmittedEvidence(item.text);
      const evidenceNode: ArgNode = {
        id: `${item.id}-evidence`,
        kind: "evidence",
        owner: item.owner,
        text: item.text.slice(0, 240),
        round: item.round,
        evidenceStrength: inspection.status === "verifiable" ? "cited" : "general",
        citations: inspection.sources
          .filter((source) => !validateEvidenceSource(source).length)
          .map((source) => ({ sourceName: source.sourceName ?? source.url, homepage: source.url })),
      };
      graph.nodes.push(evidenceNode);
      const supportTarget = claimNode ?? ownPriorClaim;
      if (supportTarget) graph.edges.push({ from: evidenceNode.id, to: supportTarget.id, relation: "supports" });
    }

    if (hasRole(roles, "rebuttal")) {
      const rebuttalNode: ArgNode = {
        id: `${item.id}-rebuttal`,
        kind: "rebuttal",
        owner: item.owner,
        text: item.text.slice(0, 240),
        round: item.round,
        targets: comparisonTargetNode ? [comparisonTargetNode.id] : [],
      };
      graph.nodes.push(rebuttalNode);
      if (comparisonTargetNode) graph.edges.push({ from: rebuttalNode.id, to: comparisonTargetNode.id, relation: "rebuts" });
    } else if (hasRole(roles, "counterexample") && comparisonTargetNode) {
      graph.edges.push({ from: claimNode?.id ?? item.id, to: comparisonTargetNode.id, relation: "rebuts" });
    }

    if (hasRole(roles, "concession") && comparisonTargetNode) {
      graph.concessions.push({ nodeId: comparisonTargetNode.id, by: item.owner, note: "Structural classifier marked an explicit concession." });
    }

    if (claimNode && hasRole(roles, "reasoning") && IMPACT_CUE_RE.test(item.text)) {
      const impact: ArgNode = {
        id: `${item.id}-impact`,
        kind: "impact",
        owner: item.owner,
        text: item.text.slice(0, 240),
        round: item.round,
      };
      graph.nodes.push(impact);
      graph.edges.push({ from: claimNode.id, to: impact.id, relation: "impacts" });
    }

    previous.push(item);
  }

  graph.evidenceStats = deterministicEvidenceStats(graph.nodes, graph.edges);
  return graph;
}

function validateEvidenceSource(source: { url: string; sourceName?: string }): string[] {
  return source.url.startsWith("https://") && source.sourceName?.trim() ? [] : ["source is not a valid https citation"];
}

// ---------------------------------------------------------------------------
// Rebuttal-quality scoring (beyond coverage: backing + engagement + substance)
//
// "coverage" here is the TARGETING DISCIPLINE of the side's own rebuttals
// (share of rebuttals aimed at a valid opponent target) — a different concept
// from opportunity coverage (rebuttalCoverageFor in opportunity.ts), which
// measures answered opportunities. The skill ledger exposes this one as
// "rebuttalTargeting" so the two are never conflated.
// ---------------------------------------------------------------------------

export interface RebuttalQualityScore {
  score: number; // 0..1
  coverage: number;
  evidenceBacked: number;
  engagesStrongMaterial: number;
  specificity: number;
}

export function scoreRebuttalQuality(graph: ArgGraph, owner: ArgNode["owner"]): RebuttalQualityScore | null {
  const rebuttals = graph.nodes.filter((n) => n.kind === "rebuttal" && n.owner === owner);
  if (!rebuttals.length) return null;

  const evidenceIdsByOwner = new Set(
    graph.nodes.filter((n) => n.kind === "evidence" && n.owner === owner).map((n) => n.id),
  );

  let covered = 0;
  let backed = 0;
  let engagesStrong = 0;
  let specificitySum = 0;

  for (const r of rebuttals) {
    const targets = r.targets ?? [];
    // Targeting credit uses THE canonical target rule (shared with coverage,
    // rewards and the ledger): the target must exist, belong to the opponent,
    // be a rebuttable kind, and predate this response. Self-targets, evidence
    // nodes, future arguments and dangling ids score nothing here.
    const hasTargets = targets.some((t) => isValidRebuttalTarget(graph, t, owner, r.round));
    if (hasTargets) covered += 1;

    const citesSomething = (r.citations?.length ?? 0) > 0 || CITATION_CUE_RE.test(r.text);
    const supportedByOwnEvidence = graph.edges.some(
      (e) => e.to === r.id && evidenceIdsByOwner.has(e.from),
    );
    if (citesSomething || supportedByOwnEvidence) backed += 1;

    // Engaging strong material: same canonical validity rule, restricted to
    // the opponent's strongest answerable move (counterclaim). Impact is a
    // weighing move handled by impact handling, so it cannot earn rebuttal
    // target credit here.
    const targetNodes = targets
      .map((t) => graph.nodes.find((n) => n.id === t))
      .filter((n): n is ArgNode =>
        !!n && isValidRebuttalTarget(graph, n.id, owner, r.round) && STRONG_TARGET_KINDS.has(n.kind),
      );
    if (targetNodes.length) engagesStrong += 1;

    const w = words(r.text).length;
    specificitySum += w >= 6 && w <= 60 ? 1 : w < 6 ? w / 6 : 60 / w;
  }

  const n = rebuttals.length;
  const coverage = covered / n;
  const evidenceBacked = backed / n;
  const engagesStrongMaterial = engagesStrong / n;
  const specificity = specificitySum / n;
  return {
    score: round2(coverage * 0.4 + evidenceBacked * 0.25 + engagesStrongMaterial * 0.2 + specificity * 0.15),
    coverage: round2(coverage),
    evidenceBacked: round2(evidenceBacked),
    engagesStrongMaterial: round2(engagesStrongMaterial),
    specificity: round2(specificity),
  };
}

// ---------------------------------------------------------------------------
// Steelman-quality scoring (fairness to the opposing case)
// ---------------------------------------------------------------------------

export interface SteelmanQualityScore {
  score: number; // 0..1
  markers: number;
  concessions: number;
  strawmanPenalty: number;
}

const STEELMAN_FALLACIES = new Set(["strawman", "ad_hominem"]);

function substantiveTokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 3),
  );
}

export function scoreSteelmanQuality(graph: ArgGraph, owner: ArgNode["owner"]): SteelmanQualityScore {
  const opponentVocab = new Set<string>();
  for (const node of graph.nodes) {
    if (node.owner === owner || !node.text) continue;
    for (const token of substantiveTokens(node.text)) opponentVocab.add(token);
  }

  let markers = 0;
  for (const node of graph.nodes) {
    if (node.owner !== owner || !node.text) continue;
    STEELMAN_MARKER_RE.lastIndex = 0;
    if (!STEELMAN_MARKER_RE.test(node.text)) continue;
    // A marker only counts when it engages the opponent's actual position:
    // shared substantive vocabulary with opponent moves, or a rebuttal with
    // a valid opponent target. Bare "to be fair / admittedly" with no
    // engagement is decoration, not steelmanning.
    const shared = [...substantiveTokens(node.text)].filter((token) => opponentVocab.has(token)).length;
    const validTarget =
      node.kind === "rebuttal" &&
      (node.targets ?? []).some((target) => isValidRebuttalTarget(graph, target, owner, node.round));
    if (shared >= 2 || validTarget) markers += 1;
    if (markers >= 3) break;
  }

  const concessions = graph.concessions.filter((c) => c.by === owner).length;

  const ownNodeIds = new Set(graph.nodes.filter((n) => n.owner === owner).map((n) => n.id));
  const strawmanPenalty = graph.fallacies.filter(
    (f) => ownNodeIds.has(f.nodeId) && f.fallacy && STEELMAN_FALLACIES.has(f.fallacy),
  ).length;

  return {
    score: round2(clamp01(markers * 0.34 + Math.min(concessions, 2) * 0.33 - Math.min(strawmanPenalty, 2) * 0.5)),
    markers,
    concessions,
    strawmanPenalty,
  };
}

// ---------------------------------------------------------------------------
// Aggregate per-side report
// ---------------------------------------------------------------------------

export type EngineFindingKind = "causal_overclaim" | "fake_precision";

export interface EngineFinding {
  nodeId: string;
  kind: EngineFindingKind;
  severity: "moderate" | "high";
  detail: string;
}

export interface SideEngineReport {
  findings: EngineFinding[];
  unsourcedPrecisionHits: number;
  causalOverclaims: number;
  rebuttalQuality: RebuttalQualityScore | null;
  steelmanQuality: SteelmanQualityScore;
}

export interface EngineReport {
  a: SideEngineReport;
  b: SideEngineReport;
}

const CLAIM_KINDS = new Set(["claim", "counterclaim", "impact"]);

function sideReport(graph: ArgGraph, owner: ArgNode["owner"], opponentOwner?: ArgNode["owner"]): SideEngineReport {
  const findings: EngineFinding[] = [];
  const evidenceTexts = graph.nodes
    .filter((n) => n.kind === "evidence" && n.owner === owner)
    .flatMap((n) => [n.text, ...(n.citations ?? []).map((c) => c.excerpt ?? "")])
    .filter(Boolean);

  let causalOverclaims = 0;
  let unsourcedPrecisionHits = 0;

  for (const node of graph.nodes) {
    if (node.owner !== owner || !CLAIM_KINDS.has(node.kind)) continue;

    const overclaim = detectCausalOverclaim(node.text, evidenceTexts);
    if (overclaim.detected && overclaim.severity !== "none") {
      causalOverclaims += 1;
      findings.push({ nodeId: node.id, kind: "causal_overclaim", severity: overclaim.severity, detail: overclaim.reason });
    }

    for (const hit of detectFakePrecision(node.text)) {
      if (hit.sourced) continue;
      unsourcedPrecisionHits += 1;
      findings.push({
        nodeId: node.id,
        kind: "fake_precision",
        severity: "moderate",
        detail: `Unsourced decimal-exact figure "${hit.match}".`,
      });
    }
  }

  // Steelman credit includes engaging the opponent's strongest material.
  void opponentOwner;
  return {
    findings,
    unsourcedPrecisionHits,
    causalOverclaims,
    rebuttalQuality: scoreRebuttalQuality(graph, owner),
    steelmanQuality: scoreSteelmanQuality(graph, owner),
  };
}

export function engineReport(graph: ArgGraph, owners: { a: ArgNode["owner"]; b: ArgNode["owner"] }): EngineReport {
  return { a: sideReport(graph, owners.a), b: sideReport(graph, owners.b) };
}
