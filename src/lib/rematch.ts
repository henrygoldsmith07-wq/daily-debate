/**
 * Rematch options on a fresh result, copied from direct competitors: MindDuel
 * and DebateArena's "switch sides" and the harder rematch most AI debate
 * trainers offer (PublicForumAI, Debatable: raise the AI's level).
 *
 * Both start an ordinary debate on the same motion. Whether it carries a
 * deliberate retest is decided server-side by the same topic-eligibility rule
 * as any other start, so a rematch can never be announced as a test.
 */

import type { OpponentDifficulty } from "./opponentPersona";

export type DebateSide = "for" | "against";

const HARDER: Record<OpponentDifficulty, OpponentDifficulty | null> = {
  easy: "challenging",
  challenging: "expert",
  expert: null,
};

export interface RematchOption {
  id: "other_side" | "harder";
  label: string;
  side: DebateSide;
  difficulty: OpponentDifficulty;
}

export function rematchOptions(side: DebateSide, difficulty: OpponentDifficulty): RematchOption[] {
  const other: DebateSide = side === "for" ? "against" : "for";
  const options: RematchOption[] = [
    { id: "other_side", label: `Argue the other side (${other === "for" ? "For" : "Against"})`, side: other, difficulty },
  ];
  const harder = HARDER[difficulty];
  if (harder) {
    options.push({ id: "harder", label: `Rematch, harder (${harder === "expert" ? "Expert" : "Challenging"})`, side, difficulty: harder });
  }
  return options;
}
