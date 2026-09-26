import type { ArgGraph, ArgNode, Fallacy } from "./argGraph";
import type { ArgumentRole } from "./argumentTaxonomy";
import { unansweredOpportunitiesBy } from "./opportunity";

export type RepairKind = "evidence" | "rebuttal" | "logic" | "impact" | "structure" | "clarity";

export interface RepairTarget {
  kind: RepairKind;
  label: string;
  title: string;
  prompt: string;
  sourceText: string;
  sourceNodeId?: string;
}

export interface RepairScore {
  score: number;
  signals: string[];
  state: RepairState;
}

export type RepairState = "needs_another_pass" | "partially_repaired" | "repair_demonstrated";

export function repairStateFromScore(score: number): RepairState {
  if (score >= 60) return "repair_demonstrated";
  if (score >= 30) return "partially_repaired";
  return "needs_another_pass";
}

export type StructuralRepairPath =
  | "evidence-verification"
  | "rebuttal-compare"
  | "reasoning-bridge"
  | "concession-qualification"
  | "question-clarification"
  | "off-topic-lightweight"
  | "general-repair";

/** Map a structural role to a coaching/repair path without judging its view. */
export function repairPathForRole(role: ArgumentRole): StructuralRepairPath {
  switch (role) {
    case "evidence": return "evidence-verification";
    case "rebuttal":
    case "counterexample": return "rebuttal-compare";
    case "reasoning": return "reasoning-bridge";
    case "concession":
    case "qualification": return "concession-qualification";
    case "question": return "question-clarification";
    case "off-topic": return "off-topic-lightweight";
    default: return "general-repair";
  }
}

const CONTRASTIVE_RE = /\b(however|but|although|while|even if|yet|conversely|on the contrary)\b/i;
const REASONING_RE = /\b(because|therefore|so|means|leads to|results in|as a result|since)\b/i;
const WEIGHING_RE = /\b(outweighs?|more important|matters more|bigger (?:deal|impact)|higher stakes|more likely|less likely)\b/i;
const SOURCE_RE = /\b(according to|study|studies|data|report|survey|research|analysis|finds?|shows?|\d{2,}%|\$\d|Pew|NREL|Lazard|OECD|NIST|WHO|Reuters|Nature|Brookings|IMF|IEA)\b/i;
const NAMED_SOURCE_RE = /\b(Pew(?: Research Center)?|NREL|Lazard|OECD|NIST|WHO|Reuters|Nature|Brookings|IMF|IEA|World Bank|NASA|NOAA|AP(?: News)?)\b|\b[Aa]ccording to\s+[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\b|\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\s+(?:study|report|research|survey|data)\b/;
const FACTUAL_DETAIL_RE = /(?:\b\d+(?:\.\d+)?%?\b|\$\s?\d|\b(?:19|20)\d{2}\b|\b(?:rose|fell|increased|decreased|reduced|grew|declined|found|reported|estimated)\b)/i;
const ABSOLUTE_RE = /\b(always|never|everyone knows|obviously|definitely|proves|guarantees)\b/i;
const RESPONSE_MOVE_RE = /\b(however|but|although|even if|that assumes|that ignores|depends on|only if|unless|concede|grant|outweigh|narrow|does not follow|fails because)\b/i;
const COMPARISON_RE = /\b(outweighs?|more important|higher stakes|more likely|less likely|rather than|compared (?:with|to)|versus|vs\.?|whereas|than)\b/i;
const CUE_WORD_RE = /\b(however|although|even if|because|therefore|according to|study|report|research|matters more|outweighs?|more important)\b/gi;

const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "before", "being", "between", "could", "does", "doing",
  "from", "have", "however", "into", "more", "most", "other", "should", "since", "than", "that", "their",
  "there", "therefore", "these", "they", "this", "those", "through", "very", "what", "when", "where", "which",
  "while", "with", "would", "your",
]);

function ownNodes(graph: ArgGraph): ArgNode[] {
  return graph.nodes.filter((node) => node.owner === "a");
}

function nodeById(graph: ArgGraph, id: string): ArgNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function displayFallacy(fallacy: Fallacy): string {
  return fallacy.replaceAll("_", " ");
}

function firstOwnClaim(graph: ArgGraph): ArgNode | undefined {
  return ownNodes(graph).find((node) => node.kind === "claim") ?? ownNodes(graph)[0];
}

/**
 * Pick one concrete repair from the user's graph. The order is intentional:
 * repair a verifiable claim first, then a reasoning failure, then engagement
 * and impact. This keeps the exercise grounded in observable graph facts.
 */
export function pickRepairTarget(graph: ArgGraph): RepairTarget | null {
  const own = ownNodes(graph);
  if (!own.length) return null;

  const unsupported = graph.evidenceStats.unsupportedClaimIds
    .map((id) => nodeById(graph, id))
    .find((node) => node?.owner === "a" && node.kind === "claim");
  if (unsupported) {
    return {
      kind: "evidence",
      label: "Unsupported claim",
      title: "Ground the weak link",
      prompt: "Rewrite this claim with one concrete, named source or data point. Keep the claim, add the support.",
      sourceText: unsupported.text,
      sourceNodeId: unsupported.id,
    };
  }

  const ownFallacy = graph.fallacies.find((tag) => nodeById(graph, tag.nodeId)?.owner === "a");
  if (ownFallacy) {
    const node = nodeById(graph, ownFallacy.nodeId) ?? firstOwnClaim(graph);
    if (node) {
      return {
        kind: "logic",
        label: `${displayFallacy(ownFallacy.fallacy)} flagged`,
        title: "Replace the shortcut",
        prompt: `Rewrite this move without the ${displayFallacy(ownFallacy.fallacy)}. Make the reasoning step explicit instead of relying on the shortcut.`,
        sourceText: node.text,
        sourceNodeId: node.id,
      };
    }
  }

  const ownContradiction = graph.contradictions.find((item) => item.owner === "a");
  if (ownContradiction) {
    const first = nodeById(graph, ownContradiction.a);
    const second = nodeById(graph, ownContradiction.b);
    if (first && second) {
      return {
        kind: "structure",
        label: "Self-contradiction",
        title: "Make the position cohere",
        prompt: "Reconcile these two lines in two sentences. Add the condition or distinction that makes your position consistent.",
        sourceText: `${first.text} / ${second.text}`,
        sourceNodeId: first.id,
      };
    }
  }

  // Rebuttal repair target: the CANONICAL unanswered-opportunity set
  // (opportunity.ts) — the same nodes every other layer reads. Owner-agnostic
  // (PvP "b" and solo "ai" both work), chronology- and validity-checked, so
  // a self/future/dangling target can never hide a genuine unanswered
  // opponent argument, and impact/evidence moves are never offered as
  // "unanswered" rebuttal material.
  const unansweredOpportunity = unansweredOpportunitiesBy(graph, "a")[0];
  if (unansweredOpportunity) {
    return {
      kind: "rebuttal",
      label: "Unanswered opposing move",
      title: "Close the rebuttal loop",
      prompt: "Answer this opposing move directly. Identify its strongest point, test the key assumption, and explain what follows. Revise your position if the objection is sound.",
      sourceText: unansweredOpportunity.text,
      sourceNodeId: unansweredOpportunity.id,
    };
  }

  const ownImpacts = own.filter((node) => node.kind === "impact");
  if (!ownImpacts.length) {
    const claim = firstOwnClaim(graph);
    if (claim) {
      return {
        kind: "impact",
        label: "Impact not made explicit",
        title: "Name what changes",
        prompt: "Add the consequence of this claim, then weigh it against the likely downside. End with why it matters for the decision.",
        sourceText: claim.text,
        sourceNodeId: claim.id,
      };
    }
  }

  const longest = [...own].sort((a, b) => b.text.length - a.text.length)[0] ?? firstOwnClaim(graph);
  if (!longest) return null;
  return {
    kind: "clarity",
    label: "Clarity opportunity",
    title: "Make the move easier to follow",
    prompt: "Rewrite this as two short sentences: one clear claim, then the reason or evidence that supports it.",
    sourceText: longest.text,
    sourceNodeId: longest.id,
  };
}

/**
 * Choose a repair target with the classifier's structural hint as a tie
 * breaker. Existing graph facts still win: a role hint cannot manufacture an
 * unsupported claim, an unanswered opportunity, or a fallacy.
 */
export function repairForArgumentRole(
  graph: ArgGraph,
  role: ArgumentRole,
  sourceText?: string,
): RepairTarget | null {
  const base = pickRepairTarget(graph);
  const own = ownNodes(graph);
  const source = sourceText?.trim() || own.at(-1)?.text || base?.sourceText || "";
  if (!source && !base) return null;

  if (role === "evidence") {
    const claim = own.find((node) => node.kind === "claim") ?? own[0];
    if (claim) {
      return {
        kind: "evidence",
        label: "Evidence move",
        title: "Make the support checkable",
        prompt: "Add a named source or concrete data point, then explain which part of the claim it supports.",
        sourceText: source || claim.text,
        sourceNodeId: claim.id,
      };
    }
  }

  if (role === "rebuttal" || role === "counterexample") {
    const opportunity = unansweredOpportunitiesBy(graph, "a")[0];
    if (opportunity) {
      return {
        kind: "rebuttal",
        label: "Compare against the earlier move",
        title: "Close the response loop",
        prompt: "Name the earlier argument you are answering, identify its strongest premise, and explain whether your response defeats or narrows it.",
        sourceText: opportunity.text,
        sourceNodeId: opportunity.id,
      };
    }
  }

  if (role === "question") {
    return {
      kind: "clarity",
      label: "Question move",
      title: "Turn the question into a testable point",
      prompt: "State what the answer would show, then connect the question to the debate motion or to a specific claim.",
      sourceText: source,
      sourceNodeId: own.at(-1)?.id ?? base?.sourceNodeId,
    };
  }

  if (role === "off-topic") {
    return {
      kind: "structure",
      label: "Off-topic move",
      title: "Bring the point back to the motion",
      prompt: "Rewrite this move so it directly names the debate claim, evidence, or consequence it bears on.",
      sourceText: source,
      sourceNodeId: own.at(-1)?.id ?? base?.sourceNodeId,
    };
  }

  return base;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function normalised(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function substantiveTokens(text: string): string[] {
  return (normalised(text).match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function sharedSubstantiveTokens(a: string, b: string): number {
  const bTokens = new Set(substantiveTokens(b));
  return new Set(substantiveTokens(a).filter((token) => bTokens.has(token))).size;
}

function addedSubstantiveTokens(source: string, rewrite: string): number {
  const sourceTokens = new Set(substantiveTokens(source));
  return new Set(substantiveTokens(rewrite).filter((token) => !sourceTokens.has(token))).size;
}

function looksKeywordStuffed(text: string): boolean {
  const words = text.match(/[A-Za-z0-9']+/g) ?? [];
  const cues = text.match(CUE_WORD_RE) ?? [];
  if (cues.length < 4) return false;
  return cues.length / Math.max(1, words.length) >= 0.2;
}

function hasReasoningBridge(text: string): boolean {
  const match = REASONING_RE.exec(text);
  if (!match || match.index === undefined) return false;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return substantiveTokens(before).length >= 2 && substantiveTokens(after).length >= 2;
}

function hasTwoComparedOutcomes(text: string): boolean {
  const match = COMPARISON_RE.exec(text);
  if (!match || match.index === undefined) return false;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const left = new Set(substantiveTokens(before));
  const right = new Set(substantiveTokens(after));
  if (left.size < 3 || right.size < 3) return false;
  const leftOnly = [...left].some((token) => !right.has(token));
  const rightOnly = [...right].some((token) => !left.has(token));
  return leftOnly && rightOnly;
}

function sentenceWordCounts(text: string): number[] {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/).filter(Boolean).length);
}

function finishRepairScore(score: number, signals: string[], complete: boolean): RepairScore {
  const bounded = Math.min(100, complete ? score : Math.min(score, 59));
  return { score: bounded, signals, state: repairStateFromScore(bounded) };
}

/** Score only observable repair moves; this is practice feedback, not a new debate verdict. */
export function scoreRepair(target: RepairTarget, text: string): RepairScore {
  const clean = text.trim();
  const signals: string[] = [];
  if (!clean) return { score: 0, state: "needs_another_pass", signals: ["Write a repair before checking it."] };

  let score = 0;
  const words = clean.match(/[A-Za-z0-9']+/g)?.length ?? 0;
  const sentences = sentenceCount(clean);
  const reasoningBridge = hasReasoningBridge(clean);
  const changedReasoning = addedSubstantiveTokens(target.sourceText, clean) >= 3;
  const keywordStuffed = looksKeywordStuffed(clean);

  if (words >= 15 && words <= 140) {
    score += 10;
    signals.push("enough detail to inspect the reasoning move");
  } else {
    signals.push("aim for 15–140 words");
  }

  let complete = false;

  switch (target.kind) {
    case "evidence": {
      const namedSource = NAMED_SOURCE_RE.test(clean);
      const factualDetail = FACTUAL_DETAIL_RE.test(clean) && substantiveTokens(clean).length >= 6;
      if (namedSource) {
        score += 20;
        signals.push("names a specific source");
      } else {
        signals.push("name a specific source rather than saying only ‘a study’ or ‘research’");
      }
      if (factualDetail) {
        score += 25;
        signals.push("states a concrete factual claim or data point");
      } else {
        signals.push("state what the source actually found or measured");
      }
      if (reasoningBridge) {
        score += 35;
        signals.push("explains how the evidence bears on the claim");
      } else {
        signals.push("add an explicit reasoning link from the evidence to the claim");
      }
      signals.push("source support remains unverified until the cited material is checked");
      complete = namedSource && factualDetail && reasoningBridge && changedReasoning && !keywordStuffed;
      break;
    }
    case "rebuttal": {
      const overlap = sharedSubstantiveTokens(clean, target.sourceText);
      const engagesTarget = overlap >= 2;
      const responseMove = RESPONSE_MOVE_RE.test(clean) || CONTRASTIVE_RE.test(clean);
      if (engagesTarget) {
        score += 25;
        signals.push("refers to the substance of the opposing move");
      } else {
        signals.push("refer to the actual opposing claim or assumption, not just a contrast word");
      }
      if (responseMove) {
        score += 20;
        signals.push("challenges, narrows, concedes, or outweighs part of the objection");
      } else {
        signals.push("show whether you are challenging, narrowing, conceding, or outweighing the objection");
      }
      if (reasoningBridge) {
        score += 35;
        signals.push("explains what follows from the response");
      } else {
        signals.push("explain why your response changes the force of the objection");
      }
      complete = engagesTarget && responseMove && reasoningBridge && changedReasoning && !keywordStuffed;
      break;
    }
    case "logic": {
      if (!ABSOLUTE_RE.test(clean)) {
        score += 20;
        signals.push("avoids absolute-language shortcuts");
      } else {
        signals.push("replace absolute language with a reason");
      }
      if (reasoningBridge) {
        score += 50;
        signals.push("connects two distinct propositions with an explanatory relationship");
      } else {
        signals.push("state a claim and a distinct reason, then explain the relationship between them");
      }
      complete = !ABSOLUTE_RE.test(clean) && reasoningBridge && changedReasoning && !keywordStuffed;
      break;
    }
    case "impact": {
      const compares = COMPARISON_RE.test(clean) || WEIGHING_RE.test(clean);
      const twoOutcomes = hasTwoComparedOutcomes(clean);
      if (compares && twoOutcomes) {
        score += 40;
        signals.push("compares two concrete outcomes");
      } else {
        signals.push("name both competing outcomes and compare them directly");
      }
      if (reasoningBridge) {
        score += 30;
        signals.push("explains why one outcome should carry more weight");
      } else {
        signals.push("explain why the comparison should change the decision");
      }
      complete = compares && twoOutcomes && reasoningBridge && changedReasoning && !keywordStuffed;
      break;
    }
    case "structure": {
      const distinction = CONTRASTIVE_RE.test(clean) || /\b(condition|distinction|depends|unless|except|only when|in cases where)\b/i.test(clean);
      if (distinction) {
        score += 40;
        signals.push("adds a condition or distinction");
      } else {
        signals.push("name the condition that reconciles the two claims");
      }
      if (reasoningBridge) {
        score += 30;
        signals.push("explains how the distinction works");
      } else {
        signals.push("explain why the condition makes the position consistent");
      }
      complete = distinction && reasoningBridge && changedReasoning && !keywordStuffed;
      break;
    }
    case "clarity": {
      const lengths = sentenceWordCounts(clean);
      const focused = sentences >= 2 && lengths.every((length) => length >= 3 && length <= 24);
      const supportRelation = reasoningBridge || SOURCE_RE.test(clean);
      if (focused) {
        score += 35;
        signals.push("separates the move into focused sentences");
      } else {
        signals.push("use a focused claim sentence and a separate supporting sentence");
      }
      if (supportRelation) {
        score += 35;
        signals.push("makes the support for the claim explicit");
      } else {
        signals.push("make the second sentence explain or evidence the first");
      }
      complete = focused && supportRelation && changedReasoning && !keywordStuffed;
      break;
    }
  }

  if (normalised(clean) === normalised(target.sourceText)) {
    return { score: 0, state: "needs_another_pass", signals: ["The rewrite repeats the original move — change or add the reasoning itself.", ...signals] };
  }
  if (!changedReasoning) {
    signals.unshift("The wording changed, but the reasoning did not materially change yet.");
  }
  if (keywordStuffed) {
    signals.unshift("Reasoning cue words are repeated without enough substantive content between them.");
  }
  return finishRepairScore(score, signals, complete);
}
