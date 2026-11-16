import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PracticeCalendar from "./PracticeCalendar";
import { practiceCalendar } from "@/lib/practiceCalendar";

describe("PracticeCalendar", () => {
  it("renders twelve weeks and the practised-day count", () => {
    const grid = practiceCalendar(["2026-11-06T08:00:00Z", "2026-11-04T08:00:00Z"], "UTC", "2026-11-06");
    const html = renderToStaticMarkup(<PracticeCalendar grid={grid} />);
    expect(html.match(/practice-calendar-week/g)).toHaveLength(12);
    expect(html).toContain("2 days practised in 12 weeks");
    expect(html).toContain("2026-11-06: 1 debate");
  });

  it("renders nothing without a grid", () => {
    expect(renderToStaticMarkup(<PracticeCalendar grid={[]} />)).toBe("");
  });
});
