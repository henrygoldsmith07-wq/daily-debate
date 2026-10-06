import type { FactorRatings } from "@/lib/ratings";
import type { TurnScores } from "@/lib/types";

const LABELS: Record<keyof TurnScores, string> = {
  depth: "Depth",
  evidence: "Evidence",
  logic: "Logic",
  rebuttal: "Rebuttal",
  clarity: "Clarity",
};

const FACTORS = Object.keys(LABELS) as (keyof TurnScores)[];

export default function RatingBreakdown({ ratings }: { ratings: FactorRatings }) {
  return (
    <div className="surface-card flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Recent debate signals</p>
        <p className="tabular text-xs text-ink3">{ratings.roundsScored} rounds scored</p>
      </div>
      <p className="text-xs leading-5 text-ink3">
        Deterministic 0–10 practice indicators averaged over your recent solo turns. These are coaching signals, not a
        competitive or validated ability rating.
      </p>
      <div className="flex flex-col gap-3">
        {FACTORS.map((factor) => {
          const value = ratings[factor];
          return (
            <div key={factor} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-ink3">{LABELS[factor]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${(value / 10) * 100}%`, background: "var(--accent)" }}
                />
              </div>
              <span className="tabular w-10 shrink-0 text-right text-xs text-ink3">{value.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
