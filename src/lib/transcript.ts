/**
 * A finished debate as plain text, copied from Practice Debate's full
 * transcripts. Only the motion, the sides and what each side said, in order:
 * no score, no judge output, nothing the learner did not see in the room.
 */

export interface TranscriptTurn {
  round: number;
  opponent: string | null;
  learner: string | null;
}

export interface TranscriptInput {
  topicTitle: string;
  side: "for" | "against";
  /** YYYY-MM-DD the debate is dated by. */
  day: string;
  turns: readonly TranscriptTurn[];
}

const sideLabel = (side: "for" | "against") => (side === "for" ? "For" : "Against");

export function transcriptText(input: TranscriptInput): string {
  const opponentSide = input.side === "for" ? "against" : "for";
  const lines = [
    `Daily Debate · ${input.day}`,
    `Motion: ${input.topicTitle}`,
    `You: ${sideLabel(input.side)} · Opponent (AI): ${sideLabel(opponentSide)}`,
    "",
  ];
  for (const turn of [...input.turns].sort((a, b) => a.round - b.round)) {
    const opponent = turn.opponent?.trim();
    const learner = turn.learner?.trim();
    if (!opponent && !learner) continue;
    lines.push(`Round ${turn.round}`);
    if (opponent) lines.push(`Opponent: ${opponent}`);
    if (learner) lines.push(`You: ${learner}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** A filename that sorts by date and never carries the motion's free text. */
export function transcriptFilename(day: string): string {
  return `daily-debate-${/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "transcript"}.txt`;
}
