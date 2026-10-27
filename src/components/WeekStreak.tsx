import type { WeekDay } from "@/lib/weekStreak";

/**
 * Seven dots, Monday to Sunday: filled for a day practised, ringed for today,
 * faint for days still to come. The count says the same thing in words for
 * anyone not reading the dots.
 */
export default function WeekStreak({ days, note }: { days: WeekDay[]; note?: string }) {
  if (days.length !== 7) return null;
  const practised = days.filter((day) => day.practised).length;
  return (
    <div className="week-streak" data-testid="week-streak">
      <ol className="week-streak-days" aria-label={`Practised ${practised} of 7 days this week`}>
        {days.map((day) => (
          <li
            key={day.key}
            className={[
              "week-streak-day",
              day.practised ? "is-practised" : "",
              day.isToday ? "is-today" : "",
              day.isFuture ? "is-future" : "",
            ].join(" ").trim()}
            aria-hidden="true"
          >
            <span className="week-streak-dot" />
            <span className="week-streak-label">{day.label}</span>
          </li>
        ))}
      </ol>
      <p className="week-streak-note">
        <strong>{practised}</strong> of 7 days this week{note ? ` · ${note}` : ""}
      </p>
    </div>
  );
}
