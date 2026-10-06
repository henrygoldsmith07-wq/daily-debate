"use client";

import type { ArgumentSkillProfile } from "@/lib/skillProfile";

function qualitativeRead(
  score: number | null,
  lowConfidence: boolean,
  range: { min: number | null; max: number | null },
): string {
  if (score === null) return "No observed signal yet";
  if (lowConfidence) return "Early read";
  if (range.max !== null && range.min !== null && range.max !== range.min && score === range.max) return "Stronger signal";
  if (range.max !== null && range.min !== null && range.max !== range.min && score === range.min) return "Current gap";
  return "Mixed evidence";
}

export default function SkillProfileBars({ profile }: { profile: ArgumentSkillProfile }) {
  const lowData = profile.debatesAnalysed < profile.minDebates;
  const scored = profile.dimensions.map((d) => d.score).filter((score): score is number => score !== null);
  const range = {
    min: scored.length ? Math.min(...scored) : null,
    max: scored.length ? Math.max(...scored) : null,
  };

  return (
    <div className="flex flex-col gap-1">
          {lowData && (
        <p className="text-xs text-amber-600 mb-2">
          Only {profile.debatesAnalysed} debate{profile.debatesAnalysed === 1 ? "" : "s"} so far — treat this as an early profile, not an ability rating.
        </p>
      )}
      {profile.dimensions.map((d) => (
        <div key={d.key} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] py-1.5 text-xs last:border-0" aria-label={`${d.label}: ${qualitativeRead(d.score, d.lowConfidence, range)}`}>
          <span className={`w-28 shrink-0 ${d.lowConfidence ? "opacity-60" : "font-medium"}`}>{d.label}</span>
          <span className={`text-right ${d.lowConfidence ? "text-amber-600/80" : "text-ink3"}`}>
            {qualitativeRead(d.score, d.lowConfidence, range)}{d.sampleSize > 0 ? ` · ${d.sampleSize} debate${d.sampleSize === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      ))}
      <p className="mt-2 text-[10px] leading-4 text-ink3">Relative reads compare your own observed debate behaviour. Raw metrics remain available on Progress.</p>
    </div>
  );
}
