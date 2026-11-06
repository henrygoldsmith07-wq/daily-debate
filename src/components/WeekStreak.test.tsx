import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeekStreak from "./WeekStreak";
import { weekDays } from "@/lib/weekStreak";

// 2026-11-01 is a Sunday; its week runs 2026-10-26 to 2026-11-01.
const WEEK = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

describe("WeekStreak", () => {
  it("counts practised days in an ordinary week", () => {
    const html = renderToStaticMarkup(<WeekStreak days={weekDays("2026-11-01", WEEK.slice(0, 3))} />);
    expect(html).toContain("<strong>3</strong> of 7 days this week");
    expect(html).not.toContain("Perfect week");
  });

  it("calls a fully practised week a perfect week", () => {
    const html = renderToStaticMarkup(<WeekStreak days={weekDays("2026-11-01", WEEK)} />);
    expect(html).toContain("Perfect week");
  });

  it("does not count a frozen day towards a perfect week", () => {
    const practised = WEEK.filter((day) => day !== "2026-10-29");
    const html = renderToStaticMarkup(<WeekStreak days={weekDays("2026-11-01", practised, ["2026-10-29"])} />);
    expect(html).not.toContain("Perfect week");
    expect(html).toContain("1 kept by a streak freeze");
  });

  it("shows the stats line only when given one", () => {
    const days = weekDays("2026-11-01", WEEK.slice(0, 1));
    expect(renderToStaticMarkup(<WeekStreak days={days} />)).not.toContain("week-stats");
    expect(renderToStaticMarkup(<WeekStreak days={days} stats="Best streak 12 days · 23 debates" />)).toContain(
      "Best streak 12 days · 23 debates",
    );
  });
});
