import type { CalendarDay } from "@/lib/practiceCalendar";
import { practisedDayCount } from "@/lib/practiceCalendar";

const ROW_LABELS = ["M", "", "W", "", "F", "", "S"];

/**
 * Twelve weeks of finished debates, one square per day (DebateMaster AI's
 * activity heat map). Darker means more debates finished that day; it is a
 * record of practice, not of how well it went.
 */
export default function PracticeCalendar({ grid }: { grid: CalendarDay[][] }) {
  if (!grid.length) return null;
  const days = practisedDayCount(grid);
  return (
    <section className="surface-card p-4" aria-labelledby="practice-calendar-heading" data-testid="practice-calendar">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="practice-calendar-heading" className="text-sm font-semibold">
          Practice calendar
        </h2>
        <p className="text-xs text-ink3 tabular">
          {days === 1 ? "1 day" : `${days} days`} practised in {grid.length} weeks
        </p>
      </div>
      <div className="practice-calendar" role="img" aria-label={`Debates finished per day over the last ${grid.length} weeks: practised on ${days} days.`}>
        <div className="practice-calendar-labels" aria-hidden="true">
          {ROW_LABELS.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
        {grid.map((week) => (
          <div key={week[0].key} className="practice-calendar-week" aria-hidden="true">
            {week.map((day) => (
              <span
                key={day.key}
                className={`practice-calendar-day level-${day.level}${day.isFuture ? " is-future" : ""}`}
                title={day.isFuture ? undefined : `${day.key}: ${day.count === 1 ? "1 debate" : `${day.count} debates`}`}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
