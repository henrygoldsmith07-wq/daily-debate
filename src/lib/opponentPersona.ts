// Opponent persona + difficulty — the adversary controls for solo debates.
//
// A persona changes HOW the AI attacks (assumptions, evidence, consistency,
// consequences, pure opposition, domain depth); difficulty changes HOW HARD it
// presses. Both are composed into a single prompt directive string that the
// provider modules append to their instructions. Pure config + composition —
// no model calls, no scoring. The deterministic argument assessment is
// unaffected: personas shape the opponent, never the judge.
//
// "balanced" + "challenging" reproduce the previous single-opponent behaviour
// exactly (empty persona directive, standard difficulty line), so existing
// debates and stored rows keep their meaning.

import type { DebateFormat } from "./sprint";

export type OpponentPersonaId =
  | "balanced"
  | "skeptic"
  | "lawyer"
  | "philosopher"
  | "economist"
  | "devils-advocate"
  | "expert";

export type OpponentDifficulty = "easy" | "challenging" | "expert";

export interface OpponentPersona {
  id: OpponentPersonaId;
  label: string;
  /** One-line hook shown in the picker. */
  tagline: string;
  /** System directive appended to opening + turn prompts (empty for balanced). */
  directive: string;
}

export const OPPONENT_PERSONAS: Record<OpponentPersonaId, OpponentPersona> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    tagline: "Fair all-round sparring partner",
    directive: "",
  },
  skeptic: {
    id: "skeptic",
    label: "The Skeptic",
    tagline: "Attacks hidden assumptions",
    directive:
      "Your signature move is attacking ASSUMPTIONS: surface the hidden premise behind the user's claim and press on whether it actually holds. Ask why anyone should accept it before engaging the conclusion.",
  },
  lawyer: {
    id: "lawyer",
    label: "The Lawyer",
    tagline: "Demands evidence for every claim",
    directive:
      "Your signature move is cross-examining EVIDENCE: demand the specific source, date, or figure behind each claim. Where support is missing, say exactly what evidence would be required and treat unsupported assertions as carrying little weight.",
  },
  philosopher: {
    id: "philosopher",
    label: "The Philosopher",
    tagline: "Tests logical consistency",
    directive:
      "Your signature move is testing LOGICAL CONSISTENCY: probe definitions, expose contradictions between the user's claims, and name the reasoning failure when a step doesn't hold. Push the user to clarify terms before advancing.",
  },
  economist: {
    id: "economist",
    label: "The Economist",
    tagline: "Challenges consequences and tradeoffs",
    directive:
      "Your signature move is weighing CONSEQUENCES: quantify costs and benefits, surface second-order effects and tradeoffs the user ignored, and ask who gains, who pays, and over what time horizon.",
  },
  "devils-advocate": {
    id: "devils-advocate",
    label: "The Devil's Advocate",
    tagline: "Argues the opposite aggressively",
    directive:
      "Your signature move is aggressive opposition: build the strongest possible case AGAINST the user, press every weakness hard, and never concede ground without forcing the user to earn it. Stay fair — attack the argument, never the person — but be relentless.",
  },
  expert: {
    id: "expert",
    label: "The Expert",
    tagline: "Uses deeper domain knowledge",
    directive:
      "Your signature move is DOMAIN DEPTH: bring the field's actual state of knowledge, standard mechanisms, and known counter-examples into the debate. Where the user's claim conflicts with mainstream understanding, say so precisely and name the kind of evidence experts rely on.",
  },
};

export const OPPONENT_PERSONA_LIST: readonly OpponentPersona[] = Object.values(OPPONENT_PERSONAS);

export interface OpponentDifficultySpec {
  id: OpponentDifficulty;
  label: string;
  /** One-line description shown in the picker. */
  description: string;
  directive: string;
}

export const OPPONENT_DIFFICULTIES: Record<OpponentDifficulty, OpponentDifficultySpec> = {
  easy: {
    id: "easy",
    label: "Easy",
    description: "Fewer challenges, hints when you slip",
    directive:
      "Pressure dial — EASY: make ONE simple challenge per turn. If the user makes a good point, concede it briefly. Ask for at most one concrete improvement.",
  },
  challenging: {
    id: "challenging",
    label: "Challenging",
    description: "Standard rigorous sparring",
    directive:
      "Pressure dial — CHALLENGING: challenge the user's response every turn with a specific counter-argument or question.",
  },
  expert: {
    id: "expert",
    label: "Expert",
    description: "Relentless, multi-front pressure",
    directive:
      "Pressure dial — EXPERT: apply relentless pressure each turn — press the weakest specific point, demand the missing evidence, and anticipate the user's next move. Never let unsupported or vague claims pass unremarked, and vary your attack angle between turns.",
  },
};

export const OPPONENT_DIFFICULTY_LIST: readonly OpponentDifficultySpec[] = Object.values(OPPONENT_DIFFICULTIES);

export const DEFAULT_PERSONA: OpponentPersonaId = "balanced";
export const DEFAULT_DIFFICULTY: OpponentDifficulty = "challenging";

/** Validate a client-supplied persona; anything unknown falls back to balanced. */
export function resolvePersona(value: unknown): OpponentPersonaId {
  if (typeof value === "string" && value in OPPONENT_PERSONAS) return value as OpponentPersonaId;
  return DEFAULT_PERSONA;
}

/** Validate a client-supplied difficulty; anything unknown falls back to challenging. */
export function resolveDifficulty(value: unknown): OpponentDifficulty {
  if (typeof value === "string" && value in OPPONENT_DIFFICULTIES) return value as OpponentDifficulty;
  return DEFAULT_DIFFICULTY;
}

const FORMAT_STYLE: Partial<Record<DebateFormat, { opening: string; turn: string; final: string }>> = {
  flash: {
    opening: "Format — FLASH: this debate lasts a single round. Open with one sharp, specific claim in a sentence or two.",
    turn: "Format — FLASH: this is the only round. Deliver your strongest single counter-argument in two or three sentences, then close.",
    final: "Format — FLASH: this is the only round. Deliver your strongest single counter-argument in two or three sentences, then close.",
  },
  "cross-examination": {
    opening:
      "Format — CROSS-EXAMINATION: state your position in one sentence, then put ONE probing question to the user that tests their weakest assumption.",
    turn:
      "Format — CROSS-EXAMINATION: your move must be a probing QUESTION that presses the user's latest answer — at most one framing sentence, then the question. Do not make extended speeches; narrow each round's question to the weakest part of their last answer.",
    final:
      "Format — CROSS-EXAMINATION: final round. Close the cross-examination with your single hardest question — the one their answers have been most exposed on.",
  },
  socratic: {
    opening:
      "Format — SOCRATIC: you ask questions only. Open with a single question that makes the user state their position as a claim. Never state your own thesis or make your own argument in any round; your entire move is one or two linked questions that lead the user to examine their reasoning.",
    turn:
      "Format — SOCRATIC: respond to the user's latest answer with one or two linked QUESTIONS only — never state your own thesis or argue your own case. Lead the user to examine the weakest step in what they just said.",
    final:
      "Format — SOCRATIC: final round. Ask the one question that most exposes what is still unresolved in the user's reasoning.",
  },
};

/** Compose the persona + difficulty directive for the debate's opening move. */
export function openingDirective(
  persona: OpponentPersonaId,
  difficulty: OpponentDifficulty,
  format: DebateFormat,
): string {
  const parts = [
    OPPONENT_PERSONAS[persona].directive,
    OPPONENT_DIFFICULTIES[difficulty].directive,
    FORMAT_STYLE[format]?.opening,
  ].filter((s): s is string => !!s && s.length > 0);
  return parts.join(" ");
}

/**
 * Compose the persona + difficulty directive for a mid-debate opponent move.
 * `isFinalRound` marks the round whose answer will complete the debate, so the
 * format style can shift from probing to closing.
 */
export function turnDirective(
  persona: OpponentPersonaId,
  difficulty: OpponentDifficulty,
  format: DebateFormat,
  isFinalRound: boolean,
): string {
  const style = FORMAT_STYLE[format];
  const parts = [
    OPPONENT_PERSONAS[persona].directive,
    OPPONENT_DIFFICULTIES[difficulty].directive,
    isFinalRound ? style?.final : style?.turn,
  ].filter((s): s is string => !!s && s.length > 0);
  return parts.join(" ");
}
