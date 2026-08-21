import type { TurnScores } from "@/lib/types";

const LABELS: Record<keyof TurnScores, string> = {
  depth: "Depth",
  evidence: "Evidence",
  logic: "Logic",
  rebuttal: "Rebuttal",
  clarity: "Clarity",
};

function scoreClass(score: number): string {
  if (score >= 8) return "text-[var(--good)]";
  if (score >= 5) return "text-[var(--accent)]";
  return "text-[var(--bad)]";
}

export default function ScoreBadges({ scores }: { scores: TurnScores }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Round scores">
      {(Object.keys(LABELS) as (keyof TurnScores)[]).map((key) => (
        <span
          key={key}
          className={`chip-elevated tabular rounded-full px-2 py-0.5 text-xs ${scoreClass(scores[key])}`}
          title={`${LABELS[key]}: ${scores[key]} out of 10`}
        >
          {LABELS[key]} {scores[key]}/10
        </span>
      ))}
    </div>
  );
}
