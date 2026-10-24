import { describe, expect, it } from "vitest";
import { lapsedRetestNotice } from "./lapsedRetestNotice";
import { lapsedRepairRetests, pendingRepairRetests, type RepairRetestAnchor } from "./repairRetest";

const DAY = 86_400_000;
const now = Date.parse("2026-10-24T12:00:00Z");
const anchor = (id: string, daysAgo: number): RepairRetestAnchor => ({
  repairResultId: id,
  debateId: `d-${id}`,
  targetKind: "evidence",
  attemptedAt: new Date(now - daysAgo * DAY).toISOString(),
  topicId: "t1",
});

describe("lapsedRepairRetests", () => {
  it("lists only expired, unobserved repairs inside the notice window", () => {
    const anchors = [anchor("fresh", 3), anchor("lapsed", 16), anchor("old", 40)];
    expect(lapsedRepairRetests([], anchors, now).map((a) => a.repairResultId)).toEqual(["lapsed"]);
  });
  it("is disjoint from pending retests", () => {
    const anchors = [anchor("fresh", 3), anchor("lapsed", 16)];
    const pending = pendingRepairRetests([], anchors, now).map((a) => a.repairResultId);
    const lapsed = lapsedRepairRetests([], anchors, now).map((a) => a.repairResultId);
    expect(pending).toEqual(["fresh"]);
    expect(lapsed.filter((id) => pending.includes(id))).toEqual([]);
  });
  it("orders newest first and skips unknown kinds", () => {
    const bad = { ...anchor("bad", 20), targetKind: "nope" as never };
    const out = lapsedRepairRetests([], [anchor("a", 20), anchor("b", 15), bad], now);
    expect(out.map((a) => a.repairResultId)).toEqual(["b", "a"]);
  });
});

describe("lapsedRetestNotice", () => {
  it("says closed untested, not pass or fail, and counts extras", () => {
    const one = lapsedRetestNotice("Evidence", 1);
    expect(one).toContain("never tested");
    expect(one).toContain("not a pass or a fail");
    expect(lapsedRetestNotice("Evidence", 3)).toContain("and 2 others");
  });
});
