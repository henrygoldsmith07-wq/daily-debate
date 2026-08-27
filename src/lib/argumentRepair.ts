import type { ArgGraph, ArgNode, Fallacy } from "./argGraph";

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
}

const CONTRASTIVE_RE = /\b(however|but|although|while|even if|yet|conversely|on the contrary)\b/i;
const REASONING_RE = /\b(because|therefore|so|means|leads to|results in|as a result|since)\b/i;
const WEIGHING_RE = /\b(outweighs?|more important|matters more|bigger (?:deal|impact)|higher stakes|more likely|less likely)\b/i;
const SOURCE_RE = /\b(according to|study|studies|data|report|survey|research|analysis|finds?|shows?|\d{2,}%|\$\d|Pew|NREL|Lazard|OECD|NIST|WHO|Reuters|Nature|Brookings|IMF|IEA)\b/i;
const ABSOLUTE_RE = /\b(always|never|everyone knows|obviously|definitely|proves|guarantees)\b/i;

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

  const opponentMoves = graph.nodes.filter(
    (node) => node.owner === "ai" && ["counterclaim", "claim", "impact"].includes(node.kind),
  );
  const targeted = new Set(
    own.filter((node) => node.kind === "rebuttal").flatMap((node) => node.targets ?? []),
  );
  const unanswered = opponentMoves.find((node) => !targeted.has(node.id));
  if (unanswered) {
    return {
      kind: "rebuttal",
      label: "Unanswered opposing move",
      title: "Close the rebuttal loop",
      prompt: "Answer this opposing move directly. Name what they got right, target the key assumption, and explain why your case still wins.",
      sourceText: unanswered.text,
      sourceNodeId: unanswered.id,
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

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

/** Score only observable repair moves; this is practice feedback, not a new debate verdict. */
export function scoreRepair(target: RepairTarget, text: string): RepairScore {
  const clean = text.trim();
  const signals: string[] = [];
  if (!clean) return { score: 0, signals: ["Write a repair before checking it."] };

  let score = 0;
  const words = clean.match(/[A-Za-z0-9']+/g)?.length ?? 0;
  const sentences = sentenceCount(clean);

  if (words >= 15 && words <= 140) {
    score += 20;
    signals.push("substantive length");
  } else {
    signals.push("aim for 15–140 words");
  }

  if (sentences >= 2) {
    score += 10;
    signals.push("clear sentence structure");
  }

  switch (target.kind) {
    case "evidence":
      if (SOURCE_RE.test(clean)) {
        score += 55;
        signals.push("names evidence or a source");
      } else {
        signals.push("name a source, study, report, or data point");
      }
      if (REASONING_RE.test(clean)) {
        score += 15;
        signals.push("connects the evidence to the claim");
      }
      break;
    case "rebuttal":
      if (CONTRASTIVE_RE.test(clean)) {
        score += 35;
        signals.push("uses a direct contrast");
      } else {
        signals.push("use a contrast such as ‘however’ or ‘even if’");
      }
      if (REASONING_RE.test(clean)) {
        score += 25;
        signals.push("explains why the response matters");
      }
      break;
    case "logic":
      if (!ABSOLUTE_RE.test(clean)) {
        score += 30;
        signals.push("avoids absolute-language shortcuts");
      } else {
        signals.push("replace absolute language with a reason");
      }
      if (REASONING_RE.test(clean)) {
        score += 35;
        signals.push("states the reasoning bridge");
      } else {
        signals.push("add a because/therefore bridge");
      }
      break;
    case "impact":
      if (WEIGHING_RE.test(clean)) {
        score += 45;
        signals.push("weighs the competing impacts");
      } else {
        signals.push("compare which impact matters more or is more likely");
      }
      if (REASONING_RE.test(clean)) {
        score += 25;
        signals.push("links the impact to the decision");
      }
      break;
    case "structure":
      if (CONTRASTIVE_RE.test(clean) || /\b(condition|distinction|depends|unless|except)\b/i.test(clean)) {
        score += 40;
        signals.push("adds a condition or distinction");
      } else {
        signals.push("name the condition that reconciles the two claims");
      }
      if (REASONING_RE.test(clean)) {
        score += 25;
        signals.push("explains how the distinction works");
      }
      break;
    case "clarity":
      if (sentences >= 2 && clean.split(/\s+/).every(Boolean)) {
        const sentenceLengths = clean.split(/[.!?]+/).filter((part) => part.trim()).map((part) => part.trim().split(/\s+/).length);
        if (sentenceLengths.every((length) => length <= 24)) {
          score += 50;
          signals.push("keeps each sentence focused");
        } else {
          signals.push("keep each sentence under 25 words");
        }
      } else {
        signals.push("separate the claim from its reason");
      }
      if (REASONING_RE.test(clean)) {
        score += 20;
        signals.push("makes the reason explicit");
      }
      break;
  }

  return { score: Math.min(100, score), signals };
}
