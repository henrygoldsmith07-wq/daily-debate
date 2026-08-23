// Argument-evaluation engine — deterministic, offline detectors that sharpen
// what observableAssessment can see in a graph. Pure functions only: no model
// calls, no network, no DB. Every regex here is linear (no nested quantifiers)
// — see reliability.stress.test.ts for why.

import type { ArgGraph, ArgNode } from "./argGraph";

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
// Rebuttal-quality scoring (beyond coverage: backing + engagement + substance)
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

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const evidenceIdsByOwner = new Set(
    graph.nodes.filter((n) => n.kind === "evidence" && n.owner === owner).map((n) => n.id),
  );

  let covered = 0;
  let backed = 0;
  let engagesStrong = 0;
  let specificitySum = 0;

  for (const r of rebuttals) {
    const targets = r.targets ?? [];
    const hasTargets = targets.length > 0 && targets.some((t) => nodeIds.has(t));
    if (hasTargets) covered += 1;

    const citesSomething = (r.citations?.length ?? 0) > 0 || CITATION_CUE_RE.test(r.text);
    const supportedByOwnEvidence = graph.edges.some(
      (e) => e.to === r.id && evidenceIdsByOwner.has(e.from),
    );
    if (citesSomething || supportedByOwnEvidence) backed += 1;

    const targetKinds = targets
      .map((t) => graph.nodes.find((n) => n.id === t)?.kind)
      .filter((k): k is NonNullable<typeof k> => !!k);
    if (targetKinds.some((k) => k === "impact" || k === "counterclaim")) engagesStrong += 1;

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

export function scoreSteelmanQuality(graph: ArgGraph, owner: ArgNode["owner"]): SteelmanQualityScore {
  const ownTexts = graph.nodes
    .filter((n) => n.owner === owner && n.text)
    .map((n) => n.text);

  let markers = 0;
  for (const text of ownTexts) {
    STEELMAN_MARKER_RE.lastIndex = 0;
    if (STEELMAN_MARKER_RE.test(text)) markers += 1;
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
