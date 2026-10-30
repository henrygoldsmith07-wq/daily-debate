import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeeklyLoopPanel from "./WeeklyLoopPanel";
import { buildWeeklyLoop } from "@/lib/weeklyLoop";

describe("WeeklyLoopPanel", () => {
  it("shows the gate message, not a rate, with too few retests", () => {
    const html = renderToStaticMarkup(<WeeklyLoopPanel loop={buildWeeklyLoop({ debates: [], repairs: [], retests: [], pendingRetests: 1 })} />);
    expect(html).toMatch(/Not enough measured retests/);
    expect(html).toMatch(/Take your pending retest/);
    expect(html).toMatch(/Previous 7 days: 0 debates/);
  });
});
