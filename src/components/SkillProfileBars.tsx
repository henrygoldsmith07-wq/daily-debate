"use client";

import type { ArgumentSkillProfile } from "@/lib/skillProfile";

function bar(score: number | null): string {
  if (score === null) return "\u2591".repeat(10);
  const filled = Math.round(score / 10);
  return "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
}

export default function SkillProfileBars({ profile }: { profile: ArgumentSkillProfile }) {
  const lowData = profile.debatesAnalysed < profile.minDebates;

  return (
    <div className="flex flex-col gap-1">
          {lowData && (
        <p className="text-xs text-amber-600 mb-2">
          Only {profile.debatesAnalysed} debate{profile.debatesAnalysed === 1 ? "" : "s"} so far — scores become reliable at {profile.minDebates}.
        </p>
      )}
      {profile.dimensions.map((d) => (
        <div key={d.key} className="flex items-center gap-3 text-xs" aria-label={`${d.label}: ${d.score ?? "no data"} out of 100`}>
          <span className={`w-28 shrink-0 ${d.lowConfidence ? "opacity-60" : "font-medium"}`}>{d.label}</span>
          <span
            className="tracking-widest tabular select-none"
            style={{ opacity: d.lowConfidence ? 0.5 : 1 }}
            role="meter"
            aria-valuenow={d.score ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {bar(d.score)}
          </span>
          <span className={`tabular w-8 text-right font-bold ${d.lowConfidence ? "opacity-50" : ""}`}>
            {d.score ?? "—"}
          </span>
          {d.lowConfidence && (
            <span className="text-[10px] text-amber-600/80">low confidence</span>
          )}
        </div>
      ))}
      {profile.overallScore !== null && (
        <div className="mt-3 pt-3 border-t border-[var(--rule)] flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-ink3">Overall</span>
          <span className="tabular text-lg font-bold">{profile.overallScore}</span>
        </div>
      )}
    </div>
  );
}
