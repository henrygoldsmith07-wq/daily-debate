import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeeklyRecapCard from "./WeeklyRecapCard";
import type { WeeklyLoop } from "@/lib/weeklyLoop";

const base = { debates: 0, previousDebates: 0, activeDays: 0, repairAttempts: 0, repairsSucceeded: 0, retestsCompleted: 0, observableTotal: 0, demonstratedRate: null, rateState: "insufficient_evidence" } as unknown as WeeklyLoop;

describe("WeeklyRecapCard", () => {
  it("renders nothing with no activity", () => {
    expect(renderToStaticMarkup(<WeeklyRecapCard loop={base} />)).toBe("");
  });
  it("shows gated line, no rate, when retests are few", () => {
    const html = renderToStaticMarkup(<WeeklyRecapCard loop={{ ...base, debates: 2, activeDays: 2, observableTotal: 1 } as WeeklyLoop} />);
    expect(html).toContain("Not enough measured retests");
    expect(html).not.toContain("%");
  });
});
