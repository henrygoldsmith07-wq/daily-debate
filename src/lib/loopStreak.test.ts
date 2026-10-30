import { describe, expect, it } from "vitest";
import { buildLoopStreak, streakCopy } from "./loopStreak";

const now = new Date("2026-10-30T12:00:00Z");
describe("buildLoopStreak", () => {
  it("counts consecutive days ending today", () => {
    const s = buildLoopStreak(["2026-10-30T08:00:00Z", "2026-10-29T08:00:00Z", "2026-10-28T23:00:00Z"], "UTC", now);
    expect(s).toMatchObject({ current: 3, longest: 3, activeDays: 3, status: "ok" });
  });
  it("keeps streak alive when last activity was yesterday, breaks after a gap", () => {
    expect(buildLoopStreak(["2026-10-29T08:00:00Z", "2026-10-28T08:00:00Z", "2026-10-27T08:00:00Z"], "UTC", now).current).toBe(3);
    const gap = buildLoopStreak(["2026-10-28T08:00:00Z", "2026-10-27T08:00:00Z", "2026-10-20T08:00:00Z"], "UTC", now);
    expect(gap.current).toBe(0);
    expect(gap.longest).toBe(2);
  });
  it("dedupes same-day entries and uses the learner timezone", () => {
    const s = buildLoopStreak(["2026-10-29T23:30:00Z", "2026-10-29T10:00:00Z"], "Pacific/Auckland", now);
    expect(s.activeDays).toBe(2);
  });
  it("is insufficient_evidence under 3 active days and ignores bad input", () => {
    const s = buildLoopStreak(["2026-10-30T08:00:00Z", null, "nonsense"], "UTC", now);
    expect(s.status).toBe("insufficient_evidence");
    expect(streakCopy(s)).toContain("1 active day so far");
  });
});

describe("loop streak at risk", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  it("flags a live streak with nothing yet today", () => {
    const s = buildLoopStreak(["2026-10-27T10:00:00Z", "2026-10-28T10:00:00Z", "2026-10-29T10:00:00Z"], "UTC", now);
    expect(s.current).toBe(3);
    expect(s.atRisk).toBe(true);
  });
  it("is not at risk once today counts", () => {
    const s = buildLoopStreak(["2026-10-28T10:00:00Z", "2026-10-29T10:00:00Z", "2026-10-30T09:00:00Z"], "UTC", now);
    expect(s.atRisk).toBe(false);
  });
  it("never warns under the sample gate", () => {
    const s = buildLoopStreak(["2026-10-29T10:00:00Z"], "UTC", now);
    expect(s.atRisk).toBe(false);
  });
});
