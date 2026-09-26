export type GuestSkill = "claim" | "reasoning" | "rebuttal" | "impact" | "evidence";

export interface GuestResponseSignals {
  wordCount: number;
  sentenceCount: number;
  hasClaim: boolean;
  hasReasoning: boolean;
  addressesOpponent: boolean;
  comparesImpacts: boolean;
  namesEvidence: boolean;
}

export interface GuestResponseAssessment {
  signals: GuestResponseSignals;
  strength: string;
  nextMove: string;
  chips: Array<{ label: string; observed: boolean }>;
}

export interface GuestWeakness {
  kind: GuestSkill;
  label: string;
  why: string;
  repairPrompt: string;
}

export interface GuestPracticeAssessment {
  strength: string;
  weakness: GuestWeakness;
  counts: {
    claim: number;
    reasoning: number;
    rebuttal: number;
    impact: number;
    evidence: number;
  };
  sourceResponseIndex: number;
  sourceResponse: string;
  note: string;
}

export interface GuestRepairAssessment {
  succeeded: boolean;
  feedback: string;
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

const CLAIM =
  /\b(should|must|need(?:s)? to|ought to|is|are|will|would|better|worse|effective|harmful|beneficial|important|necessary|unnecessary)\b/i;
const REASONING =
  /\b(because|since|therefore|so that|which means|this means|as a result|leads? to|results? in|causes?|by doing this)\b/i;
const CONTRAST =
  /\b(however|but|although|even if|while|yet|the objection|the concern|that argument|you say|the other side)\b/i;
const IMPACT =
  /\b(on balance|outweighs?|matters more|more important|less important|greater impact|bigger impact|trade-?off|compared with|compared to|whereas|overall)\b/i;
const NAMED_EVIDENCE =
  /\b(according to|study by|research by|report by|report from|data from|survey by|figures from)\s+[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\b|\b[A-Z]{2,8}\s+(data|research|report|study|survey|figures)\b/;

const STOP = new Set([
  "the", "and", "that", "this", "with", "from", "have", "will", "would", "should",
  "could", "their", "there", "they", "them", "because", "about", "into", "than",
  "your", "you", "for", "but", "not", "are", "was", "were", "has", "had", "can",
  "our", "its", "his", "her", "who", "what", "when", "where", "which",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z]{4,}/g)
    ?.filter((token) => !STOP.has(token)) ?? [];
}

function opponentOverlap(response: string, opponent: string): number {
  const responseTokens = new Set(contentWords(response));
  const opponentTokens = new Set(contentWords(opponent));
  let overlap = 0;
  for (const token of responseTokens) {
    if (opponentTokens.has(token)) overlap += 1;
  }
  return overlap;
}

export function inspectGuestResponse(response: string, opponent: string): GuestResponseSignals {
  const wordCount = words(response).length;
  const sentenceCount = sentences(response).length;
  const substantive = wordCount >= 8;
  const overlap = opponentOverlap(response, opponent);

  return {
    wordCount,
    sentenceCount,
    hasClaim: substantive && CLAIM.test(response),
    hasReasoning: wordCount >= 10 && REASONING.test(response),
    addressesOpponent: substantive && ((CONTRAST.test(response) && overlap >= 1) || overlap >= 3),
    comparesImpacts: wordCount >= 12 && IMPACT.test(response) && REASONING.test(response),
    namesEvidence: wordCount >= 8 && NAMED_EVIDENCE.test(response),
  };
}

function bestStrength(signals: GuestResponseSignals, roundIndex: number): string {
  if (signals.comparesImpacts) return "You compared the trade-offs rather than listing points separately.";
  if (roundIndex >= 1 && signals.addressesOpponent) return "You directly engaged with the opposing point instead of talking past it.";
  if (signals.namesEvidence) return "You named a source or dataset, which makes the support checkable.";
  if (signals.hasReasoning) return "You connected your claim to a reason instead of leaving it as an assertion.";
  if (signals.hasClaim) return "Your position is clear enough for the reader to know what you are arguing.";
  return "You completed the response and gave the argument something concrete to work with.";
}

function nextMoveForRound(roundIndex: number, signals: GuestResponseSignals): string {
  if (!signals.hasClaim) return "State one clear position before adding detail.";
  if (!signals.hasReasoning) return "Add the reason your claim follows — not just the claim itself.";
  if (roundIndex >= 1 && !signals.addressesOpponent) {
    return "Answer one specific part of the opposing case before adding a new point.";
  }
  if (roundIndex >= 2 && !signals.comparesImpacts) {
    return "Compare the two sides and explain which consequence matters more, and why.";
  }
  if (!signals.namesEvidence) return "Name a real source, study, report, or dataset that supports one factual claim.";
  return "Keep the same structure, but make the support more specific.";
}

export function assessGuestResponse(
  response: string,
  opponent: string,
  roundIndex: number,
): GuestResponseAssessment {
  const signals = inspectGuestResponse(response, opponent);
  return {
    signals,
    strength: bestStrength(signals, roundIndex),
    nextMove: nextMoveForRound(roundIndex, signals),
    chips: [
      { label: "Claim", observed: signals.hasClaim },
      { label: "Reasoning", observed: signals.hasReasoning },
      { label: "Opponent", observed: signals.addressesOpponent },
      { label: "Impact", observed: signals.comparesImpacts },
      { label: "Evidence", observed: signals.namesEvidence },
    ],
  };
}

const WEAKNESS_COPY: Record<GuestSkill, Omit<GuestWeakness, "kind">> = {
  claim: {
    label: "Claim",
    why: "A reader cannot test or challenge an argument until the position itself is explicit.",
    repairPrompt: "Rewrite one response so the first sentence states exactly what should happen or what you believe is true.",
  },
  reasoning: {
    label: "Reasoning",
    why: "A conclusion is easier to dismiss when the link between the claim and the consequence is missing.",
    repairPrompt: "Rewrite one response with a clear because/therefore chain that explains why the conclusion follows.",
  },
  rebuttal: {
    label: "Rebuttal",
    why: "A debate response is stronger when it answers the opponent's actual point instead of only adding another claim.",
    repairPrompt: "Rewrite one response by naming the opponent's concern, answering it, then returning to your own position.",
  },
  impact: {
    label: "Impact comparison",
    why: "Listing two consequences is not enough; the argument needs a reason one consequence should carry more weight.",
    repairPrompt: "Rewrite the final response so it compares both sides and explains which impact matters more, and why.",
  },
  evidence: {
    label: "Evidence",
    why: "Factual claims are more useful when the reader can tell what source, study, report, or dataset they come from.",
    repairPrompt: "Rewrite one response and name a real source, study, report, or dataset that supports a factual claim.",
  },
};

function selectWeakness(
  assessments: GuestResponseAssessment[],
): { kind: GuestSkill; sourceResponseIndex: number } {
  const counts = {
    claim: assessments.filter((item) => item.signals.hasClaim).length,
    reasoning: assessments.filter((item) => item.signals.hasReasoning).length,
    rebuttal: assessments.filter((item) => item.signals.addressesOpponent).length,
    impact: assessments.filter((item) => item.signals.comparesImpacts).length,
    evidence: assessments.filter((item) => item.signals.namesEvidence).length,
  };

  // Repair the most foundational missing move first. Evidence is valuable,
  // but asking for a citation before the user has made a clear claim or
  // explained why it follows teaches decoration rather than reasoning.
  if (!assessments[0]?.signals.hasClaim || counts.claim < 2) {
    return {
      kind: "claim",
      sourceResponseIndex: Math.max(0, assessments.findIndex((item) => !item.signals.hasClaim)),
    };
  }
  if (!assessments[0]?.signals.hasReasoning || counts.reasoning < 2) {
    return {
      kind: "reasoning",
      sourceResponseIndex: Math.max(0, assessments.findIndex((item) => !item.signals.hasReasoning)),
    };
  }
  if (!assessments[1]?.signals.addressesOpponent) return { kind: "rebuttal", sourceResponseIndex: 1 };
  if (!assessments[2]?.signals.comparesImpacts) return { kind: "impact", sourceResponseIndex: 2 };
  if (counts.evidence === 0) return { kind: "evidence", sourceResponseIndex: 0 };
  const missingEvidenceIndex = assessments.findIndex((item) => !item.signals.namesEvidence);
  return {
    kind: "evidence",
    sourceResponseIndex: missingEvidenceIndex >= 0 ? missingEvidenceIndex : 0,
  };
}

export function assessGuestPractice(
  responses: string[],
  opponents: string[],
): GuestPracticeAssessment {
  const assessments = responses.map((response, index) =>
    assessGuestResponse(response, opponents[index] ?? "", index),
  );
  const counts = {
    claim: assessments.filter((item) => item.signals.hasClaim).length,
    reasoning: assessments.filter((item) => item.signals.hasReasoning).length,
    rebuttal: assessments.filter((item) => item.signals.addressesOpponent).length,
    impact: assessments.filter((item) => item.signals.comparesImpacts).length,
    evidence: assessments.filter((item) => item.signals.namesEvidence).length,
  };
  const selected = selectWeakness(assessments);
  const weaknessBase = WEAKNESS_COPY[selected.kind];
  const sourceResponse = responses[selected.sourceResponseIndex] ?? responses[0] ?? "";

  const strengthAssessment =
    assessments.find((item) => item.signals.addressesOpponent) ??
    assessments.find((item) => item.signals.comparesImpacts) ??
    assessments.find((item) => item.signals.namesEvidence) ??
    assessments.find((item) => item.signals.hasReasoning) ??
    assessments[0];

  return {
    strength: strengthAssessment?.strength ?? "You completed the three-round practice.",
    weakness: { kind: selected.kind, ...weaknessBase },
    counts,
    sourceResponseIndex: selected.sourceResponseIndex,
    sourceResponse,
    note: "Local text checks only — this identifies observable features in what you wrote. It is not a debate score or a validated measure of ability.",
  };
}

export function assessGuestRepair(
  kind: GuestSkill,
  response: string,
  opponent = "",
): GuestRepairAssessment {
  const signals = inspectGuestResponse(response, opponent);
  const substantive = signals.wordCount >= 10;

  const succeeded =
    kind === "claim"
      ? substantive && signals.hasClaim
      : kind === "reasoning"
        ? substantive && signals.hasClaim && signals.hasReasoning
        : kind === "rebuttal"
          ? substantive && signals.addressesOpponent && signals.hasReasoning
          : kind === "impact"
            ? substantive && signals.comparesImpacts && signals.hasReasoning
            : substantive && signals.namesEvidence && signals.hasReasoning;

  if (succeeded) {
    return {
      succeeded: true,
      feedback: `Repair complete: this rewrite now contains the missing ${WEAKNESS_COPY[kind].label.toLowerCase()} move.`,
    };
  }

  const cue =
    kind === "claim"
      ? "State one explicit position."
      : kind === "reasoning"
        ? "Make the claim-to-conclusion link explicit with real reasoning."
        : kind === "rebuttal"
          ? "Refer to a specific part of the opposing point and explain why your answer follows."
          : kind === "impact"
            ? "Compare both consequences and explain why one carries more weight."
            : "Name a real source and explain how it supports the claim.";

  return {
    succeeded: false,
    feedback: `Not there yet. ${cue}`,
  };
}
