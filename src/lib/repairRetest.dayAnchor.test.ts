import { describe, expect, it } from "vitest";
import { planRetestMotionForAnchor, repairDayOf } from "./repairRetest";

const TODAY = "2026-10-25";

describe("repairDayOf", () => {
  it("normalises Date and string timestamps to a UTC day", () => {
    expect(repairDayOf(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
    expect(repairDayOf("2026-10-24T01:00:00Z")).toBe("2026-10-24");
  });
  it("returns null for unparseable or missing values", () => {
    expect(repairDayOf("not-a-date")).toBeNull();
    expect(repairDayOf(null)).toBeNull();
    expect(repairDayOf(undefined)).toBeNull();
  });
});

describe("planRetestMotionForAnchor", () => {
  const base = { repairTopicId: "a", sharedTopicId: "a", today: TODAY };
  it("keeps a same-day replay of the repaired topic queued (Date anchor)", () => {
    expect(planRetestMotionForAnchor({ ...base, attemptedAt: new Date("2026-10-25T08:00:00Z") })).toBe("keep-queued");
  });
  it("swaps the motion for a same-topic collision on a later day", () => {
    expect(planRetestMotionForAnchor({ ...base, attemptedAt: "2026-10-24T08:00:00Z" })).toBe("swap-motion");
  });
  it("an unparseable anchor never counts as repaired today: it swaps", () => {
    expect(planRetestMotionForAnchor({ ...base, attemptedAt: "garbage" })).toBe("swap-motion");
    // old behaviour compared String(value).slice(0,10) to today: "2026-10-25" prefix of a bad string matched
    expect(planRetestMotionForAnchor({ ...base, attemptedAt: "2026-10-25 not a date" })).toBe("swap-motion");
  });
  it("serves the shared motion when topics differ, whatever the anchor", () => {
    expect(planRetestMotionForAnchor({ ...base, sharedTopicId: "b", attemptedAt: "garbage" })).toBe("serve-shared");
  });
});
